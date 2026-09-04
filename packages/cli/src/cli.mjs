import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { readFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, rm as rmAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertAllowedDownloadUrl,
  assertAllowedApiResponseUrl,
  assertAllowedReleaseResponseUrl,
  assertValidChannel,
  assertValidVersion,
  findArtifact,
  inferChannel,
  isValidVersion,
  platformKey,
  RELEASE_API_URL,
  metadataUrlForRelease,
  REPOSITORY,
  validateReleaseMetadata,
} from "./release-metadata.mjs";

export const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 30 * 1000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const DOWNLOAD_PROGRESS_INTERVAL_MS = 250;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DOWNLOAD_TIMEOUT_MS = timeoutFromEnv(
  "AITRACKER_DOWNLOAD_TIMEOUT_MS",
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
);
export const DOWNLOAD_IDLE_TIMEOUT_MS = timeoutFromEnv(
  "AITRACKER_DOWNLOAD_IDLE_TIMEOUT_MS",
  DEFAULT_DOWNLOAD_IDLE_TIMEOUT_MS,
);
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const SAFE_INSTALLER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:dmg|exe)$/u;

function timeoutFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS
    ? value
    : fallback;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, Number(bytes) || 0);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatDownloadProgress({ downloaded, total, elapsedMs }) {
  const downloadedBytes = Math.max(0, Number(downloaded) || 0);
  const totalBytes = Number.isFinite(total) && total > 0 ? total : undefined;
  const elapsedSeconds = Math.max(1, Number(elapsedMs) || 0) / 1000;
  const speed = downloadedBytes / elapsedSeconds;
  const progress = totalBytes
    ? `${Math.min(100, (downloadedBytes / totalBytes) * 100).toFixed(1)}% (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`
    : `${formatBytes(downloadedBytes)} downloaded`;
  return `Downloading: ${progress} at ${formatBytes(speed)}/s`;
}

function createDownloadProgressReporter(stdout) {
  if (!stdout?.write) return undefined;
  const startedAt = Date.now();
  const isTty = stdout.isTTY === true;
  let lastUpdateAt = 0;
  let ended = false;
  const report = ({ downloaded, total, done = false }) => {
    const now = Date.now();
    if (
      !done &&
      downloaded !== total &&
      now - lastUpdateAt < DOWNLOAD_PROGRESS_INTERVAL_MS
    ) {
      return;
    }
    lastUpdateAt = now;
    const line = formatDownloadProgress({
      downloaded,
      total,
      elapsedMs: now - startedAt,
    });
    stdout.write(isTty ? `\r${line}` : `${line}\n`);
    if (done) {
      ended = true;
      if (isTty) stdout.write("\n");
    }
  };
  report.finish = () => {
    if (!ended && isTty) stdout.write("\n");
    ended = true;
  };
  return report;
}

function optionValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export function parseArgs(
  argv,
  {
    packageVersion = "1.0.0-beta.3",
    platform = process.platform,
    arch = process.arch,
  } = {},
) {
  assertValidVersion(packageVersion, "CLI package version");
  const options = {
    channel: inferChannel(packageVersion),
    version: packageVersion,
    platform,
    arch,
    dryRun: false,
    downloadOnly: false,
    downloadDirectory: undefined,
    help: false,
  };
  const positional = [];
  let explicitVersion = false;
  let downloadOnlySeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--download-only") {
      if (downloadOnlySeen) {
        throw new Error("--download-only may only be provided once");
      }
      downloadOnlySeen = true;
      options.downloadOnly = true;
      const next = argv[index + 1];
      if (next === "") {
        throw new Error("--download-only directory must not be empty");
      }
      if (next && !next.startsWith("-")) {
        if (
          isValidVersion(next) &&
          !explicitVersion &&
          positional.length === 0
        ) {
          positional.push(next);
        } else {
          options.downloadDirectory = next;
        }
        index += 1;
      }
    } else if (arg.startsWith("--download-only=")) {
      if (downloadOnlySeen) {
        throw new Error("--download-only may only be provided once");
      }
      downloadOnlySeen = true;
      const directory = arg.slice("--download-only=".length);
      if (!directory) {
        throw new Error("--download-only directory must not be empty");
      }
      options.downloadOnly = true;
      options.downloadDirectory = directory;
    } else if (arg === "--channel") {
      options.channel = optionValue(argv, index, "--channel");
      index += 1;
      if (!explicitVersion) options.version = undefined;
    } else if (arg.startsWith("--channel=")) {
      options.channel = arg.slice("--channel=".length);
      if (!explicitVersion) options.version = undefined;
    } else if (arg === "--version") {
      options.version = optionValue(argv, index, "--version");
      index += 1;
      explicitVersion = true;
    } else if (arg.startsWith("--version=")) {
      options.version = arg.slice("--version=".length);
      explicitVersion = true;
    } else if (arg === "--platform") {
      options.platform = optionValue(argv, index, "--platform");
      index += 1;
    } else if (arg.startsWith("--platform=")) {
      options.platform = arg.slice("--platform=".length);
    } else if (arg === "--arch") {
      options.arch = optionValue(argv, index, "--arch");
      index += 1;
    } else if (arg.startsWith("--arch=")) {
      options.arch = arg.slice("--arch=".length);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) {
    throw new Error("only one positional version is allowed");
  }
  if (positional[0] && explicitVersion) {
    throw new Error(
      "provide the release version either positionally or with --version, not both",
    );
  }
  if (positional[0]) options.version = positional[0];
  assertValidChannel(options.channel);
  if (options.version) assertValidVersion(options.version);
  if (!options.help) platformKey(options.platform, options.arch);
  return options;
}

export function helpText() {
  return `Usage: npx @estelwalks/aitracker [version] [options]

Download and open the AITracker desktop installer.
Real downloads show percentage, transferred size, and current speed.

Options:
  --channel stable|beta  Release channel (defaults from this CLI version)
  --version x.y.z        Exact release version
  --platform NAME        Override platform for testing (darwin or win32)
  --arch NAME            Override architecture (arm64 or x64)
  --dry-run              Resolve and print the artifact without downloading it
  --download-only        Download and verify without opening the installer
  --download-only DIR    Save the verified installer as a safe filename in DIR
  --download-only=DIR    Same as the separate DIR form
  -h, --help             Show this help
`;
}

function assertSafeInstallerName(name) {
  if (
    typeof name !== "string" ||
    basename(name) !== name ||
    name.includes("\\") ||
    name === "." ||
    name === ".." ||
    !SAFE_INSTALLER_NAME.test(name)
  ) {
    throw new Error("release artifact has an unsafe installer filename");
  }
}

async function prepareDownloadDirectory(directory) {
  if (typeof directory !== "string" || directory.includes("\0")) {
    throw new Error("download directory must be a valid path");
  }
  const resolvedDirectory = resolve(directory);
  if (resolvedDirectory === dirname(resolvedDirectory)) {
    throw new Error("refusing to download directly into a filesystem root");
  }

  try {
    const existing = await lstat(resolvedDirectory);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(
        "download directory must be a real directory, not a file or symlink",
      );
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(resolvedDirectory, { recursive: true });
    const created = await lstat(resolvedDirectory);
    if (!created.isDirectory() || created.isSymbolicLink()) {
      throw new Error("download directory must be a real directory");
    }
  }
  return resolvedDirectory;
}

async function* responseChunks(response) {
  if (!response.body) {
    if (typeof response.arrayBuffer !== "function") {
      throw new Error("download response has no body");
    }
    yield new Uint8Array(await response.arrayBuffer());
    return;
  }

  if (typeof response.body[Symbol.asyncIterator] === "function") {
    for await (const chunk of response.body) yield new Uint8Array(chunk);
    return;
  }

  if (typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        yield new Uint8Array(result.value);
      }
    } finally {
      reader.releaseLock?.();
    }
    return;
  }

  throw new Error("download response body is not streamable");
}

async function fetchWithTimeout(
  fetchImpl,
  url,
  {
    timeoutMs,
    idleTimeoutMs,
    signal,
    consume,
    validateResponseUrl,
    timeoutLabel = "request",
  } = {},
) {
  const controller = new AbortController();
  const effectiveTimeoutMs = timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let timeoutReason;
  let timer;
  let idleTimer;
  const abortWithReason = (reason) => {
    timeoutReason = reason;
    controller.abort();
  };
  const armTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        abortWithReason(
          `${timeoutLabel} timed out after ${effectiveTimeoutMs} ms`,
        ),
      effectiveTimeoutMs,
    );
  };
  const armIdleTimer = () => {
    if (idleTimeoutMs === undefined) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () =>
        abortWithReason(
          `${timeoutLabel} stalled after ${idleTimeoutMs} ms without receiving data`,
        ),
      idleTimeoutMs,
    );
  };
  const noteProgress = () => {
    armIdleTimer();
  };
  armTimer();
  armIdleTimer();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { "user-agent": "aitracker-cli", accept: "application/json" },
      redirect: "follow",
    });
    const responseUrl = response?.url;
    if (responseUrl && validateResponseUrl) {
      validateResponseUrl(responseUrl, `${url} response URL`);
    }
    return consume
      ? await consume(response, controller.signal, noteProgress)
      : response;
  } catch (error) {
    if (timeoutReason) throw new Error(timeoutReason);
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(idleTimer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function readResponseBytes(response, maxBytes, label) {
  if (!response?.ok) {
    throw new Error(
      `${label} request failed (HTTP ${response?.status ?? "unknown"})`,
    );
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of responseChunks(response)) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes} byte size limit`);
    }
    chunks.push(chunk);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function fetchJson(fetchImpl, url, label, validateResponseUrl) {
  return fetchWithTimeout(fetchImpl, url, {
    validateResponseUrl,
    consume: async (response) => {
      const bytes = await readResponseBytes(
        response,
        MAX_METADATA_BYTES,
        label,
      );
      try {
        return JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new Error(`${label} returned invalid JSON`);
      }
    },
  });
}

function releaseVersionFromTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v")) return undefined;
  const version = tag.slice(1);
  return isValidVersion(version) ? version : undefined;
}

function releaseMatches(release, channel, version) {
  if (
    !release ||
    release.draft !== false ||
    release.prerelease !== (channel === "beta")
  ) {
    return false;
  }
  return !version || releaseVersionFromTag(release.tag_name) === version;
}

export async function resolveRelease({
  channel,
  version,
  platform,
  arch,
  fetchImpl = globalThis.fetch,
}) {
  assertValidChannel(channel);
  if (version) assertValidVersion(version);
  const key = platformKey(platform, arch);
  if (typeof fetchImpl !== "function")
    throw new Error("this Node.js version must provide fetch");

  const releases = await fetchJson(
    fetchImpl,
    RELEASE_API_URL,
    "GitHub Releases API",
    assertAllowedApiResponseUrl,
  );
  if (!Array.isArray(releases))
    throw new Error("GitHub Releases API returned an invalid response");
  const release = releases.find((candidate) =>
    releaseMatches(candidate, channel, version),
  );
  if (!release) {
    const requested = version ? ` version ${version}` : "";
    throw new Error(`no non-draft ${channel} release${requested} was found`);
  }

  const metadataAsset = Array.isArray(release.assets)
    ? release.assets.find((asset) => asset?.name === "release-metadata.json")
    : undefined;
  if (
    !metadataAsset ||
    typeof metadataAsset.browser_download_url !== "string"
  ) {
    throw new Error("release is missing the release-metadata.json asset");
  }
  const expectedVersion = releaseVersionFromTag(release.tag_name);
  const expectedMetadataUrl = expectedVersion
    ? metadataUrlForRelease(expectedVersion, "release-metadata.json")
    : undefined;
  assertAllowedDownloadUrl(metadataAsset.browser_download_url, "metadata URL");
  if (metadataAsset.browser_download_url !== expectedMetadataUrl) {
    throw new Error("release metadata URL does not match the selected tag");
  }
  const metadata = await fetchWithTimeout(
    fetchImpl,
    metadataAsset.browser_download_url,
    {
      validateResponseUrl: assertAllowedReleaseResponseUrl,
      consume: async (response) => {
        const metadataBytes = await readResponseBytes(
          response,
          MAX_METADATA_BYTES,
          "release-metadata.json",
        );
        try {
          return JSON.parse(new TextDecoder().decode(metadataBytes));
        } catch {
          throw new Error("release-metadata.json returned invalid JSON");
        }
      },
    },
  );
  validateReleaseMetadata(metadata);
  if (
    metadata.repository !== REPOSITORY ||
    metadata.channel !== channel ||
    metadata.appVersion !== expectedVersion ||
    metadata.gitTag !== `v${expectedVersion}`
  ) {
    throw new Error("release metadata does not match the selected release");
  }
  if (version && metadata.appVersion !== version) {
    throw new Error("release metadata does not match the requested version");
  }
  const artifact = findArtifact(metadata, platform, arch);
  return { release, metadata, artifact, platform: key };
}

export async function downloadToFile({
  fetchImpl = globalThis.fetch,
  url,
  destination,
  expectedSha256,
  expectedSize,
  maxBytes = MAX_DOWNLOAD_BYTES,
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
  idleTimeoutMs = DOWNLOAD_IDLE_TIMEOUT_MS,
  onProgress,
}) {
  assertAllowedDownloadUrl(url);
  return fetchWithTimeout(fetchImpl, url, {
    timeoutMs,
    idleTimeoutMs,
    timeoutLabel: "download",
    validateResponseUrl: assertAllowedReleaseResponseUrl,
    consume: async (response, signal, noteProgress) => {
      if (!response?.ok)
        throw new Error(
          `installer download failed (HTTP ${response?.status ?? "unknown"})`,
        );
      const advertisedSize = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(advertisedSize) && advertisedSize > maxBytes) {
        throw new Error(`installer exceeds the ${maxBytes} byte size limit`);
      }
      const progressTotal =
        Number.isFinite(advertisedSize) && advertisedSize > 0
          ? advertisedSize
          : expectedSize;

      const hash = createHash("sha256");
      let total = 0;
      let output;
      let created = false;
      let outputError;
      let outputFinished;
      try {
        output = createWriteStream(destination, { flags: "wx" });
        output.on("error", (error) => {
          outputError =
            error instanceof Error ? error : new Error(String(error));
        });
        outputFinished = finished(output);
        outputFinished.catch(() => undefined);
        await once(output, "open");
        created = true;
        for await (const chunk of responseChunks(response)) {
          signal?.throwIfAborted?.();
          if (outputError) throw outputError;
          total += chunk.byteLength;
          if (total > maxBytes)
            throw new Error(
              `installer exceeds the ${maxBytes} byte size limit`,
            );
          hash.update(chunk);
          noteProgress?.();
          onProgress?.({ downloaded: total, total: progressTotal });
          if (!output.write(chunk)) await once(output, "drain");
        }
        if (outputError) throw outputError;
        output.end();
        await outputFinished;
      } catch (error) {
        output?.destroy();
        await outputFinished?.catch(() => undefined);
        if (created) await rmAsync(destination, { force: true });
        throw error;
      }

      const actualHash = hash.digest("hex");
      if (total !== expectedSize) {
        if (created) await rmAsync(destination, { force: true });
        throw new Error(
          `installer size mismatch: expected ${expectedSize}, got ${total}`,
        );
      }
      if (actualHash !== expectedSha256) {
        if (created) await rmAsync(destination, { force: true });
        throw new Error("installer SHA-256 mismatch");
      }
      return { size: total, sha256: actualHash, path: destination };
    },
  });
}

export function formatArtifactSummary({ metadata, artifact, platform }) {
  return [
    `AITracker ${metadata.appVersion} (${metadata.channel})`,
    `Platform: ${platform}`,
    `Installer: ${artifact.name}`,
    `URL: ${artifact.url}`,
    `SHA-256: ${artifact.sha256}`,
    `Size: ${artifact.size} bytes`,
  ].join("\n");
}

export async function openInstaller(
  platform,
  installerPath,
  spawnImpl = spawn,
) {
  if (platform === "darwin") {
    const child = spawnImpl("open", [installerPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref?.();
    return;
  }
  if (platform === "win32") {
    const child = spawnImpl(installerPath, [], {
      shell: false,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref?.();
    return;
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

function packageVersion() {
  const packagePath = fileURLToPath(
    new URL("../package.json", import.meta.url),
  );
  return JSON.parse(readFileSync(packagePath, "utf8"));
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    fetchImpl = globalThis.fetch,
    platform = process.platform,
    arch = process.arch,
    spawnImpl = spawn,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  const pkg = await packageVersion();
  const options = parseArgs(argv, {
    packageVersion: pkg.version,
    platform,
    arch,
  });
  if (options.help) {
    stdout.write(helpText());
    return 0;
  }

  const resolved = await resolveRelease({ ...options, fetchImpl });
  stdout.write(`${formatArtifactSummary(resolved)}\n`);
  if (resolved.metadata.channel === "beta") {
    stdout.write(
      "Warning: this beta installer is unsigned. macOS Gatekeeper or Windows SmartScreen may show a security warning; verify the source and checksum and follow the operating system's normal per-file confirmation flow. Do not disable global security settings.\n",
    );
  }
  if (options.dryRun) return 0;
  assertSafeInstallerName(resolved.artifact.name);
  const explicitDownloadDirectory = options.downloadDirectory
    ? await prepareDownloadDirectory(options.downloadDirectory)
    : undefined;
  const tempDirectory = explicitDownloadDirectory
    ? undefined
    : await mkdtemp(join(tmpdir(), "aitracker-"));
  const installerPath = join(
    explicitDownloadDirectory ?? tempDirectory,
    resolved.artifact.name,
  );
  const reportProgress = createDownloadProgressReporter(stdout);
  try {
    await downloadToFile({
      fetchImpl,
      url: resolved.artifact.url,
      destination: installerPath,
      expectedSha256: resolved.artifact.sha256,
      expectedSize: resolved.artifact.size,
      onProgress: reportProgress,
    });
    reportProgress?.({
      downloaded: resolved.artifact.size,
      total: resolved.artifact.size,
      done: true,
    });
    stdout.write(`Downloaded and verified: ${installerPath}\n`);
    if (!options.downloadOnly)
      await openInstaller(options.platform, installerPath, spawnImpl);
    return 0;
  } finally {
    reportProgress?.finish?.();
    if (tempDirectory)
      await rmAsync(tempDirectory, { recursive: true, force: true });
  }
}

export function cliErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
