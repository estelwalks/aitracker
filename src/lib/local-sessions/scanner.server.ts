import { createReadStream } from "node:fs";
import { opendir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";

import { ENV } from "../app-config";
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
  model: string | null;
  projectRef: string | null;
  timestamps: RecordTimestamp[];
  totals: SessionTokenCounts;
  turns: number;
  editTurns: number;
  subagentCalls: number;
  /** Explicit terminal state found in structured local metadata only. */
  terminalStatus: Extract<SessionStatus, "interrupted" | "lost"> | null;
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
    model: null,
    projectRef: null,
    timestamps: [],
    totals: emptyTokenCounts(),
    turns: 0,
    editTurns: 0,
    subagentCalls: 0,
    terminalStatus: null,
  };
}

// --------------------------------------------------------------------------
// Claude Code — ~/.claude/projects/<dash-encoded-cwd>/*.jsonl
//
// A file is a session only if at least one line carries a `sessionId`. Files
// like journal.jsonl / skill-injections.jsonl lack sessionId and are ignored.
// Multiple files may share a sessionId (resume/subagent sidechains) → merge.

async function scanClaudeCodeSessions(
  claudeDirectory: string,
): Promise<SessionRecord[]> {
  const projectsRoot = join(claudeDirectory, "projects");
  const files = await collectJsonlFiles([projectsRoot], () => true);
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
    let sawSessionId = false;
    const local: {
      sessionId?: string;
      title?: string;
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

    if (!sawSessionId) continue; // journal.jsonl, skill-injections.jsonl, etc.

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

  return [...fragments.values()].map((fragment) => fragmentToRecord(fragment));
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
): Promise<Map<string, string>> {
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

async function scanCodexSessions(
  codexDirectory: string,
): Promise<SessionRecord[]> {
  const sessionsRoot = join(codexDirectory, "sessions");
  const archivedRoot = join(codexDirectory, "archived_sessions");
  const indexCache = new Map<
    string,
    { mtimeMs: number; titles: Map<string, string> }
  >();
  const titles = await readCodexSessionIndex(codexDirectory, indexCache);

  const files = await collectJsonlFiles(
    [sessionsRoot, archivedRoot],
    (relativePath) => CODEX_ROLLOUT_PATTERN.test(relativePath),
  );

  const fragments = new Map<string, SessionFragment>();

  for (const file of files) {
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

    const perFileTotals = emptyTokenCounts();
    const timestamps: RecordTimestamp[] = [];
    let assistantTurns = 0;
    let editTurns = 0;
    let subagentCalls = 0;
    let terminalStatus: ExplicitTerminalStatus | undefined;

    await readJsonLines(file.path, (record) => {
      const recordType = stringValue(record.type);
      const payload = asObject(record.payload);
      const payloadType = stringValue(payload?.type);
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

  return [...fragments.values()].map((fragment) => fragmentToRecord(fragment));
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
      continue; // do not descend further — this IS a session directory
    }
    pending.push(...subdirectories);
  }
  return sessionDirectories;
}

async function scanGrokSessions(
  grokDirectory: string,
): Promise<SessionRecord[]> {
  const sessionsRoot = join(grokDirectory, "sessions");
  const sessionDirectories = await collectGrokSessionDirectories(sessionsRoot);

  const fragments = new Map<string, SessionFragment>();

  for (const sessionDirectory of sessionDirectories) {
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

  return [...fragments.values()].map((fragment) => fragmentToRecord(fragment));
}

function fragmentToRecord(fragment: SessionFragment): SessionRecord {
  const sortedTimestamps = fragment.timestamps
    .map((entry) => entry.ms)
    .sort((left, right) => left - right);
  const startedMs = sortedTimestamps[0];
  const endedMs = sortedTimestamps[sortedTimestamps.length - 1];
  const startedAt =
    fragment.timestamps.find((entry) => entry.ms === startedMs)?.iso ??
    (startedMs != null
      ? new Date(startedMs).toISOString()
      : new Date(0).toISOString());
  const endedAt =
    fragment.timestamps.find((entry) => entry.ms === endedMs)?.iso ??
    (endedMs != null ? new Date(endedMs).toISOString() : startedAt);

  const projectRef = fragment.projectRef ?? "unknown";
  const resumeSafe = isResumeSafeId(fragment.sessionId);
  const status: SessionStatus =
    fragment.terminalStatus ?? (resumeSafe ? "available" : "unavailable");
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
    title: fragment.title,
    projectKey: projectKeyFromCwd(fragment.projectRef),
    projectRef,
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
    resumeCommand: buildResumeCommand(fragment.source, fragment.sessionId),
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

// ---------------------------------------------------------------------------
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
  const isolatedUsageHome = process.env[ENV.USAGE_HOME]?.trim();
  const homeDirectory =
    options.homeDirectory ??
    (isolatedUsageHome && isAbsolute(isolatedUsageHome)
      ? isolatedUsageHome
      : homedir());
  const registry = options.registry ?? getDefaultRegistry();
  const os = currentPlatformOs();
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
        roots.map((root) =>
          reader.scan(root).catch(() => [] as SessionRecord[]),
        ),
      );
      return scanned.flat();
    }),
  );

  const sessions = dedupeAndSort(perTool.flat()).sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt),
  );

  return {
    generatedAt: now.toISOString(),
    sessions,
    total: sessions.length,
  };
}
