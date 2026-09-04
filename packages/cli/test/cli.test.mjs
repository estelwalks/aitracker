import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  downloadToFile,
  openInstaller,
  parseArgs,
  resolveRelease,
  runCli,
} from "../src/cli.mjs";

const metadataUrl =
  "https://github.com/estelwalks/aitracker/releases/download/v1.0.0-beta.2/release-metadata.json";
const artifactUrl =
  "https://github.com/estelwalks/aitracker/releases/download/v1.0.0-beta.2/AITracker-1.0.0-beta.2-arm64.dmg";
const bytes = Buffer.from("installer-bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
const metadata = {
  schemaVersion: 1,
  appVersion: "1.0.0-beta.2",
  channel: "beta",
  repository: "estelwalks/aitracker",
  gitTag: "v1.0.0-beta.2",
  artifacts: {
    "darwin-arm64": {
      name: "AITracker-1.0.0-beta.2-arm64.dmg",
      url: artifactUrl,
      sha256,
      size: bytes.length,
    },
    "darwin-x64": {
      name: "AITracker-1.0.0-beta.2-x64.dmg",
      url: artifactUrl.replace("arm64", "x64"),
      sha256,
      size: bytes.length,
    },
    "win32-x64": {
      name: "AITracker-Setup-1.0.0-beta.2-x64.exe",
      url: artifactUrl.replace(
        "AITracker-1.0.0-beta.2-arm64.dmg",
        "AITracker-Setup-1.0.0-beta.2-x64.exe",
      ),
      sha256,
      size: bytes.length,
    },
  },
};

function fakeFetch({ releases = undefined } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("api.github.com")) {
      return new Response(
        JSON.stringify(
          releases ?? [
            {
              draft: false,
              prerelease: true,
              tag_name: "v1.0.0-beta.2",
              assets: [
                {
                  name: "release-metadata.json",
                  browser_download_url: metadataUrl,
                },
              ],
            },
          ],
        ),
      );
    }
    if (url === metadataUrl) return new Response(JSON.stringify(metadata));
    if (url === artifactUrl) return new Response(bytes);
    return new Response("not found", { status: 404 });
  };
  return { calls, fetchImpl };
}

function responseWithUrl(body, url, init) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

test("defaults to the installed CLI package version and accepts explicit versions", () => {
  assert.equal(
    parseArgs([], {
      packageVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
    }).version,
    "1.2.3",
  );
  assert.equal(
    parseArgs(["1.2.4"], {
      packageVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
    }).version,
    "1.2.4",
  );
  assert.equal(
    parseArgs(["--version", "1.2.4"], {
      packageVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
    }).version,
    "1.2.4",
  );
});

test("accepts download-only with no directory and with a separate or equals directory", () => {
  assert.equal(
    parseArgs(["--download-only"], {
      packageVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
    }).downloadDirectory,
    undefined,
  );
  assert.equal(
    parseArgs(["--download-only", "/tmp/aitracker"], {
      packageVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
    }).downloadDirectory,
    "/tmp/aitracker",
  );
  assert.equal(
    parseArgs(["--download-only=/tmp/aitracker"], {
      packageVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
    }).downloadDirectory,
    "/tmp/aitracker",
  );
  assert.equal(
    parseArgs(["--download-only", "1.2.4"], {
      packageVersion: "1.2.3",
      platform: "darwin",
      arch: "arm64",
    }).version,
    "1.2.4",
  );
});

test("rejects empty, duplicate, and ambiguous download-only arguments", () => {
  assert.throws(
    () =>
      parseArgs(["--download-only="], {
        platform: "darwin",
        arch: "arm64",
      }),
    /directory must not be empty/,
  );
  assert.throws(
    () =>
      parseArgs(["--download-only", "one", "--download-only", "two"], {
        platform: "darwin",
        arch: "arm64",
      }),
    /may only be provided once/,
  );
  assert.throws(
    () =>
      parseArgs(["--download-only", "--download-only"], {
        platform: "darwin",
        arch: "arm64",
      }),
    /may only be provided once/,
  );
});

test("resolves exact beta versions and keeps stable/beta releases isolated", async () => {
  const fake = fakeFetch();
  const resolved = await resolveRelease({
    channel: "beta",
    version: "1.0.0-beta.2",
    platform: "darwin",
    arch: "arm64",
    fetchImpl: fake.fetchImpl,
  });
  assert.equal(resolved.metadata.appVersion, "1.0.0-beta.2");

  const stable = fakeFetch({
    releases: [
      { draft: false, prerelease: true, tag_name: "v1.0.0-beta.2", assets: [] },
    ],
  });
  await assert.rejects(
    () =>
      resolveRelease({
        channel: "stable",
        platform: "darwin",
        arch: "arm64",
        fetchImpl: stable.fetchImpl,
      }),
    /no non-draft stable release/,
  );
});

test("rejects malicious final response hosts while allowing GitHub release asset redirects", async () => {
  const apiRedirect = fakeFetch();
  await assert.rejects(
    () =>
      resolveRelease({
        channel: "beta",
        version: "1.0.0-beta.2",
        platform: "darwin",
        arch: "arm64",
        fetchImpl: async (url, options) => {
          const response = await apiRedirect.fetchImpl(url, options);
          return url.includes("api.github.com")
            ? responseWithUrl(
                JSON.stringify([
                  {
                    draft: false,
                    prerelease: true,
                    tag_name: "v1.0.0-beta.2",
                    assets: [],
                  },
                ]),
                "https://evil.example/releases",
              )
            : response;
        },
      }),
    /must resolve to api\.github\.com/,
  );

  const metadataRedirect = fakeFetch();
  const resolved = await resolveRelease({
    channel: "beta",
    version: "1.0.0-beta.2",
    platform: "darwin",
    arch: "arm64",
    fetchImpl: async (url, options) => {
      const response = await metadataRedirect.fetchImpl(url, options);
      return url === metadataUrl
        ? responseWithUrl(
            JSON.stringify(metadata),
            "https://release-assets.githubusercontent.com/github-production-release-asset/metadata?x=1",
          )
        : response;
    },
  });
  assert.equal(resolved.artifact.name, "AITracker-1.0.0-beta.2-arm64.dmg");

  const evilMetadata = fakeFetch();
  await assert.rejects(
    () =>
      resolveRelease({
        channel: "beta",
        version: "1.0.0-beta.2",
        platform: "darwin",
        arch: "arm64",
        fetchImpl: async (url, options) => {
          const response = await evilMetadata.fetchImpl(url, options);
          return url === metadataUrl
            ? responseWithUrl(
                JSON.stringify(metadata),
                "https://evil.example/release-metadata.json",
              )
            : response;
        },
      }),
    /must resolve to github\.com, release-assets\.githubusercontent\.com, or objects\.githubusercontent\.com/,
  );
});

test("rejects draft releases, unsupported platforms and bad release metadata", async () => {
  const draft = fakeFetch({
    releases: [
      { draft: true, prerelease: true, tag_name: "v1.0.0-beta.2", assets: [] },
    ],
  });
  await assert.rejects(
    () =>
      resolveRelease({
        channel: "beta",
        platform: "darwin",
        arch: "arm64",
        fetchImpl: draft.fetchImpl,
      }),
    /no non-draft/,
  );
  assert.throws(
    () => parseArgs([], { platform: "linux", arch: "x64" }),
    /Unsupported platform/,
  );
  const badMetadata = fakeFetch();
  badMetadata.fetchImpl = async (url) =>
    url === metadataUrl
      ? new Response(
          JSON.stringify({
            ...metadata,
            artifacts: Object.fromEntries(
              Object.entries(metadata.artifacts).map(([key, item]) => [
                key,
                {
                  ...item,
                  sha256: "A".repeat(64),
                },
              ]),
            ),
          }),
        )
      : fakeFetch().fetchImpl(url);
  await assert.rejects(
    () =>
      resolveRelease({
        channel: "beta",
        platform: "darwin",
        arch: "arm64",
        fetchImpl: badMetadata.fetchImpl,
      }),
    /lowercase hexadecimal/,
  );
});

test("dry-run does not download the installer and download-only does not open it", async () => {
  const dry = fakeFetch();
  const dryOutput = {
    text: "",
    write(value) {
      this.text += value;
    },
  };
  await runCli(["--dry-run"], {
    platform: "darwin",
    arch: "arm64",
    fetchImpl: dry.fetchImpl,
    stdout: dryOutput,
  });
  assert.equal(dry.calls.includes(artifactUrl), false);
  assert.match(dryOutput.text, /AITracker 1\.0\.0-beta\.2/);

  const only = fakeFetch();
  let opened = false;
  await runCli(["--download-only"], {
    platform: "darwin",
    arch: "arm64",
    fetchImpl: only.fetchImpl,
    stdout: { write() {} },
    spawnImpl: () => {
      opened = true;
    },
  });
  assert.equal(only.calls.includes(artifactUrl), true);
  assert.equal(opened, false);
});

test("download-only directory saves the verified installer without opening it", async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "aitracker-download-output-"),
  );
  const fake = fakeFetch();
  let opened = false;
  try {
    await runCli(["--download-only", outputDirectory], {
      platform: "darwin",
      arch: "arm64",
      fetchImpl: fake.fetchImpl,
      stdout: { write() {} },
      spawnImpl: () => {
        opened = true;
      },
    });
    const destination = join(
      outputDirectory,
      metadata.artifacts["darwin-arm64"].name,
    );
    assert.deepEqual(await readFile(destination), bytes);
    assert.equal(opened, false);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("download-only directory rejects unsafe directories and preserves existing files", async () => {
  const outputDirectory = await mkdtemp(
    join(tmpdir(), "aitracker-download-safety-"),
  );
  const destination = join(
    outputDirectory,
    metadata.artifacts["darwin-arm64"].name,
  );
  try {
    const filePath = join(outputDirectory, "not-a-directory");
    await writeFile(filePath, "not a directory");
    await assert.rejects(
      () =>
        runCli(["--download-only", filePath], {
          platform: "darwin",
          arch: "arm64",
          fetchImpl: fakeFetch().fetchImpl,
          stdout: { write() {} },
        }),
      /real directory, not a file or symlink/,
    );

    const existing = Buffer.from("keep me");
    await writeFile(destination, existing);
    await assert.rejects(
      () =>
        runCli(["--download-only", outputDirectory], {
          platform: "darwin",
          arch: "arm64",
          fetchImpl: fakeFetch().fetchImpl,
          stdout: { write() {} },
        }),
      /EEXIST|file already exists/,
    );
    assert.deepEqual(await readFile(destination), existing);

    const failedDirectory = join(outputDirectory, "failed");
    await assert.rejects(
      () =>
        runCli(["--download-only", failedDirectory], {
          platform: "darwin",
          arch: "arm64",
          fetchImpl: async (url, options) => {
            const response = await fakeFetch().fetchImpl(url, options);
            return url === artifactUrl
              ? new Response(Buffer.from("partial"))
              : response;
          },
          stdout: { write() {} },
        }),
      /size mismatch/,
    );
    await assert.rejects(() =>
      access(join(failedDirectory, metadata.artifacts["darwin-arm64"].name)),
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("streaming download verifies size/hash and cleans failed temporary files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aitracker-download-test-"));
  const destination = join(directory, "installer.dmg");
  try {
    const response = {
      ok: true,
      body: (async function* () {
        yield Buffer.from("bad");
      })(),
    };
    await assert.rejects(
      () =>
        downloadToFile({
          fetchImpl: async () => response,
          url: artifactUrl,
          destination,
          expectedSha256: sha256,
          expectedSize: bytes.length,
        }),
      /size mismatch/,
    );
    await assert.rejects(() => access(destination));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resets the download idle timeout when streamed data makes progress", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "aitracker-download-progress-"),
  );
  const destination = join(directory, "installer.dmg");
  const chunks = [
    Buffer.from("first-"),
    Buffer.from("second-"),
    Buffer.from("third"),
  ];
  const expected = Buffer.concat(chunks);
  try {
    await downloadToFile({
      fetchImpl: async () => ({
        ok: true,
        body: (async function* () {
          for (const chunk of chunks) {
            yield chunk;
            await delay(20);
          }
        })(),
      }),
      url: artifactUrl,
      destination,
      expectedSha256: createHash("sha256").update(expected).digest("hex"),
      expectedSize: expected.length,
      timeoutMs: 250,
      idleTimeoutMs: 35,
    });
    assert.deepEqual(await readFile(destination), expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aborts a download that stops receiving data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aitracker-download-stall-"));
  const destination = join(directory, "installer.dmg");
  try {
    await assert.rejects(
      () =>
        downloadToFile({
          fetchImpl: async (_url, options) => ({
            ok: true,
            body: (async function* () {
              yield Buffer.from("first");
              await new Promise((_, reject) => {
                options.signal.addEventListener(
                  "abort",
                  () => reject(new Error("aborted")),
                  { once: true },
                );
              });
            })(),
          }),
          url: artifactUrl,
          destination,
          expectedSha256: sha256,
          expectedSize: bytes.length,
          timeoutMs: 250,
          idleTimeoutMs: 20,
        }),
      /download stalled after 20 ms without receiving data/,
    );
    await assert.rejects(() => access(destination));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not accumulate WriteStream error listeners under backpressure", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "aitracker-download-listeners-"),
  );
  const destination = join(directory, "installer.dmg");
  const chunk = Buffer.alloc(64 * 1024, 0x61);
  const chunks = Array.from({ length: 32 }, () => chunk);
  const expected = Buffer.concat(chunks);
  const warnings = [];
  const onWarning = (warning) => {
    if (warning.name === "MaxListenersExceededWarning") warnings.push(warning);
  };
  process.on("warning", onWarning);
  try {
    await downloadToFile({
      fetchImpl: async () => ({
        ok: true,
        body: (async function* () {
          yield* chunks;
        })(),
      }),
      url: artifactUrl,
      destination,
      expectedSha256: createHash("sha256").update(expected).digest("hex"),
      expectedSize: expected.length,
    });
    await delay(25);
    assert.equal(warnings.length, 0);
  } finally {
    process.off("warning", onWarning);
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects malicious installer redirects and accepts object storage redirects", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aitracker-redirect-test-"));
  try {
    const destination = join(directory, "installer.dmg");
    await downloadToFile({
      fetchImpl: async () =>
        responseWithUrl(
          bytes,
          "https://objects.githubusercontent.com/github-production-release-asset/installer?x=1",
        ),
      url: artifactUrl,
      destination,
      expectedSha256: sha256,
      expectedSize: bytes.length,
    });

    await assert.rejects(
      () =>
        downloadToFile({
          fetchImpl: async () =>
            responseWithUrl(bytes, "https://evil.example/installer.dmg"),
          url: artifactUrl,
          destination: join(directory, "evil-installer.dmg"),
          expectedSha256: sha256,
          expectedSize: bytes.length,
        }),
      /must resolve to github\.com, release-assets\.githubusercontent\.com, or objects\.githubusercontent\.com/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("opens only supported platform installers with the native launcher", async () => {
  const commands = [];
  const spawnImpl = (command, args, options) => {
    commands.push([command, args, options]);
    return { unref() {} };
  };
  await openInstaller("darwin", "/tmp/a.dmg", spawnImpl);
  await openInstaller("win32", "C:\\a.exe", spawnImpl);
  assert.equal(commands[0][0], "open");
  assert.deepEqual(commands[0][1], ["/tmp/a.dmg"]);
  assert.equal(commands[1][0], "C:\\a.exe");
  assert.deepEqual(commands[1][1], []);
  assert.deepEqual(commands[1][2], {
    shell: false,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  assert.notEqual(commands[1][0], "cmd.exe");
  await openInstaller("win32", "C:\\safe.exe & whoami", spawnImpl);
  assert.equal(commands[2][0], "C:\\safe.exe & whoami");
  assert.equal(commands[2][2].shell, false);
  await assert.rejects(
    () => openInstaller("linux", "/tmp/a", spawnImpl),
    /Unsupported platform/,
  );
});
