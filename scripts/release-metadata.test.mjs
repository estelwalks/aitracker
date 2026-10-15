import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildReleaseMetadata,
  formatChecksums,
  generateReleaseMetadata,
  parseReleaseMetadataArgs,
} from "./release-metadata.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "release-metadata.mjs",
);

// Installer names carry no version since the compatibility window closed at
// 1.0.3, so a release publishes exactly these files and the metadata names them
// as they are. The four macOS/Windows installers go into the main
// release-metadata.json; the Linux AppImage goes into the companion
// release-metadata-linux.json (dev-docs/linux/01-架构决策.md §3.1).
const files = [
  "AITracker-macOS-arm64.dmg",
  "AITracker-macOS-x64.dmg",
  "AITracker-Windows-arm64.exe",
  "AITracker-Windows-x64.exe",
];

/** The four main-document installers. */
const mainFiles = files;

/** Linux artifacts, recorded in the companion document only. */
const linuxFiles = ["AITracker-Linux-x64.AppImage"];

async function fixtureDirectory({ linux = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "aitracker-release-test-"));
  const all = linux ? [...files, ...linuxFiles] : files;
  for (const [index, file] of all.entries()) {
    await writeFile(join(directory, file), Buffer.from(`artifact-${index}`));
  }
  return directory;
}

test("the CLI entry point actually runs when invoked as a script", () => {
  // Same Windows regression as verify-release-contract.mjs: the naive
  // `file://${process.argv[1]}` entry check never matched, so the script
  // exited 0 without generating metadata or checksums.
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--version is required/);
});

test("builds metadata and checksums for the four published installers", async () => {
  const directory = await fixtureDirectory();
  try {
    const metadata = await buildReleaseMetadata({
      releaseDir: directory,
      version: "1.0.0-beta.1",
      channel: "beta",
    });
    assert.deepEqual(
      Object.entries(metadata.artifacts).map(([platform, { name, size }]) => ({
        platform,
        name,
        size,
      })),
      [
        { platform: "darwin-arm64", name: files[0], size: 10 },
        { platform: "darwin-x64", name: files[1], size: 10 },
        { platform: "win32-arm64", name: files[2], size: 10 },
        { platform: "win32-x64", name: files[3], size: 10 },
      ],
    );
    for (const [index, artifact] of Object.values(
      metadata.artifacts,
    ).entries()) {
      assert.equal(
        artifact.sha256,
        createHash("sha256").update(`artifact-${index}`).digest("hex"),
      );
      // A versionless name at the stable download URL is what keeps the link
      // working release after release without an edit.
      assert.doesNotMatch(artifact.name, /\d+\.\d+\.\d+/u);
      assert.equal(
        artifact.url,
        `https://github.com/estelwalks/aitracker/releases/latest/download/${artifact.name}`,
      );
    }
    // Checksums name the files users download.
    const checksums = formatChecksums(metadata);
    for (const file of files) {
      assert.ok(checksums.includes(`  ${file}\n`), `missing ${file}`);
    }
    assert.doesNotMatch(checksums, /\d+\.\d+\.\d+/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writes independently selectable metadata and checksum outputs", async () => {
  const directory = await fixtureDirectory();
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "aitracker-output-test-"),
  );
  try {
    await generateReleaseMetadata({
      releaseDir: directory,
      version: "1.0.0-beta.1",
      channel: "beta",
      output: join(outputDirectory, "nested", "metadata.json"),
      linuxOutput: join(outputDirectory, "nested", "metadata-linux.json"),
      checksums: join(outputDirectory, "nested", "checksums.txt"),
    });
    const linuxMetadata = JSON.parse(
      await readFile(
        join(outputDirectory, "nested", "metadata-linux.json"),
        "utf8",
      ),
    );
    // The companion document repeats the four main keys and adds linux-x64.
    assert.deepEqual(Object.keys(linuxMetadata.artifacts).sort(), [
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
      "win32-arm64",
      "win32-x64",
    ]);
    const metadata = JSON.parse(
      await readFile(join(outputDirectory, "nested", "metadata.json"), "utf8"),
    );
    // The main document must NOT gain a fifth key: a shipped pre-Linux client
    // rejects any extra key outright and would stop updating itself for every
    // later release.
    assert.deepEqual(Object.keys(metadata.artifacts).sort(), [
      "darwin-arm64",
      "darwin-x64",
      "win32-arm64",
      "win32-x64",
    ]);
    assert.equal(metadata.schemaVersion, 1);
    assert.equal(metadata.appVersion, "1.0.0-beta.1");
    assert.equal(metadata.gitTag, "v1.0.0-beta.1");
    assert.equal(
      (await readFile(join(outputDirectory, "nested", "checksums.txt"), "utf8"))
        .trimEnd()
        .split("\n").length,
      files.length,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("rejects a missing installer and malformed generator options", async () => {
  const directory = await fixtureDirectory();
  try {
    await rm(join(directory, files[1]));
    await assert.rejects(
      () =>
        buildReleaseMetadata({
          releaseDir: directory,
          version: "1.0.0-beta.1",
          channel: "beta",
        }),
      /missing release artifact/,
    );
    assert.throws(
      () => parseReleaseMetadataArgs(["--version", "1.0"]),
      /strict semantic version/,
    );
    assert.equal(
      parseReleaseMetadataArgs(["--version", "1.0.0"]).repository,
      "estelwalks/aitracker",
    );
    assert.throws(
      () =>
        parseReleaseMetadataArgs([
          "--version",
          "1.0.0",
          "--repository",
          "invalid/repository",
        ]),
      /repository must be estelwalks\/aitracker/,
    );
    assert.throws(
      () =>
        parseReleaseMetadataArgs([
          "--version",
          "1.0.0",
          "--channel",
          "nightly",
        ]),
      /stable or beta/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
