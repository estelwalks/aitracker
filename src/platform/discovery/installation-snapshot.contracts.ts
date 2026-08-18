/**
 * P3-T3-03: Installation snapshot data contract.
 *
 * Unified tool-installation and path-availability facts shared by Usage,
 * Skill and Sources consumers. Only `installed` booleans plus `~/`-relative
 * display paths are persisted — absolute probe paths never enter the snapshot.
 */

export interface InstallationFactData {
  readonly id: string;
  readonly installed: boolean;
  /** HOME-relative display paths (e.g. ".claude"); never absolute. */
  readonly paths: readonly string[];
  /** True when at least one executable probe matched. */
  readonly executableFound: boolean;
}

export interface InstallationSnapshotData {
  readonly generatedAt: string;
  readonly facts: readonly InstallationFactData[];
}

/** Turns absolute probe paths into `~/`-relative display paths. */
export function displayPaths(
  detectedPaths: readonly string[],
  homeDirectory: string,
): string[] {
  const result: string[] = [];
  for (const path of detectedPaths) {
    if (path.startsWith(homeDirectory + "/")) {
      result.push(`~/${path.slice(homeDirectory.length + 1)}`);
    } else if (path.startsWith(homeDirectory + "\\")) {
      result.push(
        `~/${path.slice(homeDirectory.length + 1).replaceAll("\\", "/")}`,
      );
    } else if (path.startsWith("~")) {
      result.push(path);
    }
    // Absolute paths outside HOME are omitted (never leak to the browser).
  }
  return result;
}
