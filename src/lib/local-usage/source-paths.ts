import {
  resolvePlatformPaths,
  type PlatformEnv,
  type PlatformOs,
} from "../tool-registry/registry.ts";

/**
 * Browser-safe source directory projection.
 *
 * The registry owns the actual platform bases. This module only converts the
 * resolved HOME-relative or HOME-contained paths into the `~/...` form that
 * the Sources page is allowed to expose. It intentionally falls back to
 * detection locations for tools that do not have a parser yet: knowing where
 * an agent stores data is independent from being able to parse its records.
 */
export function sourcePathsForPlatform(
  toolId: string,
  os: PlatformOs,
  homeDir: string,
  env: PlatformEnv = {},
): string[] {
  const usage = resolvePlatformPaths(toolId, "usage", os, env);
  const detection = resolvePlatformPaths(toolId, "detection", os, env);
  const preferred =
    usage?.status === "supported" && usage.paths.length > 0
      ? usage.paths
      : (detection?.paths ?? []);

  const values = preferred
    .map((entry) => displayPath(entry.path, entry.homeRelative, homeDir, os))
    .filter((entry): entry is string => entry !== null);
  return [...new Set(values)];
}

function displayPath(
  value: string,
  homeRelative: boolean,
  homeDir: string,
  os: PlatformOs,
): string | null {
  if (homeRelative) {
    const relative = value.replace(/^[\\/]+/, "").replaceAll("\\", "/");
    return relative ? `~/${relative}` : "~";
  }

  const normalizedValue = normalizeAbsolute(value, os);
  const normalizedHome = normalizeAbsolute(homeDir, os).replace(/\/$/, "");
  const comparisonValue =
    os === "windows" ? normalizedValue.toLowerCase() : normalizedValue;
  const comparisonHome =
    os === "windows" ? normalizedHome.toLowerCase() : normalizedHome;
  if (comparisonValue === comparisonHome) return "~";
  if (comparisonValue.startsWith(`${comparisonHome}/`)) {
    return `~/${normalizedValue.slice(normalizedHome.length + 1)}`;
  }
  // Never expose an absolute XDG/env override outside the user's home.
  return null;
}

function normalizeAbsolute(value: string, os: PlatformOs): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+/g, "/");
  if (os === "windows") return normalized.replace(/\/$/, "");
  return normalized.replace(/\/$/, "");
}
