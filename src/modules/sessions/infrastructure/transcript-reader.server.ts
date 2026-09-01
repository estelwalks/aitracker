import { createReadStream } from "node:fs";
import { opendir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";

import { ENV } from "../../../lib/app-config.ts";
import {
  getDefaultRegistry,
  getSessionPlanFor,
  resolvePlatformPaths,
  type CompiledRegistry,
  type PlatformOs,
} from "../../../lib/tool-registry/registry.ts";
import { openReadOnlySqlite } from "../../../platform/database/infrastructure/sqlite-runtime.server.ts";
import type {
  SessionTranscript,
  SessionTranscriptMessage,
} from "../contracts.ts";

/**
 * Local transcript reader (Story S-300).
 *
 * PRIVACY BOUNDARY — in-memory only, never persisted or uploaded: this module
 * exists solely to render the current session detail page. It reads the user's
 * own local tool logs, extracts message text into an in-memory structure, and
 * returns it to be serialized into the current page response. It NEVER writes
 * to disk, NEVER persists anything to any store, and NEVER uploads anything.
 *
 * It is intentionally a SEPARATE reader from the metadata scanner
 * (src/lib/local-sessions/scanner.server.ts): the scanner stays a
 * metadata-only, content-free guardrail, and this reader owns the only code
 * path that surfaces local conversation text. JSONL readers retain resource
 * caps; AiPy is read by an indexed task-id query and is not capped by the
 * database file's total size.
 */

export interface LoadSessionTranscriptInput {
  readonly source: string;
  readonly sessionId: string;
}

export interface TranscriptReaderOptions {
  /** Test seam: base home directory (defaults to `$AITRACKER_USAGE_HOME`/HOME). */
  homeDirectory?: string;
  /** Test seam: platform used for registry path resolution. */
  platform?: NodeJS.Platform;
  /** Test seam: registry used for session-plan and data-root resolution. */
  registry?: CompiledRegistry;
  /** Test seam: override resource caps (production uses scanner-parity defaults). */
  limits?: {
    maxFileBytes?: number;
    maxRecordsPerFile?: number;
    maxFiles?: number;
    maxMessages?: number;
    maxTextLength?: number;
  };
}

interface Limits {
  maxFileBytes: number;
  maxRecordsPerFile: number;
  maxFiles: number;
  maxMessages: number;
  maxTextLength: number;
}

interface JsonObject {
  [key: string]: unknown;
}

interface FileCandidate {
  path: string;
}

interface CollectedMessage {
  /** Epoch ms; missing timestamps sort last (MAX_SAFE_INTEGER). */
  ts: number;
  /** Monotonic sequence for stable ordering within one file. */
  seq: number;
  message: SessionTranscriptMessage;
}

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

// Resource caps — mirrored from the local-sessions scanner.
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_RECORDS_PER_FILE = 200_000;
const MAX_FILES = 5_000;
const MAX_DIRECTORY_ENTRIES = 200_000;
const MAX_JSONL_LINE_LENGTH = 16 * 1024 * 1024;
const MAX_MESSAGES = 2_000;
const MAX_TEXT_LENGTH = 200_000;

const CODEX_ROLLOUT_PATTERN = /rollout-.+\.jsonl$/;

/**
 * HOME-relative fallback data roots per session reader key. These mirror the
 * defaults registered by the metadata scanner (scanner.server.ts) so this
 * reader stays self-contained: it never depends on the scanner module having
 * been imported for its registration side effects.
 */
const READER_DEFAULT_ROOTS: Readonly<Record<string, readonly string[]>> = {
  "claude-session-v1": [".claude"],
  "codex-session-v1": [".codex"],
  "grok-session-v1": [".grok"],
};

function asObject(value: unknown): JsonObject | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** SQLite may expose a legacy TEXT value as a Uint8Array/BLOB. */
function sqliteTextValue(value: unknown): string | undefined {
  const text = stringValue(value);
  if (text != null) return text;
  if (value instanceof Uint8Array) {
    const decoded = new TextDecoder().decode(value);
    return decoded.length > 0 ? decoded : undefined;
  }
  return undefined;
}

function clamp(value: string, maximum: number): string {
  return value.length <= maximum ? value : value.slice(0, maximum);
}

function resolveLimits(override: TranscriptReaderOptions["limits"]): Limits {
  return {
    maxFileBytes: override?.maxFileBytes ?? MAX_FILE_BYTES,
    maxRecordsPerFile: override?.maxRecordsPerFile ?? MAX_RECORDS_PER_FILE,
    maxFiles: override?.maxFiles ?? MAX_FILES,
    maxMessages: override?.maxMessages ?? MAX_MESSAGES,
    maxTextLength: override?.maxTextLength ?? MAX_TEXT_LENGTH,
  };
}

function resolveHome(override: string | undefined): string {
  const isolatedUsageHome = process.env[ENV.USAGE_HOME]?.trim();
  return (
    override ??
    (isolatedUsageHome && isAbsolute(isolatedUsageHome)
      ? isolatedUsageHome
      : homedir())
  );
}

/** Map Node's platform value to the registry's `PlatformOs`. */
function currentPlatformOs(platform: NodeJS.Platform): PlatformOs {
  switch (platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

async function directoryAvailable(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function readFileSize(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.size;
  } catch {
    return -1;
  }
}

/**
 * Streaming JSONL reader — reads only; never writes. Stops early once
 * `maxRecordsPerFile` records are reached and skips oversized lines.
 */
async function readJsonLines(
  filePath: string,
  onRecord: (record: JsonObject) => void,
  limits: Limits,
): Promise<void> {
  const size = await readFileSize(filePath);
  if (size > limits.maxFileBytes) return;

  let records = 0;
  const input = createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 64 * 1024,
  });
  const lines = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (records >= limits.maxRecordsPerFile) break;
      if (line.length === 0 || line.length > MAX_JSONL_LINE_LENGTH) continue;
      try {
        const record = asObject(JSON.parse(line));
        if (record != null) {
          records += 1;
          onRecord(record);
        }
      } catch {
        // Malformed line — skip non-fatally.
      }
    }
  } catch {
    // Read failure is non-fatal; keep whatever was collected.
  } finally {
    lines.close();
    input.destroy();
  }
}

/** Recursive JSONL discovery mirroring the scanner's `opendir` traversal. */
async function collectJsonlFiles(
  roots: string[],
  matches: (relativePath: string, name: string) => boolean,
  maxFiles: number,
): Promise<FileCandidate[]> {
  const files: FileCandidate[] = [];
  const seen = new Set<string>();
  let discoveredEntries = 0;

  for (const root of roots) {
    if (!(await directoryAvailable(root))) continue;
    const pending = [root];
    while (pending.length > 0 && discoveredEntries < MAX_DIRECTORY_ENTRIES) {
      const directoryPath = pending.pop();
      if (directoryPath == null) break;
      let directory;
      try {
        directory = await opendir(directoryPath);
      } catch {
        continue;
      }
      for await (const entry of directory) {
        discoveredEntries += 1;
        if (discoveredEntries >= MAX_DIRECTORY_ENTRIES) break;
        const entryPath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          pending.push(entryPath);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const relativePath = relative(root, entryPath).split(sep).join("/");
        if (!matches(relativePath, entry.name)) continue;
        if (!seen.has(entryPath)) {
          seen.add(entryPath);
          files.push({ path: entryPath });
          if (files.length >= maxFiles) return files;
        }
      }
    }
  }
  return files;
}

/** Grok session directories = directories that contain `updates.jsonl`. */
async function collectGrokSessionDirectories(
  sessionsRoot: string,
  maxDirectories: number,
): Promise<string[]> {
  if (!(await directoryAvailable(sessionsRoot))) return [];
  const sessionDirectories: string[] = [];
  let discoveredEntries = 0;

  const pending = [sessionsRoot];
  while (pending.length > 0 && discoveredEntries < MAX_DIRECTORY_ENTRIES) {
    const directoryPath = pending.pop();
    if (directoryPath == null) break;
    let directory;
    try {
      directory = await opendir(directoryPath);
    } catch {
      continue;
    }
    let hasUpdatesJsonl = false;
    const subdirectories: string[] = [];
    for await (const entry of directory) {
      discoveredEntries += 1;
      if (discoveredEntries >= MAX_DIRECTORY_ENTRIES) break;
      if (entry.name === "updates.jsonl") hasUpdatesJsonl = true;
      if (entry.isDirectory()) {
        subdirectories.push(join(directoryPath, entry.name));
      }
    }
    if (hasUpdatesJsonl) {
      sessionDirectories.push(directoryPath);
      if (sessionDirectories.length >= maxDirectories)
        return sessionDirectories;
      continue; // do not descend further — this IS a session directory
    }
    pending.push(...subdirectories);
  }
  return sessionDirectories;
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function parseTimestampMs(value: unknown): number {
  if (typeof value === "bigint") {
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return Number.MAX_SAFE_INTEGER;
    }
    value = Number(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value < 1e12 ? value * 1_000 : value;
    return normalized > 0 ? normalized : Number.MAX_SAFE_INTEGER;
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Extract text/thinking from a message content payload. Supports the Claude
 * Code block array (`text`/`thinking` blocks), the Codex block array
 * (`input_text`/`output_text`/`reasoning` blocks), a plain string, or a Grok
 * `content` field. Returns only the string fields — never raw JSON or paths.
 */
function extractContent(content: unknown): { text: string; thinking: string } {
  if (typeof content === "string") return { text: content, thinking: "" };
  if (!Array.isArray(content)) return { text: "", thinking: "" };

  let text = "";
  let thinking = "";
  for (const block of content) {
    const item = asObject(block);
    if (item == null) continue;
    const type = stringValue(item.type);
    if (type === "text" || type === "output_text" || type === "input_text") {
      const value = stringValue(item.text);
      if (value != null) text += (text ? "\n" : "") + value;
    } else if (type === "thinking") {
      const value = stringValue(item.thinking) ?? stringValue(item.text);
      if (value != null) thinking += (thinking ? "\n" : "") + value;
    } else if (type === "reasoning") {
      const value = reasoningText(item);
      if (value != null) thinking += (thinking ? "\n" : "") + value;
    }
  }
  return { text, thinking };
}

function reasoningText(item: JsonObject): string | undefined {
  const summary = item.summary;
  if (typeof summary === "string") return summary;
  if (Array.isArray(summary)) {
    const parts: string[] = [];
    for (const entry of summary) {
      const value = stringValue(asObject(entry)?.text);
      if (value != null) parts.push(value);
    }
    return parts.length > 0 ? parts.join("\n") : undefined;
  }
  return stringValue(item.text);
}

function pushMessage(
  out: CollectedMessage[],
  role: "user" | "assistant",
  text: string,
  thinking: string | undefined,
  ts: number,
  limits?: Limits,
): void {
  if (limits != null && out.length >= limits.maxMessages) return;
  const safeText =
    limits == null ? text.trim() : clamp(text, limits.maxTextLength).trim();
  const safeThinking =
    thinking == null
      ? undefined
      : limits == null
        ? thinking.trim()
        : clamp(thinking, limits.maxTextLength).trim();
  if (safeText.length === 0 && safeThinking == null) return;
  out.push({
    ts,
    seq: out.length,
    message: {
      role,
      text: safeText,
      ...(safeThinking ? { thinking: safeThinking } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Claude Code — ~/.claude/projects/<encoded-cwd>/*.jsonl
// ---------------------------------------------------------------------------

async function readClaudeTranscript(
  root: string,
  sessionId: string,
  out: CollectedMessage[],
  limits: Limits,
): Promise<void> {
  const files = await collectJsonlFiles(
    [join(root, "projects")],
    () => true,
    limits.maxFiles,
  );
  interface ClaudeStreamMessage {
    role: "user" | "assistant";
    text: string;
    thinking: string;
    ts: number;
    seq: number;
  }
  const streamedMessages = new Map<string, ClaudeStreamMessage>();
  let recordSequence = 0;

  const mergeStreamPart = (current: string, incoming: string): string => {
    if (!incoming || current === incoming || current.includes(incoming)) {
      return current;
    }
    if (!current || incoming.includes(current)) return incoming;
    return `${current}\n${incoming}`;
  };

  for (const file of files) {
    const fileMatchesSession = file.path.includes(sessionId);
    await readJsonLines(
      file.path,
      (record) => {
        const seq = recordSequence++;
        // Skip system prompts and tool/result-only meta records.
        if (record.isMeta === true) return;
        if (stringValue(record.type) === "system") return;
        const recordSessionId = stringValue(
          record.sessionId ?? record.session_id ?? record.conversationId,
        );
        if (
          recordSessionId !== sessionId &&
          !(fileMatchesSession && recordSessionId == null)
        )
          return;
        const message = asObject(record.message);
        if (message == null) return;
        const role = stringValue(message.role);
        if (role !== "user" && role !== "assistant") return;
        const { text, thinking } = extractContent(message.content);
        if (!text && !thinking) return;
        const messageId = stringValue(message.id);
        if (messageId != null) {
          const existing = streamedMessages.get(messageId);
          if (existing != null) {
            existing.text = mergeStreamPart(existing.text, text);
            existing.thinking = mergeStreamPart(existing.thinking, thinking);
            existing.ts = Math.min(
              existing.ts,
              parseTimestampMs(record.timestamp),
            );
            return;
          }
          if (out.length + streamedMessages.size >= limits.maxMessages) return;
          streamedMessages.set(messageId, {
            role,
            text,
            thinking,
            ts: parseTimestampMs(record.timestamp),
            seq,
          });
          return;
        }
        if (out.length + streamedMessages.size >= limits.maxMessages) return;
        pushMessage(
          out,
          role,
          text,
          thinking || undefined,
          parseTimestampMs(record.timestamp),
          limits,
        );
      },
      limits,
    );
  }

  for (const streamed of [...streamedMessages.values()].sort((left, right) =>
    left.ts === right.ts ? left.seq - right.seq : left.ts - right.ts,
  )) {
    pushMessage(
      out,
      streamed.role,
      streamed.text,
      streamed.thinking || undefined,
      streamed.ts,
      limits,
    );
  }
}

// ---------------------------------------------------------------------------
// Codex — ~/.codex/sessions/**/rollout-*.jsonl (+ archived_sessions/)
// ---------------------------------------------------------------------------

async function readCodexTranscript(
  root: string,
  sessionId: string,
  out: CollectedMessage[],
  limits: Limits,
): Promise<void> {
  const files = await collectJsonlFiles(
    [join(root, "sessions"), join(root, "archived_sessions")],
    (relativePath) => CODEX_ROLLOUT_PATTERN.test(relativePath),
    limits.maxFiles,
  );
  const seenItemIds = new Set<string>();
  for (const file of files) {
    // Most files carry the id in the rollout filename. Some exporters omit
    // it from the record payload, so a matching filename is authoritative.
    const fileMatchesSession = file.path.includes(sessionId);
    await readJsonLines(
      file.path,
      (record) => {
        if (out.length >= limits.maxMessages) return;
        const payload = asObject(record.payload);
        if (payload == null) return;
        const recordSessionId = stringValue(
          record.sessionId ?? record.session_id ?? record.conversationId,
        );
        if (!fileMatchesSession && recordSessionId !== sessionId) return;
        const message = extractCodexMessage(payload, seenItemIds);
        if (message == null) return;
        pushMessage(
          out,
          message.role,
          message.text,
          message.thinking,
          parseTimestampMs(record.timestamp),
          limits,
        );
      },
      limits,
    );
  }
}

function extractCodexMessage(
  payload: JsonObject,
  seenItemIds: Set<string>,
): SessionTranscriptMessage | null {
  const candidates: JsonObject[] = [];
  const item = asObject(payload.item);
  const responseItem = asObject(payload.response_item);
  const nestedMessage = asObject(payload.message);
  if (item != null) candidates.push(item);
  if (responseItem != null && responseItem !== item) {
    candidates.push(responseItem);
  }
  if (nestedMessage != null) candidates.push(nestedMessage);
  const payloadRole = stringValue(payload.role);
  if (
    (payloadRole === "user" || payloadRole === "assistant") &&
    !candidates.includes(payload)
  ) {
    candidates.push(payload);
  }
  if (
    payload.type === "message" ||
    payload.type === "user_message" ||
    payload.type === "assistant_message"
  ) {
    candidates.push(payload);
  }

  for (const candidate of candidates) {
    const role = stringValue(candidate.role);
    if (role !== "user" && role !== "assistant") continue;
    const { text, thinking } = extractContent(candidate.content);
    if (text.length === 0 && thinking.length === 0) continue;
    const itemId = stringValue(candidate.id);
    if (itemId != null) {
      if (seenItemIds.has(itemId)) continue; // streamed duplicate
      seenItemIds.add(itemId);
    }
    return { role, text, ...(thinking ? { thinking } : {}) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grok (Grok Build) — ~/.grok/sessions/<encoded-cwd>/<uuid>/updates.jsonl
// ---------------------------------------------------------------------------

async function readGrokTranscript(
  root: string,
  sessionId: string,
  out: CollectedMessage[],
  limits: Limits,
): Promise<void> {
  const directories = await collectGrokSessionDirectories(
    join(root, "sessions"),
    limits.maxFiles,
  );
  for (const sessionDirectory of directories) {
    const summary = asObject(
      await readJsonFile<unknown>(join(sessionDirectory, "summary.json")),
    );
    const summaryInfo = asObject(summary?.info);
    const explicitId =
      stringValue(summaryInfo?.id ?? summary?.id) ?? basename(sessionDirectory);
    if (explicitId !== sessionId) continue;
    await readJsonLines(
      join(sessionDirectory, "updates.jsonl"),
      (record) => {
        if (out.length >= limits.maxMessages) return;
        const params = asObject(record.params);
        const update = asObject(params?.update);
        const sessionUpdate =
          stringValue(update?.sessionUpdate) ?? stringValue(record.type);
        if (
          sessionUpdate !== "user_message" &&
          sessionUpdate !== "assistant_message"
        ) {
          return;
        }
        const role = sessionUpdate === "user_message" ? "user" : "assistant";
        const message = asObject(update?.message);
        const { text, thinking } = extractContent(
          update?.content ?? message?.content ?? record.content,
        );
        const extraThinking = stringValue(update?.thinking) ?? undefined;
        pushMessage(
          out,
          role,
          text,
          thinking || extraThinking,
          parseTimestampMs(record.timestamp),
          limits,
        );
      },
      limits,
    );
  }
}

// ---------------------------------------------------------------------------
// AiPy — platform app-data/aipy-pro/aipy (SQLite)
// ---------------------------------------------------------------------------

/**
 * AiPy stores the visible conversation directly in `task_event`: USER rows
 * are prompts, LLM rows are assistant replies, and optional LLM `reason`
 * values contain thinking text. Other event types are execution metadata and
 * must not be rendered as chat messages.
 */
async function readAipyTranscript(
  root: string,
  sessionId: string,
  out: CollectedMessage[],
): Promise<void> {
  const databasePath = join(root, "aipy");

  let database: ReturnType<typeof openReadOnlySqlite> | undefined;
  try {
    database = openReadOnlySqlite(databasePath);
    const columns = new Set(
      database
        .queryRows("PRAGMA table_info(task_event)")
        .map((row) => stringValue(row.name))
        .filter((name): name is string => name != null),
    );
    if (!columns.has("task_id") || !columns.has("type")) return;

    // AiPy's task_event schema has evolved. Keep optional columns as empty
    // values so an older database can still render its user/assistant text.
    const contentColumn = columns.has("content") ? "content" : "''";
    const reasonColumn = columns.has("reason") ? "reason" : "''";
    const timeColumn = columns.has("time") ? "time" : "NULL";
    const orderBy = columns.has("time") ? "time ASC, rowid ASC" : "rowid ASC";
    const rows = database.queryRows(
      `SELECT type, ${contentColumn} AS content, ${reasonColumn} AS reason, ${timeColumn} AS time
       FROM task_event
       WHERE task_id = ? AND UPPER(type) IN ('USER', 'LLM')
       ORDER BY ${orderBy}`,
      sessionId,
    );

    for (const row of rows) {
      const type = stringValue(row.type)?.toUpperCase();
      const role =
        type === "USER" ? "user" : type === "LLM" ? "assistant" : null;
      if (role == null) continue;
      pushMessage(
        out,
        role,
        sqliteTextValue(row.content) ?? "",
        role === "assistant" ? sqliteTextValue(row.reason) : undefined,
        parseTimestampMs(row.time),
      );
    }
  } catch {
    // Missing/incompatible AiPy databases degrade to an empty transcript.
  } finally {
    database?.close();
  }
}

/**
 * Load one session's transcript into memory (S-300). Returns an empty
 * transcript for unknown sources, unsafe ids, or missing logs — it never
 * throws for missing data and never touches the disk
 * beyond read-only access.
 */
export async function loadSessionTranscript(
  input: LoadSessionTranscriptInput,
  options: TranscriptReaderOptions = {},
): Promise<SessionTranscript> {
  const empty = (): SessionTranscript => ({
    sessionId: input.sessionId,
    source: input.source,
    messages: [],
  });
  if (!SAFE_SESSION_ID.test(input.sessionId)) return empty();
  if (typeof input.source !== "string" || input.source.length === 0) {
    return empty();
  }

  const limits = resolveLimits(options.limits);
  const homeDirectory = resolveHome(options.homeDirectory);
  const registry = options.registry ?? getDefaultRegistry();
  const def = registry.byId.get(input.source);
  const plan = def ? getSessionPlanFor(def) : null;
  if (!plan) return empty();

  const resolution = resolvePlatformPaths(
    input.source,
    "sessions",
    currentPlatformOs(options.platform ?? process.platform),
    process.env,
    registry,
  );
  const fallbackRoots = READER_DEFAULT_ROOTS[plan.reader] ?? [];
  const roots =
    resolution != null && resolution.paths.length > 0
      ? resolution.paths.map((path) =>
          path.homeRelative ? join(homeDirectory, path.path) : path.path,
        )
      : fallbackRoots.map((root) => join(homeDirectory, root));
  if (roots.length === 0) return empty();

  try {
    const collected: CollectedMessage[] = [];
    for (const root of roots) {
      await readSourceTranscript(
        plan.reader,
        root,
        input.sessionId,
        collected,
        limits,
      );
      if (input.source !== "aipy" && collected.length >= limits.maxMessages)
        break;
    }
    collected.sort((left, right) =>
      left.ts === right.ts ? left.seq - right.seq : left.ts - right.ts,
    );
    return {
      sessionId: input.sessionId,
      source: input.source,
      messages: (input.source === "aipy"
        ? collected
        : collected.slice(0, limits.maxMessages)
      ).map((entry) => entry.message),
    };
  } catch {
    // Any failure degrades to an empty transcript — never a 500 for local logs.
    return empty();
  }
}

async function readSourceTranscript(
  readerKey: string,
  root: string,
  sessionId: string,
  out: CollectedMessage[],
  limits: Limits,
): Promise<void> {
  switch (readerKey) {
    case "claude-session-v1":
      return readClaudeTranscript(root, sessionId, out, limits);
    case "codex-session-v1":
      return readCodexTranscript(root, sessionId, out, limits);
    case "grok-session-v1":
      return readGrokTranscript(root, sessionId, out, limits);
    case "aipy-session-v1":
      return readAipyTranscript(root, sessionId, out);
    default:
      // Unknown reader — no transcript extraction implemented for it yet.
      return;
  }
}
