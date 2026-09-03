import { mkdir, writeFile } from "node:fs/promises";
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
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
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
  assets?: unknown;
}

interface SelectedAsset {
  name: string;
  url: string;
}

export interface UpdateManagerOptions {
  readonly currentVersion: string;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly tempDirectory: string;
  readonly fetchFn?: typeof fetch;
  readonly writeFileFn?: (path: string, data: Uint8Array) => Promise<void>;
  readonly mkdirFn?: (path: string) => Promise<void>;
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

function versionOf(release: GitHubRelease): string | null {
  return typeof release.tag_name === "string" && release.tag_name.trim()
    ? release.tag_name.trim().replace(/^v/i, "")
    : null;
}

function releaseDateOf(release: GitHubRelease): string | null {
  if (typeof release.published_at !== "string") return null;
  return Number.isFinite(Date.parse(release.published_at))
    ? release.published_at
    : null;
}

function trustedDownloadUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(GITHUB_DOWNLOAD_PREFIX);
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
  readonly #listeners = new Set<UpdateStateListener>();
  #enabled = true;
  #state: DesktopUpdateState;
  #downloadedPath: string | null = null;

  constructor(options: UpdateManagerOptions) {
    this.#options = options;
    this.#fetch = options.fetchFn ?? fetch;
    this.#writeFile = options.writeFileFn ?? writeFile;
    this.#mkdir =
      options.mkdirFn ??
      (async (path) => {
        await mkdir(path, { recursive: true });
      });
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
    this.#downloadedPath = null;
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
        .filter((item) => item.draft !== true && versionOf(item) != null)
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
      return this.setState(next);
    } catch {
      return this.setState({
        ...emptyState(this.#options.currentVersion, "unknown"),
        errorCode: "network",
      });
    }
  }

  async downloadUpdate(): Promise<DesktopUpdateState> {
    if (this.#state.status !== "available" || !this.#state.downloadUrl) {
      return this.state;
    }
    const assetName = this.#state.assetName;
    if (!assetName || assetName.includes("/") || assetName.includes("\\")) {
      return this.setState({
        ...this.#state,
        status: "error",
        errorCode: "download",
      });
    }
    this.setState({ ...this.#state, status: "downloading" });
    try {
      const response = await this.#fetch(this.#state.downloadUrl, {
        headers: { Accept: "application/octet-stream" },
        signal: AbortSignal.timeout(120_000),
      });
      const declaredSize = Number(response.headers.get("content-length"));
      if (
        !response.ok ||
        (Number.isFinite(declaredSize) && declaredSize > MAX_DOWNLOAD_BYTES)
      ) {
        throw new Error("Update download rejected");
      }
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.byteLength > MAX_DOWNLOAD_BYTES)
        throw new Error("Update too large");
      await this.#mkdir(this.#options.tempDirectory);
      const path = join(this.#options.tempDirectory, `aitracker-${assetName}`);
      await this.#writeFile(path, data);
      this.#downloadedPath = path;
      return this.setState({ ...this.#state, status: "downloaded" });
    } catch {
      return this.setState({
        ...this.#state,
        status: "error",
        errorCode: "download",
      });
    }
  }

  async installUpdate(): Promise<{ opened: boolean }> {
    if (!this.#downloadedPath || !this.#options.openInstaller) {
      return { opened: false };
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
}
