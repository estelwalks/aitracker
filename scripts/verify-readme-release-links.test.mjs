import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  inspectReadme,
  inspectWorkflow,
  README_DOWNLOAD_ALIASES,
  README_PATHS,
  verifyReadmeReleaseLinks,
} from "./verify-readme-release-links.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "verify-readme-release-links.mjs",
);
const REPOSITORY_ROOT = join(dirname(SCRIPT), "..");
const BASE = "https://github.com/estelwalks/aitracker/releases/latest/download";

const README_WITH_ALL_ALIASES = [
  "# AITracker",
  "",
  `- macOS: [AITracker-arm64.dmg](${BASE}/AITracker-arm64.dmg)`,
  `- macOS: [AITracker-x64.dmg](${BASE}/AITracker-x64.dmg)`,
  `- Windows: [AITracker-Setup-x64.exe](${BASE}/AITracker-Setup-x64.exe)`,
  `- Windows: [AITracker-Setup-arm64.exe](${BASE}/AITracker-Setup-arm64.exe)`,
  "",
].join("\n");

function withAliases() {
  return README_WITH_ALL_ALIASES;
}

function workflowText() {
  return [
    "      - name: Publish versionless installer aliases",
    "        run: |",
    `          for alias in ${README_DOWNLOAD_ALIASES.join(" ")}; do`,
    '            test -n "$alias"',
    "          done",
    "",
  ].join("\n");
}

async function fixtureRoot(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "aitracker-readme-test-"));
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(root, ".github/workflows/release.yml"),
    options.workflow ?? workflowText(),
    "utf8",
  );
  const readme = options.readme ?? withAliases();
  for (const path of README_PATHS) {
    await writeFile(join(root, path), readme, "utf8");
  }
  return root;
}

test("the CLI entry point actually runs when invoked as a script", () => {
  const result = spawnSync(process.execPath, [SCRIPT, REPOSITORY_ROOT], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verify-readme-release-links: PASS/u);
});

test("the shipped READMEs and release workflow satisfy the alias contract", async () => {
  assert.deepEqual(
    await verifyReadmeReleaseLinks({ rootDir: REPOSITORY_ROOT }),
    [],
  );
});

test("a versioned installer URL in a README is reported", () => {
  const problems = inspectReadme({
    path: "README.md",
    text: `${withAliases()}\n[AITracker-1.0.1-arm64.dmg](https://github.com/estelwalks/aitracker/releases/download/v1.0.1/AITracker-1.0.1-arm64.dmg)\n`,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /pins a versioned installer URL/u);
});

test("an unknown latest-release asset name is reported", () => {
  const problems = inspectReadme({
    path: "docs/README_CN.md",
    text: `${withAliases()}\n[AITracker-1.0.1-arm64.dmg](${BASE}/AITracker-1.0.1-arm64.dmg)\n`,
  });
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /unknown latest-release asset "AITracker-1\.0\.1-arm64\.dmg"/u,
  );
});

test("a README without any latest-release download link is reported", () => {
  const problems = inspectReadme({
    path: "README.md",
    text: "# AITracker\n\nNo download section.\n",
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /contains no .*releases\/latest\/download/u);
});

test("a workflow that stops publishing an alias is reported", () => {
  const problems = inspectWorkflow({
    workflow: "for alias in AITracker-arm64.dmg AITracker-x64.dmg; do\ndone\n",
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not publish AITracker-Setup-x64\.exe/u);
});

test("a workflow with no alias loop and a README missing an alias both fail", async () => {
  const partial = README_WITH_ALL_ALIASES.replace(
    `- Windows: [AITracker-Setup-arm64.exe](${BASE}/AITracker-Setup-arm64.exe)\n`,
    "",
  );
  const root = await fixtureRoot({
    readme: partial,
    workflow: "name: Release\n",
  });
  try {
    const problems = await verifyReadmeReleaseLinks({ rootDir: root });
    assert.ok(
      problems.some((problem) =>
        /no longer declares an alias upload loop/u.test(problem),
      ),
      problems.join("\n"),
    );
    assert.ok(
      problems.some((problem) =>
        /no README links .*AITracker-Setup-arm64\.exe/u.test(problem),
      ),
      problems.join("\n"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing README is reported instead of silently skipped", async () => {
  const root = await fixtureRoot();
  try {
    await rm(join(root, "docs/README_KO.md"));
    const problems = await verifyReadmeReleaseLinks({ rootDir: root });
    assert.ok(
      problems.some((problem) =>
        /unable to read docs\/README_KO\.md/u.test(problem),
      ),
      problems.join("\n"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI reports problems and exits non-zero", async () => {
  const root = await fixtureRoot({
    readme: "# AITracker\n",
  });
  try {
    const result = spawnSync(process.execPath, [SCRIPT, root], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /verify-readme-release-links: FAIL/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
