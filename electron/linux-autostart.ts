import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, posix, win32 } from "node:path";

/**
 * XDG autostart (freedesktop.org Desktop Application Autostart Specification)
 * for Linux.
 *
 * Electron's `app.getLoginItemSettings()` / `setLoginItemSettings()` are
 * macOS/Windows only, so the same user-facing "launch at login" switch needs a
 * `.desktop` entry under `$XDG_CONFIG_HOME/autostart` (falling back to
 * `~/.config/autostart`) on Linux. Nothing here is ever allowed to throw at the
 * call site: an unwritable config directory must degrade to "not supported"
 * rather than take down the main process.
 */

export const LINUX_AUTOSTART_FILENAME = "aitracker.desktop";

/** Mirrors `APP_NAME` in `app-config.ts`, kept local to avoid a cycle. */
const DESKTOP_ENTRY_NAME = "AITracker";

/**
 * `$XDG_CONFIG_HOME` when it is an absolute path, otherwise `~/.config`.
 *
 * A relative `XDG_CONFIG_HOME` is invalid per the XDG Base Directory
 * Specification and is ignored (the specification requires the fallback then).
 */
export function resolveXdgConfigHome(
  env: Record<string, string | undefined>,
  homeDirectory: string,
): string {
  const configured = env.XDG_CONFIG_HOME?.trim();
  if (configured && isAbsolute(configured)) return configured;
  return join(homeDirectory, ".config");
}

/** Absolute path of the autostart entry this app owns. */
export function linuxAutostartEntryPath(
  env: Record<string, string | undefined>,
  homeDirectory: string,
): string {
  return join(
    resolveXdgConfigHome(env, homeDirectory),
    "autostart",
    LINUX_AUTOSTART_FILENAME,
  );
}

function quoteExecArgument(value: string): string {
  // Paths containing a double quote cannot be represented faithfully in a
  // Desktop Entry value (the syntax has no escape for the quote character
  // itself), so refuse instead of writing an entry that cannot start the app.
  if (value.includes('"')) {
    throw new Error("Autostart path contains an unsupported quote character");
  }
  return `"${value}"`;
}

/** `Exec=` value for `program` plus already-ordered extra arguments. */
export function desktopEntryExec(
  program: string,
  args: readonly string[] = [],
): string {
  return [program, ...args].map(quoteExecArgument).join(" ");
}

/**
 * The autostart entry itself.
 *
 * `--hidden` is deliberately absent: the app has no such flag, and a login
 * launch may show its window. `X-GNOME-Autostart-enabled` is the key GNOME
 * reads to honour a disabled entry that is still on disk.
 */
export function linuxAutostartEntryContent(input: {
  readonly exec: string;
  readonly name?: string;
}): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${input.name ?? DESKTOP_ENTRY_NAME}`,
    `Exec=${input.exec}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/**
 * Normalise an absolute POSIX path so the generated `Exec` line contains the
 * separators the launcher will parse. Windows-shaped paths are left untouched:
 * this module only runs on Linux, and mangling something unexpected is worse
 * than writing it verbatim.
 */
function normaliseExecPath(value: string): string {
  if (win32.isAbsolute(value)) return value;
  return isAbsolute(value) ? posix.normalize(value) : value;
}

export interface LinuxAutostartOptions {
  readonly env: Record<string, string | undefined>;
  readonly homeDirectory: string;
  /** `process.execPath` in the main process. */
  readonly execPath: string;
  /**
   * Extra arguments that relaunch the app shell in a development run, mirroring
   * `setLoginItemSettings({ args })`.
   */
  readonly devArguments?: readonly string[];
}

/**
 * What an autostart entry should launch.
 *
 * `process.execPath` is wrong for an AppImage. The type-2 runtime sets
 * `$APPIMAGE` to the real file and runs the payload from a temporary mount
 * (`/tmp/.mount_XXXX/…`), so an entry written from `execPath` would point into
 * a directory that no longer exists at the next login — autostart would fail
 * silently. `$APPIMAGE` is the documented, stable answer, and is preferred
 * whenever it names a real path.
 */
export function resolveAutostartExecPath(
  options: Pick<LinuxAutostartOptions, "env" | "execPath">,
  pathIsAbsolute: (value: string) => boolean = isAbsolute,
): string {
  const appImage = options.env.APPIMAGE?.trim();
  if (appImage && pathIsAbsolute(appImage)) return appImage;
  return options.execPath;
}

/**
 * Injectable seams for tests. Options parameters are typed structurally so a
 * stub can ignore the flags it does not assert on.
 */
export interface LinuxAutostartDependencies {
  readonly fileExists?: (path: string) => boolean;
  readonly writeFile?: (path: string, data: string) => Promise<void>;
  readonly makeDirectory?: (
    path: string,
    options?: { readonly recursive?: boolean },
  ) => Promise<unknown>;
  readonly removeFile?: (
    path: string,
    options?: { readonly force?: boolean },
  ) => Promise<void>;
}

/**
 * Whether the autostart directory accepts a new entry.
 *
 * Probed once per config root by creating and removing a marker file, so the
 * tray and Settings can report `supported: false` (and hide the switch) instead
 * of offering a toggle that silently does nothing. The marker is never the real
 * entry, so probing cannot enable autostart as a side effect.
 */
export async function probeLinuxAutostartSupported(
  options: LinuxAutostartOptions,
  dependencies: LinuxAutostartDependencies = {},
): Promise<boolean> {
  const directory = dirname(
    linuxAutostartEntryPath(options.env, options.homeDirectory),
  );
  const marker = join(directory, ".aitracker-autostart-probe");
  const write = dependencies.writeFile ?? writeFile;
  const makeDirectory = dependencies.makeDirectory ?? mkdir;
  const remove = dependencies.removeFile ?? rm;
  try {
    await makeDirectory(directory, { recursive: true });
    await write(marker, "");
    return true;
  } catch {
    return false;
  } finally {
    await remove(marker, { force: true }).catch(() => undefined);
  }
}

/** Whether the entry exists and is not disabled by an explicit `false` key. */
export function readLinuxAutostartEnabled(
  options: LinuxAutostartOptions,
  dependencies: Pick<LinuxAutostartDependencies, "fileExists"> & {
    readonly readFileSync?: (path: string) => string;
  } = {},
): boolean {
  const fileExists = dependencies.fileExists ?? existsSync;
  const path = linuxAutostartEntryPath(options.env, options.homeDirectory);
  if (!fileExists(path)) return false;
  const readFileSync = dependencies.readFileSync;
  if (!readFileSync) return true;
  try {
    return !/^\s*X-GNOME-Autostart-enabled\s*=\s*false\s*$/imu.test(
      readFileSync(path),
    );
  } catch {
    return false;
  }
}

/**
 * Create or remove the autostart entry.
 *
 * Returns whether the desired state was applied. Callers report
 * `supported: false` when this returns `false`, so the UI hides the switch
 * instead of offering a toggle that silently does nothing.
 */
export async function writeLinuxAutostartEnabled(
  enabled: boolean,
  options: LinuxAutostartOptions,
  dependencies: LinuxAutostartDependencies = {},
): Promise<boolean> {
  const path = linuxAutostartEntryPath(options.env, options.homeDirectory);
  const write = dependencies.writeFile ?? writeFile;
  const makeDirectory = dependencies.makeDirectory ?? mkdir;
  const remove = dependencies.removeFile ?? rm;
  try {
    if (!enabled) {
      await remove(path, { force: true });
      return true;
    }
    await makeDirectory(dirname(path), { recursive: true });
    await write(
      path,
      linuxAutostartEntryContent({
        exec: desktopEntryExec(
          normaliseExecPath(resolveAutostartExecPath(options)),
          options.devArguments ?? [],
        ),
      }),
    );
    return true;
  } catch {
    return false;
  }
}
