import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Whether AITracker should pin Chromium to the X11 (XWayland) backend.
 *
 * Why this exists: Electron's Linux tray creates a GtkStatusIcon, which on X11
 * means an XEmbed window registered against the `_NET_SYSTEM_TRAY_S<n>` selection
 * owner. Under a Wayland session Electron does not create that window at all — it
 * calls `RegisterStatusNotifierItem` but never claims the bus name it advertises
 * and never exports the StatusNotifierItem object, confirmed by introspecting the
 * very connection that made the call. GNOME's appindicator extension therefore has
 * nothing to render and the tray does not exist.
 *
 * Measured on GNOME 50 / Kali with this app, via scripts/linux-tray-probe.sh:
 *   - XWayland: the 16x16 tray window appears within 2s, mapped, sitting in the
 *     panel strip, and the icon is visible and clickable. XWayland provides the
 *     XEmbed tray selection owner, so the GtkStatusIcon has somewhere to dock.
 *   - Native Wayland: no tray window is ever created (40s of polling).
 *
 * Running through XWayland is therefore what makes the tray work. It is a
 * downgrade rather than a free win, so the condition stays narrow:
 *   - only when the tray will actually be created, since it is the whole reason;
 *   - only on Linux in a Wayland session (an X11 session is already X11, and
 *     macOS/Windows never see this);
 *   - only when XWayland is plausibly present, because forcing X11 without it
 *     leaves the app unable to open a window at all;
 *   - and it can be turned off with AITRACKER_NATIVE_WAYLAND=1 for anyone who
 *     prefers native Wayland and does not need the tray.
 */

export const NATIVE_WAYLAND_ENV = "AITRACKER_NATIVE_WAYLAND";
/** Prefix for every environment variable this app reads. */
export const ENV_PREFIX = "AITRACKER_";
/** Marks a process that is already the X11 relaunch, so it never relaunches again. */
export const X11_RELAUNCH_ENV = "AITRACKER_X11_RELAUNCH";
export const OZONE_PLATFORM_ARG = "--ozone-platform=x11";
export const OZONE_PLATFORM_SWITCH = "ozone-platform";
export const OZONE_PLATFORM_X11 = "x11";
/** Directory every X server, XWayland included, publishes its socket in. */
const X11_SOCKET_DIRECTORY = "/tmp/.X11-unix";

export interface LinuxDisplayBackendInput {
  /** `process.platform`. */
  readonly platform: NodeJS.Platform;
  /** Environment to read; `process.env` in the main process. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Whether a tray icon will be created at all. */
  readonly trayEnabled: boolean;
  /**
   * Whether XWayland looks available. Defaults to socket discovery; a test
   * supplies its own answer.
   */
  readonly xwaylandAvailable: () => boolean;
}

/**
 * True when the app should pin itself to the X11 backend.
 *
 * Returning false means "leave Chromium's own choice alone" rather than "force
 * Wayland": with no switch, Chromium still auto-selects Wayland when the session
 * offers it.
 */
export function shouldPreferX11Backend(
  input: LinuxDisplayBackendInput,
): boolean {
  if (input.platform !== "linux") return false;
  if (!input.trayEnabled) return false;
  if (isTruthy(input.env[NATIVE_WAYLAND_ENV])) return false;
  // A Wayland session is the precondition, read from what the session actually
  // exported. `XDG_SESSION_TYPE` is the documented value; `WAYLAND_DISPLAY`
  // covers sessions that set only that.
  const waylandSession =
    input.env.XDG_SESSION_TYPE?.trim().toLowerCase() === "wayland" ||
    (input.env.WAYLAND_DISPLAY?.trim().length ?? 0) > 0;
  if (!waylandSession) return false;
  return input.xwaylandAvailable();
}

/**
 * Whether an X server (XWayland counts) is reachable.
 *
 * A `DISPLAY` alone is not enough — it can point at a server that has gone away,
 * and a stale value is exactly the case where forcing X11 would leave the app
 * with no window at all. The socket has to exist too; `Xwayland` on the usual
 * paths is the weaker second signal, used only when no socket is visible.
 */
export function xwaylandLooksAvailable(
  env: Readonly<Record<string, string | undefined>> = process.env,
  fileExists: (path: string) => boolean = existsSync,
): boolean {
  const display = env.DISPLAY?.trim();
  if (display && /^:\d+/u.test(display)) {
    const screen = display.slice(1).split(".")[0];
    if (fileExists(join(X11_SOCKET_DIRECTORY, `X${screen}`))) return true;
  }
  return ["/usr/bin/Xwayland", "/usr/libexec/Xwayland"].some((path) =>
    fileExists(path),
  );
}

/**
 * The command line an X11 relaunch should use, or null when no relaunch is
 * needed.
 *
 * `app.commandLine.appendSwitch` cannot express this: Chromium resolves its
 * Ozone platform during early startup, so a switch appended from JavaScript is
 * too late — measured on GNOME 50, the identical build created the tray window
 * when `--ozone-platform=x11` was on the real command line and never created it
 * when the switch was appended from the main process. Relaunching puts the
 * argument where it has to be, and keeps every packaging format working without
 * touching the generated .desktop file, which electron-builder refuses to let us
 * override (its Exec key must follow `linux.executableName`).
 */
/**
 * The single assignment that carries inherited variables across the relaunch.
 *
 * Shaped as `NAME=base64` rather than as a flag with separate arguments, because
 * `app.relaunch()` consumes an unrecognised flag *and the arguments after it*:
 * measured on Electron 43, a plan of `["--ozone-platform=x11", "--aitracker-env",
 * "AITRACKER_X=1", ...]` arrived in the child as `["--ozone-platform=x11"]`. An
 * assignment is not a flag, so it survives.
 */
export const RELAUNCH_ENV_ASSIGNMENT = "AITRACKER_RELAUNCH_ENV";

/**
 * The argument list for the X11 relaunch, or null when no relaunch is needed.
 *
 * `app.relaunch()` does not carry the environment across — measured on Electron
 * 43, a variable set on the first launch is absent in the replacement, which
 * silently disabled the tray menu probe and would do the same to any future
 * `AITRACKER_*` setting. And `app.commandLine.appendSwitch` cannot express the
 * Ozone choice either: Chromium resolves its platform before app code runs, so a
 * switch appended from JavaScript is too late. Passing everything as arguments is
 * the one channel that works, so the whole plan is built here, as a pure function,
 * where it can be tested without launching anything.
 *
 * Explicit `KEY=value` entries follow RELAUNCH_ENV_FLAG; the caller quotes them for
 * the shell.
 */
export function planX11Relaunch(
  input: LinuxDisplayBackendInput & {
    readonly argv: readonly string[];
    /** Variables to carry across, normally read from the parent process. */
    readonly inheritedEnvironment?: Readonly<Record<string, string>>;
  },
): readonly string[] | null {
  // A process that already went through this must not do it again, or the two
  // instances would relaunch each other forever.
  if (isTruthy(input.env[X11_RELAUNCH_ENV])) return null;
  if (input.argv.some((arg) => arg.startsWith("--ozone-platform"))) return null;
  if (!shouldPreferX11Backend(input)) return null;
  const carried = { ...input.inheritedEnvironment, [X11_RELAUNCH_ENV]: "1" };
  // base64 so no shell quoting is involved on the way through, and so a value with
  // spaces cannot split into extra arguments.
  const payload = Buffer.from(JSON.stringify(carried), "utf8").toString(
    "base64",
  );
  return [
    OZONE_PLATFORM_ARG,
    `${RELAUNCH_ENV_ASSIGNMENT}=${payload}`,
    ...input.argv.slice(1),
  ];
}

/** True when the argument list was produced by `planX11Relaunch`. */
export function carriesRelaunchEnvironment(argv: readonly string[]): boolean {
  return argv.some((arg) => arg.startsWith(`${RELAUNCH_ENV_ASSIGNMENT}=`));
}

/**
 * Read the carried variables out of a relaunch argument list and remove the entry.
 *
 * Fails closed: a payload that does not decode to a flat string map yields `{}`,
 * so a malformed argument can never inject arbitrary variables.
 */
export function consumeRelaunchEnvironment(
  argv: string[],
): Record<string, string> {
  const prefix = `${RELAUNCH_ENV_ASSIGNMENT}=`;
  const index = argv.findIndex((arg) => arg.startsWith(prefix));
  if (index === -1) return {};
  const payload = argv[index].slice(prefix.length);
  argv.splice(index, 1);
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64").toString("utf8"),
    );
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!key.startsWith(ENV_PREFIX) || typeof value !== "string") continue;
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function isTruthy(value: string | undefined): boolean {
  const normalised = value?.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes";
}

/**
 * The `AITRACKER_*` variables this process should carry across the relaunch.
 *
 * Needed because `app.relaunch()` does not carry the environment across: measured
 * on Electron 43, a variable set on the first launch is absent in the replacement,
 * so anything read from the environment (including the tray menu probe hook)
 * silently stops working as soon as the X11 relaunch happens.
 *
 * `process.env` is the primary source — it is this app's own environment and is
 * what most callers mean — and `/proc/<ppid>/environ` is merged underneath for the
 * case where the app was started with a scrubbed environment. A plain
 * `process.env` read is not enough on its own in the other direction either:
 * Chromium rewrites its children's environment, so the parent is consulted only as
 * a fallback, never as the authority.
 *
 * Best effort by design: any failure leaves the relaunch behaving as it does today.
 */
export function inheritedAppEnvironment(
  options: {
    readonly readFile?: (path: string) => Buffer;
    readonly parentPid?: number;
    /** This process's environment; `process.env` in the caller. */
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {},
): Record<string, string> {
  const readFile =
    options.readFile ??
    ((path: string) => readFileSync(path) as unknown as Buffer);
  const parentPid = options.parentPid ?? process.ppid;
  const own = options.env ?? process.env;

  const fromParent: Record<string, string> = {};
  try {
    const block = readFile(`/proc/${parentPid}/environ`);
    for (const entry of block.toString("utf8").split("\0")) {
      if (!entry.startsWith(ENV_PREFIX)) continue;
      const separator = entry.indexOf("=");
      if (separator <= 0) continue;
      fromParent[entry.slice(0, separator)] = entry.slice(separator + 1);
    }
  } catch {
    // No readable parent: this process's own environment is still authoritative.
  }

  const result: Record<string, string> = { ...fromParent };
  for (const [key, value] of Object.entries(own)) {
    if (!key.startsWith(ENV_PREFIX) || value === undefined) continue;
    result[key] = value;
  }
  return result;
}
