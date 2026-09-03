import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildReleaseMetadata,
  formatChecksums,
  generateReleaseMetadata,
  parseReleaseMetadataArgs,
} from "./release-metadata.mjs";

const files = [
  "AITracker-1.0.0-beta.1-arm64.dmg",
  "AITracker-1.0.0-beta.1-x64.dmg",
  "AITracker-Setup-1.0.0-beta.1-x64.exe",
];

async function fixtureDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "aitracker-release-test-"));
  for (const [index, file] of files.entries()) {
    await writeFile(join(directory, file), Buffer.from(`artifact-${index}`));
  }
  return directory;
}

test("builds metadata and checksums using electron-builder names", async () => {
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
        { platform: "win32-x64", name: files[2], size: 10 },
      ],
    );
    for (const [index, artifact] of Object.values(
      metadata.artifacts,
    ).entries()) {
      assert.equal(
        artifact.sha256,
        createHash("sha256").update(`artifact-${index}`).digest("hex"),
      );
    }
    assert.match(
      formatChecksums(metadata),
      /^[0-9a-f]{64}\s{2}.*\.(dmg|exe)\n/m,
    );
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
      checksums: join(outputDirectory, "nested", "checksums.txt"),
    });
    const metadata = JSON.parse(
      await readFile(join(outputDirectory, "nested", "metadata.json"), "utf8"),
    );
    assert.equal(metadata.schemaVersion, 1);
    assert.equal(metadata.appVersion, "1.0.0-beta.1");
    assert.equal(metadata.gitTag, "v1.0.0-beta.1");
    assert.equal(
      (
        await readFile(join(outputDirectory, "nested", "checksums.txt"), "utf8")
      ).split("\n").length,
      4,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("rejects missing artifacts and malformed generator options", async () => {
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
