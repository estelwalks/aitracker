import assert from "node:assert/strict";
import { statSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ScanSkillReport } from "skill-scanner";

import type { DesktopLocale } from "../../../../electron/contracts";
import {
  handleSecurityHttpApi,
  SECURITY_API_PREFIX,
  SECURITY_CSRF_HEADER,
  SECURITY_CSRF_VALUE,
} from "../../../../electron/security-http-api";
import type {
  SecurityScannerService,
  SecurityScannerServiceOptions,
} from "../../../../electron/security-scanner-service";
import {
  createDevSecretStorage,
  createDevSecurityScannerService,
  handleSecurityDevRequest,
  localeFromAcceptLanguage,
} from "./security-dev-server.server.ts";

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
  const root = await mkdtemp(join(tmpdir(), "tt-security-dev-"));
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

async function waitForFile(path: string): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    try {
      const details = await stat(path);
      if (details.isFile()) return;
    } catch {
      /* not yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`file was not created: ${path}`);
}

async function waitForTerminal(service: SecurityScannerService): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (!["running", "cancelling"].includes(service.getStatus().status)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scan did not finish");
}

test("isolates dev scan history from the client data directory", async () => {
  const { home, data, client } = await fixture();
  const sentinel = JSON.stringify({ version: 1, entries: [] });
  await mkdir(client, { recursive: true });
  const clientHistoryPath = join(client, "security-scan-history.json");
  await writeFile(clientHistoryPath, sentinel, "utf8");

  const service = createDevSecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
    locale: () => "zh-CN",
    scanner: stubScanner(),
  });

  await service.start({ scope: "all", mode: "quick", trigger: "manual" });
  await waitForTerminal(service);
  assert.equal(service.getStatus().status, "complete");

  // History is written under the isolated dev dataDirectory.
  const devHistory = JSON.parse(
    await readFile(join(data, "security-scan-history.json"), "utf8"),
  ) as { entries: Array<{ report?: { mode?: string } }> };
  assert.equal(devHistory.entries.length, 1);
  assert.equal(devHistory.entries[0]?.report?.mode, "quick");

  // The sibling "client" dir's sentinel history file is never touched.
  assert.equal(await readFile(clientHistoryPath, "utf8"), sentinel);

  // Report entries are present and sanitized (no absolute paths projected).
  const history = await service.history();
  assert.equal(history.length, 1);
  assert.equal(history[0]?.skillName, "demo");
  assert.equal(JSON.stringify(history).includes(home), false);
  assert.equal(JSON.stringify(history).includes(data), false);
});

test("dev secret storage round-trips and persists the key with mode 0o600", async () => {
  const { data } = await fixture();
  const storage = createDevSecretStorage(data);
  assert.equal(storage.isEncryptionAvailable(), true);

  const encoded = storage.encrypt("super-secret-dev-key");
  assert.equal(
    encoded,
    Buffer.from("super-secret-dev-key", "utf8").toString("base64"),
  );
  assert.equal(storage.decrypt(encoded), "super-secret-dev-key");

  const keyPath = join(data, "security-dev-api-key");
  await waitForFile(keyPath);
  assert.equal(await readFile(keyPath, "utf8"), "super-secret-dev-key");
  // POSIX permission bits are meaningless on Windows (Node reports 0o666
  // there); the 0600 contract applies to POSIX platforms only.
  if (process.platform !== "win32") {
    assert.equal(statSync(keyPath).mode & 0o777, 0o600);
  }

  // A fresh instance reads the raw key back from disk.
  const fresh = createDevSecretStorage(data);
  assert.equal(fresh.decrypt(encoded), "super-secret-dev-key");
});

test("full scan without a configured model returns model-required", async () => {
  const { home, data } = await fixture();
  const service = createDevSecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
    locale: () => "zh-CN",
  });
  const state = await service.start({
    scope: "all",
    mode: "full",
    trigger: "manual",
  });
  assert.equal(state.status, "model-required");
  assert.equal(state.mode, "full");
});

test("quick global scan completes and persists a history entry with a report", async () => {
  const { home, data } = await fixture();
  const requests: unknown[] = [];
  const service = createDevSecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
    locale: () => "en-US",
    scanner: stubScanner(requests),
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

test("handleSecurityDevRequest routes only /api/security/* requests", async () => {
  const passthrough = await handleSecurityDevRequest(
    new Request("http://127.0.0.1:8080/"),
  );
  assert.equal(passthrough, null);

  const capability = await handleSecurityDevRequest(
    new Request(`http://127.0.0.1:8080${SECURITY_API_PREFIX}/capability`),
  );
  assert.ok(capability instanceof Response);
  assert.equal(capability.status, 200);
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
