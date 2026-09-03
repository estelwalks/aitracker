import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ScanDependencies,
  ScanSkillReport,
} from "@estelwalks/agent-threat-scanner";

import {
  SecurityScannerService,
  type SecretStoragePort,
  type SecurityScannerPersistence,
} from "./security-scanner-service.js";
import { securityScannerUserAgent } from "./security-scanner-http.js";

const rootPackageJson = createRequire(import.meta.url)("../package.json") as {
  readonly version: string;
};
import type { ModelConfig } from "@estelwalks/agent-threat-scanner";

const cleanup: string[] = [];
test.afterEach(async () => {
  persistedHistory = [];
  persistedSchedule = null;
  persistedModel = undefined;
  persistedModelError = undefined;
  persistedRun = null;
  persistedScheduleRuntime = null;
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  root: string;
  home: string;
  skill: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "aitracker-security-scanner-"));
  cleanup.push(root);
  const home = join(root, "home");
  const skill = join(home, ".codex", "skills", "demo");
  await mkdir(skill, { recursive: true });
  await writeFile(
    join(skill, "SKILL.md"),
    "---\nname: Demo Skill\n---\n# Safe\n",
    "utf8",
  );
  return { root, home, skill };
}

function report(
  input: { locale?: "zh-CN" | "en-US"; mode?: "quick" | "full" } = {},
): ScanSkillReport {
  return {
    status: "complete",
    mode: input.mode ?? "quick",
    verdict: "allow",
    riskScore: 100,
    rulesVersion: "rules-test",
    engineVersion: "engine-test",
    locale: input.locale ?? "zh-CN",
    contentHash: "a".repeat(64),
    scannedFiles: 1,
    threatLevel: "none",
    threatLevelDisplay: "None",
    categories: {},
    summary: "No findings",
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

let persistedHistory: Awaited<ReturnType<SecurityScannerService["history"]>> =
  [];
let persistedSchedule: Awaited<
  ReturnType<SecurityScannerService["getScanSchedule"]>
> | null = null;
let persistedModel: ModelConfig | undefined;
let persistedModelError: Error | undefined;
let persistedRun: import("./contracts.js").SecurityScanRunRecord | null = null;
let persistedScheduleRuntime:
  import("./contracts.js").SecurityScanScheduleRuntime | null = null;
const testPersistence: SecurityScannerPersistence = {
  readHistory: async () => structuredClone(persistedHistory),
  writeHistory: async (entries) => {
    persistedHistory = structuredClone([...entries]);
  },
  clearHistory: async () => {
    persistedHistory = [];
  },
  readSchedule: async () => structuredClone(persistedSchedule),
  writeSchedule: async (schedule) => {
    persistedSchedule = structuredClone(schedule);
  },
  readScheduleRuntime: async () => structuredClone(persistedScheduleRuntime),
  writeScheduleRuntime: async (runtime) => {
    persistedScheduleRuntime = structuredClone(runtime);
  },
  readLatestRun: async () => structuredClone(persistedRun),
  writeRun: async (run) => {
    persistedRun = structuredClone(run);
  },
  recoverInterruptedRuns: async (finishedAt) => {
    if (persistedRun?.status !== "running" && persistedRun?.status !== "queued")
      return 0;
    persistedRun = {
      ...persistedRun,
      status: "cancelled",
      finishedAt,
      errorCode: "security.scanInterrupted",
    };
    return 1;
  },
  modelConfig: async () => {
    if (persistedModelError) throw persistedModelError;
    return structuredClone(persistedModel);
  },
};

const unavailableStorage: SecretStoragePort & {
  testPersistence: SecurityScannerPersistence;
} = {
  testPersistence,
  isEncryptionAvailable: () => false,
  encrypt: () => {
    throw new Error("must not encrypt");
  },
  decrypt: () => {
    throw new Error("must not decrypt");
  },
};

/**
 * Write the shared model-profile store (S-500 shape, maintained by the
 * settings page) under the fixture home root. Full scans resolve their model
 * from the active profile here; no security-specific config file exists.
 */
async function writeModelProfile(
  _home: string,
  profile: {
    mode?: "official" | "custom";
    protocol?: "openai" | "openai-responses" | "anthropic";
    apiKey?: string;
    endpoint?: string;
    model?: string;
  },
): Promise<void> {
  if (!profile.apiKey) {
    persistedModel = undefined;
    persistedModelError = undefined;
    return;
  }
  const protocol = profile.protocol ?? "openai";
  const model = profile.mode === "official" ? "deepseek-chat" : profile.model;
  persistedModel = model
    ? {
        provider: protocol === "anthropic" ? "anthropic" : "openai",
        endpoint:
          profile.mode === "official"
            ? "https://api.deepseek.com/v1"
            : (profile.endpoint ??
              (protocol === "anthropic"
                ? "https://api.anthropic.com/v1"
                : "https://api.openai.com/v1")),
        apiKey: profile.apiKey,
        liteModel: model,
        proModel: model,
        timeoutMs: 120_000,
        maxAgentTurns: 8,
      }
    : undefined;
}

async function waitForTerminal(service: SecurityScannerService): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (!["running", "cancelling"].includes(service.getStatus().status)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scan did not finish");
}

test("discovers managed Skills and passes only bounded relative in-memory files", async () => {
  const { home, skill } = await fixture();
  await writeFile(join(skill, "script.sh"), "echo ok\n", "utf8");
  if (process.platform !== "win32") {
    await symlink("/etc/passwd", join(skill, "escape"));
  }
  const requests: unknown[] = [];
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "ko-KR",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async (request: unknown) => {
      requests.push(structuredClone(request));
      return report({ locale: "ko-KR" as never });
    }) as never,
  });

  const [target] = await service.listSkills();
  assert.equal(target.name, "demo");
  assert.match(target.skillRef, /^skill:[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(target).includes(home), false);

  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "quick",
  });
  await waitForTerminal(service);
  const request = requests[0] as {
    files: Array<{ path: string; content: string }>;
    paths?: unknown;
    locale: string;
  };
  assert.equal(request.paths, undefined);
  assert.equal(request.locale, "ko-KR");
  assert.deepEqual(
    request.files.map((file) => file.path).sort(),
    ["SKILL.md", "script.sh"].sort(),
  );
  assert.equal(JSON.stringify(request).includes(home), false);

  const [entry] = await service.history();
  assert.equal(
    entry.report?.status,
    process.platform === "win32" ? "complete" : "partial",
  );
  assert.equal(
    entry.report?.verdict,
    process.platform === "win32" ? "allow" : "unknown",
  );
  if (process.platform !== "win32") {
    assert.deepEqual(entry.report?.skippedFiles, [
      { path: "escape", reasonCode: "symlink", reason: "symlink" },
    ]);
  }
  assert.equal(JSON.stringify(entry).includes(home), false);
});

test("single scans can resolve a catalog Skill by its manifest name", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });

  await service.start({
    scope: "single",
    skillName: "Demo Skill",
    mode: "quick",
  });
  await waitForTerminal(service);

  const [entry] = await service.history();
  assert.equal(entry?.status, "complete");
  assert.equal(entry?.skillName, "demo");
});

test("discovers AiPy Skills from its home directory", async () => {
  const { home } = await fixture();
  const skill = join(home, ".aipyapp", "skills", "aipy-demo");
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "# AiPy demo\n", "utf8");
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });

  const target = (await service.listSkills()).find(
    (candidate) => candidate.name === "aipy-demo",
  );
  assert.ok(target);
  assert.deepEqual(target.agents, ["AiPy"]);
});

test("deduplicates the same Skill installed for multiple agents", async () => {
  const { home } = await fixture();
  const duplicate = join(home, ".claude", "skills", "renamed-demo");
  await mkdir(duplicate, { recursive: true });
  await writeFile(
    join(duplicate, "SKILL.md"),
    "---\nname: Demo Skill\n---\n# Safe\n",
    "utf8",
  );
  let scanCalls = 0;
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async () => {
      scanCalls += 1;
      return report();
    }) as never,
  });

  const skills = await service.listSkills();
  assert.equal(skills.length, 1);
  assert.deepEqual(skills[0]?.agents, ["Claude Code", "Codex"]);

  const initial = await service.start({ scope: "all", mode: "quick" });
  assert.equal(initial.progress.discovered, 1);
  assert.equal(initial.progress.queued, 1);
  await waitForTerminal(service);
  assert.equal(scanCalls, 1);
  assert.equal((await service.history()).length, 1);
});

test("rejects renderer paths and unknown opaque references", async () => {
  const { home, skill } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async () => report()) as never,
  });
  await assert.rejects(
    service.start({
      scope: "single",
      skillRef: skill,
      mode: "quick",
      paths: [skill],
    }),
    /unsupported fields/u,
  );
  await assert.rejects(
    service.start({
      scope: "single",
      skillRef: `skill:${"f".repeat(64)}`,
      mode: "quick",
    }),
    /trusted Skill target/u,
  );
});

test("falls back to quick scans when AI model detection is unavailable", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "en-US",
    env: {},
    secretStorage: unavailableStorage,
  });
  const [target] = await service.listSkills();
  const state = await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "full",
  });
  assert.equal(state.status, "running");
  assert.equal(state.mode, "quick");
  assert.equal(state.locale, "en-US");
  await waitForTerminal(service);
  const automatic = await service.start({
    scope: "all",
    mode: "full",
    trigger: "automatic",
  });
  assert.equal(automatic.status, "running");
  assert.equal(automatic.mode, "quick");
  await waitForTerminal(service);

  persistedModelError = new Error("SQLite model profile read failed");
  await assert.rejects(
    service.start({
      scope: "single",
      skillRef: target.skillRef,
      mode: "quick",
    }),
    /SQLite model profile read failed/u,
  );
});

test("upgrades every manual scan to full when AI model detection is available", async () => {
  const { home } = await fixture();
  await writeModelProfile(home, {
    protocol: "openai",
    apiKey: "manual-full-key",
    endpoint: "https://example.invalid/v1",
    model: "test-model",
  });
  let captured: Record<string, unknown> | undefined;
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async (request: unknown) => {
      captured = request as Record<string, unknown>;
      return report({ mode: "full" });
    }) as never,
  });
  const [target] = await service.listSkills();
  const state = await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "quick",
  });
  assert.equal(state.mode, "full");
  await waitForTerminal(service);
  assert.equal(captured?.mode, "full");
  assert.equal(
    (captured?.model as { apiKey?: string })?.apiKey,
    "manual-full-key",
  );
  assert.equal(persistedHistory[0]?.mode, "full");
});

test("automatic scans default to quick when no model is configured", async () => {
  const { home } = await fixture();
  let captured: Record<string, unknown> | undefined;
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "ko-KR",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async (request: unknown) => {
      captured = request as Record<string, unknown>;
      return report({ locale: "ko-KR" as never });
    }) as never,
  });
  await service.startAutomaticScan();
  await waitForTerminal(service);
  assert.equal(captured?.mode, "quick");
  assert.equal(captured?.locale, "ko-KR");
  assert.equal("model" in (captured ?? {}), false);
  assert.equal(persistedHistory[0]?.trigger, "automatic");
});

test("persists an automatic run when every unchanged Skill is skipped", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async (request: {
      files: Array<{ path: string; content: string }>;
    }) => {
      const result = report();
      const hash = createHash("sha256");
      for (const file of [...request.files].sort((left, right) =>
        left.path.localeCompare(right.path),
      ))
        hash.update(file.path).update("\0").update(file.content);
      result.contentHash = hash.digest("hex");
      return result;
    }) as never,
  });

  await service.startAutomaticScan();
  await waitForTerminal(service);
  assert.equal((await service.history()).length, 1);

  const second = await service.startAutomaticScan();
  assert.equal(second.status, "running");
  await waitForTerminal(service);

  const history = await service.history();
  assert.equal(history.length, 2);
  assert.equal(history[0]?.scanId, second.scanId);
  assert.equal(history[0]?.status, "skipped");
  assert.equal(history[0]?.errorCode, "security.scan.unchanged");
  assert.equal(persistedRun?.scanId, second.scanId);
  assert.equal(persistedRun?.trigger, "automatic");
  assert.equal(persistedRun?.status, "complete");
  assert.equal(persistedRun?.queuedCount, 1);
  assert.equal(persistedRun?.completedCount, 0);
  assert.equal(persistedRun?.skippedCount, 1);
});

test("recovers interrupted durable scan runs after restart", async () => {
  const { home } = await fixture();
  persistedRun = {
    scanId: "scan:11111111-1111-4111-8111-111111111111",
    mode: "quick",
    trigger: "automatic",
    locale: "zh-CN",
    status: "running",
    startedAt: "2026-08-25T01:00:00.000Z",
    discoveredCount: 1,
    queuedCount: 1,
    completedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  };
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });

  assert.equal(await service.recoverInterruptedRuns(), 1);
  const status = await service.getScanScheduleStatus();
  assert.equal(status.lastRun?.status, "cancelled");
  assert.equal(status.lastRun?.errorCode, "security.scanInterrupted");
  assert.ok(status.lastRun?.finishedAt);
});

test("automatic scans use full model-aware analysis when a model is configured", async () => {
  const { home } = await fixture();
  let captured: Record<string, unknown> | undefined;
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "ko-KR",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async (request: unknown) => {
      captured = request as Record<string, unknown>;
      return report({ locale: "ko-KR" as never, mode: "full" });
    }) as never,
  });
  await writeModelProfile(home, {
    protocol: "openai",
    apiKey: "automatic-full-key",
    endpoint: "https://example.invalid/v1",
    model: "test-model",
  });
  await service.startAutomaticScan();
  await waitForTerminal(service);
  assert.equal(captured?.mode, "full");
  assert.equal(captured?.locale, "ko-KR");
  assert.deepEqual(captured?.model, {
    provider: "openai",
    endpoint: "https://example.invalid/v1",
    apiKey: "automatic-full-key",
    liteModel: "test-model",
    proModel: "test-model",
    timeoutMs: 120_000,
    maxAgentTurns: 8,
  });
  assert.equal(persistedHistory[0]?.trigger, "automatic");
  assert.equal(persistedHistory[0]?.mode, "full");

  // The persistence adapter withdraws the model as soon as the preference is
  // disabled. Subsequent automatic scans must not retain or send stale config.
  await writeModelProfile(home, {});
  captured = undefined;
  await service.startAutomaticScan();
  await waitForTerminal(service);
  const disabledCapture = captured as Record<string, unknown> | undefined;
  assert.equal(disabledCapture?.mode, "quick");
  assert.equal("model" in (disabledCapture ?? {}), false);
});

const DEFAULT_SCHEDULE = {
  enabled: true,
  cycle: "daily",
  time: "10:00",
  scope: "all",
  agents: [],
  dir: null,
  notify: false,
} as const;

test("scan schedule round-trips and rejects corrupt SQLite state", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });
  assert.deepEqual(await service.getScanSchedule(), DEFAULT_SCHEDULE);
  const saved = await service.setScanSchedule({
    enabled: false,
    cycle: "weekly",
    time: "09:30",
    scope: "all",
    agents: [],
    dir: null,
    notify: true,
  });
  assert.deepEqual(saved, {
    enabled: false,
    cycle: "weekly",
    time: "09:30",
    scope: "all",
    agents: [],
    dir: null,
    notify: true,
  });
  assert.deepEqual(await service.getScanSchedule(), {
    enabled: false,
    cycle: "weekly",
    time: "09:30",
    scope: "all",
    agents: [],
    dir: null,
    notify: true,
  });
  assert.deepEqual(persistedSchedule, {
    enabled: false,
    cycle: "weekly",
    time: "09:30",
    scope: "all",
    agents: [],
    dir: null,
    notify: true,
  });
  await assert.rejects(
    service.setScanSchedule({ ...DEFAULT_SCHEDULE, cycle: "monthly" }),
    /Unsupported scan cycle/u,
  );
  await assert.rejects(
    service.setScanSchedule({ ...DEFAULT_SCHEDULE, extra: true }),
    /unsupported fields/u,
  );
  await assert.rejects(
    service.setScanSchedule({ ...DEFAULT_SCHEDULE, time: "25:00" }),
    /HH:MM/u,
  );
  await assert.rejects(
    service.setScanSchedule({ ...DEFAULT_SCHEDULE, time: "9:00" }),
    /HH:MM/u,
  );
  await assert.rejects(
    service.setScanSchedule({ ...DEFAULT_SCHEDULE, scope: "single" }),
    /Unsupported scan scope/u,
  );
  await assert.rejects(
    service.setScanSchedule({ ...DEFAULT_SCHEDULE, notify: "yes" }),
    /notify must be a boolean/u,
  );
  persistedSchedule = { enabled: true, cycle: "invalid" } as never;
  await assert.rejects(service.getScanSchedule(), /Unsupported scan cycle/u);
});

test("rejects incomplete schedules instead of migrating them on save", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });
  await assert.rejects(
    service.setScanSchedule({ enabled: false, cycle: "daily" }),
    /HH:MM/u,
  );
});

test("rejects an incomplete SQLite schedule row instead of migrating it", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "en-US",
    env: {},
    secretStorage: unavailableStorage,
  });
  persistedSchedule = { enabled: true, cycle: "weekly" } as never;
  await assert.rejects(service.getScanSchedule(), /HH:MM/u);
});

test("parseSchedule normalizes agent/dir scope fields and rejects invalid values", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });
  const agentSaved = await service.setScanSchedule({
    enabled: true,
    cycle: "daily",
    time: "03:00",
    scope: "agent",
    agents: [" Codex ", "Codex", "Codex"],
    dir: null,
    notify: false,
  });
  assert.deepEqual(agentSaved.agents, ["Codex"]);
  const dirSaved = await service.setScanSchedule({
    enabled: true,
    cycle: "daily",
    time: "03:00",
    scope: "dir",
    agents: [],
    dir: "  ",
    notify: false,
  });
  assert.equal(dirSaved.dir, null);
  await assert.rejects(
    service.setScanSchedule({
      ...DEFAULT_SCHEDULE,
      scope: "agent",
      agents: "Codex",
    }),
    /agents must be an array of strings/u,
  );
  await assert.rejects(
    service.setScanSchedule({
      ...DEFAULT_SCHEDULE,
      scope: "agent",
      agents: [42],
    }),
    /agents must be an array of strings/u,
  );
  await assert.rejects(
    service.setScanSchedule({
      ...DEFAULT_SCHEDULE,
      scope: "dir",
      dir: 42,
    }),
    /dir must be a string or null/u,
  );
});

test("automatic scans with agent scope scan only the selected agents' skills", async () => {
  const { home } = await fixture();
  const other = join(home, ".claude", "skills", "other");
  await mkdir(other, { recursive: true });
  await writeFile(
    join(other, "SKILL.md"),
    "---\nname: Other Skill\n---\n# Safe\n",
    "utf8",
  );
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });
  await service.startAutomaticScan({
    ...DEFAULT_SCHEDULE,
    scope: "agent",
    agents: ["Codex"],
  });
  await waitForTerminal(service);
  assert.equal(persistedHistory.length, 1);
  assert.equal(persistedHistory[0]?.skillName, "demo");

  persistedHistory = [];
  await service.startAutomaticScan({
    ...DEFAULT_SCHEDULE,
    scope: "agent",
    agents: ["Claude Code"],
  });
  await waitForTerminal(service);
  assert.equal(persistedHistory.length, 1);
  assert.equal(persistedHistory[0]?.skillName, "other");
});

test("automatic scans with an empty agent selection reject with no trusted targets", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });
  await assert.rejects(
    service.startAutomaticScan({
      ...DEFAULT_SCHEDULE,
      scope: "agent",
      agents: [],
    }),
    /No trusted Skill target was found/u,
  );
});

test("automatic scans with dir scope scan only skills under the directory prefix", async () => {
  const { home } = await fixture();
  const other = join(home, ".claude", "skills", "other");
  await mkdir(other, { recursive: true });
  await writeFile(
    join(other, "SKILL.md"),
    "---\nname: Other Skill\n---\n# Safe\n",
    "utf8",
  );
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });
  // Parent root prefix matches the Codex skill only.
  await service.startAutomaticScan({
    ...DEFAULT_SCHEDULE,
    scope: "dir",
    dir: join(home, ".codex", "skills"),
  });
  await waitForTerminal(service);
  assert.equal(persistedHistory.length, 1);
  assert.equal(persistedHistory[0]?.skillName, "demo");

  // Exact skill-root path still matches.
  persistedHistory = [];
  await service.startAutomaticScan({
    ...DEFAULT_SCHEDULE,
    scope: "dir",
    dir: join(home, ".codex", "skills", "demo"),
  });
  await waitForTerminal(service);
  assert.equal(persistedHistory.length, 1);
  assert.equal(persistedHistory[0]?.skillName, "demo");

  // A dir that matches nothing rejects.
  await assert.rejects(
    service.startAutomaticScan({
      ...DEFAULT_SCHEDULE,
      scope: "dir",
      dir: join(home, ".gemini", "skills"),
    }),
    /No trusted Skill target was found/u,
  );
});

test("automatic directory scans discover an explicitly configured custom root", async () => {
  const { home } = await fixture();
  const customRoot = join(home, "custom-skills", "local-demo");
  await mkdir(customRoot, { recursive: true });
  await writeFile(join(customRoot, "SKILL.md"), "# Safe\n", "utf8");
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });

  await service.startAutomaticScan({
    ...DEFAULT_SCHEDULE,
    scope: "dir",
    dir: customRoot,
  });
  await waitForTerminal(service);

  assert.equal(persistedHistory.length, 1);
  assert.equal(persistedHistory[0]?.skillName, "local-demo");
});

test("resolves the active model profile only for an explicit full scan and redacts it from history", async () => {
  const { home } = await fixture();
  let captured: Record<string, unknown> | undefined;
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "en-US",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async (request: unknown) => {
      captured = request as Record<string, unknown>;
      return report({ locale: "en-US", mode: "full" });
    }) as never,
  });
  await writeModelProfile(home, {
    protocol: "anthropic",
    apiKey: "sk-test-full-only",
    endpoint: "https://api.anthropic.com/v1",
    model: "test-model",
  });
  const [target] = await service.listSkills();
  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "full",
  });
  await waitForTerminal(service);
  assert.deepEqual(captured?.model, {
    provider: "anthropic",
    endpoint: "https://api.anthropic.com/v1",
    apiKey: "sk-test-full-only",
    liteModel: "test-model",
    proModel: "test-model",
    timeoutMs: 120_000,
    maxAgentTurns: 8,
  });
  assert.equal(
    JSON.stringify(await service.history()).includes("sk-test-full-only"),
    false,
  );
});

test("runs the real agent-threat-scanner quick engine through the in-memory boundary", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "ja-JP",
    env: {},
    secretStorage: unavailableStorage,
  });
  const [target] = await service.listSkills();
  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "quick",
  });
  await waitForTerminal(service);
  const [entry] = await service.history();
  assert.equal(entry.status, "complete");
  assert.equal(entry.report?.mode, "quick");
  assert.equal(entry.report?.locale, "ja-JP");
  assert.equal(entry.report?.branches[0]?.name, "static");
  assert.equal(entry.report?.branches[0]?.status, "complete");
  assert.equal(entry.report?.scannedFiles, 1);
});

test("injects the unified UA into the scanner HTTP dependency", async () => {
  let capturedInput: string | undefined;
  let capturedInit: RequestInit | undefined;
  const scanner = async (
    _request: unknown,
    dependencies?: ScanDependencies,
  ): Promise<ScanSkillReport> => {
    assert.ok(dependencies?.fetch);
    await dependencies.fetch("https://model.example/v1/models");
    return report();
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    capturedInput = String(input);
    capturedInit = init;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    const { home } = await fixture();
    const service = new SecurityScannerService({
      homeDirectory: home,
      locale: () => "zh-CN",
      env: {},
      secretStorage: unavailableStorage,
      scanner: scanner as never,
    });
    const [target] = await service.listSkills();
    await service.start({
      scope: "single",
      skillRef: target.skillRef,
      mode: "quick",
    });
    await waitForTerminal(service);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(capturedInput, "https://model.example/v1/models");
  assert.equal(
    new Headers(capturedInit?.headers).get("User-Agent"),
    `AITracker/${rootPackageJson.version} (Electron; +https://github.com/estelwalks/aitracker)`,
  );
  assert.equal(
    securityScannerUserAgent(),
    `AITracker/${rootPackageJson.version} (Electron; +https://github.com/estelwalks/aitracker)`,
  );
});

test("binary files retain skip evidence but finish the scan", async () => {
  const { home, skill } = await fixture();
  await writeFile(join(skill, "payload.exe"), Buffer.from([0, 1, 2]));
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async () => report()) as never,
  });
  const [target] = await service.listSkills();

  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "quick",
  });
  await waitForTerminal(service);

  const [entry] = await service.history();
  assert.equal(service.getStatus().status, "complete");
  assert.equal(entry.status, "complete");
  assert.equal(entry.report?.status, "complete");
  assert.equal(entry.report?.verdict, "allow");
  assert.deepEqual(entry.report?.skippedFiles, [
    { path: "payload.exe", reasonCode: "binary", reason: "binary" },
  ]);
});

test("exhausted AI analysis retries retain branch evidence but finish the scan", async () => {
  const { home } = await fixture();
  const partial = report({ mode: "full" });
  partial.status = "partial";
  partial.verdict = "unknown";
  partial.branches = [
    { name: "static", status: "complete" },
    { name: "ruleReview", status: "complete" },
    { name: "singleFileAnalysis", status: "skipped" },
    {
      name: "multiFileAnalysis",
      status: "failed",
      detail: "retry exhausted",
    },
  ];
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async () => partial) as never,
  });
  await writeModelProfile(home, {
    protocol: "openai",
    apiKey: "sk-test-retry-exhausted",
    model: "test-model",
  });
  const [target] = await service.listSkills();

  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "full",
  });
  await waitForTerminal(service);

  const [entry] = await service.history();
  assert.equal(service.getStatus().status, "complete");
  assert.equal(entry.status, "complete");
  assert.equal(entry.report?.status, "complete");
  assert.equal(entry.report?.verdict, "allow");
  assert.equal(
    entry.report?.branches.find((branch) => branch.name === "multiFileAnalysis")
      ?.status,
    "failed",
  );
});

test("normalizes persisted terminal partial reports from older scans", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async () => report()) as never,
  });
  const [target] = await service.listSkills();
  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "quick",
  });
  await waitForTerminal(service);
  persistedHistory = persistedHistory.map((entry) => ({
    ...entry,
    status: "partial",
    report: entry.report
      ? {
          ...entry.report,
          status: "partial",
          verdict: "unknown",
          branches: [],
          skippedFiles: [],
        }
      : undefined,
  }));

  const [entry] = await service.history();
  assert.equal(entry.status, "complete");
  assert.equal(entry.report?.status, "complete");
  assert.equal(entry.report?.verdict, "allow");
});

test("real quick history never projects path assignment or Slack webhook canaries", async () => {
  const { home, skill } = await fixture();
  await writeFile(
    join(skill, "SKILL.md"),
    "# Canary\npath=/Users/alice/private/token.txt\nhttps://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX;/Users/alice/private.txt\n",
    "utf8",
  );
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "en-US",
    env: {},
    secretStorage: unavailableStorage,
  });
  await service.startAutomaticScan();
  await waitForTerminal(service);
  const history = await service.history();
  assert.ok((history[0]?.report?.findings.length ?? 0) > 0);
  const projected = JSON.stringify(history);
  assert.equal(projected.includes("/Users/alice"), false);
  assert.equal(projected.includes("hooks.slack.com/services"), false);
  assert.equal(projected.includes("XXXXXXXXXXXXXXXXXXXXXXXX"), false);
});

test("discovery projects basename only and never marker metadata", async () => {
  const { home, skill } = await fixture();
  await writeFile(
    join(skill, "SKILL.md"),
    "---\nname: /Users/alice/private https://hooks.slack.com/services/T/B/S\n---\n",
    "utf8",
  );
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });
  const [target] = await service.listSkills();
  assert.equal(target?.name, "demo");
  assert.equal(JSON.stringify(target).includes("/Users/alice"), false);
  assert.equal(JSON.stringify(target).includes("hooks.slack.com"), false);
});

test("rejects an unsafe scanner report instead of persisting an absolute path", async () => {
  const { home } = await fixture();
  const unsafe = report();
  unsafe.findings.push({
    id: "unsafe",
    kind: "secret_access",
    severity: "high",
    source: "static",
    kindDisplay: "Secret access",
    severityDisplay: "High",
    ruleId: "TEST",
    ruleName: "Unsafe path",
    message: "unsafe",
    remediation: "remove",
    weight: 1,
    path: "/Users/private/secret.txt",
  });
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async () => unsafe) as never,
  });
  const [target] = await service.listSkills();
  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "quick",
  });
  await waitForTerminal(service);
  const [entry] = await service.history();
  assert.equal(entry.status, "failed");
  assert.equal(entry.report, undefined);
  assert.equal(JSON.stringify(entry).includes("/Users/private"), false);

  persistedHistory = [
    {
      ...entry,
      skillName: "/Users/private/skill",
      apiKey: "history-must-not-project-this",
    } as never,
  ];
  const [projected] = await service.history();
  assert.equal(projected.skillName, "Skill");
  assert.equal(
    JSON.stringify(projected).includes("history-must-not-project-this"),
    false,
  );
});

test("does not follow a file exchanged for a symlink after directory enumeration", async () => {
  const { root, home, skill } = await fixture();
  const outside = join(root, "outside.txt");
  await writeFile(outside, "TOCTOU-CANARY-SECRET", "utf8");
  let exchanged = false;
  let scannerCalled = false;
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    beforeOpenFile: async (path) => {
      if (exchanged || !path.endsWith("SKILL.md")) return;
      exchanged = true;
      await rename(path, `${path}.original`);
      await symlink(outside, path);
    },
    scanner: (async () => {
      scannerCalled = true;
      return report();
    }) as never,
  });
  const [target] = await service.listSkills();
  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "quick",
  });
  await waitForTerminal(service);
  assert.equal(scannerCalled, false);
  assert.equal(
    JSON.stringify(await service.history()).includes("TOCTOU-CANARY"),
    false,
  );
});

test("sanitizes every free-text report field with exact key and path redaction", async () => {
  const { home } = await fixture();
  const apiKey = "canary-api-key-value-123456";
  const tainted = report({ mode: "full" });
  const poison = `CANARY ${apiKey} path=/Users/alice/private file:///Users/alice/private C:\\Users\\alice\\private https://hooks.slack.com/services/T000/B000/SECRET123 sk-secret-12345678\u0000`;
  tainted.summary = poison;
  tainted.threatLevelDisplay = poison;
  tainted.categories.secret_access = {
    count: 1,
    highestSeverity: "high",
    totalWeight: 1,
    display: poison,
  };
  tainted.findings.push({
    id: "finding",
    kind: "secret_access",
    severity: "high",
    source: "model",
    kindDisplay: poison,
    severityDisplay: poison,
    ruleName: poison,
    message: poison,
    remediation: poison,
    reasoning: poison,
    excerpt: poison,
    weight: 1,
    path: "SKILL.md",
  });
  tainted.rules.push({
    ruleId: "rule",
    ruleName: poison,
    kind: "secret_access",
    severity: "high",
    weight: 1,
    count: 1,
    matches: [{ path: "SKILL.md", excerpt: poison }],
  });
  tainted.branches.push({
    name: "ruleReview",
    status: "failed",
    detail: poison,
  });
  tainted.skippedFiles.push({ path: "asset.bin", reason: poison });
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async () => tainted) as never,
  });
  await writeModelProfile(home, {
    apiKey,
    endpoint: "https://example.invalid/v1",
    model: "test-model",
  });
  const [target] = await service.listSkills();
  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "full",
  });
  await waitForTerminal(service);
  const serialized = JSON.stringify(await service.history());
  for (const forbidden of [
    apiKey,
    "file://",
    "/Users/alice",
    "C:\\Users",
    "hooks.slack.com/services",
    "SECRET123",
    "sk-secret-12345678",
    "\\u0000",
  ])
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  assert.equal(serialized.includes("[redacted-secret]"), true);
  assert.equal(serialized.includes("[redacted-path]"), true);

  const [tampered] = structuredClone(persistedHistory);
  if (tampered?.report) {
    tampered.report.summary = `READ-CANARY ${apiKey} /Users/alice/private`;
  }
  persistedHistory = tampered ? [tampered] : [];
  const reread = JSON.stringify(await service.history());
  assert.equal(reread.includes(apiKey), false);
  assert.equal(reread.includes("/Users/alice"), false);
});

test("clear removes scan history and resets the scanner state", async () => {
  const { home } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });
  const [target] = await service.listSkills();
  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "quick",
  });
  await waitForTerminal(service);
  const clearing = service.clear();
  await assert.rejects(
    service.start({ scope: "all", mode: "quick", trigger: "automatic" }),
    /being cleared/u,
  );
  await clearing;
  assert.equal(service.getStatus().status, "idle");
  assert.deepEqual(await service.history(), []);
  assert.deepEqual(persistedHistory, []);
});

test("clear invalidates a deferred full run before it can restore history", async () => {
  const { home } = await fixture();
  let releaseScanner!: (value: ScanSkillReport) => void;
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const deferred = new Promise<ScanSkillReport>((resolve) => {
    releaseScanner = resolve;
  });
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "ja-JP",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async () => {
      markEntered();
      return deferred;
    }) as never,
  });
  await writeModelProfile(home, {
    apiKey: "CLEAR-RACE-API-KEY-CANARY",
    endpoint: "https://example.invalid/v1",
    model: "test-model",
  });
  const [target] = await service.listSkills();
  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "full",
  });
  await entered;
  const clearing = service.clear();
  await assert.rejects(
    service.start({ scope: "all", mode: "quick", trigger: "automatic" }),
    /being cleared/u,
  );
  await assert.rejects(
    service.setScanSchedule({
      enabled: true,
      cycle: "daily",
      time: "03:00",
      scope: "all",
      agents: [],
      dir: null,
      notify: false,
    }),
    /being cleared/u,
  );
  const late = report({ locale: "ja-JP" as never, mode: "full" });
  late.summary =
    "CLEAR-RACE-REPORT-CANARY /Users/alice/private CLEAR-RACE-API-KEY-CANARY";
  releaseScanner(late);
  await clearing;

  assert.equal(service.getStatus().status, "idle");
  assert.deepEqual(await service.history(), []);
  assert.deepEqual(persistedHistory, []);
});

test("projects binary, size, depth and unreadable-directory limits as stable reason codes", async () => {
  const { home, skill } = await fixture();
  await writeFile(join(skill, "binary.bin"), Buffer.from([0, 1, 2]));
  await writeFile(join(skill, "large.txt"), Buffer.alloc(1_000_001, 65));
  let deep = skill;
  for (let index = 1; index <= 7; index += 1) {
    deep = join(deep, `d${index}`);
    await mkdir(deep);
  }
  await writeFile(join(deep, "hidden.txt"), "hidden", "utf8");
  const unreadable = join(skill, "unreadable");
  await mkdir(unreadable);
  await chmod(unreadable, 0o000);
  const service = new SecurityScannerService({
    homeDirectory: home,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
    scanner: (async () => report()) as never,
  });
  const [target] = await service.listSkills();
  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "quick",
  });
  await waitForTerminal(service);
  await chmod(unreadable, 0o700);
  const [entry] = await service.history();
  const codes = new Set(
    entry.report?.skippedFiles.map((item) => item.reasonCode),
  );
  assert.equal(codes.has("binary"), true);
  assert.equal(codes.has("file-size-limit"), true);
  assert.equal(codes.has("depth-limit"), true);
  if (process.platform !== "win32")
    assert.equal(codes.has("unavailable"), true);
});
