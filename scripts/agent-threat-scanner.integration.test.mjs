import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { ProviderSchema, scanSkill } from "@estelwalks/agent-threat-scanner";

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

test("uses the published agent-threat-scan CLI entrypoint", async (t) => {
  // npm's .cmd shim cannot be execFile'd directly on Windows (EINVAL), so run
  // the published CLI entry script under the current Node executable there;
  // POSIX runners keep exercising the npm-installed shell shim.
  const isWindows = process.platform === "win32";
  const cli = isWindows
    ? {
        command: process.execPath,
        args: [
          join(
            process.cwd(),
            "node_modules",
            "@estelwalks",
            "agent-threat-scanner",
            "dist",
            "cli.js",
          ),
        ],
      }
    : {
        command: join(
          process.cwd(),
          "node_modules",
          ".bin",
          "agent-threat-scan",
        ),
        args: [],
      };
  const help = await execFileAsync(cli.command, [...cli.args, "--help"], {
    cwd: process.cwd(),
  });
  assert.match(help.stdout, /Usage: agent-threat-scan /u);

  // The published engine's path-safety guard accepts POSIX paths only (no
  // drive letters / backslashes), so scanning a real disk file is impossible
  // on Windows with any published version. The library API above still covers
  // the engine contract on every platform, and the disk CLI path is exercised
  // on the Linux CI runner.
  if (isWindows) {
    t.skip("published engine rejects Windows disk paths");
    return;
  }

  const fixtureRoot = await mkdtemp(
    join(tmpdir(), "aitracker-agent-threat-scanner-"),
  );
  try {
    const skillPath = join(fixtureRoot, "SKILL.md");
    await writeFile(skillPath, "# Safe skill\n", "utf8");
    const result = await execFileAsync(
      cli.command,
      [...cli.args, skillPath, "--quick", "--json"],
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
