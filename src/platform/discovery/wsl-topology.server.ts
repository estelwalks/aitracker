import { execFile } from "node:child_process";

/**
 * P3-T3-04 / P5-T5-04: WSL topology discovery.
 *
 * Enumerates distros and their Linux home directories exactly once per refresh
 * and exposes them as a small, bounded fact snapshot. Consumers (Claude/Codex
 * usage scanner, session reader) ask this module for the topology instead of
 * invoking `wsl.exe` themselves.
 *
 * Cancellation: every child process is bound to the caller's AbortSignal.
 * When the signal fires the child is killed and awaited before the promise
 * settles, and a stable warning code is recorded — no hanging handles, no
 * delayed commit.
 */

export interface WslDistroHome {
  readonly distribution: string;
  /** Linux home path (e.g. "/home/user"); never empty. */
  readonly home: string;
}

export interface WslTopology {
  /** Empty on non-Windows platforms or when WSL is unavailable. */
  readonly distros: readonly WslDistroHome[];
  readonly enumeratedAt: string | null;
  readonly failed: boolean;
  /** Stable warning codes ("cancelled", "timeout", "wsl-unavailable"). */
  readonly warningCodes: readonly string[];
}

export interface WslTopologyOptions {
  readonly platform?: string;
  /** Test seam; defaults to `execFile`. */
  readonly execFileFn?: typeof execFile;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function emptyTopology(
  enumeratedAt: string | null,
  failed = false,
  warningCodes: readonly string[] = [],
): WslTopology {
  return { distros: [], enumeratedAt, failed, warningCodes };
}

interface ExecFileResult {
  stdout: string | Buffer;
  killed: boolean;
}

/**
 * Runs one child process bound to the signal. On abort the child is killed
 * and awaited (no hanging handle); the promise rejects with a stable
 * "cancelled" error. `timeoutMs` is enforced by execFile itself.
 */
function execFileP(
  run: typeof execFile,
  file: string,
  args: readonly string[],
  options: object,
  signal: AbortSignal | undefined,
): Promise<ExecFileResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const child = run(file, [...args], options, (error, stdout) => {
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ stdout, killed: false });
    });
    const onAbort = () => {
      // Kill and wait for exit; do not start any stronger destructive op.
      child.kill();
      child.once("exit", () => {
        reject(new Error("cancelled"));
      });
      // Safety net: if the child ignores SIGTERM, still settle promptly.
      const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
      child.once("exit", () => clearTimeout(force));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Enumerates WSL distributions and their home directories. On failure
 * (non-Windows, no WSL, timeout, cancellation) returns an empty failed
 * topology — never throws — so scanners degrade to their non-WSL paths.
 */
export async function enumerateWslTopology(
  options: WslTopologyOptions = {},
): Promise<WslTopology> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    return emptyTopology(null);
  }
  const run = options.execFileFn ?? execFile;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const signal = options.signal;
  const enumeratedAt = now().toISOString();

  let stdout: string | Buffer;
  try {
    ({ stdout } = await execFileP(
      run,
      "wsl.exe",
      ["-l", "-q"],
      {
        encoding: "buffer",
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      signal,
    ));
  } catch (caught) {
    if (signal?.aborted)
      return emptyTopology(enumeratedAt, true, ["cancelled"]);
    return emptyTopology(enumeratedAt, true, ["wsl-unavailable"]);
  }

  const raw = Buffer.isBuffer(stdout) ? stdout.toString("utf16le") : stdout;
  const distributions = raw
    .split(/\r?\n/)
    .map((value) => value.replace(/\0/g, "").trim())
    .filter(Boolean);

  const distros: WslDistroHome[] = [];
  for (const distribution of distributions) {
    if (signal?.aborted) {
      return {
        distros,
        enumeratedAt,
        failed: true,
        warningCodes: ["cancelled"],
      };
    }
    try {
      const result = await execFileP(
        run,
        "wsl.exe",
        ["-d", distribution, "-e", "sh", "-lc", 'printf %s "$HOME"'],
        {
          encoding: "utf8",
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
        signal,
      );
      const stdout = Buffer.isBuffer(result.stdout)
        ? result.stdout.toString("utf8")
        : result.stdout;
      const linuxHome = stdout.trim();
      if (!linuxHome.startsWith("/")) continue;
      distros.push({ distribution, home: linuxHome });
    } catch {
      // Skip unresponsive distros; the rest of the topology stays usable.
    }
  }
  return { distros, enumeratedAt, failed: false, warningCodes: [] };
}

/**
 * Builds the UNC roots a provider directory would live at under each distro.
 * Returns an empty array when the topology is unavailable.
 */
export function wslRootsFor(
  topology: WslTopology,
  providerDirectory: string,
): string[] {
  return topology.distros.flatMap(({ distribution, home }) => {
    const suffix = `${home.replaceAll("/", "\\")}\\${providerDirectory}`;
    return [
      `\\\\wsl.localhost\\${distribution}${suffix}`,
      `\\\\wsl$\\${distribution}${suffix}`,
    ];
  });
}
