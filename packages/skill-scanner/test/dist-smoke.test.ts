import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScanSkillReportSchema } from "../src/types.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distCli = join(repository, "dist", "cli.js");
const packageJson = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")) as { version: string };
const scratch = mkdtempSync(join(tmpdir(), "skill-scanner-dist-contract-"));
const childEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  NODE_OPTIONS: process.env.NODE_OPTIONS,
  LANG: "C.UTF-8",
};

function runDist(args: string[]): string {
  return execFileSync(process.execPath, [distCli, ...args], {
    cwd: scratch,
    env: childEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
}

function treeDigest(root: string): string {
  const hash = createHash("sha256");
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        hash.update(relative(root, absolute)).update("\0");
        hash.update(String(statSync(absolute).mode)).update("\0");
        hash.update(readFileSync(absolute));
      }
    }
  };
  visit(root);
  return hash.digest("hex");
}

beforeAll(() => {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) throw new Error("npm_execpath is required to exercise the package build");
  execFileSync(process.execPath, [npmExecPath, "run", "build"], {
    cwd: repository,
    env: childEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
  });
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("published dist smoke contract", () => {
  it("reports the exact package version from the built CLI", () => {
    expect(runDist(["--version"]).trim()).toBe(packageJson.version);
  });

  it("ships every source prompt with byte-identical non-empty content", () => {
    const sourceDir = join(repository, "src", "model", "prompts");
    const distDir = join(repository, "dist", "prompts");
    const sourcePrompts = readdirSync(sourceDir).filter((name) => name.endsWith(".md")).sort();
    const distPrompts = readdirSync(distDir).filter((name) => name.endsWith(".md")).sort();

    expect(distPrompts).toEqual(sourcePrompts);
    expect(sourcePrompts).toEqual([
      "attack_patterns.md",
      "attack_patterns.zh.md",
      "behavioral_analysis_system.md",
      "behavioral_analysis_system.zh.md",
      "rules_verify_system.md",
      "rules_verify_system.zh.md",
      "single_file_analysis_system.md",
      "single_file_analysis_system.zh.md",
    ]);
    for (const name of sourcePrompts) {
      const source = readFileSync(join(sourceDir, name));
      const built = readFileSync(join(distDir, name));
      expect(built.length, name).toBeGreaterThan(100);
      expect(built, name).toEqual(source);
    }
  });

  it.each([
    ["negative documentation", "test/fixtures/realistic/negative/documentation", 0],
    ["positive prompt injection", "test/fixtures/realistic/positive/prompt-injection", 1],
  ])("scans the %s fixture through dist without modifying fixture files", (_name, fixtureRelative, minimumFindings) => {
    const fixture = join(repository, fixtureRelative);
    const before = treeDigest(fixture);
    const stdout = runDist([fixture, "--quick", "--locale", "en-US", "--json"]);
    const after = treeDigest(fixture);
    const report = ScanSkillReportSchema.parse(JSON.parse(stdout));

    expect(report.mode).toBe("quick");
    expect(report.status).toBe("complete");
    expect(report.scannedFiles).toBeGreaterThan(0);
    expect(report.findings.length).toBeGreaterThanOrEqual(minimumFindings);
    expect(after).toBe(before);
  });
});
