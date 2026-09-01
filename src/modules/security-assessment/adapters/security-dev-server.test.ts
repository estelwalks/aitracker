import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ScanSkillReport } from "@estelwalks/agent-threat-scanner";

import type {
  DesktopLocale,
  SecurityScanRunRecord,
  SecurityScanSchedule,
  SecurityScanScheduleRuntime,
} from "../../../../electron/contracts";
import {
  handleSecurityHttpApi,
  SECURITY_API_PREFIX,
  SECURITY_CSRF_HEADER,
  SECURITY_CSRF_VALUE,
} from "../../../../electron/security-http-api";
import type {
  SecurityScannerService,
  SecurityScannerPersistence,
  SecurityScannerServiceOptions,
} from "../../../../electron/security-scanner-service";
import type { AutomaticSecurityScanClock } from "../../../../electron/automatic-security-scan-scheduler";
import {
  createDevAutomaticSecurityScanScheduler,
  createDevSecretStorage,
  createDevSecurityScannerService,
  handleSecurityDevRequest,
  localeFromAcceptLanguage,
  toSecurityModelConfig,
} from "./security-dev-server.server.ts";

class DevSchedulerFakeClock implements AutomaticSecurityScanClock {
  #now: number;
  #nextId = 1;
  readonly #timers = new Map<
    number,
    { readonly at: number; readonly handler: () => void }
  >();

  constructor(now: string) {
    this.#now = Date.parse(now);
  }

  now(): Date {
    return new Date(this.#now);
  }

  setTimeout(handler: () => void, delayMs: number): unknown {
    const id = this.#nextId++;
    this.#timers.set(id, { at: this.#now + Math.max(0, delayMs), handler });
    return id;
  }

  clearTimeout(timer: unknown): void {
    this.#timers.delete(timer as number);
  }

  async advanceTo(target: string): Promise<void> {
    const targetTime = Date.parse(target);
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, value]) => value.at <= targetTime)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      this.#now = due[1].at;
      this.#timers.delete(due[0]);
      due[1].handler();
      await Promise.resolve();
    }
    this.#now = targetTime;
  }
}

const cleanup: string[] = [];
test.afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  root: string;
  home: string;
  data: string;
  client: string;
  skill: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "aitracker-security-dev-"));
  cleanup.push(root);
  const home = join(root, "home");
  const data = join(root, "data");
  const client = join(root, "client");
  const skill = join(home, ".claude", "skills", "demo");
  await mkdir(skill, { recursive: true });
  await writeFile(
    join(skill, "SKILL.md"),
    "---\nname: Demo Skill\n---\n# Safe\n",
    "utf8",
  );
  return { root, home, data, client, skill };
}

function report(
  input: { mode?: "quick" | "full"; locale?: DesktopLocale } = {},
): ScanSkillReport {
  return {
    status: "complete",
    mode: input.mode ?? "quick",
    verdict: "allow",
    riskScore: 0,
    rulesVersion: "test",
    engineVersion: "test",
    locale: input.locale ?? "zh-CN",
    contentHash: "0".repeat(64),
    scannedFiles: 1,
    threatLevel: "none",
    threatLevelDisplay: "none",
    categories: {},
    summary: "",
    findings: [],
    rules: [],
    branches: [{ name: "static", status: "complete" }],
    skippedFiles: [],
    tokenUsage: {
      status: "not_applicable",
      requestCount: 0,
      reportedRequestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      byModel: {},
      byBranch: {},
    },
  };
}

/** Schema-valid stub scanner that mirrors `electron/security-scanner-service.test.ts`. */
function stubScanner(
  requests?: unknown[],
): NonNullable<SecurityScannerServiceOptions["scanner"]> {
  return (async (input: unknown) => {
    const request = input as {
      mode: "quick" | "full";
      locale: DesktopLocale;
      files: Array<{ path: string; content: string }>;
    };
    requests?.push(structuredClone(request));
    return {
      ...report({ mode: request.mode, locale: request.locale }),
      scannedFiles: request.files.length,
    };
  }) as never;
}

async function waitForTerminal(service: SecurityScannerService): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (!["running", "cancelling"].includes(service.getStatus().status)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scan did not finish");
}

function historyEntry(id: string): Record<string, string> {
  return {
    id,
    scanId: "scan:11111111-1111-4111-8111-111111111111",
    skillRef: `skill:${"1".repeat(64)}`,
    skillName: `skill-${id}`,
    mode: "quick",
    trigger: "automatic",
    locale: "zh-CN",
    status: "complete",
    startedAt: "2026-08-01T00:00:00.000Z",
    finishedAt: "2026-08-01T00:00:01.000Z",
  };
}

function memoryPersistence(
  initial: readonly Record<string, unknown>[] = [],
  modelConfig?: Awaited<ReturnType<SecurityScannerPersistence["modelConfig"]>>,
): SecurityScannerPersistence {
  let entries = structuredClone(initial) as never[];
  let schedule: SecurityScanSchedule | null = null;
  let runtime: SecurityScanScheduleRuntime | null = null;
  let latestRun: SecurityScanRunRecord | null = null;
  return {
    readHistory: async () => structuredClone(entries),
    writeHistory: async (value) => {
      entries = structuredClone(value) as never[];
    },
    clearHistory: async () => {
      entries = [];
    },
    readSchedule: async () => structuredClone(schedule),
    writeSchedule: async (value) => {
      schedule = structuredClone(value) as never;
    },
    readScheduleRuntime: async () => structuredClone(runtime),
    writeScheduleRuntime: async (value) => {
      runtime = structuredClone(value);
    },
    readLatestRun: async () => structuredClone(latestRun),
    writeRun: async (value) => {
      latestRun = structuredClone(value);
    },
    recoverInterruptedRuns: async () => 0,
    modelConfig: async () => structuredClone(modelConfig),
  };
}

function expectedScannerModel(
  protocol: "openai" | "openai-responses" | "anthropic",
): Record<string, unknown> {
  const explicit = protocol === "openai" ? "openai-completions" : protocol;
  const output: Record<string, unknown> = {
    endpoint: "http://127.0.0.1:11434/v1",
    apiKey: "test-key",
    liteModel: "local-model",
    proModel: "local-model",
    timeoutMs: 120_000,
    maxAgentTurns: 8,
  };
  output.provider = explicit;
  return output;
}

test("dev model adapter defaults off and exposes config only after opt-in", () => {
  const profile = {
    mode: "custom" as const,
    protocol: "openai" as const,
    apiKey: "test-key",
    endpoint: "http://127.0.0.1:11434/v1",
    model: "local-model",
  };
  assert.equal(toSecurityModelConfig(profile, false), undefined);
  assert.deepEqual(
    toSecurityModelConfig(profile, true),
    expectedScannerModel("openai"),
  );
  assert.equal(toSecurityModelConfig(null, true), undefined);
});

test("dev model adapter preserves the explicit Responses protocol for upgraded scanners", () => {
  const profile = {
    mode: "custom" as const,
    protocol: "openai-responses" as const,
    apiKey: "test-key",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-5.2",
  };
  const config = toSecurityModelConfig(profile, true) as Record<
    string,
    unknown
  >;
  assert.equal(config.provider, "openai-responses");
});

test("dev model adapter maps every profile protocol to the scanner contract", () => {
  for (const [profileProtocol, scannerProtocol] of [
    ["openai", "openai-completions"],
    ["openai-responses", "openai-responses"],
    ["anthropic", "anthropic"],
  ] as const) {
    const config = toSecurityModelConfig(
      {
        mode: "custom",
        protocol: profileProtocol,
        apiKey: "test-key",
        endpoint: "https://api.example.com/v1",
        model: "model",
      },
      true,
    ) as Record<string, unknown>;
    assert.equal(config.provider, scannerProtocol);
  }
});

test("dev service appends through its SQLite persistence port without clobbering history", async () => {
  const { home, data } = await fixture();
  const persistence = memoryPersistence([historyEntry("desktop-1")]);

  const service = await createDevSecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    scanner: stubScanner(),
    persistence,
  });

  await service.start({ scope: "all", mode: "quick", trigger: "manual" });
  await waitForTerminal(service);
  assert.equal(service.getStatus().status, "complete");

  const history = await service.history();
  assert.equal(history.length, 2);
  assert.equal(
    history.some((entry) => entry.skillName === "skill-desktop-1"),
    true,
  );
  assert.equal(
    history.some((entry) => entry.skillName === "demo"),
    true,
  );

  // Report entries are present and sanitized (no absolute paths projected).
  assert.equal(JSON.stringify(history).includes(home), false);
  assert.equal(JSON.stringify(history).includes(data), false);
});

test("dev secret adapter round-trips without creating a persistence authority", async () => {
  const { data } = await fixture();
  const storage = createDevSecretStorage();
  assert.equal(storage.isEncryptionAvailable(), true);

  const encoded = storage.encrypt("super-secret-dev-key");
  assert.equal(
    encoded,
    Buffer.from("super-secret-dev-key", "utf8").toString("base64"),
  );
  assert.equal(storage.decrypt(encoded), "super-secret-dev-key");
  await assert.rejects(
    import("node:fs/promises").then(({ stat }) => stat(data)),
  );
});

test("a requested full scan stays local when no model is enabled", async () => {
  const { home } = await fixture();
  const requests: unknown[] = [];
  const service = await createDevSecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    scanner: stubScanner(requests),
    persistence: memoryPersistence(),
  });
  await service.start({
    scope: "all",
    mode: "full",
    trigger: "manual",
  });
  await waitForTerminal(service);

  assert.equal(service.getStatus().status, "complete");
  assert.equal(service.getStatus().mode, "quick");
  assert.equal((requests[0] as { mode?: string } | undefined)?.mode, "quick");
});

test("quick global scan completes and persists a history entry with a report", async () => {
  const { home } = await fixture();
  const requests: unknown[] = [];
  const service = await createDevSecurityScannerService({
    homeDirectory: home,
    locale: () => "en-US",
    scanner: stubScanner(requests),
    persistence: memoryPersistence(),
  });

  await service.start({ scope: "all", mode: "quick", trigger: "manual" });
  await waitForTerminal(service);

  assert.equal(service.getStatus().status, "complete");
  const history = await service.history();
  assert.equal(history.length, 1);
  assert.equal(history[0]?.status, "complete");
  assert.equal(history[0]?.report?.mode, "quick");
  assert.equal(history[0]?.report?.locale, "en-US");
  assert.equal(history[0]?.report?.scannedFiles, 1);
  assert.equal((requests[0] as { files: unknown[] }).files.length, 1);
});

test("dev automatic scans stay quick when disabled and become full only when enabled", async () => {
  const { home } = await fixture();
  const disabledRequests: unknown[] = [];
  const disabled = await createDevSecurityScannerService({
    homeDirectory: home,
    scanner: stubScanner(disabledRequests),
    persistence: memoryPersistence(),
  });
  await disabled.startAutomaticScan();
  await waitForTerminal(disabled);
  assert.equal((disabledRequests[0] as { mode: string }).mode, "quick");
  assert.equal("model" in (disabledRequests[0] as object), false);

  const enabledRequests: unknown[] = [];
  const enabledModel = expectedScannerModel("openai");
  const enabled = await createDevSecurityScannerService({
    homeDirectory: home,
    scanner: stubScanner(enabledRequests),
    persistence: memoryPersistence([], enabledModel as never),
  });
  await enabled.startAutomaticScan();
  await waitForTerminal(enabled);
  assert.equal((enabledRequests[0] as { mode: string }).mode, "full");
  assert.deepEqual(
    (enabledRequests[0] as { model: unknown }).model,
    enabledModel,
  );
});

test("dev runtime arms saved schedules and executes them automatically", async () => {
  const { home } = await fixture();
  const persistence = memoryPersistence();
  const requests: unknown[] = [];
  const clock = new DevSchedulerFakeClock("2026-08-27T08:29:00.000Z");
  let scheduler: ReturnType<
    typeof createDevAutomaticSecurityScanScheduler
  > | null = null;
  const service = await createDevSecurityScannerService({
    homeDirectory: home,
    scanner: stubScanner(requests),
    persistence,
    now: () => clock.now(),
    onScheduleChanged: async (schedule) => {
      await scheduler?.update(schedule);
    },
  });
  scheduler = createDevAutomaticSecurityScanScheduler({
    service,
    persistence,
    clock,
  });
  await scheduler.start();
  await service.setScanSchedule({
    enabled: true,
    cycle: "hourly",
    time: "16:30",
    scope: "all",
    agents: [],
    dir: null,
    notify: false,
  });

  assert.equal(
    (await service.getScanScheduleStatus()).nextRunAt,
    "2026-08-27T09:29:00.000Z",
  );
  await clock.advanceTo("2026-08-27T09:29:00.000Z");
  for (let index = 0; index < 100 && requests.length === 0; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await waitForTerminal(service);

  assert.equal(requests.length, 1);
  assert.equal((await service.history())[0]?.trigger, "automatic");
  assert.equal(
    (await service.getScanScheduleStatus()).nextRunAt,
    "2026-08-27T10:29:00.000Z",
  );
  scheduler.stop();
});

test("handleSecurityDevRequest passes through non-security requests", async () => {
  const passthrough = await handleSecurityDevRequest(
    new Request("http://127.0.0.1:8080/"),
  );
  assert.equal(passthrough, null);
});

const origin = "http://127.0.0.1:43210";

function stubService(
  overrides: Record<string, unknown> = {},
): SecurityScannerService {
  return {
    getRuntimeCapability: () => ({ capability: "detection-only" }),
    listSkills: async () => [],
    getStatus: () => ({ status: "idle" }),
    history: async () => [],
    cancel: () => ({ cancelled: false }),
    start: async (input: unknown) => ({ status: "running", input }),
    ...overrides,
  } as unknown as SecurityScannerService;
}

function post(path: string, body: unknown, headers: HeadersInit = {}): Request {
  return new Request(`${origin}${SECURITY_API_PREFIX}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      [SECURITY_CSRF_HEADER]: SECURITY_CSRF_VALUE,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("HTTP adapter serves capability and enforces CSRF and Origin on mutations", async () => {
  const capability = await handleSecurityHttpApi(
    new Request(`${origin}${SECURITY_API_PREFIX}/capability`),
    origin,
    stubService(),
  );
  assert.equal(capability?.status, 200);
  assert.deepEqual(await capability?.json(), { capability: "detection-only" });

  const headerless = new Request(`${origin}${SECURITY_API_PREFIX}/start`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ scope: "all", mode: "quick" }),
  });
  const noCsrf = await handleSecurityHttpApi(headerless, origin, stubService());
  assert.equal(noCsrf?.status, 403);
  assert.deepEqual(await noCsrf?.json(), {
    error: { code: "security.http.csrf_required" },
  });

  const wrongCsrf = await handleSecurityHttpApi(
    post(
      "/start",
      { scope: "all", mode: "quick" },
      { [SECURITY_CSRF_HEADER]: "wrong" },
    ),
    origin,
    stubService(),
  );
  assert.equal(wrongCsrf?.status, 403);
  assert.deepEqual(await wrongCsrf?.json(), {
    error: { code: "security.http.csrf_required" },
  });

  const wrongOrigin = await handleSecurityHttpApi(
    post(
      "/start",
      { scope: "all", mode: "quick" },
      { origin: "http://evil.invalid" },
    ),
    origin,
    stubService(),
  );
  assert.equal(wrongOrigin?.status, 403);
  assert.deepEqual(await wrongOrigin?.json(), {
    error: { code: "security.http.invalid_origin" },
  });
});

test("localeFromAcceptLanguage maps the first language tag to the desktop locale", () => {
  assert.equal(localeFromAcceptLanguage("zh-CN"), "zh-CN");
  assert.equal(localeFromAcceptLanguage("en-US,en;q=0.9"), "en-US");
  assert.equal(localeFromAcceptLanguage("ja"), "ja-JP");
  assert.equal(localeFromAcceptLanguage("ko"), "ko-KR");
  assert.equal(localeFromAcceptLanguage(null), "zh-CN");
  assert.equal(localeFromAcceptLanguage("fr-FR"), "zh-CN");
});
