import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { ProviderSchema, scanSkill } from "@l3m0nc9/agent-threat-scanner";

const execFileAsync = promisify(execFile);

test("uses the published scanner library contract", async () => {
  const report = await scanSkill({
    mode: "quick",
    locale: "en-US",
    files: [{ path: "SKILL.md", content: "# Safe skill\n" }],
  });

  assert.equal(report.status, "complete");
  assert.equal(report.mode, "quick");
  assert.equal(report.locale, "en-US");
  assert.equal(ProviderSchema.safeParse("openai-responses").success, true);
});

test("uses the published agent-threat-scan CLI entrypoint", async () => {
  const cliName =
    process.platform === "win32"
      ? "agent-threat-scan.cmd"
      : "agent-threat-scan";
  const cliPath = join(process.cwd(), "node_modules", ".bin", cliName);
  const help = await execFileAsync(cliPath, ["--help"], {
    cwd: process.cwd(),
  });
  assert.match(help.stdout, /Usage: agent-threat-scan /u);

  const fixtureRoot = await mkdtemp(
    join(tmpdir(), "aitracker-agent-threat-scanner-"),
  );
  try {
    const skillPath = join(fixtureRoot, "SKILL.md");
    await writeFile(skillPath, "# Safe skill\n", "utf8");
    const result = await execFileAsync(
      cliPath,
      [skillPath, "--quick", "--json"],
      {
        cwd: process.cwd(),
      },
    );
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "quick");
    assert.equal(report.status, "complete");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
