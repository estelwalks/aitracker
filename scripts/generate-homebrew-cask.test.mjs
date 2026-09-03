import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  generateCask,
  renderCask,
  validateMetadata,
} from "./generate-homebrew-cask.mjs";

const execFileAsync = promisify(execFile);
const CHANNEL_TOKENS = Object.freeze({
  stable: "aitracker",
  beta: "aitracker-beta",
});
const ARM_SHA = "a".repeat(64);
const INTEL_SHA = "b".repeat(64);

function fixture(channel = "stable") {
  const version = channel === "stable" ? "1.2.3" : "1.2.3-beta.1";
  return {
    schemaVersion: 1,
    appVersion: version,
    channel,
    repository: "estelwalks/aitracker",
    gitTag: `v${version}`,
    artifacts: {
      "darwin-arm64": {
        name: `AITracker-${version}-arm64.dmg`,
        url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-${version}-arm64.dmg`,
        sha256: ARM_SHA,
        size: 123456,
      },
      "darwin-x64": {
        name: `AITracker-${version}-x64.dmg`,
        url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-${version}-x64.dmg`,
        sha256: INTEL_SHA,
        size: 123457,
      },
      "win32-x64": {
        name: `AITracker-Setup-${version}-x64.exe`,
        url: `https://github.com/estelwalks/aitracker/releases/download/v${version}/AITracker-Setup-${version}-x64.exe`,
        sha256: "c".repeat(64),
        size: 123458,
      },
    },
  };
}

async function commandAvailable(command, args) {
  try {
    await execFileAsync(command, args, { encoding: "utf8" });
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function assertBrewStyle(output, { brewRepository, token }) {
  const tapUser = await mkdtemp(
    join(brewRepository, "Library", "Taps", "aitracker-style-user-"),
  );
  const tap = join(tapUser, `homebrew-aitracker-style-${token}`);
  const caskPath = join(tap, "Casks", `${token}.rb`);
  await mkdir(dirname(caskPath), { recursive: true });
  await writeFile(caskPath, output, "utf8");

  try {
    await execFileAsync("brew", ["style", "--cask", caskPath], {
      encoding: "utf8",
    });
  } finally {
    await rm(tapUser, { recursive: true, force: true });
  }
}

test("renders stable Cask with distinct arm/intel URL and SHA mappings", () => {
  const output = renderCask(fixture(), {
    channel: "stable",
    token: "aitracker",
  });

  assert.match(output, /^cask "aitracker" do/u);
  assert.match(output, /version "1\.2\.3"/u);
  assert.match(
    output,
    /on_arch_conditional\(\n\s+arm:\s+"https:\/\/github\.com\/estelwalks\/aitracker\/releases\/download\/v1\.2\.3\/AITracker-1\.2\.3-arm64\.dmg",\n\s+intel:\s+"https:\/\/github\.com\/estelwalks\/aitracker\/releases\/download\/v1\.2\.3\/AITracker-1\.2\.3-x64\.dmg",/u,
  );
  assert.match(
    output,
    new RegExp(`sha256 arm:\\s+"${ARM_SHA}",\\n\\s+intel: "${INTEL_SHA}"`),
  );
  assert.match(output, /app "AITracker\.app"/u);
  assert.doesNotMatch(output, /secret|token|password/u);
});

test("renders beta with its separate token and channel version", () => {
  const output = renderCask(fixture("beta"), {
    channel: "beta",
    token: "aitracker-beta",
  });

  assert.match(output, /^cask "aitracker-beta" do/u);
  assert.match(output, /version "1\.2\.3-beta\.1"/u);
  assert.match(output, /AITracker-1\.2\.3-beta\.1-arm64\.dmg/u);
  assert.match(output, /AITracker-1\.2\.3-beta\.1-x64\.dmg/u);
  assert.match(output, /name "AITracker Beta"/u);
  assert.match(
    output,
    /desc "Pre-release local-first AI development asset dashboard"/u,
  );
});

test("rejects invalid hash, URL, channel, and missing Darwin artifact", () => {
  const invalidCases = [
    [
      "hash",
      (metadata) =>
        (metadata.artifacts["darwin-arm64"].sha256 = "A".repeat(64)),
      /sha256/u,
    ],
    [
      "URL",
      (metadata) =>
        (metadata.artifacts["darwin-x64"].url = "https://example.com/app.dmg"),
      /url/u,
    ],
    [
      "size",
      (metadata) => (metadata.artifacts["darwin-arm64"].size = 0),
      /size/u,
    ],
    ["channel", (metadata) => (metadata.channel = "nightly"), /channel/u],
    [
      "missing artifact",
      (metadata) => delete metadata.artifacts["darwin-x64"],
      /darwin-x64/u,
    ],
  ];

  for (const [, mutate, message] of invalidCases) {
    const metadata = fixture();
    mutate(metadata);
    assert.throws(
      () => validateMetadata(metadata, { channel: "stable" }),
      message,
    );
  }
});

test("rejects a channel/version mismatch and a wrong token", () => {
  assert.throws(
    () => validateMetadata(fixture("beta"), { channel: "stable" }),
    /channel/u,
  );
  assert.throws(
    () => renderCask(fixture(), { channel: "stable", token: "aitracker-beta" }),
    /token/u,
  );
});

test("writing the same metadata twice is byte-for-byte reproducible", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-homebrew-cask-"));
  const metadataPath = join(root, "release-metadata.json");
  const firstOutput = join(root, "first.rb");
  const secondOutput = join(root, "second.rb");
  await writeFile(metadataPath, JSON.stringify(fixture(), null, 2), "utf8");

  await generateCask({
    metadataPath,
    outputPath: firstOutput,
    token: "aitracker",
    channel: "stable",
  });
  await generateCask({
    metadataPath,
    outputPath: secondOutput,
    token: "aitracker",
    channel: "stable",
  });

  assert.equal(
    await readFile(firstOutput, "utf8"),
    await readFile(secondOutput, "utf8"),
  );
});

test("generated fixture Casks pass Ruby syntax and Homebrew 6 style", async (t) => {
  const hasRuby = await commandAvailable("ruby", ["--version"]);
  const hasBrew = await commandAvailable("brew", ["--version"]);
  if (!hasRuby || !hasBrew) {
    t.skip("ruby and Homebrew are required for Cask tooling validation");
    return;
  }

  const { stdout: brewRepositoryOutput } = await execFileAsync(
    "brew",
    ["--repository"],
    { encoding: "utf8" },
  );
  const brewRepository = brewRepositoryOutput.trim();
  assert.ok(brewRepository, "brew --repository must return a path");

  const root = await mkdtemp(join(tmpdir(), "aitracker-homebrew-cask-tools-"));
  try {
    for (const [channel, token] of Object.entries(CHANNEL_TOKENS)) {
      const metadataPath = join(root, `${channel}-release-metadata.json`);
      const outputPath = join(root, `${token}.rb`);
      await writeFile(
        metadataPath,
        JSON.stringify(fixture(channel), null, 2),
        "utf8",
      );

      await generateCask({
        metadataPath,
        outputPath,
        token,
        channel,
      });
      const output = await readFile(outputPath, "utf8");
      assert.doesNotMatch(output, /__(?:VERSION|ARM64|X64)_[^_]+__/u);
      await execFileAsync("ruby", ["-c", outputPath], { encoding: "utf8" });
      await assertBrewStyle(output, { brewRepository, token });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
