import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { join } from "node:path";

import type {
  DesktopUpdateState,
  DesktopUpdateLifecycle,
} from "./contracts.js";
import { APP_REPO_URL } from "./app-config.js";
import type { LinuxPackageFormat } from "./linux-package-format.js";

const githubRepository = new URL(APP_REPO_URL);
const githubPath = githubRepository.pathname.replace(/\/$/u, "");
const GITHUB_RELEASES_URL = `https://api.github.com/repos${githubPath}/releases?per_page=100`;
const RELEASE_REPOSITORY = "estelwalks/aitracker";
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
/** How long the installer download may take before its headers arrive. */
const DOWNLOAD_CONNECT_TIMEOUT_MS = 60_000;
/**
 * Maximum silence between installer download chunks. Slower-than-this
 * transfers abort, but a steady trickle may run for as long as it needs.
 */
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
/** Throttle for progress broadcasts while downloading. */
const DOWNLOAD_PROGRESS_INTERVAL_MS = 200;
const RELEASE_METADATA_NAME = "release-metadata.json";
/**
 * Linux's companion document. The main document's artifact map has to keep
 * exactly the four macOS/Windows keys, because clients released before the
 * tolerant validator reject any fifth key outright — a `linux-x64` entry there
 * would permanently strand their own updates. Linux artifacts are therefore
 * published both here (authoritative for Linux) and, from the release that
 * merges them, in the main document.
 */
const RELEASE_METADATA_LINUX_NAME = "release-metadata-linux.json";
const STRICT_SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?$/u;
const TRUSTED_GITHUB_ASSET_HOSTS = new Set([
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const ARCH_ALIASES: Record<string, readonly string[]> = {
  arm64: ["arm64", "aarch64"],
  x64: ["x64", "amd64", "x86_64"],
  ia32: ["ia32", "x86", "win32"],
};

interface GitHubAsset {
  name?: unknown;
  browser_download_url?: unknown;
  /** Size in bytes, which the API reports for every uploaded asset. */
  size?: unknown;
  /** `sha256:<hex>` of the uploaded bytes, computed by GitHub. */
  digest?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

interface SelectedAsset {
  name: string;
  url: string;
  /**
   * GitHub's own size and sha256 for this asset, when the feed carries a usable
   * pair. They are what makes an installer the release metadata does not record
   * — the `.deb`/`.rpm` a distro install updates through — verifiable anyway.
   */
  size?: number;
  sha256?: string;
}

export type UpdateChannel = "stable" | "beta";

interface ExpectedArtifact {
  name: string;
  url: string;
  sha256: string;
  size: number;
}

export interface UpdateManagerOptions {
  readonly currentVersion: string;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly tempDirectory: string;
  /** Defaults to beta for prerelease builds and stable otherwise. */
  readonly channel?: UpdateChannel;
  /** Defaults to 512 MiB. Useful for enforcing a tighter product limit. */
  readonly maxDownloadBytes?: number;
  /** Download connect phase budget, until response headers arrive (default 60 s). */
  readonly downloadConnectTimeoutMs?: number;
  /**
   * Maximum silence between download chunks before the transfer aborts
   * (default 60 s). The total transfer may take much longer as long as data
   * keeps flowing.
   */
  readonly downloadIdleTimeoutMs?: number;
  /**
   * Which distro package a `.deb`/`.rpm` install updates through, when the host
   * is one. `null`/absent keeps the AppImage first, which is what every Linux
   * host could always install by running it.
   */
  readonly preferredLinuxPackageFormat?: LinuxPackageFormat | null;
  readonly fetchFn?: typeof fetch;
  readonly writeFileFn?: (path: string, data: Uint8Array) => Promise<void>;
  readonly mkdirFn?: (path: string) => Promise<void>;
  readonly unlinkFn?: (path: string) => Promise<void>;
}

export type UpdateStateListener = (state: DesktopUpdateState) => void;

function emptyState(
  currentVersion: string,
  status: DesktopUpdateLifecycle = "idle",
): DesktopUpdateState {
  return {
    status,
    currentVersion,
    latestVersion: null,
    releaseDate: null,
    downloadUrl: null,
    assetName: null,
    releaseUrl: null,
    changelog: null,
  };
}

function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const normalized = value.trim().replace(/^v/i, "").split("+")[0] ?? "";
    const [coreText, prereleaseText] = normalized.split("-", 2);
    const core = (coreText ?? "").split(".").map((part) => {
      const number = Number.parseInt(part, 10);
      return Number.isFinite(number) ? number : 0;
    });
    const prerelease =
      prereleaseText == null
        ? null
        : prereleaseText
            .split(".")
            .map((part) => (/^\d+$/u.test(part) ? Number(part) : part));
    return { core: [core[0] ?? 0, core[1] ?? 0, core[2] ?? 0], prerelease };
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index]! - right.core[index]!;
    }
  }
  if (left.prerelease == null && right.prerelease == null) return 0;
  if (left.prerelease == null) return 1;
  if (right.prerelease == null) return -1;
  for (
    let index = 0;
    index < Math.max(left.prerelease.length, right.prerelease.length);
    index += 1
  ) {
    const aPart = left.prerelease[index];
    const bPart = right.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    if (typeof aPart === "number" && typeof bPart === "number") {
      return aPart - bPart;
    }
    if (typeof aPart === "number") return -1;
    if (typeof bPart === "number") return 1;
    return aPart.localeCompare(bPart);
  }
  return 0;
}

function hasPrerelease(version: string): boolean {
  const normalized = version.trim().replace(/^v/i, "").split("+")[0] ?? "";
  return normalized.includes("-");
}

function defaultChannel(currentVersion: string): UpdateChannel {
  return hasPrerelease(currentVersion) ? "beta" : "stable";
}

function isPrereleaseRelease(release: GitHubRelease): boolean {
  return release.prerelease === true || hasPrerelease(versionOf(release) ?? "");
}

function versionOf(release: GitHubRelease): string | null {
  if (typeof release.tag_name !== "string") return null;
  const tag = release.tag_name;
  if (!tag.startsWith("v")) return null;
  const version = tag.slice(1);
  return tag === tag.trim() && STRICT_SEMVER_PATTERN.test(version)
    ? version
    : null;
}

function releaseDateOf(release: GitHubRelease): string | null {
  if (typeof release.published_at !== "string") return null;
  return Number.isFinite(Date.parse(release.published_at))
    ? release.published_at
    : null;
}

function trustedDownloadUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === githubRepository.hostname &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      // Installer and metadata names carry no version, so an asset is reached
      // either through the `latest` alias release or through the tag of the
      // release it was listed in. Only this repository's own release paths are
      // accepted; the sha256 check covers the delivered bytes.
      url.pathname.startsWith(`${githubPath}/releases/`) &&
      /^\/releases\/(?:latest\/download|download\/[^/?#]+)\/[^/?#]+$/u.test(
        url.pathname.slice(githubPath.length),
      )
    );
  } catch {
    return false;
  }
}

function canonicalArch(arch: string): string {
  for (const [canonical, aliases] of Object.entries(ARCH_ALIASES)) {
    if (aliases.includes(arch)) return canonical;
  }
  return arch;
}

function platformArtifactKey(platform: NodeJS.Platform, arch: string): string {
  return `${platform}-${canonicalArch(arch)}`;
}

function isSafeAssetName(name: string): boolean {
  return name.length > 0 && !/[/\\?#]/u.test(name);
}

function isTrustedResponseUrl(response: Response): boolean {
  if (!response.url || trustedDownloadUrl(response.url)) return true;
  try {
    const url = new URL(response.url);
    return (
      url.protocol === "https:" &&
      TRUSTED_GITHUB_ASSET_HOSTS.has(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function contentLengthOf(response: Response): number | null {
  const value = response.headers.get("content-length");
  return value === null ? null : Number(value);
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  onChunk?: (receivedBytes: number) => void,
): Promise<Uint8Array> {
  const declaredSize = contentLengthOf(response);
  if (
    declaredSize !== null &&
    (!Number.isFinite(declaredSize) ||
      declaredSize < 0 ||
      declaredSize > maxBytes)
  ) {
    throw new Error("size-limit");
  }

  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > maxBytes) throw new Error("size-limit");
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      total += chunk.byteLength;
      onChunk?.(total);
      if (total > maxBytes) throw new Error("size-limit");
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

interface StreamDownloadResult {
  size: number;
  sha256: string;
}

async function streamResponseToFile(
  response: Response,
  path: string,
  expectedSize: number,
  maxBytes: number,
  onChunk?: (receivedBytes: number) => void,
): Promise<StreamDownloadResult> {
  if (!response.body) throw new Error("download-body");

  // 0o755 rather than the umask default (0644): a Linux AppImage has to be
  // executable, and the hand-off asserts `X_OK` before it reports success. The
  // `.dmg`/`.exe` flows are unaffected by the extra execute bits. The hand-off
  // still chmods and re-checks, so this is a convenience, not the guarantee.
  const output = createWriteStream(path, { flags: "wx", mode: 0o755 });
  const hash = createHash("sha256");
  const reader = response.body.getReader();
  let outputError: Error | null = null;
  output.on("error", (error) => {
    outputError = error instanceof Error ? error : new Error(String(error));
  });
  const outputFinished = finished(output);
  // Keep the promise observed while response chunks are being consumed.
  outputFinished.catch(() => undefined);
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      if (outputError) throw outputError;
      total += chunk.byteLength;
      onChunk?.(total);
      if (!Number.isSafeInteger(total) || total > maxBytes) {
        throw new Error("size-limit");
      }
      if (total > expectedSize) throw new Error("size-mismatch");
      hash.update(chunk);
      if (!output.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          const onDrain = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const cleanup = () => {
            output.off("drain", onDrain);
            output.off("error", onError);
          };
          output.once("drain", onDrain);
          output.once("error", onError);
        });
      }
    }
    reader.releaseLock();
    output.end();
    await outputFinished;

    if (total !== expectedSize) throw new Error("size-mismatch");
    return { size: total, sha256: hash.digest("hex") };
  } catch (error) {
    reader.releaseLock();
    output.destroy();
    await finished(output).catch(() => undefined);
    throw error;
  }
}

function metadataArtifactOf(
  payload: unknown,
  release: GitHubRelease,
  channel: UpdateChannel,
  platform: NodeJS.Platform,
  arch: string,
  selectedAsset: SelectedAsset,
  maxDownloadBytes: number,
  assets: readonly GitHubAsset[],
): ExpectedArtifact | null {
  if (typeof payload !== "object" || payload === null) return null;
  const metadata = payload as Record<string, unknown>;
  const allowedMetadataKeys = new Set([
    "schemaVersion",
    "appVersion",
    "channel",
    "repository",
    "gitTag",
    "gitCommit",
    "publishedAt",
    "artifacts",
  ]);
  if (Object.keys(metadata).some((key) => !allowedMetadataKeys.has(key))) {
    return null;
  }
  if (
    metadata.schemaVersion !== 1 ||
    metadata.repository !== RELEASE_REPOSITORY ||
    metadata.appVersion !== versionOf(release) ||
    metadata.gitTag !== `v${versionOf(release)}` ||
    (metadata.channel !== "stable" && metadata.channel !== "beta") ||
    metadata.channel !== (isPrereleaseRelease(release) ? "beta" : "stable") ||
    metadata.channel !==
      (hasPrerelease(metadata.appVersion as string) ? "beta" : "stable")
  ) {
    return null;
  }
  if (
    metadata.gitCommit !== undefined &&
    (typeof metadata.gitCommit !== "string" ||
      !/^[0-9a-fA-F]{40}$/.test(metadata.gitCommit))
  )
    return null;
  if (
    metadata.publishedAt !== undefined &&
    (typeof metadata.publishedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        metadata.publishedAt,
      ) ||
      !Number.isFinite(Date.parse(metadata.publishedAt)))
  )
    return null;
  if (channel === "stable" && metadata.channel !== "stable") return null;

  const artifacts = metadata.artifacts;
  if (
    typeof artifacts !== "object" ||
    artifacts === null ||
    Array.isArray(artifacts)
  )
    return null;
  const artifactMap = artifacts as Record<string, unknown>;
  // The platforms every release publishes. These four must be present: the
  // compatibility window that let this be a subset closed at 1.0.3 (the last
  // release 1.0.0 and 1.0.1 could update themselves from), so this is the
  // 1.0.3-and-later contract.
  const requiredKeys = [
    "darwin-arm64",
    "darwin-x64",
    "win32-arm64",
    "win32-x64",
  ];
  // A release also publishes Linux installers, but never as a fifth key of the
  // MAIN document: clients older than the Linux launch reject any fifth key
  // outright, which would strand their own updates for every subsequent
  // release. Linux artifacts live in `release-metadata-linux.json`, and the
  // main document keeps its four keys until no such client is left.
  // (See dev-docs/linux/01-架构决策.md §3.1.)
  //
  // This reader is nevertheless forward-tolerant: a key shaped like a platform
  // artifact entry is accepted and ignored rather than treated as a foreign
  // document. That is what lets a Linux client validate the companion document
  // (five keys) today and the merged main document later, without weakening the
  // "is this document ours" check — four required keys must still validate.
  const platformKeyShape = /^(?:darwin|win32|linux)-(?:arm64|x64|ia32)$/u;
  if (
    Object.keys(artifactMap).some(
      (key) => !requiredKeys.includes(key) && !platformKeyShape.test(key),
    ) ||
    requiredKeys.some(
      (key) => !Object.prototype.hasOwnProperty.call(artifactMap, key),
    )
  )
    return null;
  for (const key of requiredKeys) {
    const candidate = artifactMap[key];
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate)
    )
      return null;
    const artifact = candidate as Record<string, unknown>;
    if (
      Object.keys(artifact).some(
        (key) => !["name", "url", "sha256", "size"].includes(key),
      ) ||
      typeof artifact.name !== "string" ||
      !isSafeAssetName(artifact.name) ||
      typeof artifact.url !== "string" ||
      // The URL cannot be derived from a version any more, so it only has to
      // be a trusted releases/latest or releases/download/<tag> URL for this
      // repository. The name below ties it to a real asset of the selected
      // release, and the sha256 is re-verified against the downloaded bytes.
      !trustedDownloadUrl(artifact.url) ||
      typeof artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      typeof artifact.size !== "number" ||
      !Number.isSafeInteger(artifact.size) ||
      artifact.size < 1 ||
      artifact.size > maxDownloadBytes
    )
      return null;
    // Match by name only: a release lists its assets under the tag's own
    // download path, while the metadata records the versionless
    // releases/latest/download/<name> URL, so the two legitimately differ.
    if (!assets.some((asset) => asset.name === artifact.name)) return null;
  }

  const rawArtifact = artifactMap[platformArtifactKey(platform, arch)];
  if (typeof rawArtifact !== "object" || rawArtifact === null) return null;
  const artifact = rawArtifact as Record<string, unknown>;
  if (
    typeof artifact.name !== "string" ||
    typeof artifact.url !== "string" ||
    typeof artifact.sha256 !== "string" ||
    typeof artifact.size !== "number" ||
    !isSafeAssetName(artifact.name) ||
    !trustedDownloadUrl(artifact.url) ||
    !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 1 ||
    artifact.size > maxDownloadBytes
  ) {
    return null;
  }

  const releaseAsset = assets.find((asset) => asset.name === artifact.name);
  if (!releaseAsset || artifact.name !== selectedAsset.name) {
    return null;
  }
  // Always download the URL the release itself advertises for this asset: for a
  // tag-addressed asset that is the immutable per-release URL, which is what
  // its sha256 was computed from.
  const downloadUrl =
    typeof releaseAsset.browser_download_url === "string" &&
    trustedDownloadUrl(releaseAsset.browser_download_url)
      ? releaseAsset.browser_download_url
      : artifact.url;
  return {
    name: artifact.name,
    url: downloadUrl,
    sha256: artifact.sha256.toLowerCase(),
    size: artifact.size,
  };
}

/**
 * Metadata documents that may describe this platform, most specific first.
 *
 * Linux reads its companion document first and falls back to the main one, so a
 * release that later merges Linux into the main document keeps working for
 * clients that shipped with the split arrangement.
 */
function metadataDocumentNames(platform: NodeJS.Platform): readonly string[] {
  return platform === "linux"
    ? [RELEASE_METADATA_LINUX_NAME, RELEASE_METADATA_NAME]
    : [RELEASE_METADATA_NAME];
}

/**
 * Installer extensions this platform accepts, most preferred first.
 *
 * A build installed from a distro package updates through its own software
 * centre, which can only open the format its package manager understands — so
 * for those installs the matching package is preferred and the AppImage stays
 * as the fallback for a release that does not publish it.
 */
function extensionsFor(
  platform: NodeJS.Platform,
  preferredPackageFormat?: LinuxPackageFormat | null,
): readonly string[] {
  if (platform === "darwin") return [".dmg", ".zip"];
  if (platform === "win32") return [".exe", ".msi", ".zip"];
  // `.tar.gz` is deliberately absent. It used to be listed, which made it
  // selectable, and nothing downstream can install a tarball — the update would
  // be "downloaded" and then handed to a hand-off that has no path for it.
  if (platform === "linux") {
    if (preferredPackageFormat === "deb") return [".deb", ".appimage", ".rpm"];
    if (preferredPackageFormat === "rpm") return [".rpm", ".appimage", ".deb"];
    return [".appimage", ".deb", ".rpm"];
  }
  return [];
}

/**
 * GitHub's own integrity data for an asset, when the feed carries a usable pair:
 * `size` plus a `sha256:` digest computed by GitHub from the uploaded bytes.
 */
function assetIntegrity(asset: GitHubAsset): {
  size?: number;
  sha256?: string;
} {
  const digest = typeof asset.digest === "string" ? asset.digest.trim() : "";
  const match = /^sha256:([a-fA-F0-9]{64})$/u.exec(digest);
  const size =
    typeof asset.size === "number" &&
    Number.isSafeInteger(asset.size) &&
    asset.size > 0
      ? asset.size
      : undefined;
  return {
    ...(size === undefined ? {} : { size }),
    ...(match ? { sha256: match[1]!.toLowerCase() } : {}),
  };
}

/** Selects only a trusted, user-installable asset for this platform/arch. */
export function selectUpdateAsset(
  assets: readonly GitHubAsset[],
  platform: NodeJS.Platform,
  arch: string,
  options: {
    readonly preferredPackageFormat?: LinuxPackageFormat | null;
  } = {},
): SelectedAsset | null {
  const extensions = extensionsFor(platform, options.preferredPackageFormat);
  const archNames = ARCH_ALIASES[arch] ?? [arch];
  const candidates = assets.flatMap((asset) => {
    if (
      typeof asset.name !== "string" ||
      !trustedDownloadUrl(asset.browser_download_url)
    ) {
      return [];
    }
    const lowerName = asset.name.toLowerCase();
    if (!extensions.some((extension) => lowerName.endsWith(extension))) {
      return [];
    }
    return [
      {
        name: asset.name,
        url: asset.browser_download_url,
        lowerName,
        ...assetIntegrity(asset),
      },
    ];
  });
  if (candidates.length === 0) return null;

  const exact = candidates.filter((candidate) =>
    archNames.some((name) => candidate.lowerName.includes(name)),
  );
  const hasOtherArchitecture = candidates.some((candidate) =>
    Object.values(ARCH_ALIASES)
      .flat()
      .some((name) => candidate.lowerName.includes(name)),
  );
  if (exact.length === 0 && hasOtherArchitecture) return null;
  const pool = exact.length > 0 ? exact : candidates;
  const selected = pool.sort(
    (left, right) =>
      extensions.findIndex((extension) => left.lowerName.endsWith(extension)) -
        extensions.findIndex((extension) =>
          right.lowerName.endsWith(extension),
        ) || left.name.localeCompare(right.name),
  )[0];
  if (!selected) return null;
  const { name, url, size, sha256 } = selected;
  return {
    name,
    url,
    ...(size === undefined ? {} : { size }),
    ...(sha256 === undefined ? {} : { sha256 }),
  };
}

/**
 * The artifact exactly as GitHub describes it. Used for an installer the
 * release metadata does not record, which is the case for the `.deb`/`.rpm` a
 * distro install updates through: the metadata contract allows one artifact per
 * platform key, and that key is the AppImage.
 */
function artifactFromAsset(asset: SelectedAsset): ExpectedArtifact | null {
  if (asset.sha256 === undefined || asset.size === undefined) return null;
  return {
    name: asset.name,
    url: asset.url,
    sha256: asset.sha256,
    size: asset.size,
  };
}

export class UpdateManager {
  readonly #options: UpdateManagerOptions;
  readonly #fetch: typeof fetch;
  readonly #writeFile: (path: string, data: Uint8Array) => Promise<void>;
  readonly #mkdir: (path: string) => Promise<void>;
  readonly #unlink: (path: string) => Promise<void>;
  readonly #channel: UpdateChannel;
  readonly #maxDownloadBytes: number;
  readonly #packageFormat: LinuxPackageFormat | null;
  readonly #listeners = new Set<UpdateStateListener>();
  #enabled = true;
  #state: DesktopUpdateState;
  #downloadedPath: string | null = null;
  #expectedArtifact: ExpectedArtifact | null = null;
  #connectTimeoutMs: number;
  #idleTimeoutMs: number;

  constructor(options: UpdateManagerOptions) {
    this.#options = options;
    this.#fetch = options.fetchFn ?? fetch;
    this.#writeFile = options.writeFileFn ?? writeFile;
    this.#mkdir =
      options.mkdirFn ??
      (async (path) => {
        await mkdir(path, { recursive: true });
      });
    this.#unlink = options.unlinkFn ?? unlink;
    this.#channel = options.channel ?? defaultChannel(options.currentVersion);
    this.#packageFormat = options.preferredLinuxPackageFormat ?? null;
    this.#maxDownloadBytes = options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES;
    if (
      !Number.isSafeInteger(this.#maxDownloadBytes) ||
      this.#maxDownloadBytes < 1
    ) {
      throw new TypeError("maxDownloadBytes must be a positive safe integer");
    }
    this.#connectTimeoutMs =
      options.downloadConnectTimeoutMs ?? DOWNLOAD_CONNECT_TIMEOUT_MS;
    this.#idleTimeoutMs =
      options.downloadIdleTimeoutMs ?? DOWNLOAD_IDLE_TIMEOUT_MS;
    for (const [name, value] of [
      ["downloadConnectTimeoutMs", this.#connectTimeoutMs],
      ["downloadIdleTimeoutMs", this.#idleTimeoutMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new TypeError(`${name} must be a positive safe integer`);
      }
    }
    this.#state = emptyState(options.currentVersion);
  }

  get state(): DesktopUpdateState {
    return { ...this.#state };
  }

  /**
   * Path of the verified installer currently waiting for a restart
   * (`null` unless the state is `downloaded`). Used by the main process to
   * quit and launch the installer.
   */
  get downloadedInstallerPath(): string | null {
    return this.#state.status === "downloaded" ? this.#downloadedPath : null;
  }

  setEnabled(enabled: boolean): void {
    this.#enabled = enabled;
  }

  subscribe(listener: UpdateStateListener): () => void {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }

  async startAutomaticCheck(): Promise<DesktopUpdateState> {
    if (!this.#options.isPackaged || !this.#enabled) return this.state;
    // A verified installer is already waiting for the user to restart: keep
    // it. Periodic/startup checks must neither discard it nor re-download the
    // same release while the user decides when to install.
    if (this.#state.status === "downloaded") return this.state;
    const checked = await this.checkForUpdates();
    return checked.status === "available" ? this.downloadUpdate() : checked;
  }

  async checkForUpdates(): Promise<DesktopUpdateState> {
    if (!this.#options.isPackaged) {
      return this.setState({
        ...emptyState(this.#options.currentVersion, "unsupported"),
        errorCode: "development",
      });
    }
    if (
      this.#state.status === "checking" ||
      this.#state.status === "downloading"
    ) {
      return this.state;
    }
    const previousDownloadedPath = this.#downloadedPath;
    // A downloaded installer waiting for the restart survives a manual
    // re-check: only a strictly newer release discards it, so checking for
    // updates again never throws away the bytes already downloaded for the
    // same version.
    const waitingInstaller =
      this.#state.status === "downloaded" && previousDownloadedPath != null;
    if (waitingInstaller) {
      if (!(await this.hasNewerRemoteRelease())) return this.state;
      this.#downloadedPath = null;
      this.#expectedArtifact = null;
      await this.unlinkBestEffort(previousDownloadedPath);
    } else {
      this.#downloadedPath = null;
      this.#expectedArtifact = null;
      if (previousDownloadedPath) {
        await this.unlinkBestEffort(previousDownloadedPath);
      }
    }
    this.setState(emptyState(this.#options.currentVersion, "checking"));
    try {
      const response = await this.#fetch(GITHUB_RELEASES_URL, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        return this.setState({
          ...emptyState(this.#options.currentVersion, "unknown"),
          errorCode: response.status === 404 ? "not-found" : "network",
        });
      }
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) {
        return this.setState({
          ...emptyState(this.#options.currentVersion, "unknown"),
          errorCode: "invalid-response",
        });
      }
      const release = payload
        .filter(
          (item): item is GitHubRelease =>
            typeof item === "object" && item !== null,
        )
        .filter(
          (item) =>
            item.draft !== true &&
            versionOf(item) != null &&
            (this.#channel === "beta" || !isPrereleaseRelease(item)),
        )
        .sort((left, right) =>
          compareVersions(versionOf(right)!, versionOf(left)!),
        )[0];
      if (!release) {
        return this.setState({
          ...emptyState(this.#options.currentVersion, "unknown"),
          errorCode: "not-found",
        });
      }
      const latestVersion = versionOf(release)!;
      const assets = Array.isArray(release.assets)
        ? (release.assets as GitHubAsset[])
        : [];
      const asset = selectUpdateAsset(
        assets,
        this.#options.platform,
        this.#options.arch,
        { preferredPackageFormat: this.#packageFormat },
      );
      const isNewer =
        compareVersions(latestVersion, this.#options.currentVersion) > 0;
      const next: DesktopUpdateState = {
        status: isNewer ? (asset ? "available" : "error") : "current",
        currentVersion: this.#options.currentVersion,
        latestVersion,
        releaseDate: releaseDateOf(release),
        downloadUrl: asset?.url ?? null,
        assetName: asset?.name ?? null,
        releaseUrl:
          typeof release.html_url === "string" ? release.html_url : null,
        changelog:
          typeof release.body === "string"
            ? release.body.slice(0, 600)
            : typeof release.name === "string"
              ? release.name
              : null,
        ...(isNewer && !asset ? { errorCode: "no-asset" as const } : {}),
      };
      if (!isNewer || !asset) return this.setState(next);

      const resolved = await this.resolveExpectedArtifact(
        release,
        asset,
        assets,
      );
      if (resolved.kind === "ok") {
        this.#expectedArtifact = resolved.artifact;
        return this.setState({
          ...next,
          downloadUrl: resolved.artifact.url,
          assetName: resolved.artifact.name,
        });
      }
      this.reportIntegrityFailure(
        resolved.kind === "missing" ? "metadata-missing" : "metadata-invalid",
        latestVersion,
      );
      return this.setState({
        ...next,
        status: "error",
        // `metadata` means no document for this platform was published at all,
        // which needs a different fix from a document that failed validation.
        errorCode: resolved.kind === "missing" ? "metadata" : "download",
      });
    } catch {
      return this.setState({
        ...emptyState(this.#options.currentVersion, "unknown"),
        errorCode: "network",
      });
    }
  }

  /**
   * Resolve the verified artifact (name/url/sha256/size) for the selected
   * installer.
   *
   * The first candidates come from {@link metadataDocumentNames}. A document
   * that is not published is skipped silently; one that exists but does not
   * validate is skipped too, so a future release that merges Linux into the
   * main document keeps working for this client. Anything the documents do not
   * describe — today the `.deb`/`.rpm` a distro install updates through — is
   * then taken from GitHub's own digest for that asset. Only when no source
   * produced an artifact does the caller fail, and it distinguishes "nothing
   * was published for this platform" from "what was published did not
   * validate".
   */
  private async resolveExpectedArtifact(
    release: GitHubRelease,
    asset: SelectedAsset,
    assets: readonly GitHubAsset[],
  ): Promise<
    | { kind: "ok"; artifact: ExpectedArtifact }
    | { kind: "missing" }
    | { kind: "invalid" }
  > {
    let sawDocument = false;
    for (const name of metadataDocumentNames(this.#options.platform)) {
      const metadataAsset = assets.find((candidate) => candidate.name === name);
      // The metadata asset name is versionless like the installer names, so the
      // URL is taken from this release's own asset list (already filtered to
      // non-draft semver tags) rather than rebuilt from a version.
      if (
        !metadataAsset ||
        !trustedDownloadUrl(metadataAsset.browser_download_url)
      ) {
        continue;
      }
      sawDocument = true;
      try {
        const metadataResponse = await this.#fetch(
          metadataAsset.browser_download_url,
          {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (!metadataResponse.ok || !isTrustedResponseUrl(metadataResponse)) {
          continue;
        }
        const metadataBytes = await readResponseBytes(
          metadataResponse,
          MAX_METADATA_BYTES,
        );
        const metadata = JSON.parse(
          new TextDecoder().decode(metadataBytes),
        ) as unknown;
        const artifact = metadataArtifactOf(
          metadata,
          release,
          this.#channel,
          this.#options.platform,
          this.#options.arch,
          asset,
          this.#maxDownloadBytes,
          assets,
        );
        if (artifact) return { kind: "ok", artifact };
      } catch {
        // Try the next document; the caller reports one failure for the set.
      }
    }
    // Nothing in the documents described this installer, which is the case for
    // the `.deb`/`.rpm` a distro install updates through. GitHub's own digest
    // for the asset we selected still makes it verifiable, and it comes from the
    // same API response that chose the release.
    const fromAsset = artifactFromAsset(asset);
    if (fromAsset) return { kind: "ok", artifact: fromAsset };
    return sawDocument ? { kind: "invalid" } : { kind: "missing" };
  }

  /**
   * Whether the remote channel currently exposes a release strictly newer than
   * the one already downloaded and waiting. Any network/feed problem resolves
   * to `false` so a waiting installer is never discarded on transient errors.
   */
  private async hasNewerRemoteRelease(): Promise<boolean> {
    const downloadedVersion = this.#state.latestVersion;
    if (downloadedVersion == null) return false;
    try {
      const response = await this.#fetch(GITHUB_RELEASES_URL, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return false;
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) return false;
      const release = payload
        .filter(
          (item): item is GitHubRelease =>
            typeof item === "object" && item !== null,
        )
        .filter(
          (item) =>
            item.draft !== true &&
            versionOf(item) != null &&
            (this.#channel === "beta" || !isPrereleaseRelease(item)),
        )
        .sort((left, right) =>
          compareVersions(versionOf(right)!, versionOf(left)!),
        )[0];
      if (!release) return false;
      return compareVersions(versionOf(release)!, downloadedVersion) > 0;
    } catch {
      return false;
    }
  }

  async downloadUpdate(): Promise<DesktopUpdateState> {
    if (
      this.#state.status !== "available" ||
      !this.#state.downloadUrl ||
      !this.#expectedArtifact
    ) {
      return this.state;
    }
    const expectedArtifact = this.#expectedArtifact;
    const assetName = expectedArtifact.name;
    if (
      !isSafeAssetName(assetName) ||
      this.#state.downloadUrl !== expectedArtifact.url
    ) {
      this.reportIntegrityFailure(
        "metadata-invalid",
        this.#state.latestVersion,
      );
      return this.setState({
        ...this.#state,
        status: "error",
        errorCode: "download",
      });
    }
    this.setState({ ...this.#state, status: "downloading" });
    let path: string | null = null;
    // Reuse an installer left behind by an earlier attempt when it still
    // matches the release metadata byte for byte: restarting the app must not
    // re-download a large package that is already verified on disk.
    const reusablePath = join(
      this.#options.tempDirectory,
      `aitracker-${assetName}`,
    );
    if (
      !this.#options.writeFileFn &&
      (await this.verifyInstallerOnDisk(reusablePath, expectedArtifact))
    ) {
      this.#downloadedPath = reusablePath;
      return this.setState({
        ...this.#state,
        status: "downloaded",
        progress: {
          downloadedBytes: expectedArtifact.size,
          totalBytes: expectedArtifact.size,
        },
      });
    }
    // The transfer budget is split in two: a connect phase that must finish
    // within downloadConnectTimeoutMs, and an idle guard that aborts only
    // when no chunk arrives for downloadIdleTimeoutMs. A slow but steady
    // download is never cut off by a total wall-clock limit.
    const controller = new AbortController();
    const connectTimer = setTimeout(
      () => controller.abort(),
      this.#connectTimeoutMs,
    );
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshIdleDeadline = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), this.#idleTimeoutMs);
    };
    const clearTimers = () => {
      clearTimeout(connectTimer);
      if (idleTimer) clearTimeout(idleTimer);
    };
    // Throttled download progress broadcast (per-chunk state pushes would
    // flood the IPC channel on fast connections).
    let lastProgressEmitAt = 0;
    const reportProgress = (receivedBytes: number) => {
      refreshIdleDeadline();
      const now = Date.now();
      if (
        receivedBytes < expectedArtifact.size &&
        now - lastProgressEmitAt < DOWNLOAD_PROGRESS_INTERVAL_MS
      ) {
        return;
      }
      lastProgressEmitAt = now;
      this.setState({
        ...this.#state,
        status: "downloading",
        progress: {
          downloadedBytes: receivedBytes,
          totalBytes: expectedArtifact.size,
        },
      });
    };
    try {
      const response = await this.#fetch(expectedArtifact.url, {
        headers: { Accept: "application/octet-stream" },
        signal: controller.signal,
      });
      clearTimeout(connectTimer);
      reportProgress(0);
      if (!response.ok || !isTrustedResponseUrl(response)) {
        throw new Error("download-response");
      }
      const declaredSize = contentLengthOf(response);
      if (
        declaredSize !== null &&
        (!Number.isSafeInteger(declaredSize) ||
          declaredSize !== expectedArtifact.size)
      ) {
        throw new Error("size-mismatch");
      }
      await this.#mkdir(this.#options.tempDirectory);
      path = join(this.#options.tempDirectory, `aitracker-${assetName}`);
      if (this.#options.writeFileFn) {
        // Keep the historical test seam working. Production has no injected
        // writeFileFn and therefore always uses streamResponseToFile below.
        const data = await readResponseBytes(
          response,
          this.#maxDownloadBytes,
          reportProgress,
        );
        if (data.byteLength !== expectedArtifact.size) {
          throw new Error("size-mismatch");
        }
        if (
          createHash("sha256").update(data).digest("hex") !==
          expectedArtifact.sha256
        ) {
          throw new Error("checksum-mismatch");
        }
        await this.#writeFile(path, data);
      } else {
        // Remove a stale file left by an interrupted run; the
        // exclusive-create stream below would otherwise fail with EEXIST.
        await this.unlinkBestEffort(path);
        const result = await streamResponseToFile(
          response,
          path,
          expectedArtifact.size,
          this.#maxDownloadBytes,
          reportProgress,
        );
        if (result.sha256 !== expectedArtifact.sha256) {
          throw new Error("checksum-mismatch");
        }
      }
      clearTimers();
      this.#downloadedPath = path;
      return this.setState({
        ...this.#state,
        status: "downloaded",
        progress: {
          downloadedBytes: expectedArtifact.size,
          totalBytes: expectedArtifact.size,
        },
      });
    } catch (error) {
      clearTimers();
      if (path) {
        await this.unlinkBestEffort(path);
      }
      const reason = error instanceof Error ? error.message : "download";
      this.reportIntegrityFailure(
        reason === "checksum-mismatch" || reason === "size-mismatch"
          ? reason
          : "download-failed",
        this.#state.latestVersion,
      );
      return this.setState({
        ...this.#state,
        status: "error",
        errorCode: "download",
        progress: undefined,
      });
    }
  }

  private setState(state: DesktopUpdateState): DesktopUpdateState {
    this.#state = state;
    const snapshot = this.state;
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  private async unlinkBestEffort(path: string): Promise<void> {
    try {
      await this.#unlink(path);
    } catch {
      // Cleanup must not mask the original update failure.
    }
  }

  /**
   * Whether `path` already holds this exact verified installer (size and
   * SHA-256 from the release metadata). Streams the file so a large package
   * never has to be buffered in memory.
   */
  private async verifyInstallerOnDisk(
    path: string,
    artifact: ExpectedArtifact,
  ): Promise<boolean> {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size !== artifact.size) return false;
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) {
        hash.update(chunk as Uint8Array);
      }
      return hash.digest("hex") === artifact.sha256;
    } catch {
      return false;
    }
  }

  private reportIntegrityFailure(reason: string, version: string | null): void {
    console.warn("AITracker update integrity validation failed", {
      reason,
      version,
      channel: this.#channel,
    });
  }
}
