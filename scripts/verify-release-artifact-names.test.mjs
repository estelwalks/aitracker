import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_ARTIFACT_NAMES,
  EXPECTED_TEMPLATES,
  inspectPackagingConfig,
  verifyReleaseArtifactNames,
} from "./verify-release-artifact-names.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "verify-release-artifact-names.mjs",
);
const REPOSITORY_ROOT = join(dirname(SCRIPT), "..");

// The fixture must declare exactly the templates the live guard expects,
// otherwise every case below also reports the fixture's own drift.
const CONFIG = [
  "appId: com.aitracker.desktop",
  "productName: AITracker",
  "dmg:",
  `  artifactName: ${EXPECTED_TEMPLATES[0]}`,
  "nsis:",
  `  artifactName: ${EXPECTED_TEMPLATES[1]}`,
  "linux:",
  `  artifactName: ${EXPECTED_TEMPLATES[2]}`,
  "",
].join("\n");

async function fixtureRoot({ config = CONFIG, sources = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "aitracker-artifact-names-"));
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, "electron-builder.yml"), config, "utf8");
  for (const path of [
    "scripts/verify-release-contract.mjs",
    "scripts/release-metadata.mjs",
  ]) {
    const body = sources
      ? EXPECTED_ARTIFACT_NAMES.map((name) => `"${name}"`).join("\n")
      : "";
    await writeFile(join(root, path), body, "utf8");
  }
  return root;
}

test("the CLI entry point actually runs when invoked as a script", () => {
  const result = spawnSync(process.execPath, [SCRIPT, REPOSITORY_ROOT], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verify-release-artifact-names: PASS/u);
});

test("the shipped packaging config and release scripts agree on the names", async () => {
  assert.deepEqual(
    await verifyReleaseArtifactNames({ rootDir: REPOSITORY_ROOT }),
    [],
  );
});

test("the expected names are exactly what electron-builder renders", async () => {
  const config = await readFile(
    join(REPOSITORY_ROOT, "electron-builder.yml"),
    "utf8",
  );
  // One template per target section: dmg renders .dmg for macOS, nsis renders
  // .exe for Windows, so the same ${productName}-${arch}.${ext} shape yields
  // different names per section.
  // macOS and Windows use `${arch}` and are expanded per architecture; Linux
  // spells the architecture out (`-x64`) because electron-builder renders
  // `${arch}` as x86_64 for AppImage and amd64 for deb, which would give one
  // platform two different suffixes.
  const templates = {
    dmg: {
      pattern:
        /^dmg:\n(?:(?!^\S)[\s\S])*?^\s+artifactName:\s*"?([^"\n]+?)"?\s*$/mu,
      ext: "dmg",
      archs: ["arm64", "x64"],
    },
    nsis: {
      pattern:
        /^nsis:\n(?:(?!^\S)[\s\S])*?^\s+artifactName:\s*"?([^"\n]+?)"?\s*$/mu,
      ext: "exe",
      archs: ["arm64", "x64"],
    },
    linux: {
      pattern:
        /^linux:\n(?:(?!^\S)[\s\S])*?^\s+artifactName:\s*"?([^"\n]+?)"?\s*$/mu,
      ext: "AppImage",
      archs: ["x64"],
    },
  };
  const rendered = new Set();
  for (const [section, { pattern, ext, archs }] of Object.entries(templates)) {
    const template = config.match(pattern)?.[1]?.trim();
    assert.ok(template, `${section} must declare an artifactName`);
    for (const arch of archs) {
      rendered.add(
        template
          .replace("${productName}", "AITracker")
          .replace("${arch}", arch)
          .replace("${ext}", ext),
      );
    }
  }
  assert.deepEqual([...rendered].sort(), [...EXPECTED_ARTIFACT_NAMES].sort());
});

test("a reintroduced ${version} placeholder is reported", () => {
  const { problems } = inspectPackagingConfig({
    config: CONFIG.replace(
      `  artifactName: ${EXPECTED_TEMPLATES[0]}`,
      "  artifactName: ${productName}-${version}-${arch}.${ext}",
    ),
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /puts a version in an artifact name/u);
  assert.ok(
    problems[1].includes(`must declare artifactName ${EXPECTED_TEMPLATES[0]}`),
    problems[1],
  );
});

test("a renamed artifact template is reported", () => {
  const { problems } = inspectPackagingConfig({
    config: CONFIG.replace(
      `  artifactName: ${EXPECTED_TEMPLATES[1]}`,
      "  artifactName: ${productName}-Installer-${arch}.${ext}",
    ),
  });
  assert.equal(problems.length, 1);
  assert.ok(
    problems[0].includes(`must declare artifactName ${EXPECTED_TEMPLATES[1]}`),
    problems[0],
  );
});

test("a release script that drops a name is reported", async () => {
  const root = await fixtureRoot();
  try {
    await writeFile(
      join(root, "scripts/release-metadata.mjs"),
      '"AITracker-macOS-arm64.dmg"',
      "utf8",
    );
    const problems = await verifyReleaseArtifactNames({ rootDir: root });
    assert.ok(
      problems.some((problem) =>
        /scripts\/release-metadata\.mjs does not name AITracker-Windows-x64\.exe/u.test(
          problem,
        ),
      ),
      problems.join("\n"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing packaging config is reported", async () => {
  const root = await fixtureRoot();
  try {
    await rm(join(root, "electron-builder.yml"));
    const problems = await verifyReleaseArtifactNames({ rootDir: root });
    assert.ok(
      problems.some((problem) =>
        /unable to read electron-builder\.yml/u.test(problem),
      ),
      problems.join("\n"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI exits non-zero when the names drift", async () => {
  const root = await fixtureRoot({
    config: CONFIG.replace(
      `  artifactName: ${EXPECTED_TEMPLATES[0]}`,
      "  artifactName: ${productName}-${version}-${arch}.${ext}",
    ),
  });
  try {
    const result = spawnSync(process.execPath, [SCRIPT, root], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /verify-release-artifact-names: FAIL/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
