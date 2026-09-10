import { spawn, type SpawnOptions } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";

export interface InstallerHandoffResult {
  readonly launched: boolean;
  readonly reason?: string;
  /** How the hand-off was armed; useful in diagnostics. */
  readonly method?:
    | "windows-hidden"
    | "windows-command"
    | "darwin-auto-install"
    | "darwin-open"
    | "spawn";
}

/**
 * Minimal shape of a detached child: the app process may quit right after
 * launching, so the child must survive the parent (detached) and must not keep
 * any stdio pipe open that could block or leak.
 */
export interface DetachedProcess {
  unref(): void;
  on(event: "error", listener: (error: Error) => void): this;
}

export type DetachedSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => DetachedProcess;

const nodeSpawn: DetachedSpawn = (command, args, options) =>
  spawn(command, [...args], options);

/** Name of the packaged executable, used to relaunch the updated app. */
const WINDOWS_APP_EXECUTABLE = "AITracker.exe";
/** Generated hand-off script name inside the temp directory. */
export const WINDOWS_HANDOFF_COMMAND_NAME = "aitracker-update-handoff.cmd";

/**
 * Build the Windows hand-off script that is executed by ShellExecute
 * (`shell.openPath`, i.e. the same path as double-clicking it):
 *
 * 1. `start "" /wait <installer> /S --updated --force-run` — `start` goes
 *    through ShellExecute, which is the only way to trigger the UAC elevation
 *    the per-machine installer needs and to wait for it to finish. `--updated`
 *    lets the installer close the running app itself; `--force-run` makes it
 *    relaunch the app once the silent install completed;
 * 2. if no app instance is running afterwards, start one — the safety net for
 *    an installer that finished without relaunching.
 *
 * The script itself runs with a hidden console window; everything is appended
 * to `%TEMP%\aitracker-update-launch.log` so a failed hand-off can still be
 * diagnosed afterwards.
 *
 * This deliberately avoids spawning PowerShell: in the packaged app that
 * helper never started, while `cmd.exe` (absolute path, no manual quoting) plus
 * ShellExecute as a fallback are the same mechanisms the user's own
 * double-click relies on.
 */
export function buildWindowsHandoffCommand(options: {
  readonly installerPath: string;
  readonly appExecutablePath: string;
  readonly processId: number;
}): string {
  const { installerPath, appExecutablePath, processId } = options;
  const appDirectory = appExecutablePath.replace(/[\\/][^\\/]*$/u, "");
  const installedExecutable = appDirectory
    ? `${appDirectory}\\${WINDOWS_APP_EXECUTABLE}`
    : WINDOWS_APP_EXECUTABLE;
  return [
    "@echo off",
    "setlocal",
    'set "LOG=%TEMP%\\aitracker-update-launch.log"',
    "title AITracker update",
    `echo [%DATE% %TIME%] handoff started (pid=${processId})>>"%LOG%"`,
    `start "" /wait "${installerPath}" /S --updated --force-run`,
    `echo [%DATE% %TIME%] installer finished (exit=%ERRORLEVEL%)>>"%LOG%"`,
    // Safety net for an installer that finished without relaunching the app.
    // It uses hidden PowerShell on purpose: console programs such as
    // `ping`/`tasklist`/`find` would each allocate a visible console window,
    // because this script itself runs without one.
    `"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; if (-not (Get-Process -Name 'AITracker' -ErrorAction SilentlyContinue)) { Start-Process -FilePath '${installedExecutable}' }"`,
    `echo [%DATE% %TIME%] relaunch check done>>"%LOG%"`,
    "exit /b 0",
  ].join("\r\n");
}

/** Default window for observing an async spawn failure before falling back. */
const SPAWN_PROBE_TIMEOUT_MS = 700;

/** Generated macOS hand-off script name inside the temp directory. */
export const MACOS_HANDOFF_COMMAND_NAME = "aitracker-update-handoff.sh";

/**
 * The `.app` bundle that contains `executablePath`
 * (`/Applications/AITracker.app/Contents/MacOS/AITracker` →
 * `/Applications/AITracker.app`). Returns `null` when the path is not inside a
 * bundle, which the caller treats as "cannot install in place".
 */
export function appBundleFromExecutable(executablePath: string): string | null {
  const match = /^(.*\.app)\/Contents\/MacOS\/[^/]+$/u.exec(executablePath);
  return match?.[1] ?? null;
}

/**
 * Single-quote a path for the generated shell script. A path containing `'`
 * cannot be represented safely, so it throws and the caller falls back to
 * opening the image instead of running a mangled script.
 */
function shellQuote(value: string): string {
  if (value.includes("'")) {
    throw new Error(`cannot quote for the shell: ${value}`);
  }
  return `'${value}'`;
}

/** `1.0.1-beta.2` → `1.0.1`; `null` when there is no leading numeric version. */
function numericVersion(version: string): string | null {
  const core = version.trim().replace(/^v/iu, "").split(/[-+]/u)[0];
  return core && /^\d+(?:\.\d+)*$/u.test(core) ? core : null;
}

/**
 * Build the macOS hand-off script that installs the downloaded image without
 * asking the user to drag the app to `/Applications`.
 *
 * macOS has no equivalent of the Windows elevated installer the app can just
 * launch, so the installer is a detached script that outlives the app:
 *
 * 1. mount the DMG read-only without browsing (`hdiutil attach -nobrowse`)
 *    and poll for the mounted volume (`AITracker`, then `AITracker 1`/`2` when
 *    a copy is already mounted);
 * 2. wait for this app to exit, because macOS refuses to replace a running
 *    bundle ("the executable is in use");
 * 3. verify the mounted bundle is structurally valid, its executable is
 *    runnable, and its version is not older than the running one;
 * 4. stage the new bundle next to the target and only then move the old one
 *    aside, so a half-copied bundle can never replace a working install, and
 *    restore the old one when the swap itself fails;
 * 5. relaunch the app and watch for the new process. When it never appears
 *    (normally the Gatekeeper prompt still waiting for the user) the new
 *    version stays installed and the previous bundle is kept beside it for a
 *    manual recovery, because silently reverting an installed update would be
 *    worse than asking once.
 *
 * Every failure path falls back to opening the mounted image, which is exactly
 * the manual flow this replaces, and every step appends to
 * `$TMPDIR/aitracker-update-launch.log` so a failed update stays diagnosable
 * after the app is gone.
 *
 * The new bundle keeps its download quarantine flag: the first launch still
 * goes through the Gatekeeper confirmation prompt. The script never removes
 * `com.apple.quarantine` and never touches system-wide security settings.
 */
export function buildMacHandoffCommand(options: {
  readonly installerPath: string;
  readonly appBundlePath: string;
  readonly processId: number;
  /** Version of the running app; used to refuse a downgrade. */
  readonly currentVersion?: string;
}): string {
  const { installerPath, appBundlePath, processId } = options;
  const currentNumeric = options.currentVersion
    ? numericVersion(options.currentVersion)
    : null;
  const appName = appBundlePath.split("/").pop() ?? "AITracker.app";
  const appParent = appBundlePath.replace(/\/[^/]+$/u, "");
  const executableName = appName.replace(/\.app$/u, "");
  return (
    `#!/bin/bash
# Generated by AITracker. Installs the verified update image without the manual
# drag-and-drop step, then reopens the app.
set -u

LOG="\${TMPDIR:-/tmp}/aitracker-update-launch.log"
DMG="$X_INSTALLER_PATH"
APP="$X_APP_BUNDLE"
APP_NAME="$X_APP_NAME"
EXECUTABLE_NAME="$X_EXECUTABLE_NAME"
PID="$X_PROCESS_ID"
TARGET_NUMERIC="$X_TARGET_NUMERIC"

log() { printf '[%s] %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG" 2>/dev/null || true; }

# Numeric part of a version (1.0.1-beta.2 -> 1.0.1), or nothing.
version_numeric() {
  printf '%s' "$1" | sed 's/^[vV]//' | sed 's/[-+].*$//'
}

# Compare two dotted numeric versions; prints -1, 0 or 1.
compare_versions() {
  local left="$1" right="$2"
  local la lb i
  IFS='.' read -r -a la <<<"$left"
  IFS='.' read -r -a lb <<<"$right"
  for ((i = 0; i < 4; i++)); do
    local a="\${la[i]:-0}" b="\${lb[i]:-0}"
    case "$a$b" in *[!0-9]*) printf '0'; return ;; esac
    if ((10#$a > 10#$b)); then printf '1'; return; fi
    if ((10#$a < 10#$b)); then printf '%s' '-1'; return; fi
  done
  printf '0'
}

open_image() {
  log "falling back to the manual install flow"
  /usr/bin/open "$DMG" >>"$LOG" 2>&1 || true
}

# --- 1. mount -------------------------------------------------------------
log "handoff started (pid=$PID, dmg=$DMG)"
MOUNT=""
ATTACH_PLIST="$(/usr/bin/hdiutil attach -nobrowse -noverify -noautoopen -plist "$DMG" 2>>"$LOG")" || true
# The plist holds one entity per attached device and only the volume carries a
# mount-point, so take the last one. plutil cannot walk that array,
# and reading the XML keeps this independent of the system locale.
MOUNT="$(printf '%s' "$ATTACH_PLIST" | /usr/bin/awk '
  /[<]key[>]mount-point[<][/]key[>]/ { grab = 1; next }
  grab {
    line = $0
    sub(/^[ \t]*[<]string[>]/, "", line)
    sub(/[<][/]string[>][ \t]*$/, "", line)
    if (line != "") value = line
    grab = 0
  }
  END { if (value != "") print value }
' 2>/dev/null || true)"
# The volume is mounted by name, so poll for it: the image may still be
# attaching, and an already mounted copy lands on "AITracker 1"/"AITracker 2".
if [ -z "$MOUNT" ] || [ ! -d "$MOUNT/$APP_NAME" ]; then
  MOUNT=""
  for _ in $(/usr/bin/seq 1 40); do
    for CANDIDATE in "/Volumes/AITracker" "/Volumes/AITracker 1" "/Volumes/AITracker 2"; do
      if [ -d "$CANDIDATE/$APP_NAME" ]; then MOUNT="$CANDIDATE"; break; fi
    done
    [ -n "$MOUNT" ] && break
    /bin/sleep 1
  done
fi
if [ -z "$MOUNT" ] || [ ! -d "$MOUNT/$APP_NAME" ]; then
  log "no usable bundle at $MOUNT/$APP_NAME"
  open_image
  exit 0
fi
log "mounted at $MOUNT"

# --- 2. wait for this app to exit ----------------------------------------
for _ in $(/usr/bin/seq 1 60); do
  /bin/kill -0 "$PID" 2>/dev/null || break
  /bin/sleep 1
done
if /bin/kill -0 "$PID" 2>/dev/null; then
  log "the running app did not exit; falling back"
  open_image
  exit 0
fi

# --- 3. validate the incoming bundle -------------------------------------
SOURCE="$MOUNT/$APP_NAME"
if [ ! -f "$SOURCE/Contents/Info.plist" ] || [ ! -x "$SOURCE/Contents/MacOS/$EXECUTABLE_NAME" ]; then
  log "incoming bundle is incomplete"
  open_image
  exit 0
fi
SOURCE_VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$SOURCE/Contents/Info.plist" 2>/dev/null | tr -d '\\r')"
SOURCE_NUMERIC="$(version_numeric "$SOURCE_VERSION")"
if [ -n "$SOURCE_NUMERIC" ] && [ -n "$TARGET_NUMERIC" ]; then
  if [ "$(compare_versions "$SOURCE_NUMERIC" "$TARGET_NUMERIC")" = "-1" ]; then
    log "incoming version $SOURCE_VERSION is older than $TARGET_NUMERIC"
    open_image
    exit 0
  fi
fi
log "incoming bundle version=$SOURCE_VERSION"

# --- 4. swap, keeping a rollback -----------------------------------------
STAGED="$X_APP_PARENT/.$APP_NAME.update"
BACKUP="$X_APP_PARENT/.$APP_NAME.backup"
/bin/rm -rf "$STAGED" "$BACKUP" >>"$LOG" 2>&1 || true
if ! /usr/bin/ditto "$SOURCE" "$STAGED" >>"$LOG" 2>&1; then
  log "staging copy failed; falling back"
  /bin/rm -rf "$STAGED" >>"$LOG" 2>&1 || true
  open_image
  exit 0
fi
if [ ! -x "$STAGED/Contents/MacOS/$EXECUTABLE_NAME" ] || [ ! -f "$STAGED/Contents/Info.plist" ]; then
  log "staged copy is incomplete; falling back"
  /bin/rm -rf "$STAGED" >>"$LOG" 2>&1 || true
  open_image
  exit 0
fi
if ! /bin/mv "$APP" "$BACKUP" >>"$LOG" 2>&1; then
  # Target not writable (for example an app owned by another account).
  log "cannot move the running app aside; falling back"
  /bin/rm -rf "$STAGED" >>"$LOG" 2>&1 || true
  open_image
  exit 0
fi
if ! /bin/mv "$STAGED" "$APP" >>"$LOG" 2>&1; then
  log "installing the staged bundle failed; rolling back"
  /bin/mv "$BACKUP" "$APP" >>"$LOG" 2>&1 || true
  /bin/rm -rf "$STAGED" >>"$LOG" 2>&1 || true
  open_image
  exit 0
fi
log "installed $SOURCE_VERSION to $APP"

# --- 5. relaunch, with a rollback window ---------------------------------
launch() {
  /usr/bin/open -a "$APP" >>"$LOG" 2>&1 || /usr/bin/open "$APP" >>"$LOG" 2>&1 || true
}
launch
STARTED=0
for _ in $(/usr/bin/seq 1 20); do
  if /usr/bin/pgrep -f "$APP/Contents/MacOS/$EXECUTABLE_NAME" >/dev/null 2>&1; then
    STARTED=1
    break
  fi
  /bin/sleep 1
done
if [ "$STARTED" = "1" ]; then
  log "relaunched"
  /bin/rm -rf "$BACKUP" >>"$LOG" 2>&1 || true
  /bin/rm -f "$DMG" >>"$LOG" 2>&1 || true
  /usr/bin/hdiutil detach "$MOUNT" >>"$LOG" 2>&1 || true
  log "update finished"
  exit 0
fi

# The app installed but did not come up. That is normally the Gatekeeper
# prompt still waiting for the user, so the new version stays in place and the
# backup is kept for a manual recovery instead of silently reverting.
log "the updated app did not start; keeping the new version and the backup at $BACKUP"
launch
/usr/bin/hdiutil detach "$MOUNT" >>"$LOG" 2>&1 || true
exit 0
`
      // Each placeholder sits in its own `NAME="..."` line, so the value is
      // inserted unquoted-but-escaped rather than double-quoted.
      .replaceAll("$X_INSTALLER_PATH", shellQuote(installerPath).slice(1, -1))
      .replaceAll("$X_APP_BUNDLE", shellQuote(appBundlePath).slice(1, -1))
      .replaceAll("$X_APP_NAME", shellQuote(appName).slice(1, -1))
      .replaceAll("$X_EXECUTABLE_NAME", shellQuote(executableName).slice(1, -1))
      .replaceAll("$X_APP_PARENT", shellQuote(appParent).slice(1, -1))
      .replaceAll("$X_PROCESS_ID", String(processId))
      .replaceAll(
        "$X_TARGET_NUMERIC",
        shellQuote(currentNumeric ?? "").slice(1, -1),
      )
  );
}

/**
 * Run the generated hand-off script with a hidden console window (absolute
 * `cmd.exe` + `windowsHide`) and report whether it started. Resolves `false`
 * on a synchronous throw or an asynchronous spawn error so the caller can fall
 * back to ShellExecute.
 */
async function runHandoffScriptHidden(
  commandPath: string,
  spawnFn: DetachedSpawn,
  probeTimeoutMs: number,
): Promise<boolean> {
  const command = process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe";
  let child: DetachedProcess;
  try {
    child = spawnFn(command, ["/d", "/s", "/c", commandPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
  } catch {
    return false;
  }
  child.unref();
  if (probeTimeoutMs <= 0) return true;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(true);
    }, probeTimeoutMs);
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Hand the downloaded installer over to the platform so the update can
 * complete:
 * - Windows: write {@link buildWindowsHandoffCommand} to the temp directory and
 *   run it with a hidden console window (falling back to `openPathFn` →
 *   Electron `shell.openPath`/ShellExecute when spawning fails). The app keeps
 *   running: the elevated installer closes it as part of `--updated` and
 *   relaunches the new build.
 * - macOS: write {@link buildMacHandoffCommand} to the temp directory and run
 *   it detached, so the script mounts the image, waits for this app to exit,
 *   swaps the bundle and relaunches it. The caller must quit as soon as this
 *   returns. When the app does not live in a writable `.app` bundle the image
 *   is opened instead and the user finishes the install manually.
 * - Other platforms: run/open the artifact as best effort.
 *
 * Never throws: every failure is reported as `{ launched: false, reason }`.
 */
export async function handOffInstaller(options: {
  readonly platform: NodeJS.Platform;
  readonly installerPath: string;
  readonly appExecutablePath?: string;
  readonly appBundlePath?: string;
  readonly processId?: number;
  /** Version of the running app; macOS refuses to install an older build. */
  readonly currentVersion?: string;
  /** Directory for the generated Windows command script (defaults to tmp). */
  readonly tempDirectory?: string;
  /** Electron `shell.openPath` equivalent; `""` means success. */
  readonly openPathFn?: (path: string) => Promise<string>;
  readonly writeFileFn?: (
    path: string,
    data: string,
    options?: { mode?: number },
  ) => Promise<void>;
  readonly spawnFn?: DetachedSpawn;
  /** How long to wait for an async spawn error before trusting the spawn. */
  readonly spawnProbeTimeoutMs?: number;
}): Promise<InstallerHandoffResult> {
  const {
    platform,
    installerPath,
    appExecutablePath = process.execPath,
    processId = process.pid,
  } = options;
  if (platform === "win32") {
    const openPath = options.openPathFn;
    if (!openPath) return { launched: false, reason: "openPath unavailable" };
    // This path is handed to cmd.exe, so it must always use Windows
    // separators. The plain `join` follows the host platform and would emit
    // `C:\Temp/aitracker-update-handoff.cmd` when the process does not itself
    // run on Windows.
    const commandPath = win32.join(
      options.tempDirectory ?? tmpdir(),
      WINDOWS_HANDOFF_COMMAND_NAME,
    );
    try {
      await (options.writeFileFn ?? writeFile)(
        commandPath,
        buildWindowsHandoffCommand({
          installerPath,
          appExecutablePath,
          processId,
        }),
      );
    } catch (error) {
      return {
        launched: false,
        reason: `handoff script write failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
    // Preferred: hidden console, no window flashes on screen.
    const hidden = await runHandoffScriptHidden(
      commandPath,
      options.spawnFn ?? nodeSpawn,
      options.spawnProbeTimeoutMs ?? SPAWN_PROBE_TIMEOUT_MS,
    );
    if (hidden) return { launched: true, method: "windows-hidden" };
    // Fallback: ShellExecute the script (a console window is visible, but the
    // update still completes).
    try {
      const failure = await openPath(commandPath);
      if (failure) return { launched: false, reason: failure };
      return { launched: true, method: "windows-command" };
    } catch (error) {
      return {
        launched: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const spawnFn = options.spawnFn ?? nodeSpawn;
  if (platform === "darwin") {
    const appBundlePath =
      options.appBundlePath ?? appBundleFromExecutable(appExecutablePath);
    if (appBundlePath) {
      const commandPath = join(
        options.tempDirectory ?? tmpdir(),
        MACOS_HANDOFF_COMMAND_NAME,
      );
      try {
        await (options.writeFileFn ?? writeFile)(
          commandPath,
          buildMacHandoffCommand({
            installerPath,
            appBundlePath,
            processId,
            ...(options.currentVersion === undefined
              ? {}
              : { currentVersion: options.currentVersion }),
          }),
          { mode: 0o755 },
        );
        spawnFn("/bin/bash", [commandPath], {
          detached: true,
          stdio: "ignore",
        })
          .on("error", (error) => {
            console.error("AITracker update hand-off launch failed", error);
          })
          .unref();
        return { launched: true, method: "darwin-auto-install" };
      } catch (error) {
        // Fall through to the manual flow rather than leaving the user with a
        // "restart to install" button that does nothing.
        console.error(
          "AITracker could not arm the macOS auto-install",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
  const commandAndArgs: { command: string; args: readonly string[] } =
    platform === "darwin"
      ? { command: "/usr/bin/open", args: [installerPath] }
      : { command: installerPath, args: [] };
  try {
    spawnFn(commandAndArgs.command, commandAndArgs.args, {
      detached: true,
      stdio: "ignore",
    })
      .on("error", (error) => {
        // Async spawn failures (for example ENOENT) surface here after the
        // method returned; they cannot fail the quit flow retroactively.
        console.error("AITracker update installer launch failed", error);
      })
      .unref();
    return {
      launched: true,
      method: platform === "darwin" ? "darwin-open" : "spawn",
    };
  } catch (error) {
    return {
      launched: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
