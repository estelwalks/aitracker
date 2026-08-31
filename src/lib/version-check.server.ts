import { createServerFn } from "@tanstack/react-start";

import { APP_ID, APP_REPO_URL, APP_VERSION, ENV } from "./app-config";

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
  /** ISO timestamp the check ran. */
  checkedAt: string;
}

/** Default GitHub repo to poll for releases. Override via env if forked. */
const releasePath = new URL(APP_REPO_URL).pathname
  .split("/")
  .filter((part) => part.length > 0);
const RELEASE_OWNER =
  process.env[ENV.RELEASE_OWNER] ?? releasePath[0] ?? APP_ID;
const RELEASE_REPO = process.env[ENV.RELEASE_REPO] ?? releasePath[1] ?? APP_ID;
const CHECK_TIMEOUT_MS = 5_000;

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
): VersionCheckResult {
  return {
    status: "unknown",
    currentVersion,
    latestVersion: null,
    changelog: null,
    releaseUrl: null,
    checkedAt,
  };
}

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
}

async function fetchLatestRelease(
  currentVersion: string,
  checkedAt: string,
): Promise<VersionCheckResult> {
  const url = `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!response.ok) return unknown(currentVersion, checkedAt);
    const release = (await response.json()) as GitHubRelease;
    const tag = typeof release.tag_name === "string" ? release.tag_name : null;
    if (tag == null) return unknown(currentVersion, checkedAt);
    const latestVersion = tag.replace(/^v/i, "");
    const changelog =
      typeof release.body === "string"
        ? release.body.slice(0, 600)
        : typeof release.name === "string"
          ? release.name
          : null;
    const releaseUrl =
      typeof release.html_url === "string" ? release.html_url : null;
    return {
      status:
        compareVersions(latestVersion, currentVersion) > 0
          ? "newer"
          : "current",
      currentVersion,
      latestVersion,
      changelog,
      releaseUrl,
      checkedAt,
    };
  } catch {
    return unknown(currentVersion, checkedAt);
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
