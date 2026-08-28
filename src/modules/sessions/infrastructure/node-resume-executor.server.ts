import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, chmod, constants, mkdtemp, writeFile } from "node:fs/promises";
import { delimiter, join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";

import {
  buildResumeCommandTokens,
  isResumeSafeId,
} from "../../../lib/local-sessions/resume-id.ts";
import type {
  ResumeCommandExecutor,
  ResumeCommandRequest,
} from "./session-adapter.server.ts";

type Spawn = typeof spawn;

export interface NodeResumeExecutorOptions {
  /** Test seam. Production always uses Node's `child_process.spawn`. */
  readonly spawn?: Spawn;
  /**
   * Test seam: resolve the command's executable before spawn. Defaults to
   * `resolveExecutableForLaunch`, which first uses the current process PATH,
   * then falls back to the user's login-shell PATH (packaged macOS/Linux GUI
   * apps inherit a minimal PATH, so CLI tools like codex/claude are usually
   * only reachable via the login shell).
   */
  readonly resolveExecutable?: (file: string) => Promise<string> | string;
}

/** Cached login-shell PATH (macOS/Linux GUI apps don't inherit the shell PATH). */
let loginPathCache: string | null | undefined;

function pathDirectories(pathValue: string): string[] {
  return pathValue.split(delimiter).filter(Boolean);
}

async function findExecutableInPath(
  file: string,
  pathValue: string,
): Promise<string | null> {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];
  for (const directory of pathDirectories(pathValue)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${file}${extension.toLowerCase()}`);
      try {
        await access(
          candidate,
          process.platform === "win32" ? constants.F_OK : constants.X_OK,
        );
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

async function loginShellPath(): Promise<string | null> {
  if (loginPathCache !== undefined) return loginPathCache;
  loginPathCache = null;
  if (process.platform === "win32") return null;
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const value = await new Promise<string | null>((resolve) => {
      execFile(
        shell,
        ["-lc", "printf '%s' \"$PATH\""],
        { timeout: 5000, windowsHide: true },
        (error, stdout) => resolve(error ? null : stdout.trim()),
      );
    });
    if (value) loginPathCache = value;
  } catch {
    // keep the cached null fallback
  }
  return loginPathCache;
}

/**
 * Resolve a resume executable that may be missing from the GUI-launched
 * process PATH. Returns the file unchanged when it is a path or already
 * resolvable — otherwise the login-shell PATH is consulted (codex/claude/…
 * usually live there) and the absolute path is returned.
 */
export async function resolveExecutableForLaunch(
  file: string,
): Promise<string> {
  if (isAbsolute(file) || file.includes("/") || file.includes("\\"))
    return file;
  if (await findExecutableInPath(file, process.env.PATH ?? "")) return file;
  const loginPath = await loginShellPath();
  const resolved = loginPath
    ? await findExecutableInPath(file, loginPath)
    : null;
  return resolved ?? file;
}

/**
 * Launches a registered resume command without a shell. The only executable
 * and arguments come from the tool registry's tokenized session plan; the
 * renderer can never supply a command, a working directory, or a file path.
 *
 * A resumed CLI is deliberately detached because it can be long-running and
 * interactive. `accepted` means the OS accepted the child process launch, not
 * that the external CLI completed a conversation recovery.
 */
export function createNodeResumeExecutor(
  options: NodeResumeExecutorOptions = {},
): ResumeCommandExecutor {
  const start = options.spawn ?? spawn;
  const useVisibleTerminal = options.spawn === undefined;
  const resolveExecutable =
    options.resolveExecutable ?? resolveExecutableForLaunch;
  return {
    async execute(
      request: ResumeCommandRequest,
      signal?: AbortSignal,
    ): Promise<void> {
      if (signal?.aborted) throw new Error("resume cancelled");
      if (!isResumeSafeId(request.sessionId))
        throw new Error("unsafe session id");
      const command = buildResumeCommandTokens(
        request.source,
        request.sessionId,
      );
      if (!command) throw new Error("unsupported session source");

      const [file, ...args] = command;
      if (!file) throw new Error("missing resume executable");
      const executable = await resolveExecutable(file);
      const launch = await visibleTerminalCommand(
        executable,
        args,
        request.cwd,
        useVisibleTerminal,
      );

      await new Promise<void>((resolve, reject) => {
        let child: ChildProcess;
        let settled = false;

        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", cancel);
          callback();
        };
        const cancel = () => {
          // This only handles cancellation before `spawn` confirms. After a
          // launch is accepted the child is detached and must stay independent
          // from a transient HTTP/navigation cancellation.
          child.kill();
          finish(() => reject(new Error("resume cancelled")));
        };

        try {
          child = start(launch.file, launch.args, {
            detached: useVisibleTerminal ? false : true,
            shell: false,
            stdio: useVisibleTerminal ? "ignore" : "ignore",
            windowsHide: useVisibleTerminal ? false : true,
            cwd: launch.cwd,
          });
        } catch (error) {
          finish(() => reject(error));
          return;
        }

        signal?.addEventListener("abort", cancel, { once: true });
        // An abort may happen between the initial check and listener setup.
        // Do not let that race launch a process after its caller has gone away.
        if (signal?.aborted) {
          cancel();
          return;
        }
        child.once("error", (error) => finish(() => reject(error)));
        child.once("spawn", () =>
          finish(() => {
            child.unref();
            resolve();
          }),
        );
      });
    },
  };
}

function posixShellString(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

interface TerminalLaunch {
  file: string;
  args: string[];
  /** Working directory inherited by the terminal launcher process. */
  cwd?: string;
}

async function macDefaultTerminalScript(
  executable: string,
  args: readonly string[],
  cwd?: string,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aitracker-resume-"));
  const scriptPath = join(directory, "resume.command");
  const command = [executable, ...args].map(posixShellString).join(" ");
  const script = [
    "#!/bin/sh",
    "set -e",
    // `.command` is opened by the user's configured terminal association;
    // this explicit cd is required because that terminal is a new process.
    "script_path=$0",
    'cleanup() { rm -f "$script_path"; rmdir "$(dirname "$script_path")" 2>/dev/null || true; }',
    "trap cleanup EXIT",
    ...(cwd == null ? [] : [`cd ${posixShellString(cwd)}`]),
    command,
    "",
  ].join("\n");
  await writeFile(scriptPath, script, { encoding: "utf8", mode: 0o700 });
  await chmod(scriptPath, 0o700);
  return scriptPath;
}

async function visibleTerminalCommand(
  executable: string,
  args: readonly string[],
  cwd: string | undefined,
  enabled: boolean,
): Promise<TerminalLaunch> {
  if (!enabled) return { file: executable, args: [...args], cwd };
  if (process.platform === "darwin") {
    const scriptPath = await macDefaultTerminalScript(executable, args, cwd);
    return {
      // Let Launch Services choose the user's default terminal for the .command
      // file instead of hard-coding Terminal.app or iTerm2.
      file: "/usr/bin/open",
      args: [scriptPath],
    };
  }
  if (process.platform === "win32") {
    return {
      file: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/k", executable, ...args],
      cwd,
    };
  }
  return {
    // x-terminal-emulator is the system-selected default terminal launcher
    // on Linux distributions that provide it.
    file: "x-terminal-emulator",
    args: ["-e", executable, ...args],
    cwd,
  };
}
