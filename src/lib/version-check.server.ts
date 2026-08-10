import { createServerFn } from "@tanstack/react-start";

import { APP_ID, APP_VERSION, ENV } from "./app-config";

/**
 * FR-033 — silent new-version check on startup.
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
const RELEASE_OWNER = process.env[ENV.RELEASE_OWNER] ?? APP_ID;
const RELEASE_REPO = process.env[ENV.RELEASE_REPO] ?? APP_ID;
const CHECK_TIMEOUT_MS = 5_000;

/**
 * Loose semver compare (major.minor.patch, ignoring pre-release/build tags).
 * Returns >0 if a is newer, <0 if b is newer, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string): [number, number, number] => {
    const match = value.trim().replace(/^v/i, "").split("-")[0]!.split(".");
    const major = Number.parseInt(match[0] ?? "0", 10);
    const minor = Number.parseInt(match[1] ?? "0", 10);
    const patch = Number.parseInt(match[2] ?? "0", 10);
    return [
      Number.isFinite(major) ? major : 0,
      Number.isFinite(minor) ? minor : 0,
      Number.isFinite(patch) ? patch : 0,
    ];
  };
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
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
