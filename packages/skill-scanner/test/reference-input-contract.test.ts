import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectPaths, MAX_FILE_CONTENT_CHARS } from "../src/input.js";
import { scanSkill } from "../src/index.js";
import type { ModelConfig } from "../src/types.js";

const model: ModelConfig = {
  endpoint: "https://model.example/v1",
  apiKey: "sk-reference-contract-secret",
  liteModel: "lite",
  proModel: "pro",
  timeoutMs: 1000,
  maxAgentTurns: 3,
};

function response(payload: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });
}

function cleanModel(captured: string[] = []) {
  return async (_url: string, init?: RequestInit): Promise<Response> => {
    const body = String(init?.body ?? "");
    captured.push(body);
    const messages = JSON.parse(body).messages as Array<{ content: string }>;
    const task = messages[1]?.content ?? "";
    if (task.startsWith("Please verify each")) return response({ verifications: [] });
    if (task.startsWith("Perform a behavioral security analysis of the following SKILL directory to find")) {
      return response({ type: "final", risk_found: false, findings: [] });
    }
    return response({ risk_found: false, findings: [] });
  };
}

describe("reference disk input contract", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "skill-scanner-reference-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("keeps ignored project-tree files visible to file checks but not rules", async () => {
    mkdirSync(join(dir, "tests"));
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "SKILL.md"), "# Safe skill");
    writeFileSync(join(dir, "tests", "run.py"), "import os\nos.system('whoami')");
    writeFileSync(join(dir, "tests", "payload.exe"), "MZ placeholder");
    writeFileSync(join(dir, "node_modules", "client.js"), "child_process.exec('whoami')");
    writeFileSync(join(dir, ".env"), "CALLBACK=203.0.113.5");

    const collected = await collectPaths([dir]);
    expect(collected.analysisPaths).toEqual([resolve(join(dir, "SKILL.md"))]);
    expect(collected.singleSkillFile).toBe(false);

    const report = await scanSkill({ mode: "quick", paths: [dir] });
    expect(report.findings.some((finding) => finding.ruleId === "OS_SYSTEM")).toBe(false);
    expect(report.findings.some((finding) => finding.ruleId === "NODE_CHILD_EXEC")).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ ruleId: "RISK_FILE", path: resolve(join(dir, "tests", "payload.exe")) }));
    expect(report.findings).toContainEqual(expect.objectContaining({ ruleId: "SUSPICIOUS_EXTERNAL_IP", path: resolve(join(dir, ".env")) }));
  });

  it("does not send ignored file content to the behavioral model", async () => {
    const marker = "IGNORED_CONTENT_MUST_NOT_REACH_MODEL_7f31";
    writeFileSync(join(dir, "SKILL.md"), "# Safe skill");
    writeFileSync(join(dir, "audit.log"), marker);
    const captured: string[] = [];

    const report = await scanSkill({ mode: "full", paths: [dir], model }, { fetch: cleanModel(captured) });

    expect(report.branches).toContainEqual(expect.objectContaining({ name: "singleFileAnalysis", status: "skipped" }));
    expect(report.branches).toContainEqual(expect.objectContaining({ name: "multiFileAnalysis", status: "complete" }));
    expect(captured.join("\n")).not.toContain(marker);
    expect(captured.join("\n")).not.toContain(model.apiKey);
  });

  it("routes a sole SKILL.md to single-file analysis", async () => {
    writeFileSync(join(dir, "SKILL.md"), "# Safe skill");
    const report = await scanSkill({ mode: "full", paths: [dir], model }, { fetch: cleanModel() });
    expect(report.branches).toContainEqual(expect.objectContaining({ name: "singleFileAnalysis", status: "complete" }));
    expect(report.branches).toContainEqual(expect.objectContaining({ name: "multiFileAnalysis", status: "skipped" }));
  });

  it.each([
    ["ignored log", (root: string) => writeFileSync(join(root, "audit.log"), "ignored")],
    ["DS Store", (root: string) => writeFileSync(join(root, ".DS_Store"), Buffer.from([0, 1, 2]))],
    ["binary", (root: string) => writeFileSync(join(root, "payload.bin"), Buffer.from([0x4d, 0x5a, 0, 1]))],
    ["oversized", (root: string) => writeFileSync(join(root, "large.md"), "x".repeat(MAX_FILE_CONTENT_CHARS + 1))],
  ])("routes an attached %s entry to multi-file analysis", async (_name, addFile) => {
    writeFileSync(join(dir, "SKILL.md"), "# Safe skill");
    addFile(dir);
    const report = await scanSkill({ mode: "full", paths: [dir], model }, { fetch: cleanModel() });
    expect(report.branches).toContainEqual(expect.objectContaining({ name: "singleFileAnalysis", status: "skipped" }));
    expect(report.branches).toContainEqual(expect.objectContaining({ name: "multiFileAnalysis", status: "complete" }));
  });

  it("uses only the first 1024 bytes for disk binary classification", async () => {
    writeFileSync(join(dir, "SKILL.md"), "# Safe skill");
    writeFileSync(join(dir, "late-nul.py"), Buffer.concat([
      Buffer.alloc(1024, 0x61),
      Buffer.from([0]),
      Buffer.from("\nimport os\nos.system('whoami')"),
    ]));
    writeFileSync(join(dir, "control.bin"), Buffer.from([1, 2, 3, 4, 65, 65, 65, 65, 65, 65]));

    const report = await scanSkill({ mode: "quick", paths: [dir] });
    expect(report.skippedFiles).toContainEqual({ path: resolve(join(dir, "control.bin")), reason: "binary file was not scanned" });
    expect(report.skippedFiles.some((item) => item.path === resolve(join(dir, "late-nul.py")))).toBe(false);
    expect(report.findings).toContainEqual(expect.objectContaining({ ruleId: "OS_SYSTEM", path: resolve(join(dir, "late-nul.py")) }));
  });
});
