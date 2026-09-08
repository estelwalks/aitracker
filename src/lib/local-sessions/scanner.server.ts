import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { opendir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

import { ENV } from "../app-config";
import { osFromProcess } from "../tools/detection.server.ts";
import {
  decodeZstdSessionLogWithBounds,
  ZSTD_MAGIC_BYTES,
} from "../local-usage/dsh-zstd.ts";
import { canonicalizeProjectIdentity } from "../local-usage/project-path.server.ts";
import {
  findNearestGitRepositoryRoot,
  serverPathImplForPlatform,
} from "../git-repository.server.ts";
import {
  getDefaultRegistry,
  getSessionPlanFor,
  listSessionTools,
  resolvePlatformPaths,
} from "../tool-registry/registry.ts";
import type {
  CompiledRegistry,
  PlatformEnv,
  PlatformOs,
} from "../tool-registry/registry.ts";
import {
  getSessionReader,
  registerSessionReader,
} from "../tool-registry/readers/session-readers.ts";
import { estimateSessionCost } from "./cost.ts";
import { buildResumeCommand, isResumeSafeId } from "./resume-id.ts";
import type {
  SessionRecord,
  SessionSource,
  SessionSummary,
  SessionTokenCounts,
  SessionStatus,
} from "./types.ts";

/**
 * Privacy guardrails & resource caps.
 *
 * `MAX_FILE_BYTES` and `MAX_RECORDS_PER_FILE` cap a single malformed/oversized
 * log so a bad fixture cannot exhaust memory. `MAX_FILES_PER_SOURCE` bounds the
 * directory walk. None of these readers ever persist prompt/response text —
 * only metadata (ids, timestamps, model, cwd, token/turn counts) is read out.
 */
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_RECORDS_PER_FILE = 200_000;
const MAX_FILES_PER_SOURCE = 5_000;
const MAX_JSONL_LINE_LENGTH = 16 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 200_000;

/** A gap between consecutive records longer than this is treated as idle time. */
const IDLE_GAP_MS = 30 * 60 * 1_000;

const SYNTHETIC_MODEL_TOKENS = new Set(["<synthetic>", "<unknown>"]);

export interface ScanLocalSessionsOptions {
  homeDirectory?: string;
  now?: Date;
  /**
   * Test seam: registry to derive session tools, plans and scan roots from
   * (P1-3). Defaults to the built-in default registry.
   */
  registry?: CompiledRegistry;
  /** P5-T5-03: real cancellation; checked before and during tool scans. */
  signal?: AbortSignal;
  /** Test seam for Windows-only deep cancellation behavior. */
  platform?: NodeJS.Platform;
  /**
   * Persisted DSH scan cache from a previous process (see
   * `snapshotDshScanCache`). Hydrated once per scan root on first use so a
   * restart does not re-decode the full DSH history; files changed since the
   * snapshot was written are still re-parsed via their stamps.
   */
  dshCacheState?: unknown;
}

interface JsonObject {
  [key: string]: unknown;
}

interface RecordTimestamp {
  /** Epoch milliseconds, used for active-time and span computation. */
  ms: number;
  /** Original ISO string (preferred for display), when available. */
  iso: string;
}

interface SessionFragment {
  source: SessionSource;
  sessionId: string;
  title: string;
  /** Earliest safe user-text fallback; explicit titles always win. */
  fallbackTitle: string;
  fallbackTitleAt: number | null;
  model: string | null;
  projectRef: string | null;
  timestamps: RecordTimestamp[];
  /** Earliest user-authored message, when the reader can identify one. */
  firstUserAt: RecordTimestamp | null;
  totals: SessionTokenCounts;
  turns: number;
  editTurns: number;
  subagentCalls: number;
  /** Explicit terminal state found in structured local metadata only. */
  terminalStatus: Extract<SessionStatus, "interrupted" | "lost"> | null;
  /** Read-only session sources deliberately cannot be resumed. */
  resumeSupported?: boolean;
}

function asObject(value: unknown): JsonObject | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tokenValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

type ExplicitTerminalStatus = Extract<SessionStatus, "interrupted" | "lost">;

/**
 * Only recognize exact structured status values.  We intentionally do not
 * infer an interruption from a timestamp gap, an incomplete token record, or
 * error/message text: any of those can occur during a healthy resumable turn.
 */
function explicitTerminalStatus(
  ...metadata: Array<JsonObject | undefined>
): ExplicitTerminalStatus | undefined {
  for (const item of metadata) {
    if (item == null) continue;
    for (const key of ["status", "state", "outcome", "type", "subtype"]) {
      const raw = stringValue(item[key]);
      if (raw == null) continue;
      const value = raw.trim().toLowerCase().replaceAll("-", "_");
      if (value === "lost" || value === "session_lost") return "lost";
      if (
        value === "interrupted" ||
        value === "cancelled" ||
        value === "canceled" ||
        value === "aborted" ||
        value === "turn_interrupted" ||
        value === "turn_cancelled" ||
        value === "turn_canceled" ||
        value === "turn_aborted"
      ) {
        return "interrupted";
      }
    }
  }
  return undefined;
}

function mergeTerminalStatus(
  current: ExplicitTerminalStatus | null,
  next: ExplicitTerminalStatus | undefined,
): ExplicitTerminalStatus | null {
  // An explicit lost marker is stronger than a prior interruption marker.
  if (current === "lost" || next === "lost") return "lost";
  if (current === "interrupted" || next === "interrupted") {
    return "interrupted";
  }
  return null;
}

function timestampFromMs(ms: number): RecordTimestamp {
  return { ms, iso: new Date(ms).toISOString() };
}

function parseTimestampValue(value: unknown): RecordTimestamp | undefined {
  if (typeof value === "string") {
    const date = new Date(value);
    const ms = date.getTime();
    if (!Number.isNaN(ms)) {
      return { ms, iso: date.toISOString() };
    }
    return undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Detect seconds vs milliseconds by magnitude (unix seconds < 1e12).
    const normalized = value < 1e12 ? value * 1_000 : value;
    if (normalized > 0) {
      return timestampFromMs(normalized);
    }
  }
  return undefined;
}

function projectKeyFromCwd(cwd: string | null): string {
  if (!cwd) return "unknown";
  const trimmed = cwd.replaceAll("\\", "/").replace(/\/+$/, "");
  if (trimmed.length === 0) return "unknown";
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || "unknown";
}

function emptyTokenCounts(): SessionTokenCounts {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addTokenCounts(
  target: SessionTokenCounts,
  addend: SessionTokenCounts,
): void {
  target.inputTokens += addend.inputTokens;
  target.outputTokens += addend.outputTokens;
  target.cachedInputTokens += addend.cachedInputTokens;
  target.cacheCreationInputTokens += addend.cacheCreationInputTokens;
  target.reasoningOutputTokens += addend.reasoningOutputTokens;
  target.totalTokens += addend.totalTokens;
}

/**
 * Active duration: sort timestamps ascending, sum consecutive gaps that are
 * ≤ IDLE_GAP_MS. Gaps larger than the idle threshold (e.g. a resumed session
 * picked up the next morning) are ignored so the duration reflects real work.
 */
function activeDurationMs(timestamps: RecordTimestamp[]): number {
  if (timestamps.length === 0) return 0;
  const sorted = [...timestamps]
    .map((entry) => entry.ms)
    .sort((left, right) => left - right);
  let total = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index] - sorted[index - 1];
    if (gap > 0 && gap <= IDLE_GAP_MS) {
      total += gap;
    }
  }
  return total;
}

async function directoryAvailable(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

interface FileCandidate {
  path: string;
}

/** Recursive walk mirroring the local-usage scanner's `opendir` traversal. */
async function collectJsonlFiles(
  roots: string[],
  matches: (relativePath: string, name: string) => boolean,
  signal?: AbortSignal,
): Promise<FileCandidate[]> {
  const files: FileCandidate[] = [];
  const seen = new Set<string>();
  let discoveredEntries = 0;

  for (const root of roots) {
    signal?.throwIfAborted();
    if (!(await directoryAvailable(root))) continue;
    const pending = [root];
    while (pending.length > 0 && discoveredEntries < MAX_DIRECTORY_ENTRIES) {
      signal?.throwIfAborted();
      const directoryPath = pending.pop();
      if (directoryPath == null) break;
      let directory;
      try {
        directory = await opendir(directoryPath);
      } catch {
        continue;
      }
      for await (const entry of directory) {
        signal?.throwIfAborted();
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
          if (files.length >= MAX_FILES_PER_SOURCE) return files;
        }
      }
    }
  }
  return files;
}

async function readFileSize(path: string): Promise<number> {
  try {
    const info = await stat(path);
    return info.size;
  } catch {
    return -1;
  }
}

/** Streaming JSONL reader; stops early once `MAX_RECORDS_PER_FILE` is hit. */
async function readJsonLines(
  filePath: string,
  onRecord: (record: JsonObject) => void,
): Promise<void> {
  const size = await readFileSize(filePath);
  if (size > MAX_FILE_BYTES) return;

  let records = 0;
  const input = createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 64 * 1024,
  });
  const lines = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      if (records >= MAX_RECORDS_PER_FILE) break;
      if (line.length === 0 || line.length > MAX_JSONL_LINE_LENGTH) continue;
      try {
        const record = asObject(JSON.parse(line));
        if (record != null) {
          records += 1;
          onRecord(record);
        }
      } catch {
        // Skip malformed line — privacy-safe and non-fatal.
      }
    }
  } catch {
    // Read failure is non-fatal; we keep whatever was collected.
  } finally {
    lines.close();
    input.destroy();
  }
}

function createEmptyFragment(
  source: SessionSource,
  sessionId: string,
): SessionFragment {
  return {
    source,
    sessionId,
    title: "",
    fallbackTitle: "",
    fallbackTitleAt: null,
    model: null,
    projectRef: null,
    timestamps: [],
    firstUserAt: null,
    totals: emptyTokenCounts(),
    turns: 0,
    editTurns: 0,
    subagentCalls: 0,
    terminalStatus: null,
  };
}

const FALLBACK_TITLE_MAX_LENGTH = 120;

/**
 * Reduce user-authored content to a short, display-safe fallback title.
 * Paths, links and likely credentials are redacted before the text leaves the
 * JSONL callback; no prompt body is added to SessionRecord.
 */
function safeFallbackTitle(content: unknown): string | undefined {
  const parts =
    typeof content === "string"
      ? [content]
      : asArray(content).flatMap((item) => {
          const block = asObject(item);
          const blockType = stringValue(block?.type);
          return (blockType === "text" || blockType === "input_text") &&
            typeof block?.text === "string"
            ? [block.text]
            : [];
        });
  if (parts.length === 0) return undefined;

  const normalized = parts
    .join(" ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/```[A-Za-z0-9_-]*|```|`/gu, " ")
    .replace(/https?:\/\/\S+/giu, "[link]")
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/gu, "[path]")
    .replace(/(?:^|\s)\/(?:[^\s/]+\/)*[^\s"'<>]*/gu, " [path]")
    .replace(
      /\b(?:bearer\s+\S+|(?:api[_-]?key|token|password|secret|authorization)\s*[:=]?\s*\S*)/giu,
      "[sensitive]",
    )
    .replace(/^\s*(?:#{1,6}|[-*+]>?)\s*/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length === 0) return undefined;
  return Array.from(normalized).slice(0, FALLBACK_TITLE_MAX_LENGTH).join("");
}

function claudeFallbackTitle(
  record: JsonObject,
  message: JsonObject | undefined,
): string | undefined {
  const recordType = stringValue(record.type)?.toLowerCase();
  const role = stringValue(message?.role)?.toLowerCase();
  if (recordType !== "user" && role !== "user") return undefined;
  if (
    record.isMeta === true ||
    record.is_meta === true ||
    message?.isMeta === true ||
    message?.is_meta === true
  ) {
    return undefined;
  }
  return safeFallbackTitle(message?.content);
}

// --------------------------------------------------------------------------
// Claude Code — ~/.claude/projects/<dash-encoded-cwd>/*.jsonl
//
// A file is a session only if at least one line carries a `sessionId`. Files
// like journal.jsonl / skill-injections.jsonl lack sessionId and are ignored.
// Multiple files may share a sessionId (resume/subagent sidechains) → merge.

async function scanClaudeCodeSessions(
  claudeDirectory: string,
  signal?: AbortSignal,
): Promise<SessionRecord[]> {
  const projectsRoot = join(claudeDirectory, "projects");
  const files = await collectJsonlFiles([projectsRoot], () => true, signal);
  const fragments = new Map<string, SessionFragment>();
  const usageByMessage = new Map<
    string,
    {
      sessionId: string;
      timestamp: RecordTimestamp;
      tokens: SessionTokenCounts;
    }
  >();
  const assistantMessages = new Set<string>();

  for (const file of files) {
    signal?.throwIfAborted();
    let sawSessionId = false;
    let sawUsefulRecord = false;
    const local: {
      sessionId?: string;
      title?: string;
      fallbackTitle?: string;
      model?: string;
      cwd?: string;
      timestamp?: RecordTimestamp;
      tokens?: SessionTokenCounts;
      messageId?: string;
      isAssistant?: boolean;
      isEditTurn?: boolean;
      subagent?: boolean;
      terminalStatus?: ExplicitTerminalStatus;
    }[] = [];

    await readJsonLines(file.path, (record) => {
      const recordType = stringValue(record.type);
      if (
        recordType !== "permission-mode" &&
        recordType !== "file-history-snapshot" &&
        recordType !== "last-prompt"
      ) {
        sawUsefulRecord = true;
      }
      const terminalStatus = explicitTerminalStatus(record);
      // Title from the agent-authored ai-title record.
      if (recordType === "ai-title") {
        const aiTitle = stringValue(record.aiTitle);
        if (aiTitle != null) {
          local.push({ title: aiTitle, terminalStatus });
        }
        return;
      }
      // Current Claude Code persists user/auto titles as custom-title records
      // carrying the title in `customTitle` (ai-title records are legacy).
      if (recordType === "custom-title") {
        const customTitle = stringValue(record.customTitle);
        const sessionId = stringValue(
          record.sessionId ?? record.session_id ?? record.conversationId,
        );
        if (sessionId != null) sawSessionId = true;
        if (customTitle != null) {
          local.push({ title: customTitle, terminalStatus });
        }
        return;
      }

      const sessionId = stringValue(
        record.sessionId ?? record.session_id ?? record.conversationId,
      );
      if (sessionId != null) sawSessionId = true;

      const message = asObject(record.message);
      const messageId = stringValue(message?.id);
      const usage = asObject(message?.usage);
      const model = stringValue(message?.model);
      const isAssistant =
        stringValue(message?.role) === "assistant" ||
        stringValue(record.type) === "assistant" ||
        recordType === "assistant";
      const timestamp = parseTimestampValue(
        record.timestamp ?? message?.timestamp,
      );
      const cwd = stringValue(record.cwd) ?? stringValue(record.project);
      const fallbackTitle = claudeFallbackTitle(record, message);

      // Token usage lives on assistant lines (per local-usage/scanner convention).
      let tokens: SessionTokenCounts | undefined;
      if (isAssistant && usage != null) {
        const inputTokens = tokenValue(usage.input_tokens);
        const outputTokens = tokenValue(usage.output_tokens);
        const cachedInputTokens = tokenValue(usage.cache_read_input_tokens);
        const cacheCreationInputTokens = tokenValue(
          usage.cache_creation_input_tokens,
        );
        const reasoningOutputTokens = tokenValue(usage.reasoning_output_tokens);
        const totalTokens =
          inputTokens +
          outputTokens +
          cachedInputTokens +
          cacheCreationInputTokens;
        if (totalTokens > 0) {
          tokens = {
            inputTokens,
            outputTokens,
            cachedInputTokens,
            cacheCreationInputTokens,
            reasoningOutputTokens,
            totalTokens,
          };
        }
      }

      // Tool-use heuristics — only metadata (tool name), never the tool input.
      const toolCalls = asArray(message?.content).filter(
        (item) => asObject(item)?.type === "tool_use",
      );
      const isEditTurn = toolCalls.some((call) => {
        const name = stringValue(asObject(call)?.name) ?? "";
        return (
          name.toLowerCase().includes("edit") ||
          name.toLowerCase().includes("write") ||
          name.toLowerCase().includes("str_replace") ||
          name.toLowerCase().includes("replace") ||
          name.toLowerCase().includes("apply_patch")
        );
      });
      const subagent = toolCalls.some((call) => {
        const name = stringValue(asObject(call)?.name) ?? "";
        const lower = name.toLowerCase();
        return (
          lower.includes("task") ||
          lower.includes("subagent") ||
          lower.includes("agent")
        );
      });

      // turns = number of assistant turns (≈ user turns that got a reply).
      // (the per-record user-turn marker is not needed for this count.)

      local.push({
        sessionId,
        fallbackTitle,
        model:
          model != null && !SYNTHETIC_MODEL_TOKENS.has(model)
            ? model
            : undefined,
        cwd,
        timestamp,
        tokens,
        messageId,
        isAssistant,
        isEditTurn: isEditTurn || undefined,
        subagent: subagent || undefined,
        terminalStatus,
      });
    });

    if (!sawSessionId || !sawUsefulRecord) continue;

    // Resolve the file-level sessionId (first non-empty observed).
    const fileSessionId = local
      .map((entry) => entry.sessionId)
      .find((value): value is string => value != null);
    if (fileSessionId == null) continue;

    const fragment =
      fragments.get(fileSessionId) ??
      createEmptyFragment("claude-code", fileSessionId);

    let assistantSeen = 0;
    for (const entry of local) {
      if (entry.title != null && fragment.title === "") {
        fragment.title = entry.title;
      }
      if (
        entry.fallbackTitle != null &&
        (fragment.fallbackTitle === "" ||
          (entry.timestamp != null &&
            fragment.fallbackTitleAt != null &&
            entry.timestamp.ms < fragment.fallbackTitleAt))
      ) {
        fragment.fallbackTitle = entry.fallbackTitle;
        fragment.fallbackTitleAt = entry.timestamp?.ms ?? null;
      }
      if (entry.model != null) {
        fragment.model = entry.model; // last real model wins
      }
      if (entry.cwd != null && fragment.projectRef == null) {
        fragment.projectRef = entry.cwd;
      }
      if (entry.timestamp != null) {
        fragment.timestamps.push(entry.timestamp);
      }
      if (entry.tokens != null) {
        if (entry.messageId == null || entry.timestamp == null) {
          // Preserve legacy records that predate message ids. Current Claude
          // records are deduplicated below using the same identity as usage.
          addTokenCounts(fragment.totals, entry.tokens);
        } else {
          const identity = `${fileSessionId}:${entry.messageId}`;
          const existing = usageByMessage.get(identity);
          if (
            existing == null ||
            entry.tokens.totalTokens > existing.tokens.totalTokens ||
            (entry.tokens.totalTokens === existing.tokens.totalTokens &&
              entry.timestamp.ms > existing.timestamp.ms)
          ) {
            usageByMessage.set(identity, {
              sessionId: fileSessionId,
              timestamp: entry.timestamp,
              tokens: entry.tokens,
            });
          }
        }
      }
      const assistantIdentity =
        entry.messageId == null ? null : `${fileSessionId}:${entry.messageId}`;
      const firstAssistantObservation =
        assistantIdentity == null || !assistantMessages.has(assistantIdentity);
      if (assistantIdentity != null) assistantMessages.add(assistantIdentity);
      if (entry.isAssistant && firstAssistantObservation) {
        assistantSeen += 1;
      }
      if (entry.subagent && firstAssistantObservation) {
        fragment.subagentCalls += 1;
      }
      if (entry.isEditTurn && firstAssistantObservation) {
        fragment.editTurns += 1;
      }
      fragment.terminalStatus = mergeTerminalStatus(
        fragment.terminalStatus,
        entry.terminalStatus,
      );
    }
    // turns = number of assistant turns (≈ user turns that got a reply).
    fragment.turns += assistantSeen;

    fragments.set(fileSessionId, fragment);
  }

  for (const usage of usageByMessage.values()) {
    const fragment = fragments.get(usage.sessionId);
    if (fragment != null) addTokenCounts(fragment.totals, usage.tokens);
  }

  return Promise.all(
    [...fragments.values()].map((fragment) => fragmentToRecord(fragment)),
  );
}

// --------------------------------------------------------------------------
// Codex — ~/.codex/sessions/**/rollout-*.jsonl + ~/.codex/archived_sessions/
// Titles come from ~/.codex/session_index.jsonl (memoized by file mtime).

const CODEX_ROLLOUT_PATTERN = /rollout-.+\.jsonl$/;
const UUID_LIKE_PATTERN =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function readCodexSessionIndex(
  codexDirectory: string,
  cache: Map<string, { mtimeMs: number; titles: Map<string, string> }>,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  signal?.throwIfAborted();
  const indexPath = join(codexDirectory, "session_index.jsonl");
  const info = await stat(indexPath).catch(() => undefined);
  if (info == null) return new Map();
  const cached = cache.get(indexPath);
  if (cached != null && cached.mtimeMs === info.mtimeMs) {
    return cached.titles;
  }
  const titles = new Map<string, string>();
  await readJsonLines(indexPath, (record) => {
    const id = stringValue(record.id);
    const threadName = stringValue(record.thread_name);
    if (id != null && threadName != null) {
      titles.set(id, threadName);
    }
  });
  cache.set(indexPath, { mtimeMs: info.mtimeMs, titles });
  return titles;
}

function codexSessionIdFromFilename(name: string): string | undefined {
  const match = name.match(UUID_LIKE_PATTERN);
  return match != null ? match[0] : undefined;
}

// Codex injects a synthetic first "user" turn — an environment/plugin
// preamble, not the user's request. Letting it win the fallback title produces
// garbage like "/path 2026-08-20 Asia/Shanghai /path :root /path". These tags
// are noise, so blocks starting with one are dropped; `<user_request>` /
// `<user_command>` deliberately aren't in the set because Codex can wrap the
// user's real prompt in them.
const CODEX_SYNTHETIC_PREAMBLE_RE =
  /^(?:<(?:environment_context|recommended_plugins|custom_tool_instruction|user_instructions)\b|#\s*AGENTS\.md instructions for\b)/iu;

/** Keep only the user-authored blocks of a Codex user message. */
function authoredCodexBlocks(content: unknown): unknown {
  if (typeof content === "string") {
    return CODEX_SYNTHETIC_PREAMBLE_RE.test(content.trimStart()) ? "" : content;
  }
  return asArray(content).filter((item) => {
    const block = asObject(item);
    if (
      block == null ||
      (stringValue(block.type) !== "text" &&
        stringValue(block.type) !== "input_text") ||
      typeof block.text !== "string"
    ) {
      return false;
    }
    return !CODEX_SYNTHETIC_PREAMBLE_RE.test(block.text.trimStart());
  });
}

/** Current Codex records may put the message directly in payload or nest it. */
function codexFallbackTitle(
  payload: JsonObject | undefined,
): string | undefined {
  if (payload == null) return undefined;
  const candidates = [
    asObject(payload.item),
    asObject(payload.response_item),
    asObject(payload.message),
    payload,
  ];
  for (const candidate of candidates) {
    if (candidate == null || stringValue(candidate.role) !== "user") continue;
    const title = safeFallbackTitle(authoredCodexBlocks(candidate.content));
    if (title != null) return title;
  }
  return undefined;
}

async function scanCodexSessions(
  codexDirectory: string,
  signal?: AbortSignal,
): Promise<SessionRecord[]> {
  const sessionsRoot = join(codexDirectory, "sessions");
  const archivedRoot = join(codexDirectory, "archived_sessions");
  const indexCache = new Map<
    string,
    { mtimeMs: number; titles: Map<string, string> }
  >();
  const titles = await readCodexSessionIndex(
    codexDirectory,
    indexCache,
    signal,
  );

  const files = await collectJsonlFiles(
    [sessionsRoot, archivedRoot],
    (relativePath) => CODEX_ROLLOUT_PATTERN.test(relativePath),
    signal,
  );

  const fragments = new Map<string, SessionFragment>();

  for (const file of files) {
    signal?.throwIfAborted();
    const fileName = basename(file.path);
    const fallbackId = codexSessionIdFromFilename(fileName);
    let resolvedId: string | undefined;

    const context = {
      model: null as string | null,
      cwd: null as string | null,
    };
    // last_token_usage from the previous turn, used to delta total_token_usage.
    let previousTotalUsage: JsonObject | undefined;
    // Track which turns carried an edit tool (best-effort).
    let pendingEditTurn = false;

    // Codex auto-spawns guardian/approval-review subagent threads
    // (thread_source: "subagent"). Their rollout is an internal side-chain
    // whose first "user" turn is injected AGENTS.md / environment preamble,
    // not a real user conversation — such files are skipped below.
    let isSubagentThread = false;
    const perFileTotals = emptyTokenCounts();
    const timestamps: RecordTimestamp[] = [];
    let assistantTurns = 0;
    let editTurns = 0;
    let subagentCalls = 0;
    let terminalStatus: ExplicitTerminalStatus | undefined;
    let fallbackTitle = "";
    let fallbackTitleAt: number | null = null;

    await readJsonLines(file.path, (record) => {
      const recordType = stringValue(record.type);
      const payload = asObject(record.payload);
      const payloadType = stringValue(payload?.type);
      const candidateTitle = codexFallbackTitle(payload);
      const candidateTimestamp = parseTimestampValue(record.timestamp);
      if (
        candidateTitle != null &&
        (fallbackTitle === "" ||
          (candidateTimestamp != null &&
            fallbackTitleAt != null &&
            candidateTimestamp.ms < fallbackTitleAt))
      ) {
        fallbackTitle = candidateTitle;
        fallbackTitleAt = candidateTimestamp?.ms ?? null;
      }
      terminalStatus =
        mergeTerminalStatus(
          terminalStatus ?? null,
          explicitTerminalStatus(record, payload),
        ) ?? undefined;

      // session_meta carries the authoritative id and (sometimes) cwd.
      if (recordType === "session_meta" || payloadType === "session_meta") {
        // Current Codex envelopes carry the kind on record.type and omit
        // payload.type. The payload is still the authoritative metadata body.
        const metaPayload: JsonObject = payload ?? record;
        const id = stringValue(
          metaPayload.id ?? metaPayload.sessionId ?? metaPayload.session_id,
        );
        if (id != null) resolvedId = id;
        const cwd = stringValue(metaPayload.cwd);
        if (cwd != null) context.cwd = cwd;
        if (stringValue(metaPayload.thread_source) === "subagent") {
          isSubagentThread = true;
        }
        return;
      }

      // turn_context carries model + cwd (NOT model_provider — that's provenance).
      if (recordType === "turn_context" || payloadType === "turn_context") {
        const ctxPayload: JsonObject = payload ?? record;
        const model = stringValue(ctxPayload.model);
        if (model != null) context.model = model;
        const cwd = stringValue(ctxPayload.cwd);
        if (cwd != null) context.cwd = cwd;
        pendingEditTurn = false;
        return;
      }

      // Look for tool-execution metadata to flag edit turns (name only).
      const item = asObject(payload?.item) ?? asObject(payload?.response_item);
      const itemType = stringValue(item?.type);
      const callType = itemType ?? payloadType ?? recordType;
      if (callType === "patch_apply_end") {
        pendingEditTurn = true;
        return;
      }
      if (callType === "function_call" || callType === "custom_tool_call") {
        const callPayload: JsonObject = item ?? payload ?? record;
        const name = (
          stringValue(callPayload.name) ??
          stringValue(asObject(callPayload.msg)?.name) ??
          ""
        ).toLowerCase();
        if (
          name.includes("edit") ||
          name.includes("write") ||
          name.includes("str_replace") ||
          name.includes("replace") ||
          name.includes("apply_patch") ||
          name.includes("shell")
        ) {
          pendingEditTurn = true;
        }
        if (name.includes("task") || name.includes("subagent")) {
          subagentCalls += 1;
        }
        return;
      }

      // token_count records carry the usage for this turn.
      const tokenSource =
        payloadType === "token_count"
          ? payload
          : payload != null &&
              stringValue(asObject(payload.msg)?.type) === "token_count"
            ? asObject(payload.msg)
            : undefined;
      if (tokenSource == null) {
        const ts = parseTimestampValue(record.timestamp);
        if (ts != null) timestamps.push(ts);
        return;
      }
      const info = asObject(tokenSource.info);
      const totalUsage = asObject(info?.total_token_usage);
      const lastUsage = asObject(info?.last_token_usage);

      // Prefer deltas of total_token_usage (matches local-usage codex path);
      // fall back to last_token_usage when totals are unavailable.
      let usage: JsonObject | undefined = lastUsage;
      if (totalUsage != null && previousTotalUsage != null) {
        const delta: JsonObject = {};
        for (const key of [
          "input_tokens",
          "cached_input_tokens",
          "cache_creation_input_tokens",
          "cache_write_input_tokens",
          "output_tokens",
          "reasoning_output_tokens",
        ]) {
          delta[key] = Math.max(
            0,
            tokenValue(totalUsage[key]) - tokenValue(previousTotalUsage[key]),
          );
        }
        usage = delta;
      }
      if (totalUsage != null) previousTotalUsage = totalUsage;

      const ts = parseTimestampValue(record.timestamp ?? tokenSource.timestamp);
      if (ts != null) timestamps.push(ts);

      if (usage != null) {
        // Codex raw input_tokens already includes cached — subtract for display.
        const cachedInputTokens = tokenValue(usage.cached_input_tokens);
        const rawInputTokens = tokenValue(usage.input_tokens);
        const inputTokens = Math.max(0, rawInputTokens - cachedInputTokens);
        const cacheCreationInputTokens =
          tokenValue(usage.cache_creation_input_tokens) +
          tokenValue(usage.cache_write_input_tokens);
        const outputTokens = tokenValue(usage.output_tokens);
        const reasoningOutputTokens = tokenValue(usage.reasoning_output_tokens);
        const totalTokens =
          inputTokens +
          outputTokens +
          cachedInputTokens +
          cacheCreationInputTokens;
        if (totalTokens > 0) {
          perFileTotals.inputTokens += inputTokens;
          perFileTotals.outputTokens += outputTokens;
          perFileTotals.cachedInputTokens += cachedInputTokens;
          perFileTotals.cacheCreationInputTokens += cacheCreationInputTokens;
          perFileTotals.reasoningOutputTokens += reasoningOutputTokens;
          perFileTotals.totalTokens += totalTokens;
        }
      }

      assistantTurns += 1;
      if (pendingEditTurn) {
        editTurns += 1;
        pendingEditTurn = false;
      }
    });

    // Internal subagent side-chains never become user-facing sessions.
    if (isSubagentThread) continue;

    const sessionId = resolvedId ?? fallbackId;
    if (sessionId == null) continue;

    const fragment =
      fragments.get(sessionId) ?? createEmptyFragment("codex", sessionId);
    fragment.model = context.model ?? fragment.model;
    fragment.projectRef = context.cwd ?? fragment.projectRef;
    if (fragment.title === "") {
      const title = titles.get(sessionId);
      if (title != null) fragment.title = title;
    }
    if (
      fallbackTitle !== "" &&
      (fragment.fallbackTitle === "" ||
        (fallbackTitleAt != null &&
          fragment.fallbackTitleAt != null &&
          fallbackTitleAt < fragment.fallbackTitleAt))
    ) {
      fragment.fallbackTitle = fallbackTitle;
      fragment.fallbackTitleAt = fallbackTitleAt;
    }
    fragment.timestamps.push(...timestamps);
    addTokenCounts(fragment.totals, perFileTotals);
    fragment.turns += assistantTurns;
    fragment.editTurns += editTurns;
    fragment.subagentCalls += subagentCalls;
    fragment.terminalStatus = mergeTerminalStatus(
      fragment.terminalStatus,
      terminalStatus,
    );
    fragments.set(sessionId, fragment);
  }

  return Promise.all(
    [...fragments.values()].map((fragment) => fragmentToRecord(fragment)),
  );
}

// --------------------------------------------------------------------------
// Grok (Grok Build) — ~/.grok/sessions/<url-encoded-cwd>/<uuid>/updates.jsonl
// + sibling summary.json / signals.json.

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

async function collectGrokSessionDirectories(
  sessionsRoot: string,
  signal?: AbortSignal,
): Promise<string[]> {
  if (!(await directoryAvailable(sessionsRoot))) return [];
  const sessionDirectories: string[] = [];
  let discoveredEntries = 0;

  const pending = [sessionsRoot];
  while (pending.length > 0 && discoveredEntries < MAX_DIRECTORY_ENTRIES) {
    signal?.throwIfAborted();
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
      signal?.throwIfAborted();
      discoveredEntries += 1;
      if (discoveredEntries >= MAX_DIRECTORY_ENTRIES) break;
      if (entry.name === "updates.jsonl") hasUpdatesJsonl = true;
      if (entry.isDirectory()) {
        subdirectories.push(join(directoryPath, entry.name));
      }
    }
    if (hasUpdatesJsonl) {
      sessionDirectories.push(directoryPath);
      continue; // do not descend further — this IS a session directory
    }
    pending.push(...subdirectories);
  }
  return sessionDirectories;
}

async function scanGrokSessions(
  grokDirectory: string,
  signal?: AbortSignal,
): Promise<SessionRecord[]> {
  const sessionsRoot = join(grokDirectory, "sessions");
  const sessionDirectories = await collectGrokSessionDirectories(
    sessionsRoot,
    signal,
  );

  const fragments = new Map<string, SessionFragment>();

  for (const sessionDirectory of sessionDirectories) {
    signal?.throwIfAborted();
    const summary = asObject(
      await readJsonFile<unknown>(join(sessionDirectory, "summary.json")),
    );
    const signals = asObject(
      await readJsonFile<unknown>(join(sessionDirectory, "signals.json")),
    );
    const summaryInfo = asObject(summary?.info);

    const explicitId = stringValue(
      summaryInfo?.id ?? summary?.id ?? signals?.sessionId,
    );
    const directoryNameId = basename(sessionDirectory);
    const updatesPath = join(sessionDirectory, "updates.jsonl");

    let resolvedId: string | undefined = explicitId ?? directoryNameId;
    const context = {
      model:
        stringValue(signals?.primaryModelId) ??
        stringValue(summary?.current_model_id) ??
        null,
      cwd: stringValue(summaryInfo?.cwd) ?? null,
    };
    let title =
      stringValue(summary?.generated_title) ??
      stringValue(summary?.session_summary) ??
      "";

    const timestamps: RecordTimestamp[] = [];
    const perFileTotals = emptyTokenCounts();
    let assistantTurns = 0;
    let editTurns = 0;
    let subagentCalls = 0;
    let pendingEditTurn = false;
    let terminalStatus: ExplicitTerminalStatus | undefined;
    const seenCompletedEvents = new Set<string>();

    await readJsonLines(updatesPath, (record) => {
      const recordType = stringValue(record.type);
      const params = asObject(record.params);
      const meta = asObject(params?._meta);
      const update = asObject(params?.update);
      const sessionUpdate = stringValue(update?.sessionUpdate) ?? recordType;
      terminalStatus =
        mergeTerminalStatus(
          terminalStatus ?? null,
          explicitTerminalStatus(record, params, meta),
        ) ?? undefined;

      // sessionId fallback: params.sessionId inside updates.jsonl.
      if (resolvedId == null) {
        const candidate = stringValue(params?.sessionId);
        if (candidate != null) resolvedId = candidate;
      }

      const envelopeTimestamp = parseTimestampValue(record.timestamp);
      const agentTimestamp = parseTimestampValue(meta?.agentTimestampMs);
      const timestamp = agentTimestamp ?? envelopeTimestamp;
      if (timestamp != null) timestamps.push(timestamp);

      if (sessionUpdate === "turn_completed") {
        const eventId = stringValue(meta?.eventId);
        if (eventId != null && seenCompletedEvents.has(eventId)) return;
        if (eventId != null) seenCompletedEvents.add(eventId);
        const usage = asObject(update?.usage) ?? asObject(record.usage);
        const keyedModelUsage = asObject(usage?.modelUsage);
        const legacyModelUsage = asArray(usage?.modelUsage);
        const modelUsage = keyedModelUsage
          ? Object.entries(keyedModelUsage).map(([modelId, value]) => ({
              modelId,
              usage: asObject(value),
            }))
          : legacyModelUsage.map((value) => {
              const item = asObject(value);
              return {
                modelId: stringValue(item?.modelId) ?? stringValue(item?.model),
                usage: item,
              };
            });
        let turnModel: string | null = null;
        for (const entry of modelUsage) {
          const item = entry.usage;
          if (item == null) continue;
          const modelId = entry.modelId;
          if (modelId != null) turnModel = modelId;
          const rawInputTokens = tokenValue(
            item.inputTokens ?? item.input_tokens,
          );
          const outputTokens = tokenValue(
            item.outputTokens ?? item.output_tokens,
          );
          const cacheReadTokens = tokenValue(
            item.cachedReadTokens ??
              item.cacheReadTokens ??
              item.cache_read_input_tokens,
          );
          const cachedInputTokens =
            cacheReadTokens ||
            tokenValue(item.cachedInputTokens ?? item.cached_input_tokens);
          const inputTokens = Math.max(0, rawInputTokens - cacheReadTokens);
          const cacheCreationInputTokens = tokenValue(
            item.cachedWriteTokens ??
              item.cacheWriteTokens ??
              item.cacheCreationInputTokens ??
              item.cache_creation_input_tokens,
          );
          const reasoningOutputTokens = tokenValue(
            item.reasoningTokens ??
              item.reasoningOutputTokens ??
              item.reasoning_output_tokens,
          );
          const componentTotal =
            inputTokens +
            outputTokens +
            cachedInputTokens +
            cacheCreationInputTokens;
          const totalTokens =
            tokenValue(item.totalTokens ?? item.total_tokens) || componentTotal;
          if (totalTokens > 0) {
            perFileTotals.inputTokens += inputTokens;
            perFileTotals.outputTokens += outputTokens;
            perFileTotals.cachedInputTokens += cachedInputTokens;
            perFileTotals.cacheCreationInputTokens += cacheCreationInputTokens;
            perFileTotals.reasoningOutputTokens += reasoningOutputTokens;
            perFileTotals.totalTokens += totalTokens;
          }
        }
        if (turnModel != null) context.model = turnModel;
        assistantTurns += 1;
        if (pendingEditTurn) {
          editTurns += 1;
          pendingEditTurn = false;
        }
        return;
      }

      // Tool-call records — only the name is inspected, never the input.
      if (
        sessionUpdate === "tool_call" ||
        sessionUpdate === "function_call" ||
        sessionUpdate === "tool_use"
      ) {
        const name = (
          stringValue(asObject(meta?.["x.ai/tool"])?.name) ??
          stringValue(update?.title) ??
          stringValue(update?.name) ??
          stringValue(record.name) ??
          stringValue(asObject(record.tool)?.name) ??
          ""
        ).toLowerCase();
        if (
          name.includes("edit") ||
          name.includes("write") ||
          name.includes("replace") ||
          name.includes("apply_patch")
        ) {
          pendingEditTurn = true;
        }
        if (name.includes("task") || name.includes("subagent")) {
          subagentCalls += 1;
        }
      }
    });

    if (resolvedId == null) continue;

    const fragment =
      fragments.get(resolvedId) ?? createEmptyFragment("grok", resolvedId);
    fragment.model = context.model ?? fragment.model;
    fragment.projectRef = context.cwd ?? fragment.projectRef;
    if (fragment.title === "" && title !== "") fragment.title = title;
    title = ""; // only the first observed title wins
    fragment.timestamps.push(...timestamps);
    addTokenCounts(fragment.totals, perFileTotals);
    fragment.turns += assistantTurns;
    fragment.editTurns += editTurns;
    fragment.subagentCalls += subagentCalls;
    fragment.terminalStatus = mergeTerminalStatus(
      fragment.terminalStatus,
      terminalStatus,
    );
    fragments.set(resolvedId, fragment);
  }

  return Promise.all(
    [...fragments.values()].map((fragment) => fragmentToRecord(fragment)),
  );
}

// --------------------------------------------------------------------------
// DeepSeek Harness (DSH) — ~/.dsh/sessions/<workspace>/<session-id>/
// One session is a directory holding `session.jsonl` (compression "none") or
// `session.jsonl.zstd` (concatenated zstd frames). The first record is the
// session header (id/cwd/createdAt); `assistant/message` records carry the
// per-step usage, `tool/call` records carry tool names (metadata only), and
// `turn/start` marks each user turn. Physical decoding is shared with the
// usage chain via the shared zstd decoder; only metadata is extracted here.
//
// turns = `turn/start` records (a DSH "step" is one model round inside a
// turn, so steps are intentionally not counted as turns). editTurns /
// subagentCalls are best-effort from `tool/call` names, never tool arguments.

function isDshEditTool(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("todo")) return false;
  return (
    lower.includes("edit") ||
    lower.includes("write") ||
    lower.includes("str_replace") ||
    lower.includes("replace") ||
    lower.includes("apply_patch")
  );
}

function isDshSubagentTool(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("subagent") ||
    lower.includes("agent") ||
    lower.includes("task")
  );
}

/* DSH session files live at ~/.dsh/sessions/<workspace>/<session-id>/, named session.jsonl or session.jsonl.zstd. */
async function collectDshSessionFiles(
  sessionsRoot: string,
  signal?: AbortSignal,
): Promise<FileCandidate[]> {
  const files: FileCandidate[] = [];
  if (!(await directoryAvailable(sessionsRoot))) return files;
  const seen = new Set<string>();
  let discoveredEntries = 0;
  const pending = [sessionsRoot];
  while (pending.length > 0 && discoveredEntries < MAX_DIRECTORY_ENTRIES) {
    signal?.throwIfAborted();
    const directoryPath = pending.pop();
    if (directoryPath == null) break;
    let directory;
    try {
      directory = await opendir(directoryPath);
    } catch {
      continue;
    }
    for await (const entry of directory) {
      signal?.throwIfAborted();
      discoveredEntries += 1;
      if (discoveredEntries >= MAX_DIRECTORY_ENTRIES) break;
      const entryPath = join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (
        entry.name !== "session.jsonl" &&
        entry.name !== "session.jsonl.zstd"
      ) {
        continue;
      }
      if (!seen.has(entryPath)) {
        seen.add(entryPath);
        files.push({ path: entryPath });
        if (files.length >= MAX_FILES_PER_SOURCE) return files;
      }
    }
  }
  // A session dir holds one container; prefer zstd when both forms exist.
  const byDirectory = new Map<string, string>();
  for (const file of files) {
    const directory = dirname(file.path);
    const existing = byDirectory.get(directory);
    if (
      existing == null ||
      (!existing.endsWith(".zstd") && file.path.endsWith(".zstd"))
    ) {
      byDirectory.set(directory, file.path);
    }
  }
  return [...byDirectory.values()].map((path) => ({ path }));
}

// ---------------------------------------------------------------------------
// DSH per-file metadata cache.
//
// DSH persists every agent session as a CONCATENATED zstd container with one
// tiny frame per append batch, so a single session log can hold tens of
// thousands of frames and decoding every session on every periodic refresh
// costs minutes of main-thread CPU. Session metadata of an unchanged file can
// never change, so the reader keeps an in-process per-scan-root cache of the
// metadata extracted per file, keyed by (size, mtime, ctime) plus a prefix
// hash. Unchanged files are replayed from the cache without touching the log;
// files that only GREW (active sessions) are decoded from the last parsed
// frame boundary onward and merged into the cached aggregate; files that were
// rewritten (compaction) or are new are decoded in full. Only metadata is
// retained — never conversation text. Entries are written through per file,
// so an aborted cold scan still converges on the next attempt.
// ---------------------------------------------------------------------------

/** Bump when DSH per-file parse semantics change (invalidates cached entries). */
const DSH_SESSION_PARSE_VERSION = 1;

interface DshFileStamp {
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

/**
 * Raw per-file aggregate produced by the DSH record reducer. Keeping the
 * uncounted inputs (turn starts, key sets, assistant messages) lets appended
 * tail records merge into the aggregate and derive the same per-file summary
 * a from-scratch parse of the whole log would produce.
 */
interface DshRawAggregate {
  /** Header id; resolved to the session-directory name once parsing completes. */
  sessionId: string | null;
  title: string;
  model: string | null;
  projectRef: string | null;
  /** Epoch ms only; the display ISO is re-derived at merge time. */
  timestampsMs: number[];
  totals: SessionTokenCounts;
  turnStarts: number;
  assistantMessages: number;
  observedTurnKeys: Set<string>;
  editTurnKeys: Set<string>;
  unattributedEditTurns: number;
  subagentCalls: number;
}

/**
 * Per-file summary derived from a raw aggregate — mirrors the per-file
 * aggregation of the uncached parse exactly.
 */
interface DshParsedFile {
  /** Resolved session id: header id, else the session directory name. */
  readonly sessionId: string;
  readonly title: string;
  readonly model: string | null;
  readonly projectRef: string | null;
  readonly timestampsMs: number[];
  readonly totals: SessionTokenCounts;
  readonly turns: number;
  readonly editTurns: number;
  readonly subagentCalls: number;
}

interface DshCacheEntry {
  readonly parseVersion: number;
  readonly stamp: DshFileStamp;
  /** Byte offset of the end of the last fully parsed frame (the prefix). */
  readonly prefixEnd: number;
  /** sha256 hex of bytes [0, prefixEnd) — proves growth was append-only. */
  readonly prefixHash: string;
  /** Whether the decoded prefix text ended at a line boundary ('\n'). */
  readonly endsWithNewline: boolean;
  readonly aggregate: DshRawAggregate;
}

/** dsh sessions root (absolute) -> session log path -> cached metadata. */
const dshScanCache = new Map<string, Map<string, DshCacheEntry>>();

/**
 * Serializable form of the DSH scan cache. Root keys are sha256 hashes of the
 * absolute sessions root and entry keys are ROOT-RELATIVE log paths, so the
 * file never stores an absolute local path. Entries hold metadata only.
 */
export interface DshScanCacheSnapshot {
  readonly version: 1;
  readonly roots: Record<string, Record<string, unknown>>;
}

function serializeDshCacheEntry(entry: DshCacheEntry): unknown {
  return {
    parseVersion: entry.parseVersion,
    stamp: entry.stamp,
    prefixEnd: entry.prefixEnd,
    prefixHash: entry.prefixHash,
    endsWithNewline: entry.endsWithNewline,
    aggregate: {
      ...entry.aggregate,
      observedTurnKeys: [...entry.aggregate.observedTurnKeys].sort(),
      editTurnKeys: [...entry.aggregate.editTurnKeys].sort(),
    },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

function hydratedDshCacheEntry(value: unknown): DshCacheEntry | null {
  try {
    if (!isPlainObject(value)) return null;
    const stamp = value.stamp;
    if (
      !isPlainObject(stamp) ||
      !finiteNumber(stamp.size) ||
      !finiteNumber(stamp.mtimeMs) ||
      !finiteNumber(stamp.ctimeMs)
    ) {
      return null;
    }
    const aggregate = value.aggregate;
    const observed = stringArray(
      isPlainObject(aggregate) ? aggregate.observedTurnKeys : null,
    );
    const edits = stringArray(
      isPlainObject(aggregate) ? aggregate.editTurnKeys : null,
    );
    if (
      !isPlainObject(aggregate) ||
      typeof aggregate.sessionId !== "string" ||
      typeof aggregate.title !== "string" ||
      (aggregate.model != null && typeof aggregate.model !== "string") ||
      (aggregate.projectRef != null &&
        typeof aggregate.projectRef !== "string") ||
      !Array.isArray(aggregate.timestampsMs) ||
      !aggregate.timestampsMs.every(finiteNumber) ||
      !isPlainObject(aggregate.totals) ||
      !Object.values(aggregate.totals).every(finiteNumber) ||
      !finiteNumber(aggregate.turnStarts) ||
      !finiteNumber(aggregate.assistantMessages) ||
      observed == null ||
      edits == null ||
      !finiteNumber(aggregate.unattributedEditTurns) ||
      !finiteNumber(aggregate.subagentCalls)
    ) {
      return null;
    }
    if (
      value.parseVersion !== DSH_SESSION_PARSE_VERSION ||
      !finiteNumber(value.prefixEnd) ||
      typeof value.prefixHash !== "string" ||
      typeof value.endsWithNewline !== "boolean"
    ) {
      return null;
    }
    const parsedAggregate: DshRawAggregate = {
      sessionId: aggregate.sessionId,
      title: aggregate.title,
      model: aggregate.model == null ? null : aggregate.model,
      projectRef: aggregate.projectRef == null ? null : aggregate.projectRef,
      timestampsMs: [...(aggregate.timestampsMs as number[])],
      totals: { ...(aggregate.totals as unknown as SessionTokenCounts) },
      turnStarts: aggregate.turnStarts,
      assistantMessages: aggregate.assistantMessages,
      observedTurnKeys: new Set(observed),
      editTurnKeys: new Set(edits),
      unattributedEditTurns: aggregate.unattributedEditTurns,
      subagentCalls: aggregate.subagentCalls,
    };
    return {
      parseVersion: DSH_SESSION_PARSE_VERSION,
      stamp: {
        size: stamp.size,
        mtimeMs: stamp.mtimeMs,
        ctimeMs: stamp.ctimeMs,
      },
      prefixEnd: value.prefixEnd,
      prefixHash: value.prefixHash,
      endsWithNewline: value.endsWithNewline,
      aggregate: parsedAggregate,
    };
  } catch {
    return null;
  }
}

function hydrateDshScanRoot(
  sessionsRoot: string,
  state: unknown,
): Map<string, DshCacheEntry> {
  const hydrated = new Map<string, DshCacheEntry>();
  if (!isPlainObject(state)) return hydrated;
  if (state.version !== 1 || !isPlainObject(state.roots)) return hydrated;
  const rootEntries = state.roots[sha256Hex(Buffer.from(sessionsRoot, "utf8"))];
  if (!isPlainObject(rootEntries)) return hydrated;
  for (const [relativePath, raw] of Object.entries(rootEntries)) {
    const entry = hydratedDshCacheEntry(raw);
    if (entry == null) continue;
    const absolutePath = join(sessionsRoot, relativePath.split("/").join(sep));
    hydrated.set(absolutePath, entry);
  }
  return hydrated;
}

/**
 * Snapshot of the in-memory DSH scan cache for persistence across processes.
 * Returns null when nothing is cached yet. The caller owns writing this to
 * its own storage; a later process passes it back through
 * `ScanLocalSessionsOptions.dshCacheState`.
 */
export function snapshotDshScanCache(): DshScanCacheSnapshot | null {
  const roots: Record<string, Record<string, unknown>> = {};
  for (const [sessionsRoot, files] of dshScanCache) {
    if (files.size === 0) continue;
    const serialized: Record<string, unknown> = {};
    for (const [absolutePath, entry] of files) {
      serialized[relative(sessionsRoot, absolutePath).split(sep).join("/")] =
        serializeDshCacheEntry(entry);
    }
    roots[sha256Hex(Buffer.from(sessionsRoot, "utf8"))] = serialized;
  }
  if (Object.keys(roots).length === 0) return null;
  return { version: 1, roots };
}

/** Test seam: clears the module-level cache (simulates a fresh process). */
export function __resetDshScanCache(): void {
  dshScanCache.clear();
}

function dshStampsMatch(left: DshFileStamp, right: DshFileStamp): boolean {
  return (
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function emptyDshAggregate(): DshRawAggregate {
  return {
    sessionId: null,
    title: "",
    model: null,
    projectRef: null,
    timestampsMs: [],
    totals: emptyTokenCounts(),
    turnStarts: 0,
    assistantMessages: 0,
    observedTurnKeys: new Set(),
    editTurnKeys: new Set(),
    unattributedEditTurns: 0,
    subagentCalls: 0,
  };
}

function cloneDshAggregate(source: DshRawAggregate): DshRawAggregate {
  return {
    sessionId: source.sessionId,
    title: source.title,
    model: source.model,
    projectRef: source.projectRef,
    timestampsMs: [...source.timestampsMs],
    totals: { ...source.totals },
    turnStarts: source.turnStarts,
    assistantMessages: source.assistantMessages,
    observedTurnKeys: new Set(source.observedTurnKeys),
    editTurnKeys: new Set(source.editTurnKeys),
    unattributedEditTurns: source.unattributedEditTurns,
    subagentCalls: source.subagentCalls,
  };
}

function dshParsedFromAggregate(
  aggregate: DshRawAggregate,
): DshParsedFile | null {
  if (aggregate.sessionId == null || aggregate.sessionId === "") return null;
  return {
    sessionId: aggregate.sessionId,
    title: aggregate.title,
    model: aggregate.model,
    projectRef: aggregate.projectRef,
    timestampsMs: aggregate.timestampsMs,
    totals: aggregate.totals,
    turns:
      aggregate.turnStarts > 0
        ? aggregate.turnStarts
        : aggregate.observedTurnKeys.size > 0
          ? aggregate.observedTurnKeys.size
          : aggregate.assistantMessages,
    editTurns: aggregate.editTurnKeys.size + aggregate.unattributedEditTurns,
    subagentCalls: aggregate.subagentCalls,
  };
}

function sha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Apply the metadata semantics of ONE parsed dsh record to the aggregate.
 * Field handling mirrors the uncached whole-file parse exactly (same guards,
 * same last-wins rules, same token field fallbacks).
 */
function applyDshRecord(aggregate: DshRawAggregate, record: JsonObject): void {
  const recordType = stringValue(record.type);
  const data = asObject(record.data);
  const time = parseTimestampValue(record.time);
  if (time != null) aggregate.timestampsMs.push(time.ms);

  if (recordType === "session") {
    const headerId = stringValue(record.id);
    if (headerId != null) aggregate.sessionId = headerId;
    const cwd = stringValue(record.cwd);
    if (cwd != null) aggregate.projectRef = cwd;
    const createdAt = parseTimestampValue(record.createdAt);
    if (createdAt != null) aggregate.timestampsMs.push(createdAt.ms);
    return;
  }
  if (recordType === "session/title") {
    const sessionTitle = stringValue(data?.title);
    if (sessionTitle != null && aggregate.title === "") {
      aggregate.title = sessionTitle;
    }
    return;
  }
  if (recordType === "request/context") {
    const contextModel = stringValue(data?.model);
    if (contextModel != null) aggregate.model = contextModel;
    return;
  }
  if (recordType === "request/header") {
    const headerModel = stringValue(
      asObject(asObject(data?.header)?.config)?.model,
    );
    if (headerModel != null) aggregate.model = headerModel;
    return;
  }
  if (recordType === "turn/start") {
    aggregate.turnStarts += 1;
    return;
  }
  if (recordType === "assistant/message") {
    aggregate.assistantMessages += 1;
    const turn = data?.turn;
    if (turn !== undefined && turn !== null) {
      aggregate.observedTurnKeys.add(String(turn));
    }
    const usage = asObject(data?.usage);
    if (usage != null) {
      const inputTokens = tokenValue(
        usage.inputTokens ?? usage.uncachedInputTokens,
      );
      const cachedInputTokens = tokenValue(
        usage.cacheReadTokens ?? usage.cachedInputTokens,
      );
      const cacheCreationInputTokens = tokenValue(
        usage.cacheWriteTokens ??
          usage.cacheCreationInputTokens ??
          usage.cache_creation_input_tokens,
      );
      const outputTokens = tokenValue(usage.outputTokens);
      const reasoningOutputTokens = tokenValue(
        usage.reasoningTokens ?? usage.reasoningOutputTokens,
      );
      const totalTokens =
        inputTokens +
        cachedInputTokens +
        cacheCreationInputTokens +
        outputTokens +
        reasoningOutputTokens;
      if (totalTokens > 0) {
        aggregate.totals.inputTokens += inputTokens;
        aggregate.totals.cachedInputTokens += cachedInputTokens;
        aggregate.totals.cacheCreationInputTokens += cacheCreationInputTokens;
        aggregate.totals.outputTokens += outputTokens;
        aggregate.totals.reasoningOutputTokens += reasoningOutputTokens;
        aggregate.totals.totalTokens += totalTokens;
      }
    }
    return;
  }
  if (recordType === "tool/call") {
    const name = stringValue(data?.name) ?? "";
    if (name === "") return;
    if (isDshEditTool(name)) {
      const turn = data?.turn;
      if (turn === undefined || turn === null) {
        aggregate.unattributedEditTurns += 1;
      } else {
        aggregate.editTurnKeys.add(String(turn));
      }
    }
    if (isDshSubagentTool(name)) {
      aggregate.subagentCalls += 1;
    }
    return;
  }
}

/** Parse one JSONL line's record into the aggregate; malformed lines are skipped. */
function applyDshJsonlLine(
  aggregate: DshRawAggregate,
  line: string,
  signal?: AbortSignal,
): void {
  signal?.throwIfAborted();
  if (line.trim().length === 0) return;
  let record: JsonObject;
  try {
    record = asObject(JSON.parse(line)) ?? {};
  } catch {
    return;
  }
  applyDshRecord(aggregate, record);
}

/** Apply every line of an already-decoded text region (whole-file semantics). */
function applyDshJsonlText(
  aggregate: DshRawAggregate,
  text: string,
  signal?: AbortSignal,
): void {
  for (const line of text.split("\n")) {
    applyDshJsonlLine(aggregate, line, signal);
  }
}

/**
 * Apply records from a newly decoded appended text region. The region is only
 * entered when the previously parsed text ended at a line boundary, so every
 * split line is a complete record; torn/partial fragments are skipped exactly
 * like whole-text parsing skips them.
 */
function applyDshAppendedText(
  aggregate: DshRawAggregate,
  text: string,
  signal?: AbortSignal,
): void {
  for (const line of text.split("\n")) {
    applyDshJsonlLine(aggregate, line, signal);
  }
}

/** Full parse of one dsh session log. Returns null for unreadable logs. */
async function parseDshSessionFileFull(
  file: FileCandidate,
  signal?: AbortSignal,
): Promise<{
  aggregate: DshRawAggregate;
  prefixEnd: number;
  endsWithNewline: boolean;
} | null> {
  let buffer: Buffer;
  try {
    buffer = await readFile(file.path);
  } catch {
    return null;
  }
  if (buffer.length > MAX_FILE_BYTES) return null;
  const aggregate = emptyDshAggregate();
  const isZstd =
    buffer.length >= ZSTD_MAGIC_BYTES.length &&
    buffer.subarray(0, ZSTD_MAGIC_BYTES.length).equals(ZSTD_MAGIC_BYTES);
  let prefixEnd = buffer.length;
  let endsWithNewline = false;
  try {
    if (isZstd) {
      const decoded = decodeZstdSessionLogWithBounds(buffer);
      applyDshJsonlText(aggregate, decoded.text, signal);
      prefixEnd = decoded.completeEnd;
      endsWithNewline = decoded.text.endsWith("\n");
    } else {
      const text = buffer.toString("utf8");
      applyDshJsonlText(aggregate, text, signal);
      endsWithNewline = text.endsWith("\n");
    }
  } catch {
    return null;
  }
  const resolvedId = aggregate.sessionId ?? basename(dirname(file.path));
  if (resolvedId === "") return null;
  aggregate.sessionId = resolvedId;
  return { aggregate, prefixEnd, endsWithNewline };
}

/**
 * Per-file parse with cache: unchanged logs are replayed from the cache,
 * appended logs are decoded from the last parsed frame boundary onward, and
 * only new/rewritten logs are decoded in full. Entries are written through
 * immediately so an aborted scan still leaves finished files cached.
 */
async function dshParsedFileFor(
  file: FileCandidate,
  signal: AbortSignal | undefined,
  cache: Map<string, DshCacheEntry>,
): Promise<DshParsedFile | null> {
  let info;
  try {
    info = await stat(file.path);
  } catch {
    return null;
  }
  if (!info.isFile() || info.size < 0 || info.size > MAX_FILE_BYTES) {
    return null;
  }
  const stamp: DshFileStamp = {
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
  };
  const existing = cache.get(file.path);
  if (
    existing != null &&
    existing.parseVersion === DSH_SESSION_PARSE_VERSION &&
    dshStampsMatch(existing.stamp, stamp)
  ) {
    return dshParsedFromAggregate(existing.aggregate);
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(file.path);
  } catch {
    return null;
  }
  if (buffer.length > MAX_FILE_BYTES) return null;
  const isZstd =
    buffer.length >= ZSTD_MAGIC_BYTES.length &&
    buffer.subarray(0, ZSTD_MAGIC_BYTES.length).equals(ZSTD_MAGIC_BYTES);

  // Append-only incremental path: the parsed prefix is byte-identical and
  // ended on a line boundary, so only the bytes after prefixEnd need decoding
  // and merging. A prefix that ended mid-line (or any rewrite/compaction) is
  // re-parsed in full — the DSH writer does not produce mid-line frames.
  if (
    existing != null &&
    existing.parseVersion === DSH_SESSION_PARSE_VERSION &&
    existing.endsWithNewline &&
    buffer.length >= existing.prefixEnd &&
    sha256Hex(buffer.subarray(0, existing.prefixEnd)) === existing.prefixHash
  ) {
    if (buffer.length === existing.prefixEnd) {
      // Metadata-only change (touch) — content unchanged, refresh the stamp.
      cache.set(file.path, { ...existing, stamp });
      return dshParsedFromAggregate(existing.aggregate);
    }
    try {
      if (isZstd) {
        const decoded = decodeZstdSessionLogWithBounds(
          buffer.subarray(existing.prefixEnd),
        );
        if (decoded.completeEnd > 0) {
          const regionEnd = existing.prefixEnd + decoded.completeEnd;
          const aggregate = cloneDshAggregate(existing.aggregate);
          applyDshAppendedText(aggregate, decoded.text, signal);
          cache.set(file.path, {
            parseVersion: DSH_SESSION_PARSE_VERSION,
            stamp,
            prefixEnd: regionEnd,
            prefixHash: sha256Hex(buffer.subarray(0, regionEnd)),
            endsWithNewline: decoded.text.endsWith("\n"),
            aggregate,
          });
          return dshParsedFromAggregate(aggregate);
        }
      } else if (buffer.length > existing.prefixEnd) {
        // Plaintext append (compression "none").
        const tailText = buffer.toString("utf8", existing.prefixEnd);
        const aggregate = cloneDshAggregate(existing.aggregate);
        applyDshAppendedText(aggregate, tailText, signal);
        cache.set(file.path, {
          parseVersion: DSH_SESSION_PARSE_VERSION,
          stamp,
          prefixEnd: buffer.length,
          prefixHash: sha256Hex(buffer),
          endsWithNewline: tailText.endsWith("\n"),
          aggregate,
        });
        return dshParsedFromAggregate(aggregate);
      }
      // Torn tail extended but no complete frame yet — content unchanged.
      cache.set(file.path, { ...existing, stamp });
      return dshParsedFromAggregate(existing.aggregate);
    } catch {
      // Structural change (rewrite/compaction/corruption): full reparse below.
    }
  }

  const full = await parseDshSessionFileFull(file, signal);
  if (full == null) {
    // A log that can no longer be parsed must not shadow future repairs.
    cache.delete(file.path);
    return null;
  }
  cache.set(file.path, {
    parseVersion: DSH_SESSION_PARSE_VERSION,
    stamp,
    prefixEnd: full.prefixEnd,
    prefixHash: sha256Hex(buffer.subarray(0, full.prefixEnd)),
    endsWithNewline: full.endsWithNewline,
    aggregate: full.aggregate,
  });
  return dshParsedFromAggregate(full.aggregate);
}

async function scanDshSessions(
  dshDirectory: string,
  signal?: AbortSignal,
  persistedCacheState?: unknown,
): Promise<SessionRecord[]> {
  const sessionsRoot = join(dshDirectory, "sessions");
  const files = await collectDshSessionFiles(sessionsRoot, signal);
  let rootCache = dshScanCache.get(sessionsRoot);
  if (rootCache == null) {
    // Fresh process: seed this root from the persisted cache of the previous
    // process so unchanged logs are never re-decoded after a restart. Entries
    // are still stamp/hash validated per file, and files that disappeared are
    // pruned at the end of this scan.
    rootCache = hydrateDshScanRoot(sessionsRoot, persistedCacheState);
    dshScanCache.set(sessionsRoot, rootCache);
  }
  const fragments = new Map<string, SessionFragment>();

  for (const file of files) {
    signal?.throwIfAborted();
    const parsed = await dshParsedFileFor(file, signal, rootCache);
    if (parsed == null) continue;

    const fragment =
      fragments.get(parsed.sessionId) ??
      createEmptyFragment("dsh", parsed.sessionId);
    if (fragment.title === "" && parsed.title !== "") {
      fragment.title = parsed.title;
    }
    if (parsed.model != null) fragment.model = parsed.model;
    if (fragment.projectRef == null && parsed.projectRef != null) {
      fragment.projectRef = parsed.projectRef;
    }
    for (const ms of parsed.timestampsMs) {
      fragment.timestamps.push(timestampFromMs(ms));
    }
    addTokenCounts(fragment.totals, parsed.totals);
    fragment.turns += parsed.turns;
    fragment.editTurns += parsed.editTurns;
    fragment.subagentCalls += parsed.subagentCalls;
    fragments.set(parsed.sessionId, fragment);
  }

  // Drop entries whose session log disappeared, keeping the map bounded by
  // the current file set (collectDshSessionFiles caps at MAX_FILES_PER_SOURCE).
  const current = new Set(files.map((file) => file.path));
  for (const path of [...rootCache.keys()]) {
    if (!current.has(path)) rootCache.delete(path);
  }
  return Promise.all(
    [...fragments.values()].map((fragment) => fragmentToRecord(fragment)),
  );
}

async function fragmentToRecord(
  fragment: SessionFragment,
): Promise<SessionRecord> {
  const sortedTimestamps = fragment.timestamps
    .map((entry) => entry.ms)
    .sort((left, right) => left - right);
  const startedMs = fragment.firstUserAt?.ms ?? sortedTimestamps[0];
  const endedMs = sortedTimestamps[sortedTimestamps.length - 1];
  const startedAt =
    fragment.firstUserAt?.iso ??
    fragment.timestamps.find((entry) => entry.ms === startedMs)?.iso ??
    (startedMs != null
      ? new Date(startedMs).toISOString()
      : new Date(0).toISOString());
  const endedAt =
    fragment.timestamps.find((entry) => entry.ms === endedMs)?.iso ??
    (endedMs != null ? new Date(endedMs).toISOString() : startedAt);

  const rawProjectRef = fragment.projectRef ?? "unknown";
  const pathImpl = serverPathImplForPlatform(process.platform);
  const gitRoot = await findNearestGitRepositoryRoot(pathImpl, rawProjectRef);
  const projectRef = gitRoot ?? rawProjectRef;
  const resumeCwd = pathImpl.isAbsolute(rawProjectRef)
    ? rawProjectRef
    : undefined;
  const resumeSafe =
    fragment.resumeSupported !== false && isResumeSafeId(fragment.sessionId);
  const idSafe = isResumeSafeId(fragment.sessionId);
  const status: SessionStatus =
    fragment.terminalStatus ?? (idSafe ? "available" : "unavailable");
  const statusReason =
    status === "lost"
      ? "本地会话元数据明确标记为丢失。"
      : status === "interrupted"
        ? "本地会话元数据明确标记为已中断。"
        : status === "unavailable"
          ? "会话 ID 不符合安全格式，未生成恢复命令。"
          : null;
  const record = {
    sessionId: fragment.sessionId,
    source: fragment.source,
    title: fragment.title || fragment.fallbackTitle,
    projectKey: projectKeyFromCwd(projectRef),
    projectRef,
    ...(resumeCwd === undefined ? {} : { resumeCwd }),
    isGitProject: gitRoot != null,
    model: fragment.model,
    startedAt,
    endedAt,
    durationMs: activeDurationMs(fragment.timestamps),
    turns: fragment.turns,
    editTurns: fragment.editTurns,
    // v1 simplification: retry detection requires prompt-content hashing,
    // which we deliberately avoid to honor the privacy contract. Set to 0
    // until a content-free heuristic is available.
    retryTurns: 0,
    totals: fragment.totals,
    subagentCalls: fragment.subagentCalls,
    status,
    statusReason,
    resumeSafe,
    resumeCommand: resumeSafe
      ? buildResumeCommand(fragment.source, fragment.sessionId)
      : null,
  };
  return { ...record, cost: estimateSessionCost(record) };
}

/**
 * Map Node's `process.platform` to the registry's `PlatformOs`. Scanning runs
 * on the local machine, so the current platform is the resolution target.
 */
function currentPlatformOs(): PlatformOs {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

function dedupeAndSort(sessions: SessionRecord[]): SessionRecord[] {
  const seen = new Map<string, SessionRecord>();
  for (const session of sessions) {
    const key = `${session.source}:${session.sessionId}`;
    const existing = seen.get(key);
    if (existing == null) {
      seen.set(key, session);
      continue;
    }
    // Prefer the entry with the larger token total (the busier fragment).
    if (session.totals.totalTokens > existing.totals.totalTokens) {
      seen.set(key, session);
    }
  }
  return [...seen.values()].sort((left, right) =>
    left.startedAt.localeCompare(right.startedAt),
  );
}

// AiPy stores tasks and their events in one SQLite database. It has no
// supported resume command, but the task metadata is still useful as a
// read-only session history entry.
async function scanAipySessions(
  aipyDirectory: string,
  signal?: AbortSignal,
): Promise<SessionRecord[]> {
  signal?.throwIfAborted();
  const databasePath = join(aipyDirectory, "aipy");
  let database: DatabaseSync | undefined;
  try {
    const databaseStat = await stat(databasePath);
    if (!databaseStat.isFile()) return [];
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database
      .prepare(
        `SELECT
           e.task_id AS sessionId,
           e.model AS eventModel,
           e.type AS type,
           e.time AS timestamp,
           e.usage AS usage,
           t.title AS title,
           t.model AS taskModel,
           t.workdir AS taskWorkdir,
           w.workdir AS workspaceWorkdir
         FROM task_event e
         LEFT JOIN task t ON t.id = e.task_id
         LEFT JOIN workspace w ON w.id = t.workspace_id
         WHERE e.task_id IS NOT NULL AND e.task_id <> ''`,
      )
      .all() as Array<Record<string, unknown>>;
    const fragments = new Map<string, SessionFragment>();
    for (const row of rows) {
      signal?.throwIfAborted();
      const sessionId = stringValue(row.sessionId);
      if (!sessionId) continue;
      const fragment =
        fragments.get(sessionId) ?? createEmptyFragment("aipy", sessionId);
      fragment.resumeSupported = false;
      if (!fragment.title) fragment.title = stringValue(row.title) ?? "";
      if (!fragment.model) {
        fragment.model =
          stringValue(row.eventModel) ?? stringValue(row.taskModel) ?? null;
      }
      if (!fragment.projectRef) {
        fragment.projectRef =
          stringValue(row.workspaceWorkdir) ??
          stringValue(row.taskWorkdir) ??
          null;
      }
      const timestamp = parseTimestampValue(row.timestamp);
      if (timestamp) {
        fragment.timestamps.push(timestamp);
        if (
          stringValue(row.type) === "USER" &&
          (fragment.firstUserAt == null ||
            timestamp.ms < fragment.firstUserAt.ms)
        ) {
          fragment.firstUserAt = timestamp;
        }
      }
      fragment.turns += 1;
      let usage: JsonObject | undefined;
      if (typeof row.usage === "string") {
        try {
          usage = asObject(JSON.parse(row.usage));
        } catch {
          usage = undefined;
        }
      } else {
        usage = asObject(row.usage);
      }
      if (usage) {
        const inputTokens = tokenValue(usage.input_tokens ?? usage.inputTokens);
        const outputTokens = tokenValue(
          usage.output_tokens ?? usage.outputTokens,
        );
        const reasoningOutputTokens = tokenValue(
          usage.reasoning_tokens ?? usage.reasoningTokens,
        );
        const totalTokens =
          tokenValue(usage.total_tokens ?? usage.totalTokens) ||
          inputTokens + outputTokens + reasoningOutputTokens;
        addTokenCounts(fragment.totals, {
          inputTokens,
          outputTokens,
          cachedInputTokens: tokenValue(
            usage.cached_input_tokens ?? usage.cachedInputTokens,
          ),
          cacheCreationInputTokens: tokenValue(
            usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens,
          ),
          reasoningOutputTokens,
          totalTokens,
        });
      }
      fragments.set(sessionId, fragment);
    }
    return Promise.all(
      [...fragments.values()]
        .filter((fragment) => fragment.totals.totalTokens > 0)
        .map((fragment) => fragmentToRecord(fragment)),
    );
  } catch {
    return [];
  } finally {
    database?.close();
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Pi (earendil-works/pi coding agent) — ~/.pi/agent/sessions/<--cwd-->/*.jsonl
//
// One plaintext JSONL file per session. First line is a v4 `{kind:"header",
// id, cwd, createdAt, ...}` or legacy v3 `{type:"session", version:3, ...}`
// storage header; assistant messages append metadata-only usage envelopes
// (`{type:"message", id, message:{role, model, timestamp, usage:{...}}}`).
// Pi has no explicit resume CLI surface here, so sessions are read-only
// (resumeSupported=false, same as AiPy). Conversation text is only read
// transiently for a privacy-safe fallback title.
// ---------------------------------------------------------------------------

/**
 * Main-agent session logs only: `~/.pi/agent/sessions/<--cwd-->/*.jsonl`.
 * oh-my-pi nests subagent/advisor transcripts BELOW the cwd level (a session
 * directory instead of a file) — those are usage traffic, not separate
 * sessions in the history list, so deeper levels are intentionally not
 * traversed here.
 */
async function collectPiLikeSessionFiles(
  sessionsRoot: string,
  signal?: AbortSignal,
): Promise<FileCandidate[]> {
  const files: FileCandidate[] = [];
  if (!(await directoryAvailable(sessionsRoot))) return files;
  let discoveredEntries = 0;
  try {
    const topLevel = await opendir(sessionsRoot);
    for await (const cwdEntry of topLevel) {
      signal?.throwIfAborted();
      discoveredEntries += 1;
      if (discoveredEntries >= MAX_DIRECTORY_ENTRIES) break;
      if (!cwdEntry.isDirectory()) continue;
      const cwdPath = join(sessionsRoot, cwdEntry.name);
      let directory;
      try {
        directory = await opendir(cwdPath);
      } catch {
        continue;
      }
      for await (const entry of directory) {
        signal?.throwIfAborted();
        discoveredEntries += 1;
        if (discoveredEntries >= MAX_DIRECTORY_ENTRIES) break;
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        files.push({ path: join(cwdPath, entry.name) });
        if (files.length >= MAX_FILES_PER_SOURCE) return files;
      }
    }
  } catch {
    // Ignore unreadable roots.
  }
  return files;
}

/** Session id from a pi file name `<createdAt>_<encodeURIComponent(id)>.jsonl`. */
function piSessionIdFromFileName(fileName: string): string | undefined {
  const base = fileName.endsWith(".jsonl")
    ? fileName.slice(0, -".jsonl".length)
    : fileName;
  const separator = base.indexOf("_");
  const encoded = separator >= 0 ? base.slice(separator + 1) : base;
  if (encoded.length === 0) return undefined;
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.length > 0 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

async function scanPiLikeSessions(
  source: "pi" | "omp",
  piDirectory: string,
  signal?: AbortSignal,
): Promise<SessionRecord[]> {
  const sessionsRoot = join(piDirectory, "agent", "sessions");
  const files = await collectPiLikeSessionFiles(sessionsRoot, signal);
  const fragments = new Map<string, SessionFragment>();

  for (const file of files) {
    signal?.throwIfAborted();
    let size = -1;
    try {
      const info = await stat(file.path);
      size = info.size;
    } catch {
      continue;
    }
    if (size < 0 || size > MAX_FILE_BYTES) continue;
    let content: string;
    try {
      content = await readFile(file.path, "utf8");
    } catch {
      continue;
    }
    let sessionId: string | undefined;
    let projectRef: string | null = null;
    let headerSeen = false;
    let fallbackTitle: string | undefined;
    const userMessageIds = new Set<string>();
    const timestamps: RecordTimestamp[] = [];
    const totals = emptyTokenCounts();
    let userTurns = 0;
    let assistantMessages = 0;
    let lastModel: string | null = null;
    const lines = content.split("\n");
    const tornTail = !content.endsWith("\n");
    for (let index = 0; index < lines.length; index += 1) {
      signal?.throwIfAborted();
      const line = lines[index] ?? "";
      if (line.trim().length === 0) continue;
      let record: JsonObject;
      try {
        record = asObject(JSON.parse(line)) ?? {};
      } catch {
        // Tolerate the trailing partial line of an in-flight writer.
        if (!(tornTail && index === lines.length - 1)) continue;
        continue;
      }
      const kind = stringValue(record.kind);
      const type = stringValue(record.type);
      if ((kind === "header" || type === "session") && !headerSeen) {
        headerSeen = true;
        const headerId = stringValue(record.id);
        if (headerId != null) sessionId = headerId;
        const headerCwd = stringValue(record.cwd);
        if (headerCwd != null) projectRef = headerCwd;
        const createdAt = parseTimestampValue(
          kind === "header" ? record.createdAt : record.timestamp,
        );
        if (createdAt != null) timestamps.push(createdAt);
        continue;
      }
      if (type !== "message") continue;
      const message = asObject(record.message);
      if (message == null) continue;
      const role = stringValue(message.role);
      const messageId = stringValue(record.id) ?? stringValue(message.id);
      const messageTime = parseTimestampValue(
        message.timestamp ?? record.timestamp,
      );
      if (messageTime != null) timestamps.push(messageTime);
      const contentValue = message.content;
      if (role === "user") {
        if (messageId != null) {
          if (userMessageIds.has(messageId)) continue;
          userMessageIds.add(messageId);
        }
        userTurns += 1;
        if (fallbackTitle === undefined && contentValue != null) {
          fallbackTitle = safeFallbackTitle(contentValue);
        }
        continue;
      }
      if (role !== "assistant") continue;
      assistantMessages += 1;
      const model = stringValue(message.model);
      if (model != null) lastModel = model;
      const usage = asObject(message.usage);
      if (usage == null) continue;
      const inputTokens = tokenValue(usage.input ?? usage.inputTokens);
      const cachedInputTokens = tokenValue(usage.cacheRead);
      const cacheCreationInputTokens = tokenValue(usage.cacheWrite);
      const outputTokens = tokenValue(usage.output ?? usage.outputTokens);
      const reasoningOutputTokens = tokenValue(
        usage.reasoningTokens ?? usage.reasoning,
      );
      const declaredTotal = tokenValue(usage.totalTokens);
      const totalTokens =
        declaredTotal > 0
          ? declaredTotal
          : inputTokens +
            cachedInputTokens +
            cacheCreationInputTokens +
            outputTokens +
            reasoningOutputTokens;
      if (totalTokens === 0) continue;
      addTokenCounts(totals, {
        inputTokens,
        cachedInputTokens,
        cacheCreationInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
      });
    }
    if (!headerSeen) continue;
    const resolvedId =
      sessionId ?? piSessionIdFromFileName(basename(file.path));
    if (resolvedId === undefined || resolvedId === "") continue;
    const fragment =
      fragments.get(resolvedId) ?? createEmptyFragment(source, resolvedId);
    if (fragment.projectRef == null && projectRef != null) {
      fragment.projectRef = projectRef;
    }
    if (fragment.model == null && lastModel != null) fragment.model = lastModel;
    if (fragment.fallbackTitle === "" && fallbackTitle != null) {
      fragment.fallbackTitle = fallbackTitle;
    }
    fragment.timestamps.push(...timestamps);
    addTokenCounts(fragment.totals, totals);
    fragment.turns += userTurns > 0 ? userTurns : assistantMessages;
    fragment.resumeSupported = false;
    fragments.set(resolvedId, fragment);
  }

  return Promise.all(
    [...fragments.values()].map((fragment) => fragmentToRecord(fragment)),
  );
}

// P1-3: controlled SessionReader registration. The scan implementations stay
// in this module; the factory (tool-registry/readers/session-readers.ts) binds
// the registry's `SessionReaderKey` to them so config and code cannot drift.
// `defaultRoots` are the pre-registry hardcoded tool home suffixes, used when
// a tool JSON declares no `storage.dataRoots` for the sessions capability.
// ---------------------------------------------------------------------------

registerSessionReader({
  key: "claude-session-v1",
  scan: scanClaudeCodeSessions,
  defaultRoots: [".claude"],
});
registerSessionReader({
  key: "codex-session-v1",
  scan: scanCodexSessions,
  defaultRoots: [".codex"],
});
registerSessionReader({
  key: "grok-session-v1",
  scan: scanGrokSessions,
  defaultRoots: [".grok"],
});
registerSessionReader({
  key: "dsh-session-v1",
  scan: scanDshSessions,
  defaultRoots: [".dsh"],
});
registerSessionReader({
  key: "aipy-session-v1",
  scan: scanAipySessions,
  defaultRoots: [],
});
function scanPiSessions(
  piDirectory: string,
  signal?: AbortSignal,
): Promise<SessionRecord[]> {
  return scanPiLikeSessions("pi", piDirectory, signal);
}

function scanOmpSessions(
  piDirectory: string,
  signal?: AbortSignal,
): Promise<SessionRecord[]> {
  return scanPiLikeSessions("omp", piDirectory, signal);
}

registerSessionReader({
  key: "pi-session-v1",
  scan: scanPiSessions,
  defaultRoots: [".pi"],
});
registerSessionReader({
  key: "omp-session-v1",
  scan: scanOmpSessions,
  defaultRoots: [".omp", ".oh-my-pi"],
});
/**
 * Scan every registry-declared session tool and return a merged, deduplicated,
 * startedAt-descending summary. For each tool: take the scan implementation
 * from the controlled SessionReader factory (`getSessionPlan().reader`), and
 * derive the scan root(s) from the platform path plan
 * (`resolvePlatformPaths(toolId, "sessions", os, env)`, F5-T1 XDG-aware); when
 * the plan declares no `dataRoots`, the reader's `defaultRoots` keep the
 * legacy behavior. Missing directories are treated as empty — never throw.
 */
export async function scanLocalSessions(
  options: ScanLocalSessionsOptions = {},
): Promise<SessionSummary> {
  const now = options.now ?? new Date();
  // P5-T5-03: stop before starting any per-tool I/O when cancelled.
  options.signal?.throwIfAborted();
  const traversalSignal =
    (options.platform ?? process.platform) === "win32"
      ? options.signal
      : undefined;
  const isolatedUsageHome = process.env[ENV.USAGE_HOME]?.trim();
  const homeDirectory =
    options.homeDirectory ??
    (isolatedUsageHome && isAbsolute(isolatedUsageHome)
      ? isolatedUsageHome
      : homedir());
  const registry = options.registry ?? getDefaultRegistry();
  // Resolve scan roots against the injected platform when provided (test
  // seam): platform plans differ per os, and fixture tests simulate the
  // macOS layout on any runner.
  const os =
    options.platform !== undefined
      ? osFromProcess(options.platform)
      : currentPlatformOs();
  const env: PlatformEnv = process.env;

  const perTool = await Promise.all(
    listSessionTools(registry).map(async (toolId) => {
      options.signal?.throwIfAborted();
      const def = registry.byId.get(toolId);
      const plan = def ? getSessionPlanFor(def) : null;
      if (!plan) return [] as SessionRecord[];
      const reader = getSessionReader(plan.reader);
      if (!reader) return [] as SessionRecord[];
      const resolution = resolvePlatformPaths(
        toolId,
        "sessions",
        os,
        env,
        registry,
      );
      if (!resolution) return [] as SessionRecord[];
      const roots =
        resolution.paths.length > 0
          ? resolution.paths.map((path) =>
              path.homeRelative ? join(homeDirectory, path.path) : path.path,
            )
          : reader.defaultRoots.map((root) => join(homeDirectory, root));
      const scanned = await Promise.all(
        roots.map((root) => {
          // The DSH reader keeps its own persisted per-file cache (restart
          // fast-path); all other readers are stateless registry readers.
          const scan =
            toolId === "dsh"
              ? scanDshSessions(root, traversalSignal, options.dshCacheState)
              : reader.scan(root, traversalSignal);
          return scan.catch(() => {
            traversalSignal?.throwIfAborted();
            return [] as SessionRecord[];
          });
        }),
      );
      return scanned.flat();
    }),
  );

  const canonicalProjectPaths = new Map<
    string,
    ReturnType<typeof canonicalizeProjectIdentity>
  >();
  const sessions = await Promise.all(
    dedupeAndSort(perTool.flat())
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((session) => {
        let canonicalProject = canonicalProjectPaths.get(session.projectRef);
        if (canonicalProject == null) {
          canonicalProject = canonicalizeProjectIdentity(
            session.projectRef,
            homeDirectory,
            options.platform ?? process.platform,
          );
          canonicalProjectPaths.set(session.projectRef, canonicalProject);
        }
        return canonicalProject.then((identity) => ({
          ...session,
          projectKey: projectKeyFromCwd(identity.project),
          projectRef: identity.project,
          isGitProject: identity.isGitProject,
        }));
      }),
  );

  return {
    generatedAt: now.toISOString(),
    sessions,
    total: sessions.length,
  };
}
