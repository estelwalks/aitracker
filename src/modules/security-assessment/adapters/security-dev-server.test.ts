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

import { APP_DATA_DIR } from "../../../lib/app-config";
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
  migrateLegacyDevHistory,
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

test("dev service appends into a pre-existing shared history without clobbering it", async () => {
  const { home, data } = await fixture();
  // The shared history file already holds desktop-app entries; the dev backend
  // must read-modify-write it, not replace it.
  await mkdir(data, { recursive: true });
  await writeFile(
    join(data, "security-scan-history.json"),
    JSON.stringify({ version: 1, entries: [historyEntry("desktop-1")] }),
    "utf8",
  );

  const service = createDevSecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
    locale: () => "zh-CN",
    scanner: stubScanner(),
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

test("migrates legacy isolated dev history into the shared history, deduped and idempotent", async () => {
  const { home } = await fixture();
  const sharedDir = join(home, APP_DATA_DIR);
  const legacyDir = join(sharedDir, "security-dev");
  await mkdir(legacyDir, { recursive: true });
  await writeFile(
    join(legacyDir, "security-scan-history.json"),
    JSON.stringify({
      version: 1,
      entries: [historyEntry("legacy-1"), historyEntry("legacy-2")],
    }),
    "utf8",
  );
  await writeFile(
    join(sharedDir, "security-scan-history.json"),
    JSON.stringify({
      version: 1,
      entries: [historyEntry("legacy-2"), historyEntry("shared-1")],
    }),
    "utf8",
  );

  migrateLegacyDevHistory(home);
  migrateLegacyDevHistory(home); // idempotent

  const merged = JSON.parse(
    await readFile(join(sharedDir, "security-scan-history.json"), "utf8"),
  ) as { entries: Array<{ id: string }> };
  assert.deepEqual(
    merged.entries.map((entry) => entry.id),
    ["legacy-1", "legacy-2", "shared-1"],
  );
  // The legacy file is left in place for a downgrade path.
  const legacy = JSON.parse(
    await readFile(join(legacyDir, "security-scan-history.json"), "utf8"),
  ) as { entries: unknown[] };
  assert.equal(legacy.entries.length, 2);
});

test("migrateLegacyDevHistory is a no-op when no legacy history exists", async () => {
  const { home } = await fixture();
  migrateLegacyDevHistory(home); // must not throw
  // No shared history is created when there is nothing to migrate.
  await assert.rejects(
    readFile(join(home, APP_DATA_DIR, "security-scan-history.json"), "utf8"),
  );
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
