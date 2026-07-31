import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type {
  LocalUsageEvent,
  LocalUsageSource,
  LocalUsageSourceSummary,
} from "./types.ts";
import { KNOWN_LOCAL_USAGE_SOURCES } from "./types.ts";

const SYNC_INTERVAL_MS = 60_000;
const SYNC_TIMEOUT_MS = 120_000;
const INIT_TIMEOUT_MS = 180_000;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const MAX_LOG_BYTES = 512 * 1024;

let lastSyncAt = 0;
let syncPending: Promise<void> | undefined;
let initializationPending: Promise<void> | undefined;

interface QueueRow {
  hour_start?: unknown;
  source?: unknown;
  model?: unknown;
  project_key?: unknown;
  input_tokens?: unknown;
  cached_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  output_tokens?: unknown;
  reasoning_output_tokens?: unknown;
  total_tokens?: unknown;
}

function usageHome(override?: string): string {
  if (override) return override;
  const configured = process.env.TRUSTTOOLS_USAGE_HOME?.trim();
  return configured || homedir();
}

function runtimeEntry(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return resourcesPath
    ? join(resourcesPath, "tokentracker-cli", "bin", "tracker.js")
    : resolve(process.cwd(), "vendor", "tokentracker-cli", "bin", "tracker.js");
}

function stateRoot(home: string): string {
  return join(home, ".trusttools", "tokentracker-runtime");
}

function queuePath(home: string): string {
  return join(stateRoot(home), ".tokentracker", "tracker", "queue.jsonl");
}

function configPath(home: string): string {
  return join(stateRoot(home), ".tokentracker", "tracker", "config.json");
}

function bootstrapLogPath(home: string): string {
  return join(home, ".trusttools", "logs", "local-usage-bootstrap.log");
}

function nodeCommand(): { executable: string; env: NodeJS.ProcessEnv } {
  if (process.versions.electron) {
    return {
      executable: process.execPath,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return { executable: process.execPath, env: {} };
}

interface TrackerCommandResult {
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  error?: string;
  stdout: string;
  stderr: string;
}

function appendCapped(chunks: Buffer[], chunk: Buffer | string): void {
  const currentBytes = chunks.reduce((total, value) => total + value.byteLength, 0);
  if (currentBytes >= MAX_COMMAND_OUTPUT_BYTES) return;
  const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  chunks.push(value.subarray(0, MAX_COMMAND_OUTPUT_BYTES - currentBytes));
}

async function persistCommandResult(home: string, result: TrackerCommandResult): Promise<void> {
  const path = bootstrapLogPath(home);
  await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
  const existingSize = await stat(path).then((value) => value.size).catch(() => 0);
  if (existingSize > MAX_LOG_BYTES) {
    await writeFile(path, "", "utf8").catch(() => undefined);
  }
  const record = [
    `[${new Date().toISOString()}] tracker ${result.args.join(" ")}`,
    `exit=${result.exitCode ?? "null"} signal=${result.signal ?? "none"} timedOut=${result.timedOut}`,
    result.error ? `error=${result.error}` : "",
    result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : "",
    result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : "",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  await appendFile(path, `${record}\n`, "utf8").catch(() => undefined);
}

async function runTrackerCommand(
  home: string,
  args: string[],
  timeoutMs: number,
  extraEnvironment: NodeJS.ProcessEnv = {},
): Promise<TrackerCommandResult> {
  const command = nodeCommand();
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  return new Promise<TrackerCommandResult>((resolveCommand) => {
    let settled = false;
    let timedOut = false;
    let spawnError: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    const child = spawn(command.executable, [runtimeEntry(), ...args], {
      cwd: dirname(runtimeEntry()),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...command.env,
        HOME: home,
        USERPROFILE: home,
        TRUSTTOOLS_TOKENTRACKER_STATE_HOME: stateRoot(home),
        TOKENTRACKER_NO_TELEMETRY: "1",
        ...extraEnvironment,
      },
    });
    child.stdout?.on("data", (chunk: Buffer) => appendCapped(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => appendCapped(stderr, chunk));
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const result: TrackerCommandResult = {
        args,
        exitCode,
        signal,
        timedOut,
        error: spawnError,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      void persistCommandResult(home, result).finally(() => resolveCommand(result));
    };
    child.once("error", (error) => {
      spawnError = error instanceof Error ? error.message : String(error);
      finish(null, null);
    });
    child.once("exit", finish);
    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
  });
}

async function runSync(home: string, force: boolean): Promise<void> {
  if (!force && Date.now() - lastSyncAt < SYNC_INTERVAL_MS) return;
  if (syncPending) return syncPending;

  syncPending = (async () => {
    // `--auto` suppresses cloud/account work but still performs a full local
    // source scan when no notify source is supplied. This is the fast path that
    // lets a clean installation render existing history immediately.
    await runTrackerCommand(home, ["sync", "--drain", "--auto"], SYNC_TIMEOUT_MS);
    lastSyncAt = Date.now();

    // Hook installation can involve copying the local runtime and must not
    // block the first visible dashboard. It starts immediately after the
    // historical scan and completes in the background in packaged Electron.
    if (process.versions.electron) {
      void initializeTokenTrackerUsage({ homeDirectory: home });
    }
  })().finally(() => {
    syncPending = undefined;
  });

  return syncPending;
}

export async function initializeTokenTrackerUsage(options: {
  homeDirectory?: string;
} = {}): Promise<void> {
  const home = usageHome(options.homeDirectory);
  const initialized = await stat(configPath(home))
    .then((value) => value.isFile())
    .catch(() => false);
  if (initialized) return;
  if (initializationPending) return initializationPending;

  initializationPending = runTrackerCommand(
    home,
    ["init", "--yes", "--no-auth", "--no-open"],
    INIT_TIMEOUT_MS,
    // The awaited fast scan above already populated historical usage. Avoid
    // launching a duplicate scan from TokenTracker's init command.
    { TOKENTRACKER_SKIP_FIRST_SYNC: "1" },
  )
    .then(() => undefined)
    .finally(() => {
      initializationPending = undefined;
    });
  return initializationPending;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

function source(value: unknown): LocalUsageSource | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const aliases: Record<string, string> = {
    claude: "claude-code",
    copilot: "github-copilot",
    gemini: "gemini-cli",
    roocode: "roo-code",
  };
  const normalized = aliases[value] ?? value;
  return (KNOWN_LOCAL_USAGE_SOURCES as readonly string[]).includes(normalized)
    ? (normalized as LocalUsageSource)
    : undefined;
}

export async function collectTokenTrackerUsage(options: {
  forceSync?: boolean;
  homeDirectory?: string;
} = {}): Promise<{
  events: LocalUsageEvent[];
  summaries: LocalUsageSourceSummary[];
}> {
  const home = usageHome(options.homeDirectory);
  const outputPath = queuePath(home);
  const hasQueue = await stat(outputPath).then((value) => value.isFile()).catch(() => false);
  await runSync(home, options.forceSync === true || !hasQueue);

  const text = await readFile(outputPath, "utf8").catch(() => "");
  const latest = new Map<string, QueueRow>();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const row = JSON.parse(line) as QueueRow;
      const rowSource = source(row.source);
      if (!rowSource || typeof row.hour_start !== "string") continue;
      const model = typeof row.model === "string" && row.model ? row.model : "unknown";
      const project =
        typeof row.project_key === "string" && row.project_key ? row.project_key : "unknown";
      latest.set(`${rowSource}\0${model}\0${project}\0${row.hour_start}`, row);
    } catch {
      continue;
    }
  }

  const events: LocalUsageEvent[] = [];
  for (const row of latest.values()) {
    const rowSource = source(row.source);
    if (!rowSource || typeof row.hour_start !== "string") continue;
    const inputTokens = count(row.input_tokens);
    const cachedInputTokens = count(row.cached_input_tokens);
    const cacheCreationInputTokens = count(row.cache_creation_input_tokens);
    const outputTokens = count(row.output_tokens);
    const reasoningOutputTokens = count(row.reasoning_output_tokens);
    const totalTokens =
      count(row.total_tokens) ||
      inputTokens +
        cachedInputTokens +
        cacheCreationInputTokens +
        outputTokens +
        reasoningOutputTokens;
    if (totalTokens === 0) continue;
    events.push({
      source: rowSource,
      timestamp: row.hour_start,
      model: typeof row.model === "string" && row.model ? row.model : "unknown",
      project:
        typeof row.project_key === "string" && row.project_key ? row.project_key : "unknown",
      inputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens,
    });
  }

  const counts = new Map<LocalUsageSource, number>();
  for (const event of events) counts.set(event.source, (counts.get(event.source) ?? 0) + 1);
  const summaries = [...counts].map(([eventSource, eventCount]) => ({
    source: eventSource,
    available: true,
    detected: true,
    paths: [outputPath],
    filesConsidered: 1,
    filesRead: 1,
    filesReused: 0,
    filesParsed: 1,
    malformedLines: 0,
    events: eventCount,
  }));
  return { events, summaries };
}
