import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { join } from "node:path";

import type {
  DesktopUpdateState,
  DesktopUpdateLifecycle,
} from "./contracts.js";
import { APP_REPO_URL } from "./app-config.js";

const githubRepository = new URL(APP_REPO_URL);
const githubPath = githubRepository.pathname.replace(/\/$/u, "");
const GITHUB_RELEASES_URL = `https://api.github.com/repos${githubPath}/releases?per_page=100`;
const GITHUB_DOWNLOAD_PREFIX = `${APP_REPO_URL}/releases/download/`;
const RELEASE_REPOSITORY = "estelwalks/aitracker";
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const RELEASE_METADATA_NAME = "release-metadata.json";
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
  readonly fetchFn?: typeof fetch;
  readonly writeFileFn?: (path: string, data: Uint8Array) => Promise<void>;
  readonly mkdirFn?: (path: string) => Promise<void>;
  readonly unlinkFn?: (path: string) => Promise<void>;
  readonly openInstaller?: (path: string) => Promise<string>;
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
  if (typeof value !== "string" || !value.startsWith(GITHUB_DOWNLOAD_PREFIX)) {
    return false;
  }
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
      /^\/estelwalks\/aitracker\/releases\/download\/[^/?#]+\/[^/?#]+$/u.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

function canonicalDownloadUrl(version: string, name: string): string {
  return `${GITHUB_DOWNLOAD_PREFIX}v${version}/${name}`;
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
): Promise<StreamDownloadResult> {
  if (!response.body) throw new Error("download-body");

  const output = createWriteStream(path, { flags: "wx" });
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
  const requiredKeys = ["darwin-arm64", "darwin-x64", "win32-x64"];
  if (
    Object.keys(artifactMap).some((key) => !requiredKeys.includes(key)) ||
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
      artifact.url !==
        canonicalDownloadUrl(metadata.appVersion as string, artifact.name) ||
      !trustedDownloadUrl(artifact.url) ||
      typeof artifact.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      typeof artifact.size !== "number" ||
      !Number.isSafeInteger(artifact.size) ||
      artifact.size < 1 ||
      artifact.size > maxDownloadBytes
    )
      return null;
    if (
      !assets.some(
        (asset) =>
          asset.name === artifact.name &&
          asset.browser_download_url === artifact.url,
      )
    )
      return null;
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

  const releaseAsset = assets.find(
    (asset) =>
      asset.name === artifact.name &&
      asset.browser_download_url === artifact.url,
  );
  if (
    !releaseAsset ||
    artifact.name !== selectedAsset.name ||
    artifact.url !== selectedAsset.url
  ) {
    return null;
  }
  return {
    name: artifact.name,
    url: artifact.url,
    sha256: artifact.sha256.toLowerCase(),
    size: artifact.size,
  };
}

function extensionsFor(platform: NodeJS.Platform): readonly string[] {
  if (platform === "darwin") return [".dmg", ".zip"];
  if (platform === "win32") return [".exe", ".msi", ".zip"];
  if (platform === "linux") return [".appimage", ".deb", ".rpm", ".tar.gz"];
  return [];
}

/** Selects only a trusted, user-installable asset for this platform/arch. */
export function selectUpdateAsset(
  assets: readonly GitHubAsset[],
  platform: NodeJS.Platform,
  arch: string,
): SelectedAsset | null {
  const extensions = extensionsFor(platform);
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
    return [{ name: asset.name, url: asset.browser_download_url, lowerName }];
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
  return selected ? { name: selected.name, url: selected.url } : null;
}

export class UpdateManager {
  readonly #options: UpdateManagerOptions;
  readonly #fetch: typeof fetch;
  readonly #writeFile: (path: string, data: Uint8Array) => Promise<void>;
  readonly #mkdir: (path: string) => Promise<void>;
  readonly #unlink: (path: string) => Promise<void>;
  readonly #channel: UpdateChannel;
  readonly #maxDownloadBytes: number;
  readonly #listeners = new Set<UpdateStateListener>();
  #enabled = true;
  #state: DesktopUpdateState;
  #downloadedPath: string | null = null;
  #expectedArtifact: ExpectedArtifact | null = null;

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
    this.#maxDownloadBytes = options.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES;
    if (
      !Number.isSafeInteger(this.#maxDownloadBytes) ||
      this.#maxDownloadBytes < 1
    ) {
      throw new TypeError("maxDownloadBytes must be a positive safe integer");
    }
    this.#state = emptyState(options.currentVersion);
  }

  get state(): DesktopUpdateState {
    return { ...this.#state };
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
    this.#downloadedPath = null;
    this.#expectedArtifact = null;
    this.setState(emptyState(this.#options.currentVersion, "checking"));
    if (previousDownloadedPath) {
      await this.unlinkBestEffort(previousDownloadedPath);
    }
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

      const metadataAsset = assets.find(
        (candidate) => candidate.name === RELEASE_METADATA_NAME,
      );
      if (
        !metadataAsset ||
        typeof metadataAsset.browser_download_url !== "string" ||
        metadataAsset.browser_download_url !==
          canonicalDownloadUrl(latestVersion, RELEASE_METADATA_NAME)
      ) {
        this.reportIntegrityFailure("metadata-missing", latestVersion);
        return this.setState({
          ...next,
          status: "error",
          errorCode: "download",
        });
      }

      try {
        const metadataResponse = await this.#fetch(
          metadataAsset.browser_download_url,
          {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (!metadataResponse.ok || !isTrustedResponseUrl(metadataResponse)) {
          throw new Error("metadata-response");
        }
        const metadataBytes = await readResponseBytes(
          metadataResponse,
          MAX_METADATA_BYTES,
        );
        const metadata = JSON.parse(
          new TextDecoder().decode(metadataBytes),
        ) as unknown;
        const expectedArtifact = metadataArtifactOf(
          metadata,
          release,
          this.#channel,
          this.#options.platform,
          this.#options.arch,
          asset,
          this.#maxDownloadBytes,
          assets,
        );
        if (!expectedArtifact) throw new Error("metadata-invalid");
        this.#expectedArtifact = expectedArtifact;
        return this.setState({
          ...next,
          downloadUrl: expectedArtifact.url,
          assetName: expectedArtifact.name,
        });
      } catch {
        this.reportIntegrityFailure("metadata-invalid", latestVersion);
        return this.setState({
          ...next,
          status: "error",
          errorCode: "download",
        });
      }
    } catch {
      return this.setState({
        ...emptyState(this.#options.currentVersion, "unknown"),
        errorCode: "network",
      });
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
    try {
      const response = await this.#fetch(expectedArtifact.url, {
        headers: { Accept: "application/octet-stream" },
        signal: AbortSignal.timeout(120_000),
      });
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
        const data = await readResponseBytes(response, this.#maxDownloadBytes);
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
        const result = await streamResponseToFile(
          response,
          path,
          expectedArtifact.size,
          this.#maxDownloadBytes,
        );
        if (result.sha256 !== expectedArtifact.sha256) {
          throw new Error("checksum-mismatch");
        }
      }
      this.#downloadedPath = path;
      return this.setState({ ...this.#state, status: "downloaded" });
    } catch (error) {
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
      });
    }
  }

  async installUpdate(): Promise<{ opened: boolean }> {
    if (
      this.#state.status !== "downloaded" ||
      !this.#downloadedPath ||
      !this.#expectedArtifact ||
      !this.#options.openInstaller
    ) {
      return { opened: false };
    }
    if (this.#channel === "beta") {
      console.info(
        "AITracker beta update may trigger macOS Gatekeeper or Windows SmartScreen",
      );
    }
    try {
      const error = await this.#options.openInstaller(this.#downloadedPath);
      if (error) throw new Error(error);
      return { opened: true };
    } catch {
      this.setState({ ...this.#state, status: "error", errorCode: "install" });
      return { opened: false };
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

  private reportIntegrityFailure(reason: string, version: string | null): void {
    console.warn("AITracker update integrity validation failed", {
      reason,
      version,
      channel: this.#channel,
    });
  }
}
