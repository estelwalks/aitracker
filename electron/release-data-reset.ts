import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
} from "node:path";

const DATA_DIRECTORY_NAME = ".trusttools";
const MARKER_PREFIX = ".trusttools-release-data-reset-";
const MARKER_SUFFIX = ".complete";

/**
 * Bump this code only for a release that intentionally discards the local
 * product database. Keeping it separate from the app version prevents an
 * ordinary upgrade from ever becoming destructive.
 */
export const RELEASE_DATA_RESET_CODE = "initial-schema-v1";

export interface ReleaseDataResetOptions {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  appVersion: string;
  homeDirectory: string;
  userDataDirectory: string;
}

export interface ReleaseDataReset {
  status: "pending" | "already-completed" | "not-applicable";
  /**
   * Persist completion only after every workspace initialization gate has
   * succeeded. Until then, the next launch deliberately retries the reset.
   */
  markInitializationComplete(): Promise<void>;
}

/**
 * Bind reset completion to the workspace warmup boundary. A page or native UI
 * failure after this function returns must not make the destructive reset run
 * again, while a warmup failure must leave it retryable.
 */
export async function completeReleaseDataResetAfterWarmup(
  reset: ReleaseDataReset,
  warmup: () => Promise<void>,
): Promise<void> {
  await warmup();
  await reset.markInitializationComplete();
}

function isPathInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}

function requireTrustedDirectory(value: string, label: string): string {
  if (!value || value.includes("\0") || !isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path`);
  }

  const normalized = normalize(value);
  if (normalized === parse(normalized).root) {
    throw new TypeError(`${label} must not be a filesystem root`);
  }
  return normalized;
}

function validateAppVersion(appVersion: string): void {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(appVersion)) {
    throw new TypeError("App version is not safe for a reset marker");
  }
}

function resolveResetPaths(options: ReleaseDataResetOptions): {
  markerPath: string;
  resetTarget: string;
  userDataDirectory: string;
} {
  const homeDirectory = requireTrustedDirectory(
    options.homeDirectory,
    "Home directory",
  );
  const userDataDirectory = requireTrustedDirectory(
    options.userDataDirectory,
    "User data directory",
  );
  validateAppVersion(options.appVersion);
  const resetTarget = resolve(homeDirectory, DATA_DIRECTORY_NAME);

  // The deletion target is derived here and nowhere else. These checks guard
  // future refactors from broadening it to the home directory or another path.
  if (
    basename(resetTarget) !== DATA_DIRECTORY_NAME ||
    dirname(resetTarget) !== homeDirectory
  ) {
    throw new TypeError("Refusing unsafe AITracker data reset target");
  }
  if (isPathInside(resetTarget, userDataDirectory)) {
    throw new TypeError("Reset marker must live outside the reset target");
  }

  return {
    resetTarget,
    userDataDirectory,
    markerPath: join(
      userDataDirectory,
      // The reset code, rather than every future app version, identifies the
      // destructive event. The executing version is recorded in its content.
      `${MARKER_PREFIX}${RELEASE_DATA_RESET_CODE}${MARKER_SUFFIX}`,
    ),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function removeResetTarget(resetTarget: string): Promise<void> {
  let stats;
  try {
    stats = await lstat(resetTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  // Never hand a symlink to recursive removal. Unlinking it explicitly makes
  // it impossible to descend into a directory outside ~/.trusttools.
  if (stats.isSymbolicLink()) {
    await unlink(resetTarget);
    return;
  }
  await rm(resetTarget, { recursive: true, force: true });
}

async function writeMarkerAtomically(
  markerPath: string,
  appVersion: string,
): Promise<void> {
  await mkdir(dirname(markerPath), { recursive: true });
  const temporaryPath = `${markerPath}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(
      `${JSON.stringify({
        appVersion,
        resetCode: RELEASE_DATA_RESET_CODE,
        completedAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, markerPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Prepare the one-time packaged macOS data reset. This function removes the
 * old product data but intentionally does not mark success; the caller owns
 * the later initialization gate and must explicitly persist completion.
 */
export async function prepareReleaseDataReset(
  options: ReleaseDataResetOptions,
): Promise<ReleaseDataReset> {
  if (options.platform !== "darwin" || !options.isPackaged) {
    return {
      status: "not-applicable",
      markInitializationComplete: async () => undefined,
    };
  }

  const { markerPath, resetTarget } = resolveResetPaths(options);
  if (await pathExists(markerPath)) {
    return {
      status: "already-completed",
      markInitializationComplete: async () => undefined,
    };
  }

  await removeResetTarget(resetTarget);
  let completed = false;
  return {
    status: "pending",
    async markInitializationComplete() {
      if (completed) return;
      await writeMarkerAtomically(markerPath, options.appVersion);
      completed = true;
    },
  };
}

/** Test-only-friendly reader that does not expose or accept a deletion path. */
export async function readReleaseDataResetMarker(
  options: ReleaseDataResetOptions,
): Promise<string | null> {
  if (options.platform !== "darwin" || !options.isPackaged) return null;
  const { markerPath } = resolveResetPaths(options);
  try {
    return await readFile(markerPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
