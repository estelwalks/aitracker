import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseArgs, UsageError } from "../src/cli/args.js";
import { envModel, isModelComplete, loadConfig, loadDotEnv, parseDotEnv, readConfigFile } from "../src/cli/config.js";
import { main } from "../src/cli/main.js";
import { renderJson, renderSummary } from "../src/cli/output.js";
import type { ParsedArgs } from "../src/cli/args.js";
import { ModelConfigSchema } from "../src/types.js";
import type { ScanSkillReport } from "../src/types.js";

const baseArgs: ParsedArgs = { quick: false, model: {}, json: false, help: false, version: false, verbose: false };

describe("parseArgs", () => {
  it("parses the positional and boolean flags", () => {
    const args = parseArgs(["dir", "--quick", "--json", "--verbose"]);
    expect(args.positional).toBe("dir");
    expect(args.quick).toBe(true);
    expect(args.json).toBe(true);
    expect(args.verbose).toBe(true);
  });
  it("supports --flag=value and kebab-case model flags", () => {
    const args = parseArgs(["--endpoint=https://x/v1", "--api-key", "sk", "--timeout-ms=5000", "--locale", "en-US"]);
    expect(args.model.endpoint).toBe("https://x/v1");
    expect(args.model.apiKey).toBe("sk");
    expect(args.model.timeoutMs).toBe(5000);
    expect(args.locale).toBe("en-US");
  });
  it("throws UsageError for unknown flags, extra positionals, missing values and invalid enums", () => {
    expect(() => parseArgs(["--nope"])).toThrow(UsageError);
    expect(() => parseArgs(["a", "b"])).toThrow(UsageError);
    expect(() => parseArgs(["--mode"])).toThrow(UsageError);
    expect(() => parseArgs(["--mode", "bogus"])).toThrow(UsageError);
    expect(() => parseArgs(["--locale", "xx"])).toThrow(UsageError);
    expect(() => parseArgs(["--provider", "bogus"])).toThrow("invalid provider");
  });
  it("parses --config and --output in both forms", () => {
    const args = parseArgs(["dir", "--config", "c.json", "--output=o.json", "--provider", "openai-responses"]);
    expect(args.config).toBe("c.json");
    expect(args.output).toBe("o.json");
    expect(args.model.provider).toBe("openai-responses");
  });
});

describe("config helpers", () => {
  it("maps LLM_* env vars onto a partial model and ignores invalid numerics", () => {
    const m = envModel({ LLM_PROVIDER: "anthropic", LLM_TIMEOUT_MS: "5000", LLM_CONTEXT_WINDOW_TOKENS: "1000000" });
    expect(m.provider).toBe("anthropic");
    expect(m.timeoutMs).toBe(5000);
    expect(m.contextWindowTokens).toBe(1_000_000);
    expect(envModel({ LLM_TIMEOUT_MS: "abc" }).timeoutMs).toBeUndefined();
    expect(envModel({ LLM_PROVIDER: "bogus" }).provider).toBeUndefined();
  });
  it.each(["openai-responses", "openai-completions", "anthropic", "openai"])("accepts provider %s from env and config schema", (provider) => {
    expect(envModel({ LLM_PROVIDER: provider }).provider).toBe(provider);
    expect(ModelConfigSchema.safeParse({ endpoint: "https://example.com/v1", apiKey: "k", liteModel: "l", proModel: "p", provider }).success).toBe(true);
  });
  it("isModelComplete requires the four core fields", () => {
    expect(isModelComplete({ endpoint: "e", apiKey: "k", liteModel: "l", proModel: "p" })).toBe(true);
    expect(isModelComplete({ endpoint: "e", apiKey: "k" })).toBe(false);
  });
  it("readConfigFile rejects invalid JSON and unknown keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cfg-"));
    try {
      writeFileSync(join(dir, "bad.json"), "{ not json");
      expect(() => readConfigFile(join(dir, "bad.json"))).toThrow("invalid JSON");
      writeFileSync(join(dir, "keys.json"), JSON.stringify({ bogus: 1 }));
      expect(() => readConfigFile(join(dir, "keys.json"))).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("dotenv", () => {
  it("parses KEY=VALUE with comments, quotes and an export prefix", () => {
    const parsed = parseDotEnv("# comment\nLLM_ENDPOINT=https://x/v1\nexport LLM_API_KEY=\"sk-abc\"\n\nEMPTY=\nBAD LINE\nFOO='bar'");
    expect(parsed.LLM_ENDPOINT).toBe("https://x/v1");
    expect(parsed.LLM_API_KEY).toBe("sk-abc");
    expect(parsed.FOO).toBe("bar");
    expect(parsed.EMPTY).toBe("");
    expect(parsed.BAD).toBeUndefined();
  });
  it("loads .env without overriding existing environment variables", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-dotenv-"));
    try {
      writeFileSync(join(dir, ".env"), "LLM_ENDPOINT=https://from-file/v1\nLLM_API_KEY=file-key\nLLM_PROVIDER=openai");
      const env: NodeJS.ProcessEnv = { LLM_ENDPOINT: "https://from-shell/v1" };
      loadDotEnv(env, dir);
      expect(env.LLM_ENDPOINT).toBe("https://from-shell/v1");
      expect(env.LLM_API_KEY).toBe("file-key");
      expect(env.LLM_PROVIDER).toBe("openai");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("loadConfig", () => {
  it("builds a complete model from env and auto-selects full mode", () => {
    const env = { LLM_ENDPOINT: "https://api.example.com/v1", LLM_API_KEY: "k", LLM_LITE_MODEL: "lite", LLM_PRO_MODEL: "pro" };
    const cfg = loadConfig(baseArgs, env, "/tmp");
    expect(cfg.mode).toBe("full");
    expect(cfg.model?.endpoint).toBe("https://api.example.com/v1");
    expect(cfg.modeExplicit).toBe(false);
  });
  it("falls back to quick when the model is incomplete", () => {
    const cfg = loadConfig(baseArgs, { LLM_ENDPOINT: "https://x/v1" }, "/tmp");
    expect(cfg.mode).toBe("quick");
    expect(cfg.model).toBeNull();
  });
  it("rejects an explicit full mode without a complete model", () => {
    expect(() => loadConfig({ ...baseArgs, mode: "full" }, {}, "/tmp")).toThrow("full mode requires");
  });
  it("lets --quick beat a config-file full mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cfg-"));
    try {
      writeFileSync(join(dir, ".skill-scanner.json"), JSON.stringify({ mode: "full", model: { endpoint: "https://x/v1", apiKey: "k", liteModel: "l", proModel: "p" } }));
      const cfg = loadConfig({ ...baseArgs, quick: true }, {}, dir);
      expect(cfg.mode).toBe("quick");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("honors quick and full modes from the config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cfg-"));
    try {
      const model = { endpoint: "https://x/v1", apiKey: "k", liteModel: "l", proModel: "p" };
      writeFileSync(join(dir, ".skill-scanner.json"), JSON.stringify({ mode: "quick", model }));
      const quick = loadConfig(baseArgs, {}, dir);
      expect(quick.mode).toBe("quick");
      expect(quick.model).toBeNull();
      expect(quick.modeExplicit).toBe(true);

      writeFileSync(join(dir, ".skill-scanner.json"), JSON.stringify({ mode: "full", model }));
      const full = loadConfig(baseArgs, {}, dir);
      expect(full.mode).toBe("full");
      expect(full.model?.proModel).toBe("p");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("applies CLI mode over config mode and rejects incomplete configured full mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cfg-"));
    try {
      const model = { endpoint: "https://x/v1", apiKey: "k", liteModel: "l", proModel: "p" };
      writeFileSync(join(dir, ".skill-scanner.json"), JSON.stringify({ mode: "quick", model }));
      expect(loadConfig({ ...baseArgs, mode: "full" }, {}, dir).mode).toBe("full");

      writeFileSync(join(dir, ".skill-scanner.json"), JSON.stringify({ mode: "full" }));
      expect(() => loadConfig(baseArgs, {}, dir)).toThrow("full mode requires");
      expect(loadConfig({ ...baseArgs, mode: "quick" }, {}, dir).mode).toBe("quick");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("ignores a missing default config but rejects damaged default and explicit configs", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cfg-"));
    try {
      expect(loadConfig(baseArgs, {}, dir).mode).toBe("quick");
      const defaultPath = join(dir, ".skill-scanner.json");
      writeFileSync(defaultPath, "{ damaged");
      expect(() => loadConfig(baseArgs, {}, dir)).toThrow("invalid JSON");
      expect(() => loadConfig({ ...baseArgs, config: join(dir, "missing.json") }, {}, dir)).toThrow("cannot read config file");
      expect(() => loadConfig({ ...baseArgs, config: defaultPath }, {}, dir)).toThrow("invalid JSON");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("applies flag over config over env per field", () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cfg-"));
    try {
      writeFileSync(join(dir, ".skill-scanner.json"), JSON.stringify({ model: { endpoint: "https://config/v1", liteModel: "config-lite" } }));
      const env = { LLM_ENDPOINT: "https://env/v1", LLM_API_KEY: "k", LLM_LITE_MODEL: "env-lite", LLM_PRO_MODEL: "env-pro" };
      const cfg = loadConfig({ ...baseArgs, model: { endpoint: "https://flag/v1" } }, env, dir);
      expect(cfg.model?.endpoint).toBe("https://flag/v1");
      expect(cfg.model?.liteModel).toBe("config-lite");
      expect(cfg.model?.apiKey).toBe("k");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("resolves locale by CLI flag then config then env then default", () => {
    expect(loadConfig(baseArgs, {}, "/tmp").locale).toBe("zh-CN");
    expect(loadConfig(baseArgs, { LLM_LOCALE: "ja-JP" }, "/tmp").locale).toBe("ja-JP");
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cfg-"));
    try {
      writeFileSync(join(dir, ".skill-scanner.json"), JSON.stringify({ locale: "ko-KR" }));
      expect(loadConfig(baseArgs, { LLM_LOCALE: "ja-JP" }, dir).locale).toBe("ko-KR");
      expect(loadConfig({ ...baseArgs, locale: "en-US" }, { LLM_LOCALE: "ja-JP" }, dir).locale).toBe("en-US");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("output", () => {
  function makeReport(): ScanSkillReport {
    return {
      status: "complete", mode: "quick", verdict: "block",
      riskScore: 0, rulesVersion: "v", engineVersion: "v", locale: "zh-CN",
      contentHash: "abc", scannedFiles: 1,
      threatLevel: "critical", threatLevelDisplay: "严重",
      categories: { remote_execution: { count: 1, highestSeverity: "high", totalWeight: 45, display: "远程代码/命令执行" } },
      summary: "扫描了 1 个文件，发现风险类别：远程代码/命令执行。",
      findings: [{
        id: "1", kind: "remote_execution", severity: "high", source: "static", kindDisplay: "远程代码/命令执行",
        severityDisplay: "高危", ruleId: "builtin-01", ruleName: "下载脚本管道执行", message: "m", remediation: "r", weight: 45, path: "SKILL.md", line: 1,
      }],
      rules: [{ ruleId: "builtin-01", ruleName: "下载脚本管道执行", kind: "remote_execution", severity: "high", weight: 45, count: 1, matches: [{ path: "SKILL.md", line: 1 }] }],
      branches: [{ name: "static", status: "complete" }],
      skippedFiles: [],
      tokenUsage: { status: "not_applicable", requestCount: 0, reportedRequestCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0, byModel: {}, byBranch: {} },
    };
  }
  it("renders a summary with verdict, score, category and a top finding", () => {
    const text = renderSummary(makeReport());
    expect(text).toContain("verdict=block");
    expect(text).toContain("riskScore=0/100");
    expect(text).toContain("远程代码/命令执行");
    expect(text).toContain("下载脚本管道执行");
    expect(text).toContain("tokenUsage=not_applicable requests=0 reported=0");
  });
  it("renders a no-findings line when the report is clean", () => {
    const report = makeReport();
    expect(renderSummary({ ...report, findings: [], verdict: "allow" })).toContain("findings: none");
  });
  it("renders JSON that round-trips", () => {
    const report = makeReport();
    expect(JSON.parse(renderJson(report))).toEqual(report);
  });
});

describe("main", () => {
  it("returns 0 for --help and --version", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(await main(["--version"])).toBe(0);
  });
  it("returns 1 for a missing target path", async () => {
    expect(await main(["/no/such/path/anywhere"], { env: {}, cwd: "/tmp" })).toBe(1);
  });
  it("scans a temporary directory and returns 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cli-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), "# hello");
      expect(await main([dir], { env: {}, cwd: dir })).toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("writes the rendered report to --output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cli-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), "# hello");
      const outFile = join(dir, "report.txt");
      const code = await main([dir, "--output", outFile], { env: {}, cwd: dir });
      expect(code).toBe(0);
      expect(readFileSync(outFile, "utf-8")).toContain("verdict=");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("writes full JSON to --output with --json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cli-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), "# hello");
      const outFile = join(dir, "report.json");
      const code = await main([dir, "--json", "--output", outFile], { env: {}, cwd: dir });
      expect(code).toBe(0);
      const parsed = JSON.parse(readFileSync(outFile, "utf-8"));
      expect(parsed.verdict).toBeDefined();
      expect(parsed.locale).toBe("zh-CN");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("returns 1 on an unknown flag and a missing path", async () => {
    expect(await main(["--bogus"], { env: {}, cwd: "/tmp" })).toBe(1);
    expect(await main([], { env: {}, cwd: "/tmp" })).toBe(1);
  });
  it("auto-loads .env and selects full mode with an injected fetch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cli-"));
    try {
      writeFileSync(join(dir, "SKILL.md"), "# hello");
      writeFileSync(join(dir, ".env"), "LLM_ENDPOINT=https://example.com/v1\nLLM_API_KEY=k\nLLM_LITE_MODEL=l\nLLM_PRO_MODEL=p");
      let called = false;
      const fetch = async () => {
        called = true;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' } }] }), { status: 200 });
      };
      const outFile = join(dir, "out.json");
      const code = await main([dir, "--json", "--output", outFile], { env: {}, cwd: dir, fetch });
      expect(code).toBe(0);
      expect(called).toBe(true);
      const report = JSON.parse(readFileSync(outFile, "utf-8"));
      expect(report.mode).toBe("full");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("does not expose the configured API key in verbose output, errors, or reports", async () => {
    const dir = mkdtempSync(join(tmpdir(), "skill-scanner-cli-"));
    const secret = "sk-contract-secret-1234567890";
    const stdout: string[] = [];
    const stderr: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => { stdout.push(args.join(" ")); });
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => { stderr.push(args.join(" ")); });
    try {
      writeFileSync(join(dir, "SKILL.md"), "# hello");
      const configPath = join(dir, "config.json");
      const outputPath = join(dir, "report.json");
      writeFileSync(configPath, JSON.stringify({ mode: "full", model: { endpoint: "https://example.com/v1", apiKey: secret, liteModel: "lite", proModel: "pro" } }));
      const fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"risk_found":false,"findings":[]}' } }] }), { status: 200 });
      expect(await main([dir, "--config", configPath, "--json", "--output", outputPath, "--verbose"], { env: {}, cwd: dir, fetch })).toBe(0);

      writeFileSync(configPath, `{ "apiKey": "${secret}"`);
      expect(await main([dir, "--config", configPath], { env: {}, cwd: dir })).toBe(1);
      const exposed = [...stdout, ...stderr, readFileSync(outputPath, "utf-8")].join("\n");
      expect(exposed).not.toContain(secret);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
