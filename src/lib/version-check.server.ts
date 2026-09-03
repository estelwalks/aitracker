import { createServerFn } from "@tanstack/react-start";

import { APP_REPO_URL, APP_VERSION } from "./app-config";
import { fetchExternal } from "./http/external-request.server.ts";

/**
 * FR-033 — best-effort new-version check requested by the Settings UI.
 *
 * Compares the running app version against the latest GitHub release. The
 * check is best-effort: any network failure or >5s timeout is swallowed and
 * reported as "unknown" so the UI never blocks on it. Nothing is uploaded;
 * this only reads a public releases JSON endpoint.
 */

export interface VersionCheckResult {
  /** "newer" if a higher version is published; "current" if up to date; "unknown" on any failure. */
  status: "newer" | "current" | "unknown";
  currentVersion: string;
  latestVersion: string | null;
  /** Short changelog/release notes excerpt, when available. */
  changelog: string | null;
  /** HTML URL of the latest release page, when available. */
  releaseUrl: string | null;
  /** Direct asset URL selected for the current platform and architecture. */
  downloadUrl: string | null;
  /** Selected release asset filename, when available. */
  assetName: string | null;
  /** Stable error category for non-blocking diagnostics. */
  errorCode?: "not-found" | "network" | "invalid-response" | "no-asset";
  /** ISO timestamp the check ran. */
  checkedAt: string;
}

/** Default GitHub repo to poll for releases. Override via env if forked. */
const releasePath = new URL(APP_REPO_URL).pathname
  .split("/")
  .filter((part) => part.length > 0);
const RELEASE_OWNER = releasePath[0] ?? "estelwalks";
const RELEASE_REPO = releasePath[1] ?? "aitracker";
const CHECK_TIMEOUT_MS = 5_000;

export interface GitHubReleaseAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

export interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  draft?: unknown;
  assets?: unknown;
}

export interface SelectedReleaseAsset {
  name: string;
  url: string;
}

const ARCH_ALIASES: Record<string, readonly string[]> = {
  arm64: ["arm64", "aarch64"],
  x64: ["x64", "amd64", "x86_64"],
  ia32: ["ia32", "x86", "win32"],
};

function platformExtensions(platform: NodeJS.Platform): readonly string[] {
  if (platform === "darwin") return [".dmg", ".zip"];
  if (platform === "win32") return [".exe", ".msi", ".zip"];
  if (platform === "linux") return [".appimage", ".deb", ".rpm", ".tar.gz"];
  return [];
}

function isTrustedReleaseAssetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith(
        `/${RELEASE_OWNER}/${RELEASE_REPO}/releases/download/`,
      )
    );
  } catch {
    return false;
  }
}

/** Select a user-installable GitHub asset, excluding updater metadata files. */
export function selectReleaseAsset(
  assets: readonly GitHubReleaseAsset[],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): SelectedReleaseAsset | null {
  const extensions = platformExtensions(platform);
  const archNames = ARCH_ALIASES[arch] ?? [arch];
  const candidates = assets.flatMap((asset) => {
    if (
      typeof asset.name !== "string" ||
      typeof asset.browser_download_url !== "string"
    ) {
      return [];
    }
    if (!isTrustedReleaseAssetUrl(asset.browser_download_url)) return [];
    const name = asset.name;
    const lowerName = name.toLowerCase();
    if (!extensions.some((extension) => lowerName.endsWith(extension)))
      return [];
    return [{ name, url: asset.browser_download_url, lowerName }];
  });
  if (candidates.length === 0) return null;

  const exactArch = candidates.filter((candidate) =>
    archNames.some((name) => candidate.lowerName.includes(name)),
  );
  const pool = exactArch.length > 0 ? exactArch : candidates;
  const extensionRank = (name: string) => {
    const index = extensions.findIndex((extension) => name.endsWith(extension));
    return index < 0 ? extensions.length : index;
  };
  pool.sort(
    (left, right) =>
      extensionRank(left.lowerName) - extensionRank(right.lowerName) ||
      left.name.localeCompare(right.name),
  );
  const selected = pool[0];
  return selected ? { name: selected.name, url: selected.url } : null;
}

function validTag(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function releaseVersion(release: GitHubRelease): string | null {
  return validTag(release.tag_name)
    ? release.tag_name.trim().replace(/^v/i, "")
    : null;
}

function releaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com"
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Pick the highest non-draft tag from GitHub's releases response. */
export function selectLatestGitHubRelease(
  releases: readonly GitHubRelease[],
): GitHubRelease | null {
  return (
    releases
      .filter(
        (release) => release.draft !== true && releaseVersion(release) != null,
      )
      .slice()
      .sort((left, right) =>
        compareVersions(releaseVersion(right)!, releaseVersion(left)!),
      )[0] ?? null
  );
}

/**
 * Semver compare for the release tags used by the update checker. Build
 * metadata is ignored, while prereleases correctly sort before their stable
 * counterpart (`1.0.0-beta.1` < `1.0.0`). Returns >0 if a is newer, <0 if b
 * is newer, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (
    value: string,
  ): {
    core: [number, number, number];
    prerelease: readonly (number | string)[] | null;
  } => {
    const normalized = value.trim().replace(/^v/i, "").split("+")[0] ?? "";
    const [coreText, prereleaseText] = normalized.split("-", 2);
    const match = coreText!.split(".");
    const major = Number.parseInt(match[0] ?? "0", 10);
    const minor = Number.parseInt(match[1] ?? "0", 10);
    const patch = Number.parseInt(match[2] ?? "0", 10);
    const prerelease =
      prereleaseText == null || prereleaseText === ""
        ? null
        : prereleaseText.split(".").map((part) => {
            const number = Number(part);
            return /^\d+$/u.test(part) && Number.isSafeInteger(number)
              ? number
              : part;
          });
    return {
      core: [
        Number.isFinite(major) ? major : 0,
        Number.isFinite(minor) ? minor : 0,
        Number.isFinite(patch) ? patch : 0,
      ],
      prerelease,
    };
  };
  const parsedA = parse(a);
  const parsedB = parse(b);
  for (let index = 0; index < parsedA.core.length; index += 1) {
    const difference = parsedA.core[index]! - parsedB.core[index]!;
    if (difference !== 0) return difference;
  }
  if (parsedA.prerelease === null && parsedB.prerelease === null) return 0;
  if (parsedA.prerelease === null) return 1;
  if (parsedB.prerelease === null) return -1;
  for (
    let index = 0;
    index < Math.max(parsedA.prerelease.length, parsedB.prerelease.length);
    index += 1
  ) {
    const left = parsedA.prerelease[index];
    const right = parsedB.prerelease[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    if (typeof left === "number") return -1;
    if (typeof right === "number") return 1;
    return left.localeCompare(right);
  }
  return 0;
}

function unknown(
  currentVersion: string,
  checkedAt: string,
  errorCode?: VersionCheckResult["errorCode"],
): VersionCheckResult {
  return {
    status: "unknown",
    currentVersion,
    latestVersion: null,
    changelog: null,
    releaseUrl: null,
    downloadUrl: null,
    assetName: null,
    ...(errorCode ? { errorCode } : {}),
    checkedAt,
  };
}

function resultFromRelease(
  release: GitHubRelease,
  currentVersion: string,
  checkedAt: string,
): VersionCheckResult {
  const latestVersion = releaseVersion(release);
  if (!latestVersion)
    return unknown(currentVersion, checkedAt, "invalid-response");
  const releaseAssets = Array.isArray(release.assets)
    ? (release.assets as GitHubReleaseAsset[])
    : [];
  const asset = selectReleaseAsset(releaseAssets);
  const changelog =
    typeof release.body === "string"
      ? release.body.slice(0, 600)
      : typeof release.name === "string"
        ? release.name
        : null;
  return {
    status:
      compareVersions(latestVersion, currentVersion) > 0 ? "newer" : "current",
    currentVersion,
    latestVersion,
    changelog,
    releaseUrl: releaseUrl(release.html_url),
    downloadUrl: asset?.url ?? null,
    assetName: asset?.name ?? null,
    ...(compareVersions(latestVersion, currentVersion) > 0 && !asset
      ? { errorCode: "no-asset" as const }
      : {}),
    checkedAt,
  };
}

async function fetchLatestRelease(
  currentVersion: string,
  checkedAt: string,
): Promise<VersionCheckResult> {
  const url = `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases?per_page=100`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetchExternal(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return unknown(
        currentVersion,
        checkedAt,
        response.status === 404 ? "not-found" : "network",
      );
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      return unknown(currentVersion, checkedAt, "invalid-response");
    }
    const release = selectLatestGitHubRelease(payload as GitHubRelease[]);
    return release
      ? resultFromRelease(release, currentVersion, checkedAt)
      : unknown(currentVersion, checkedAt, "not-found");
  } catch {
    return unknown(currentVersion, checkedAt, "network");
  } finally {
    clearTimeout(timeout);
  }
}

function readCurrentVersion(): string {
  return APP_VERSION;
}

export const checkForUpdates = createServerFn({ method: "GET" }).handler(
  async (): Promise<VersionCheckResult> => {
    const currentVersion = readCurrentVersion();
    const checkedAt = new Date().toISOString();
    return fetchLatestRelease(currentVersion, checkedAt);
  },
);
