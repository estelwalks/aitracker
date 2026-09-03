import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ERROR_CODES,
  EXIT_CODES,
  expectedReleaseArtifacts,
  parseReleaseContractArgs,
  RELEASE_PLATFORMS,
  validateReleaseContract,
  verifyReleaseContract,
} from "./verify-release-contract.mjs";

const betaPackages = {
  rootPackage: { version: "1.0.0-beta.1" },
  cliPackage: { version: "1.0.0-beta.1" },
};

test("accepts matching strict-semver packages and derives beta contract", () => {
  const contract = validateReleaseContract(betaPackages);
  assert.equal(contract.version, "1.0.0-beta.1");
  assert.equal(contract.channel, "beta");
  assert.equal(contract.tag, "v1.0.0-beta.1");
  assert.deepEqual(
    contract.artifacts.map(({ platform, name }) => ({ platform, name })),
    [
      { platform: "darwin-arm64", name: "AITracker-1.0.0-beta.1-arm64.dmg" },
      { platform: "darwin-x64", name: "AITracker-1.0.0-beta.1-x64.dmg" },
      {
        platform: "win32-x64",
        name: "AITracker-Setup-1.0.0-beta.1-x64.exe",
      },
    ],
  );
});

test("accepts an exact tag and channel, and rejects mismatches with CI codes", () => {
  assert.equal(
    validateReleaseContract({
      ...betaPackages,
      tag: "v1.0.0-beta.1",
      channel: "beta",
    }).tag,
    "v1.0.0-beta.1",
  );
  assert.throws(
    () => validateReleaseContract({ ...betaPackages, tag: "v1.0.0-beta.2" }),
    (error) =>
      error.errorCode === ERROR_CODES.tagMismatch &&
      error.exitCode === EXIT_CODES.contract,
  );
  assert.throws(
    () => validateReleaseContract({ ...betaPackages, channel: "stable" }),
    (error) =>
      error.errorCode === ERROR_CODES.channelMismatch &&
      error.exitCode === EXIT_CODES.contract,
  );
  assert.throws(
    () => validateReleaseContract({ ...betaPackages, tag: "1.0.0-beta.1" }),
    (error) =>
      error.errorCode === ERROR_CODES.tagMismatch &&
      error.exitCode === EXIT_CODES.contract,
  );
});

test("rejects invalid and divergent package versions", () => {
  assert.throws(
    () =>
      validateReleaseContract({
        rootPackage: { version: "1.0" },
        cliPackage: { version: "1.0" },
      }),
    (error) => error.errorCode === ERROR_CODES.versionInvalid,
  );
  assert.throws(
    () =>
      validateReleaseContract({
        rootPackage: { version: "1.0.0" },
        cliPackage: { version: "1.0.0-beta.1" },
      }),
    (error) => error.errorCode === ERROR_CODES.versionMismatch,
  );
});

test("parses supported options and rejects invalid option values", () => {
  assert.deepEqual(
    parseReleaseContractArgs([
      "--tag",
      "v1.0.0-beta.1",
      "--channel=beta",
      "--platform",
      "darwin-arm64",
      "--release-dir",
      "release",
    ]),
    {
      tag: "v1.0.0-beta.1",
      channel: "beta",
      platform: "darwin-arm64",
      releaseDir: "release",
    },
  );
  assert.throws(
    () => parseReleaseContractArgs(["--channel", "nightly"]),
    (error) =>
      error.errorCode === ERROR_CODES.channelInvalid &&
      error.exitCode === EXIT_CODES.usage,
  );
  assert.throws(
    () => parseReleaseContractArgs(["--release-dir"]),
    (error) => error.errorCode === ERROR_CODES.usage,
  );
  assert.throws(
    () => parseReleaseContractArgs(["--platform", "linux-x64"]),
    (error) =>
      error.errorCode === ERROR_CODES.platformInvalid &&
      error.exitCode === EXIT_CODES.usage,
  );
});

test("checks only the matrix platform when requested, while aggregate checks remain complete", async () => {
  const rootDir = await mkdtemp(
    join(tmpdir(), "aitracker-platform-contract-test-"),
  );
  const releaseDir = join(rootDir, "release");
  try {
    await mkdir(join(rootDir, "packages/cli"), { recursive: true });
    await mkdir(releaseDir);
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({ version: "1.0.0-beta.1" }),
    );
    await writeFile(
      join(rootDir, "packages/cli/package.json"),
      JSON.stringify({ version: "1.0.0-beta.1" }),
    );
    const arm64Artifact = expectedReleaseArtifacts(
      "1.0.0-beta.1",
      "darwin-arm64",
    )[0];
    await writeFile(join(releaseDir, arm64Artifact.name), "installer");

    const matrixContract = await verifyReleaseContract({
      rootDir,
      releaseDir,
      platform: "darwin-arm64",
      cwd: rootDir,
    });
    assert.deepEqual(matrixContract.artifacts, [arm64Artifact]);

    await assert.rejects(
      () =>
        verifyReleaseContract({
          rootDir,
          releaseDir,
          platform: "darwin-x64",
          cwd: rootDir,
        }),
      (error) => error.errorCode === ERROR_CODES.artifactMissing,
    );
    await assert.rejects(
      () => verifyReleaseContract({ rootDir, releaseDir, cwd: rootDir }),
      (error) => error.errorCode === ERROR_CODES.artifactMissing,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("checks all three artifacts only when release-dir is explicitly supplied", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "aitracker-contract-test-"));
  const releaseDir = join(rootDir, "release");
  try {
    await mkdir(join(rootDir, "packages/cli"), { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({ version: "1.0.0-beta.1" }),
    );
    await writeFile(
      join(rootDir, "packages/cli/package.json"),
      JSON.stringify({ version: "1.0.0-beta.1" }),
    );

    const withoutDirectory = await verifyReleaseContract({ rootDir });
    assert.equal(withoutDirectory.artifacts.length, 3);
    await assert.rejects(
      () => verifyReleaseContract({ rootDir, releaseDir, cwd: rootDir }),
      (error) => error.errorCode === ERROR_CODES.artifactDirectory,
    );

    await mkdir(releaseDir);
    for (const artifact of expectedReleaseArtifacts("1.0.0-beta.1")) {
      await writeFile(join(releaseDir, artifact.name), "installer");
    }
    const withDirectory = await verifyReleaseContract({
      rootDir,
      releaseDir,
      cwd: rootDir,
    });
    assert.equal(withDirectory.releaseDir, releaseDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
