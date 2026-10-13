import { existsSync } from "node:fs";
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
export function x11RelaunchArgs(
  input: LinuxDisplayBackendInput & { readonly argv: readonly string[] },
): readonly string[] | null {
  // A process that already went through this once must not do it again, or the
  // two instances would relaunch each other forever.
  if (isTruthy(input.env[X11_RELAUNCH_ENV])) return null;
  if (input.argv.some((arg) => arg.startsWith("--ozone-platform"))) return null;
  if (!shouldPreferX11Backend(input)) return null;
  return [OZONE_PLATFORM_ARG];
}

function isTruthy(value: string | undefined): boolean {
  const normalised = value?.trim().toLowerCase();
  return normalised === "1" || normalised === "true" || normalised === "yes";
}
