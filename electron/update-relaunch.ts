import { spawn, type SpawnOptions } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface InstallerHandoffResult {
  readonly launched: boolean;
  readonly reason?: string;
  /** How the hand-off was armed; useful in diagnostics. */
  readonly method?: "windows-hidden" | "windows-command" | "spawn";
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
 * - macOS: hand the image to `open`; the app quits and the user finishes the
 *   drag-and-drop install from the mounted volume.
 * - Other platforms: run/open the artifact as best effort.
 *
 * Never throws: every failure is reported as `{ launched: false, reason }`.
 */
export async function handOffInstaller(options: {
  readonly platform: NodeJS.Platform;
  readonly installerPath: string;
  readonly appExecutablePath?: string;
  readonly processId?: number;
  /** Directory for the generated Windows command script (defaults to tmp). */
  readonly tempDirectory?: string;
  /** Electron `shell.openPath` equivalent; `""` means success. */
  readonly openPathFn?: (path: string) => Promise<string>;
  readonly writeFileFn?: (path: string, data: string) => Promise<void>;
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
    const commandPath = join(
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
    return { launched: true, method: "spawn" };
  } catch (error) {
    return {
      launched: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
