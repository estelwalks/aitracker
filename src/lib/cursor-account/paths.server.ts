import { stat as statFile } from "node:fs/promises";
import { join } from "node:path";

import { APP_DATA_DIR } from "../app-config.ts";
import type { PlatformOs } from "../tool-registry/registry.ts";

/**
 * Cursor has no local per-request usage log: the desktop client keeps the
 * account session in `state.vscdb` and the token-level usage only exists
 * behind Cursor's account API. The opt-in collector therefore has to write the
 * fetched export somewhere the (network-free) local scanner can read it, and
 * this module owns that shared location.
 *
 * The directory is part of the Cursor tool's declared usage paths, so the
 * offline scanner treats the synced export exactly like any other local usage
 * log. Keep the two in sync:
 * `src/lib/tool-registry/definitions/cursor.tool.json` → `capabilities.usage.paths`.
 */
export const CURSOR_ACCOUNT_CACHE_DIRECTORY = "cursor-account-usage";
export const CURSOR_ACCOUNT_CACHE_FILENAME = "usage.json";

/** `~/.aitracker/data` — the same data root that holds the AITracker database. */
export function cursorAccountCacheDir(homeDirectory: string): string {
  return join(
    homeDirectory,
    APP_DATA_DIR,
    "data",
    CURSOR_ACCOUNT_CACHE_DIRECTORY,
  );
}

export interface CursorAccountPaths {
  /** The Cursor application-data directory; its existence proves an install. */
  readonly appDir: string;
  /** Cursor's own VS Code state database, which carries the account token. */
  readonly stateDatabasePath: string;
  /** Cursor CLI login state, which carries the WorkOS subject. */
  readonly cliConfigPath: string;
  readonly cacheDirectory: string;
  readonly cachePath: string;
}

export interface CursorAccountPathInput {
  readonly homeDirectory: string;
  /**
   * Defaults to the platform this process runs on. Never fall back to a fixed
   * `"macos"` here: on Windows that resolves
   * `<home>/Library/Application Support/Cursor`, which does not exist, so every
   * caller that omits the platform reported "not installed" and never synced.
   */
  readonly platform?: PlatformOs;
  /** XDG override for Linux; ignored on macOS/Windows. */
  readonly env?: { readonly XDG_CONFIG_HOME?: string | undefined };
}

function homeJoined(homeDirectory: string, ...segments: string[]): string {
  return join(homeDirectory, ...segments);
}

/** Map Node's `process.platform` to the registry's platform-os model. */
export function cursorAccountPlatform(
  platform: NodeJS.Platform = process.platform,
): PlatformOs {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  return "linux";
}

/**
 * Resolves Cursor's per-platform locations. Windows and Linux mirror the
 * reference implementation (TokenTracker): `%APPDATA%\Cursor` and
 * `$XDG_CONFIG_HOME/Cursor` (falling back to `~/.config/Cursor`).
 */
export function resolveCursorAccountPaths(
  input: CursorAccountPathInput,
): CursorAccountPaths {
  const platform = input.platform ?? cursorAccountPlatform();
  const homeDirectory = input.homeDirectory;
  let appDir: string;
  if (platform === "macos") {
    appDir = homeJoined(
      homeDirectory,
      "Library",
      "Application Support",
      "Cursor",
    );
  } else if (platform === "windows") {
    appDir = homeJoined(homeDirectory, "AppData", "Roaming", "Cursor");
  } else {
    const xdg = input.env?.XDG_CONFIG_HOME?.trim();
    appDir =
      xdg && xdg.length > 0
        ? join(xdg, "Cursor")
        : homeJoined(homeDirectory, ".config", "Cursor");
  }
  return {
    appDir,
    stateDatabasePath: join(appDir, "User", "globalStorage", "state.vscdb"),
    cliConfigPath: homeJoined(homeDirectory, ".cursor", "cli-config.json"),
    cacheDirectory: cursorAccountCacheDir(homeDirectory),
    cachePath: join(
      cursorAccountCacheDir(homeDirectory),
      CURSOR_ACCOUNT_CACHE_FILENAME,
    ),
  };
}

/** Whether the Cursor application is installed (its data directory exists). */
export async function isCursorAccountInstalled(
  paths: Pick<CursorAccountPaths, "appDir">,
  stat: (path: string) => Promise<{ isDirectory(): boolean }> = statFile,
): Promise<boolean> {
  try {
    return (await stat(paths.appDir)).isDirectory();
  } catch {
    return false;
  }
}
