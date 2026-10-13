import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Decide whether the Chromium sandbox can be used on this Linux host.
 *
 * Why this exists: with the sandbox unusable, Electron does not print a warning
 * and keep going — the browser process aborts before any window exists, so the
 * user sees nothing at all and `app.requestSingleInstanceLock()` has already
 * been taken. There is no dialog to show at that point, which is why the
 * decision has to be made before the lock and reported on stderr.
 *
 * Chromium accepts three ways to satisfy the sandbox on Linux:
 *   1. a SUID `chrome-sandbox` helper, `root:root`, mode 4755;
 *   2. unprivileged user namespaces (`kernel.unprivileged_userns_clone`, or on
 *      Ubuntu 24.04+ an AppArmor profile that allows them);
 *   3. no sandbox at all (`--no-sandbox`).
 *
 * This function answers only the narrow, decidable question: is the SUID helper
 * definitively unusable AND are user namespaces definitively unavailable? It
 * deliberately does not guess. A filename is not enough to call the helper bad
 * — inside an AppImage the mount is read-only and the bits are unreadable in a
 * meaningful way — and Ubuntu's AppArmor restriction is a kernel/securityfs
 * question, not a `sysctl` string. When either check is inconclusive the answer
 * is `true` (keep the sandbox): Chromium's own failure path is then the same as
 * it has always been, whereas disabling the sandbox on a working host would
 * silently remove a security boundary for every user.
 */
export interface LinuxSandboxProbe {
  /** `process.platform`; only `linux` is probed. */
  readonly platform: NodeJS.Platform;
  /** Directory holding the Electron executable and its `chrome-sandbox`. */
  readonly executableDirectory: string;
  /** `app.isPackaged`. */
  readonly isPackaged: boolean;
  /** Reads a SUID helper's metadata; injectable for tests. */
  readonly statHelper?: (path: string) => {
    uid: number;
    gid: number;
    mode: number;
  };
  /** Reads a kernel knob; `null` means "not present / not readable". */
  readonly readUsernsClone?: (path: string) => string | null;
}

/** True when `path` is a readable file at all. */
function isReadableFile(path: string): boolean {
  try {
    accessSync(path, constants.R_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * `null` (rather than `false`) whenever the answer cannot be determined, so the
 * caller keeps the sandbox instead of disabling it on a guess.
 */
function suidHelperUsable(
  helperPath: string,
  statHelper: NonNullable<LinuxSandboxProbe["statHelper"]>,
): boolean | null {
  try {
    const info = statHelper(helperPath);
    // 0o4755: setuid, owner rwx, group/other r-x.
    const isSuid = (info.mode & 0o4000) !== 0;
    const isRootOwned = info.uid === 0 && info.gid === 0;
    return isSuid && isRootOwned;
  } catch {
    return null;
  }
}

/** `null` when the knob is absent, which is not evidence of anything. */
function usernsAllowed(
  readKnob: (path: string) => string | null,
): boolean | null {
  const value = readKnob("/proc/sys/kernel/unprivileged_userns_clone");
  if (value === null) return null;
  return value.trim() !== "0";
}

export function canUseLinuxChromiumSandbox(probe: LinuxSandboxProbe): boolean {
  if (probe.platform !== "linux") return true;

  const statHelper =
    probe.statHelper ??
    ((path: string) => {
      const info = statSync(path);
      return { uid: info.uid, gid: info.gid, mode: info.mode };
    });
  const readUsernsClone =
    probe.readUsernsClone ??
    ((path: string) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    });

  const helperPath = join(probe.executableDirectory, "chrome-sandbox");
  if (!isReadableFile(helperPath)) {
    // No helper beside the executable. That is normal for an AppImage, where
    // SUID bits cannot survive the squashfs mount, so fall through to the
    // user-namespace question rather than treating it as fatal.
    const userns = usernsAllowed(readUsernsClone);
    return userns === null ? true : userns;
  }

  const helper = suidHelperUsable(helperPath, statHelper);
  // A readable-but-not-SUID helper is the one case Chromium refuses outright
  // ("The SUID sandbox helper binary was found, but is not configured
  // correctly"). Fall back to user namespaces exactly as above.
  if (helper === null || helper) return true;
  const userns = usernsAllowed(readUsernsClone);
  return userns === null ? true : userns;
}

/** The switch Chromium needs when the sandbox is unusable. */
export const NO_SANDBOX_SWITCH = "no-sandbox";

/**
 * True when the user explicitly forced the sandbox off, so the caller can
 * report it rather than silently treating it as our decision.
 */
export function sandboxDisabledByEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.ELECTRON_DISABLE_SANDBOX === "1";
}

/** Directory that holds the Electron executable on this platform. */
export function executableDirectoryOf(execPath: string): string {
  return dirname(execPath);
}
