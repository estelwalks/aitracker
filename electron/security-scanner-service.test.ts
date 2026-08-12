import assert from "node:assert/strict";
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

import type { ScanSkillReport } from "skill-scanner";

import {
  SecurityScannerService,
  type SecretStoragePort,
} from "./security-scanner-service.js";

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
  skill: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "tt-security-scanner-"));
  cleanup.push(root);
  const home = join(root, "home");
  const data = join(root, "data");
  const skill = join(home, ".codex", "skills", "demo");
  await mkdir(skill, { recursive: true });
  await writeFile(
    join(skill, "SKILL.md"),
    "---\nname: Demo Skill\n---\n# Safe\n",
    "utf8",
  );
  return { root, home, data, skill };
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
  };
}

const unavailableStorage: SecretStoragePort = {
  isEncryptionAvailable: () => false,
  encrypt: () => {
    throw new Error("must not encrypt");
  },
  decrypt: () => {
    throw new Error("must not decrypt");
  },
};

async function waitForTerminal(service: SecurityScannerService): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (!["running", "cancelling"].includes(service.getStatus().status)) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("scan did not finish");
}

test("discovers managed Skills and passes only bounded relative in-memory files", async () => {
  const { home, data, skill } = await fixture();
  await writeFile(join(skill, "script.sh"), "echo ok\n", "utf8");
  await symlink("/etc/passwd", join(skill, "escape"));
  const requests: unknown[] = [];
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
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
  assert.equal(entry.report?.status, "partial");
  assert.equal(entry.report?.verdict, "unknown");
  assert.deepEqual(entry.report?.skippedFiles, [
    { path: "escape", reasonCode: "symlink", reason: "symlink" },
  ]);
  assert.equal(JSON.stringify(entry).includes(home), false);
});

test("rejects renderer paths and unknown opaque references", async () => {
  const { home, data, skill } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
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

test("requires a model for full scans and automatic full scans report model-required", async () => {
  const { home, data } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
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
  assert.equal(state.status, "model-required");
  assert.equal(state.locale, "en-US");
  const automatic = await service.start({
    scope: "all",
    mode: "full",
    trigger: "automatic",
  });
  assert.equal(automatic.status, "model-required");
});

test("automatic scans default to quick when no model is configured", async () => {
  const { home, data } = await fixture();
  let captured: Record<string, unknown> | undefined;
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
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
  const persisted = JSON.parse(
    await readFile(join(data, "security-scan-history.json"), "utf8"),
  ) as { entries: Array<{ trigger: string }> };
  assert.equal(persisted.entries[0]?.trigger, "automatic");
});

test("automatic scans use full model-aware analysis when a model is configured", async () => {
  const { home, data } = await fixture();
  let captured: Record<string, unknown> | undefined;
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
    locale: () => "ko-KR",
    env: {},
    secretStorage: {
      isEncryptionAvailable: () => true,
      encrypt: (value) => Buffer.from(value).toString("base64"),
      decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
    },
    scanner: (async (request: unknown) => {
      captured = request as Record<string, unknown>;
      return report({ locale: "ko-KR" as never, mode: "full" });
    }) as never,
  });
  await service.setModelConfig({
    provider: "openai",
    endpoint: "https://example.invalid/v1",
    apiKey: "automatic-full-key",
    liteModel: "lite",
    proModel: "pro",
  });
  await service.startAutomaticScan();
  await waitForTerminal(service);
  assert.equal(captured?.mode, "full");
  assert.equal(captured?.locale, "ko-KR");
  assert.equal(
    (captured?.model as { apiKey?: string } | undefined)?.apiKey,
    "automatic-full-key",
  );
  const persisted = JSON.parse(
    await readFile(join(data, "security-scan-history.json"), "utf8"),
  ) as { entries: Array<{ trigger: string; mode: string }> };
  assert.equal(persisted.entries[0]?.trigger, "automatic");
  assert.equal(persisted.entries[0]?.mode, "full");
});

test("scan schedule round-trips, persists, and falls back on corrupt files", async () => {
  const { home, data } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });
  assert.deepEqual(await service.getScanSchedule(), {
    enabled: true,
    cycle: "daily",
  });
  const saved = await service.setScanSchedule({
    enabled: false,
    cycle: "weekly",
  });
  assert.deepEqual(saved, { enabled: false, cycle: "weekly" });
  assert.deepEqual(await service.getScanSchedule(), {
    enabled: false,
    cycle: "weekly",
  });
  assert.deepEqual(
    JSON.parse(
      await readFile(join(data, "security-scan-schedule.json"), "utf8"),
    ),
    { enabled: false, cycle: "weekly" },
  );
  await assert.rejects(
    service.setScanSchedule({ enabled: true, cycle: "monthly" }),
    /Unsupported scan cycle/u,
  );
  await assert.rejects(
    service.setScanSchedule({ enabled: true, cycle: "daily", extra: true }),
    /unsupported fields/u,
  );
  await writeFile(
    join(data, "security-scan-schedule.json"),
    "not json",
    "utf8",
  );
  assert.deepEqual(await service.getScanSchedule(), {
    enabled: true,
    cycle: "daily",
  });
});

test("stores API keys only through encryption and never returns plaintext", async () => {
  const { home, data } = await fixture();
  const encryptedStorage: SecretStoragePort = {
    isEncryptionAvailable: () => true,
    encrypt: (value) =>
      Buffer.from(`sealed:${value}`, "utf8").toString("base64"),
    decrypt: (value) =>
      Buffer.from(value, "base64")
        .toString("utf8")
        .replace(/^sealed:/u, ""),
  };
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
    locale: () => "zh-CN",
    env: {},
    secretStorage: encryptedStorage,
  });
  const view = await service.setModelConfig({
    provider: "openai",
    endpoint: "https://example.invalid/v1",
    apiKey: "super-secret-key",
    liteModel: "lite",
    proModel: "pro",
  });
  assert.equal(view.apiKeyConfigured, true);
  assert.equal("apiKey" in view, false);
  const persisted = await readFile(
    join(data, "security-model-config.json"),
    "utf8",
  );
  assert.equal(persisted.includes("super-secret-key"), false);
  assert.equal(
    JSON.stringify(await service.getModelConfig()).includes("super-secret-key"),
    false,
  );

  const unavailable = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: join(data, "unavailable"),
    locale: () => "zh-CN",
    env: {},
    secretStorage: unavailableStorage,
  });
  await assert.rejects(
    unavailable.setModelConfig({
      provider: "anthropic",
      endpoint: "https://api.anthropic.com/v1",
      apiKey: "must-not-write",
      liteModel: "lite",
      proModel: "pro",
    }),
    /Secure model key storage is unavailable/u,
  );
});

test("decrypts ModelConfig only for an explicit full scan and redacts it from history", async () => {
  const { home, data } = await fixture();
  const encryptedStorage: SecretStoragePort = {
    isEncryptionAvailable: () => true,
    encrypt: (value) => Buffer.from(value, "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
  };
  let captured: Record<string, unknown> | undefined;
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
    locale: () => "en-US",
    env: {},
    secretStorage: encryptedStorage,
    scanner: (async (request: unknown) => {
      captured = request as Record<string, unknown>;
      return report({ locale: "en-US", mode: "full" });
    }) as never,
  });
  await service.setModelConfig({
    provider: "anthropic",
    endpoint: "https://api.anthropic.com/v1",
    apiKey: "sk-test-full-only",
    liteModel: "lite-model",
    proModel: "pro-model",
    timeoutMs: 1_000,
    contextWindowTokens: 200_000,
    maxAgentTurns: 5,
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
    liteModel: "lite-model",
    proModel: "pro-model",
    timeoutMs: 1_000,
    contextWindowTokens: 200_000,
    maxAgentTurns: 5,
  });
  assert.equal(
    JSON.stringify(await service.history()).includes("sk-test-full-only"),
    false,
  );
});

test("runs the real skill-scanner quick engine through the in-memory boundary", async () => {
  const { home, data } = await fixture();
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
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

test("real quick history never projects path assignment or Slack webhook canaries", async () => {
  const { home, data, skill } = await fixture();
  await writeFile(
    join(skill, "SKILL.md"),
    "# Canary\npath=/Users/alice/private/token.txt\nhttps://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX;/Users/alice/private.txt\n",
    "utf8",
  );
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
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
  const { home, data, skill } = await fixture();
  await writeFile(
    join(skill, "SKILL.md"),
    "---\nname: /Users/alice/private https://hooks.slack.com/services/T/B/S\n---\n",
    "utf8",
  );
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
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
  const { home, data } = await fixture();
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
    dataDirectory: data,
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

  await writeFile(
    join(data, "security-scan-history.json"),
    JSON.stringify({
      version: 1,
      entries: [
        {
          ...entry,
          skillName: "/Users/private/skill",
          apiKey: "history-must-not-project-this",
        },
      ],
    }),
    "utf8",
  );
  const [projected] = await service.history();
  assert.equal(projected.skillName, "Skill");
  assert.equal(
    JSON.stringify(projected).includes("history-must-not-project-this"),
    false,
  );
});

test("does not follow a file exchanged for a symlink after directory enumeration", async () => {
  const { root, home, data, skill } = await fixture();
  const outside = join(root, "outside.txt");
  await writeFile(outside, "TOCTOU-CANARY-SECRET", "utf8");
  let exchanged = false;
  let scannerCalled = false;
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
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
  const { home, data } = await fixture();
  const apiKey = "canary-api-key-value-123456";
  const storage: SecretStoragePort = {
    isEncryptionAvailable: () => true,
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
  };
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
    dataDirectory: data,
    locale: () => "zh-CN",
    env: {},
    secretStorage: storage,
    scanner: (async () => tainted) as never,
  });
  await service.setModelConfig({
    provider: "openai",
    endpoint: "https://example.invalid/v1",
    apiKey,
    liteModel: "lite",
    proModel: "pro",
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

  const historyPath = join(data, "security-scan-history.json");
  const tampered = JSON.parse(await readFile(historyPath, "utf8")) as {
    entries: Array<{ report: { summary: string } }>;
  };
  tampered.entries[0].report.summary = `READ-CANARY ${apiKey} /Users/alice/private`;
  await writeFile(historyPath, JSON.stringify(tampered), "utf8");
  const reread = JSON.stringify(await service.history());
  assert.equal(reread.includes(apiKey), false);
  assert.equal(reread.includes("/Users/alice"), false);
});

test("clear removes encrypted model configuration and scan history", async () => {
  const { home, data } = await fixture();
  const storage: SecretStoragePort = {
    isEncryptionAvailable: () => true,
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
  };
  const service = new SecurityScannerService({
    homeDirectory: home,
    dataDirectory: data,
    locale: () => "zh-CN",
    env: {},
    secretStorage: storage,
  });
  await service.setModelConfig({
    provider: "openai",
    endpoint: "https://example.invalid/v1",
    apiKey: "clear-me-secret",
    liteModel: "lite",
    proModel: "pro",
  });
  const [target] = await service.listSkills();
  await service.start({
    scope: "single",
    skillRef: target.skillRef,
    mode: "quick",
  });
  await waitForTerminal(service);
  const savingDuringReset = service.setModelConfig({
    provider: "openai",
    endpoint: "https://new.invalid/v1",
    apiKey: "NEW-AFTER-CLEAR",
    liteModel: "new-lite",
    proModel: "new-pro",
  });
  const clearing = service.clear();
  await Promise.all([savingDuringReset, clearing]);
  assert.equal((await service.getModelConfig()).configured, false);
  assert.deepEqual(await service.history(), []);
  await assert.rejects(
    readFile(join(data, "security-model-config.json")),
    /ENOENT/u,
  );
});

test("clear invalidates a deferred full run before it can restore history", async () => {
  const { home, data } = await fixture();
  const storage: SecretStoragePort = {
    isEncryptionAvailable: () => true,
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
  };
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
    dataDirectory: data,
    locale: () => "ja-JP",
    env: {},
    secretStorage: storage,
    scanner: (async () => {
      markEntered();
      return deferred;
    }) as never,
  });
  await service.setModelConfig({
    provider: "openai",
    endpoint: "https://example.invalid/v1",
    apiKey: "CLEAR-RACE-API-KEY-CANARY",
    liteModel: "lite",
    proModel: "pro",
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
    service.setModelConfig({
      provider: "openai",
      endpoint: "https://example.invalid/v1",
      apiKey: "NEW-AFTER-CLEAR",
      liteModel: "lite",
      proModel: "pro",
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
  await assert.rejects(
    readFile(join(data, "security-scan-history.json"), "utf8"),
    /ENOENT/u,
  );
  await assert.rejects(
    readFile(join(data, "security-model-config.json"), "utf8"),
    /ENOENT/u,
  );
});

test("projects binary, size, depth and unreadable-directory limits as stable reason codes", async () => {
  const { home, data, skill } = await fixture();
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
    dataDirectory: data,
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
  assert.equal(codes.has("unavailable"), true);
});
