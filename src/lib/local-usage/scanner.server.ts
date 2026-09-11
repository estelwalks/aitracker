import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { opendir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { zstdDecompressSync } from "node:zlib";

import { ENV } from "../app-config";
import {
  getDefaultRegistry,
  getScannerPolicy,
  getTool,
  type PlatformOs,
} from "../tool-registry/registry.ts";
import { computeToolRegistryVersion } from "../tool-registry/fingerprint.server.ts";
import { buildLocalUsageSnapshot } from "./aggregate.ts";
import {
  collectCodexContextRecord,
  consumeCodexPendingContext,
  createCodexPendingContext,
} from "./codex-context.ts";
import {
  decodeZstdSessionLogWithBounds,
  DSH_MAX_VERIFIED_GENERATION,
  parseDshLogFilename,
  scanZstdFrames,
  selectDshSessionLogs,
  ZSTD_MAGIC_BYTES,
} from "./dsh-zstd.ts";
import { canonicalizeProjectPath } from "./project-path.server.ts";
import { normalizeProjectPath } from "./project-path.ts";
import {
  collectClaudeContext,
  collectClaudeToolResults,
  collectClaudeToolUseIds,
} from "./claude-context.ts";
import {
  BUILTIN_USAGE_ADAPTERS,
  GENERIC_BUILTIN_USAGE_ADAPTERS,
} from "./adapters/catalog.ts";
import { osFromProcess } from "../tools/detection.server.ts";
import {
  isHomeFlattenedRoot,
  rebaseRoot,
  uniformDataSegment,
} from "../tool-data-root/placement.server.ts";
import {
  eventFromMappedRecord,
  fieldMismatchDiagnostic,
  recordTimestampMs,
  recordsFromJson,
} from "./adapters/parser.ts";
import {
  createNewestSelection,
  type NewestSelection,
} from "./newest-selection.ts";
import type {
  UsageAdapterContract,
  UsageAdapterPath,
} from "./adapters/types.ts";
import {
  isPrivateSessionId,
  sessionIdFromRelativeFile,
  sessionIdFromStructuredValue,
} from "./session-id.ts";
import type {
  LocalUsageDiagnostic,
  LocalUsageEvent,
  LocalUsageSnapshot,
  LocalUsageSource,
  LocalUsageSourceSummary,
  LocalTokenCounts,
} from "./types.ts";
import { KNOWN_LOCAL_USAGE_SOURCES } from "./types.ts";

const DAY_IN_MS = 24 * 60 * 60 * 1_000;
// Scanner budgets (P4-T3): moved to _shared/scanner-policy.json; the values
// below are null-safe fallbacks when the policy getter has no packs.
const SCANNER_POLICY = getScannerPolicy();
const DEFAULT_LOOKBACK_DAYS = SCANNER_POLICY?.lookbackDays ?? 10 * 365;
const MAX_FILES_PER_SOURCE = SCANNER_POLICY?.maxFilesPerSource ?? 1_200;
const MAX_DISCOVERED_ENTRIES_PER_SOURCE =
  SCANNER_POLICY?.maxDiscoveredEntriesPerSource ?? 30_000;
const MAX_JSONL_LINE_LENGTH =
  SCANNER_POLICY?.maxJsonlLineLength ?? 16 * 1024 * 1024;
// P2-17: whole-file cap applied before streaming a JSONL log. A single
// oversized line is already bounded by MAX_JSONL_LINE_LENGTH, but a
// pathological file must never be pulled into the line reader at all.
const MAX_JSONL_FILE_BYTES = 256 * 1024 * 1024;
// Issue #42: a sqlite database is queried through a prepared statement instead
// of being buffered whole, so `maxFileSizeBytes` - a budget for formats that
// are read in one piece - never applies to it. A real ZCode `db.sqlite` holds
// every session's messages and passes 512 MB within weeks of heavy use, and
// skipping it meant "no logs" for an adapter that could read it fine.
//
// P2-2 review: this cap bounds what a source KEEPS (mapped events held in
// memory) and what its scan materializes in JavaScript. It cannot bound what
// sqlite spends producing those rows, and no query shape can: every adapter
// orders by a computed timestamp expression (`COALESCE(ended_at, started_at)`,
// `strftime(...)`), so no index on a raw column can serve the ORDER BY - with
// an index on `sessions(ended_at)` present, the plan is still `SCAN sessions`
// + `USE TEMP B-TREE FOR ORDER BY` - and a third-party database is opened
// read-only, so the index cannot be added. Measured on a 5M-row / 406 MB
// fixture with a 365-day window (4.2M rows in window), the sort costs 5.5 s
// before the first row and the whole scan 7.0 s while the budget stops the
// JavaScript side at 500k rows. The three ways out were measured too, and all
// three lose:
//   - `LIMIT <budget+1>` pushdown: 10.2 s and 9.0 s to the first row. sqlite
//     still sorts the entire filtered result first, so the LIMIT only adds
//     work; the sort is not bounded by it.
//   - Dropping the ORDER BY and selecting in JavaScript: the sort disappears
//     (first row in 47 ms) but every in-window row crosses the boundary, which
//     costs 13.3 s - twice the scan - and retaining 500k raw rows instead of
//     500k mapped events adds ~1.5 GB of RSS.
//   - Keyset/cursor batches: without an index to seek, each batch repeats the
//     same full sort.
// The remaining lever is the window itself, which IS pushed into the query
// (`windowFilter`) so sqlite drops out-of-window rows before sorting them;
// `lookbackDays` defaults to ten years, which is what makes the sort large.
// Sorter memory is bounded by sqlite's own spill policy (measured RSS delta
// 23-34 MB); the temp-file bytes are not.
const MAX_SQLITE_ROWS = SCANNER_POLICY?.maxSqliteRows ?? 500_000;

/**
 * Row budget shared by every sqlite file of one source (issue #42 review).
 * Hermes keeps one `state.db` per profile and each is a separate file, so a
 * per-file budget multiplied the advertised "500,000 rows per source" by the
 * number of profiles and let one source exceed the memory bound the budget
 * exists to enforce.
 *
 * P2-1 review: the budget is now spent through `createNewestSelection`, which
 * keeps the newest rows of the whole source rather than the rows of whichever
 * database the walk read first, so a database that can no longer contribute is
 * abandoned at its first losing row. This type is what a single-database source
 * (Zed's native reader) still uses for its sequential read.
 */
interface SqliteRowBudget {
  readonly limit: number;
  exhausted(): boolean;
  /** Rows left before the source cap is reached. */
  remaining(): number;
  take(count?: number): void;
}

function createSqliteRowBudget(limit: number): SqliteRowBudget {
  let used = 0;
  return {
    limit,
    exhausted: () => used >= limit,
    remaining: () => limit - used,
    take: (count = 1) => {
      // Clamped: the budget is a bound, so no caller can push it past its own
      // limit into a state the file behind it would misread.
      used = Math.min(limit, used + count);
    },
  };
}

/**
 * Budget identity of one sqlite parse (P1/P2-1 cache review).
 *
 * A source's databases share one row budget, and the rows that survive it are
 * the newest of the WHOLE source (P2-1), so what a database contributes is not
 * a property of that database alone. An entry the budget cut short holds
 * whatever the other databases left it, and it may be reused only while the
 * whole sqlite file set reproduces (see `sqliteSetReproducible`); an entry that
 * was not cut holds every row of its own window no matter what its siblings
 * did, so it stays reusable on its own.
 */
interface SqliteBudgetIdentity {
  /** Source row budget this selection was made under. */
  limit: number;
  /** Whether rows of this database were left uncounted by that budget. */
  truncated: boolean;
}
const FUTURE_TIMESTAMP_TOLERANCE_MS =
  SCANNER_POLICY?.futureTimestampToleranceMs ?? DAY_IN_MS;
// Antigravity's estimated transcript events were added in v14. Rebuild once so cached Claude
// events gain the new privacy-safe output aggregate instead of retaining a
// stale "unobserved" capability. v17 adds per-file DSH append state
// (prefixEnd/prefixHash/endsWithNewline/parserState) so appended frames of a
// growing session log can be decoded without re-decoding the prefix. v18 adds
// the WAL companion signature (`wal`) to generic sqlite entries so a
// WAL-mode database whose main file was not checkpointed yet is re-parsed
// (fresh frames live in `db.sqlite-wal`, invisible to main-file mtime/size).
// v19 adds the sqlite window identity (`windowDays`): a windowed parse only
// holds the rows inside the window it was run with, so the cached range has to
// be compared against the requested one before reuse.
// v20 adds the sqlite budget identity (`sqliteBudget`): a parse stopped by the
// shared per-source row budget is a partial result of the other databases in
// the same walk, so reuse has to compare the budget it was left with and pay
// back the rows it took. Entries written before v20 carry no budget identity
// and are re-parsed once rather than reused under a budget they cannot
// describe.
// v21 records the identity as the budget the selection ran under plus whether
// this database lost rows to it (P2-1): the budget now keeps the newest rows of
// the whole source instead of the rows of whichever database was read first, so
// what a truncated entry holds is decided by its siblings and not by how much
// budget was left when its own read started.
const PERSISTENT_CACHE_VERSION = 21;
/**
 * Fingerprint of the tool-registry config that produced this cache. A config
 * change (paths, reader, command, pricing-rule set, or any JSON definition)
 * invalidates the cache so stale parse results are never served.
 */
const REGISTRY_FINGERPRINT = computeToolRegistryVersion(getDefaultRegistry());
const processUsageIndexes = new Map<string, PersistentUsageIndex>();

interface JsonObject {
  [key: string]: unknown;
}

interface FileCandidate {
  path: string;
  modifiedAt: number;
  size: number;
  /**
   * Signature of the `-wal` companion for sqlite candidates: `null` when no
   * WAL file exists, omitted for non-sqlite files. WAL-mode databases can
   * grow their `-wal` file (new usage rows) while the main database file
   * keeps its mtime/size until the next checkpoint, so cache reuse must also
   * compare the WAL signature.
   */
  wal?: { modifiedAt: number; size: number } | null;
}

interface SourceScanResult {
  events: LocalUsageEvent[];
  summary: LocalUsageSourceSummary;
  cacheEntries: PersistentFileEntry[];
}

export interface LocalUsageScanOptions {
  homeDirectory?: string;
  additionalHomeDirectories?: string[];
  claudeConfigDirectory?: string;
  codexHomeDirectory?: string;
  now?: Date;
  lookbackDays?: number;
  maxFilesPerSource?: number;
  /**
   * Row budget for one sqlite usage query (issue #42). Overrides the shared
   * scanner-policy `maxSqliteRows`; present so tests can exercise the
   * truncation path without seeding 500k rows.
   */
  maxSqliteRowsPerSource?: number;
  cacheDirectory?: string;
  disablePersistentCache?: boolean;
  /** Shared WSL topology (P3-T3-04); when absent the scanner enumerates once. */
  wslTopology?: import("../wsl-topology-types.ts").WslTopologyInput;
  /** Test seam for the one allowed WSL enumeration per scan. */
  enumerateWslTopology?: (options: {
    readonly platform: NodeJS.Platform;
    readonly signal?: AbortSignal;
  }) => Promise<import("../wsl-topology-types.ts").WslTopologyInput>;
  /**
   * Per-tool user data-directory overrides (toolId -> absolute directory).
   * When present for a tool, its HOME-anchored usage roots are rebased under
   * that directory and non-HOME platform arms (AppData etc.) are skipped.
   */
  toolDataRoots?: ReadonlyMap<string, string>;
  /** Test seam for Windows-only topology behavior. */
  platform?: NodeJS.Platform;
  /** P5-T5-02: real cancellation; directory loops and file reads check it. */
  signal?: AbortSignal;
}

async function discoverWindowsWslHomes(
  providerDirectory: string,
  topology: import("../wsl-topology-types.ts").WslTopologyInput,
  platform: NodeJS.Platform,
): Promise<string[]> {
  if (platform !== "win32") return [];
  return topology.distros.map(({ distribution, home }) => {
    const suffix = `${home.replaceAll("/", "\\")}\\${providerDirectory}`;
    return `\\\\wsl$\\${distribution}${suffix}`;
  });
}

interface CachedClaudeEvent {
  messageId: string;
  event: LocalUsageEvent;
}

interface CachedIdentifiedEvent {
  /** SHA-256 identity derived only from stable ids or non-content metadata. */
  identity: string;
  event: LocalUsageEvent;
}

interface PersistentFileEntryBase {
  path: string;
  mtimeMs: number;
  size: number;
  malformedLines: number;
  /**
   * WAL companion signature for sqlite-based entries: `null` when the source
   * database had no `-wal` file when parsed; absent for non-sqlite entries.
   * Cache reuse compares it so fresh WAL frames trigger a re-parse even when
   * the main database file has not been checkpointed (mtime/size unchanged).
   */
  wal?: { mtimeMs: number; size: number } | null;
  /**
   * Lookback the sqlite query was windowed to (issue #42). A windowed parse
   * only holds the rows inside that window, so an entry may be reused only
   * when its window is at least as wide as the request - a narrower cache
   * would silently under-report after `lookbackDays` is widened. Absent for
   * non-sqlite entries and for entries written before v19, both of which fall
   * back to a re-parse.
   */
  windowDays?: number;
  /**
   * Budget identity of a sqlite parse (P1 cache review, v20). A database whose
   * parse stopped at the shared row budget only holds the rows the databases
   * read before it left behind, so the entry may be reused only where the
   * budget is equally spent and its own rows are charged back to it. Absent for
   * non-sqlite entries and for entries written before v20, both of which fall
   * back to a re-parse.
   */
  sqliteBudget?: SqliteBudgetIdentity;
}

interface PersistentClaudeFileEntry extends PersistentFileEntryBase {
  source: "claude-code";
  claudeEvents: CachedClaudeEvent[];
}

/**
 * Codex-family rollout sources: OpenAI Codex (`~/.codex/sessions`) and the
 * Every Code CLI, which persists the same rollout JSONL layout under
 * `~/.code/sessions`. Both share one controlled parser (`scanCodexFamily`).
 */
type RolloutSource = "codex" | "every-code";

interface PersistentCodexFileEntry extends PersistentFileEntryBase {
  source: RolloutSource;
  events: LocalUsageEvent[];
}

interface PersistentStructuredFileEntry extends PersistentFileEntryBase {
  source: "gemini-cli" | "grok" | "openclaw" | "antigravity" | "dsh";
  identifiedEvents: CachedIdentifiedEvent[];
  diagnostics: LocalUsageDiagnostic[];
  /**
   * DSH append-only decode state (present on entries parsed by the current
   * scanner version): the byte extent already decoded, its prefix hash, and
   * the parser state at the prefix end. A file that only grew can then be
   * updated by decoding the appended frames instead of the whole log.
   */
  dsh?: DshPersistentFileFields;
}

/** Parser state at the end of a parsed DSH log prefix (tail parsing resumes). */
interface DshUsageParserState {
  sessionId: string;
  project: string;
  model: string;
  /** Number of records consumed so far (header offset + seq fallback). */
  recordIndex: number;
}

interface DshPersistentFileFields {
  /** Byte offset of the end of the last fully parsed zstd frame (the prefix). */
  prefixEnd: number;
  /** sha256 hex of the container bytes [0, prefixEnd) — proves append-only. */
  prefixHash: string;
  /** Whether the decoded prefix text ended at a line boundary ('\n'). */
  endsWithNewline: boolean;
  state: DshUsageParserState;
}

interface PersistentGenericFileEntry extends PersistentFileEntryBase {
  source: Exclude<
    LocalUsageSource,
    "claude-code" | "codex" | "gemini-cli" | "grok" | "openclaw"
  >;
  events: LocalUsageEvent[];
  /**
   * P2-17: optional per-event dedup identities (parallel to `events`, used by
   * workbuddy). Present on entries parsed after the fix; older in-memory
   * entries and other generic sources omit it and fall back to an event
   * fingerprint at aggregate time.
   */
  identities?: string[];
  diagnostics: LocalUsageDiagnostic[];
}

type PersistentFileEntry =
  | PersistentClaudeFileEntry
  | PersistentCodexFileEntry
  | PersistentStructuredFileEntry
  | PersistentGenericFileEntry;

interface PersistentUsageIndex {
  version: typeof PERSISTENT_CACHE_VERSION;
  registryFingerprint: string;
  files: PersistentFileEntry[];
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

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** A lookback in days: a positive integer, as `scanLocalUsage` clamps it. */
function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/** A row count, as the shared budget tracks it: a non-negative integer. */
function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

function timestampValue(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function isTimestampInRange(
  timestamp: Date,
  cutoffTime: number,
  nowTime: number,
): boolean {
  const time = timestamp.getTime();
  return time >= cutoffTime && time <= nowTime + FUTURE_TIMESTAMP_TOLERANCE_MS;
}

function privacyFingerprint(source: LocalUsageSource, value: unknown): string {
  return createHash("sha256")
    .update("aitracker-local-usage-event\0")
    .update(source)
    .update("\0")
    .update(JSON.stringify(value))
    .digest("hex");
}

function rawNonNegativeToken(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function isCachedEvent(
  value: unknown,
  source: LocalUsageSource,
): value is LocalUsageEvent {
  const event = asObject(value);
  return (
    event?.source === source &&
    timestampValue(event.timestamp) != null &&
    isPrivateSessionId(event.sessionId) &&
    typeof event.model === "string" &&
    typeof event.project === "string" &&
    nonNegativeNumber(event.inputTokens) &&
    nonNegativeNumber(event.cachedInputTokens) &&
    nonNegativeNumber(event.cacheCreationInputTokens) &&
    nonNegativeNumber(event.outputTokens) &&
    nonNegativeNumber(event.reasoningOutputTokens) &&
    nonNegativeNumber(event.totalTokens) &&
    (event.measurement == null ||
      event.measurement === "observed" ||
      event.measurement === "estimated") &&
    isCachedContext(event.context)
  );
}

function isCachedContext(value: unknown): boolean {
  if (value == null) return true;
  const context = asObject(value);
  if (
    context == null ||
    (context.textResponse != null && typeof context.textResponse !== "boolean")
  ) {
    return false;
  }
  if (
    context.tools != null &&
    (!Array.isArray(context.tools) ||
      !context.tools.every((tool) => {
        const item = asObject(tool);
        return (
          typeof item?.name === "string" &&
          item.name.length > 0 &&
          [
            "messages",
            "execution",
            "planning",
            "agent",
            "browser",
            "mcp",
            "skills",
            "other",
          ].includes(item.category as string) &&
          nonNegativeNumber(item.calls)
        );
      }))
  ) {
    return false;
  }
  if (
    context.skills != null &&
    (!Array.isArray(context.skills) ||
      !context.skills.every((skill) => {
        const item = asObject(skill);
        return (
          typeof item?.name === "string" &&
          item.name.length > 0 &&
          nonNegativeNumber(item.calls)
        );
      }))
  ) {
    return false;
  }
  if (
    context.commands != null &&
    (!Array.isArray(context.commands) ||
      !context.commands.every((command) => {
        const item = asObject(command);
        return (
          item?.kind === "exec_command" &&
          typeof item.executable === "string" &&
          typeof item.safeSignature === "string" &&
          ["under-1s", "1s-10s", "10s-60s", "over-60s", "unknown"].includes(
            item.duration as string,
          ) &&
          ["empty", "under-1k", "1k-10k", "over-10k", "unknown"].includes(
            item.outputSize as string,
          ) &&
          ["success", "failure", "interrupted", "unknown"].includes(
            item.exitStatus as string,
          ) &&
          nonNegativeNumber(item.calls)
        );
      }))
  ) {
    return false;
  }
  if (context.toolOutputs != null) {
    const output = asObject(context.toolOutputs);
    if (
      output == null ||
      !nonNegativeNumber(output.characters) ||
      !nonNegativeNumber(output.lines) ||
      !nonNegativeNumber(output.calls) ||
      typeof output.completed !== "boolean"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Decode the persisted `wal` field: `null` means "no WAL companion existed",
 * a valid signature object is trusted for cache reuse, and malformed values
 * degrade to `undefined` (untrusted — the file is re-parsed once).
 */
function cachedWalSignature(
  value: unknown,
): { mtimeMs: number; size: number } | null | undefined {
  if (value === null) return null;
  const wal = asObject(value);
  if (wal == null) return undefined;
  if (!nonNegativeNumber(wal.mtimeMs) || !nonNegativeNumber(wal.size)) {
    return undefined;
  }
  return { mtimeMs: wal.mtimeMs, size: wal.size };
}

/**
 * Decode the persisted budget identity of a sqlite parse (P1 cache review).
 * Malformed values degrade to `undefined` — the entry is re-parsed rather than
 * reused under a budget it cannot describe.
 */
function cachedSqliteBudget(value: unknown): SqliteBudgetIdentity | undefined {
  const identity = asObject(value);
  if (identity == null) return undefined;
  const limit = nonNegativeInteger(identity.limit);
  if (limit == null || typeof identity.truncated !== "boolean") {
    return undefined;
  }
  return { limit, truncated: identity.truncated };
}

function persistentFileEntry(value: unknown): PersistentFileEntry | undefined {
  const entry = asObject(value);
  const path = stringValue(entry?.path);
  const source = entry?.source;
  if (
    entry == null ||
    path == null ||
    !isLocalUsageSource(source) ||
    !nonNegativeNumber(entry.mtimeMs) ||
    !nonNegativeNumber(entry.size) ||
    !nonNegativeNumber(entry.malformedLines)
  ) {
    return undefined;
  }
  const wal = cachedWalSignature(entry.wal);
  // The window a sqlite parse was run with. Losing it on hydration makes every
  // sqlite entry look like it covers nothing, so the cache would never be
  // reused after a restart - the read cost the window exists to bound would
  // come back on every scan. Malformed values drop the field, which degrades
  // to a re-parse rather than a wrong reuse.
  const windowDays = positiveInteger(entry.windowDays);
  // The shared budget a sqlite parse was left with; losing it re-parses that
  // file once instead of reusing a partial result (P1 cache review).
  const sqliteBudget = cachedSqliteBudget(entry.sqliteBudget);

  if (source === "claude-code") {
    if (!Array.isArray(entry.claudeEvents)) {
      return undefined;
    }
    const claudeEvents: CachedClaudeEvent[] = [];
    for (const value of entry.claudeEvents) {
      const cached = asObject(value);
      const messageId = stringValue(cached?.messageId);
      if (messageId == null || !isCachedEvent(cached?.event, source)) {
        return undefined;
      }
      claudeEvents.push({ messageId, event: cached.event });
    }
    return {
      source,
      path,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      malformedLines: entry.malformedLines,
      ...(wal !== undefined ? { wal } : {}),
      claudeEvents,
    };
  }

  if (
    source === "gemini-cli" ||
    source === "grok" ||
    source === "openclaw" ||
    source === "antigravity" ||
    source === "dsh"
  ) {
    if (!Array.isArray(entry.identifiedEvents)) return undefined;
    const identifiedEvents: CachedIdentifiedEvent[] = [];
    for (const value of entry.identifiedEvents) {
      const cached = asObject(value);
      const identity = stringValue(cached?.identity);
      if (identity == null || !isCachedEvent(cached?.event, source)) {
        return undefined;
      }
      identifiedEvents.push({ identity, event: cached.event });
    }
    const base: PersistentStructuredFileEntry = {
      source: source as PersistentStructuredFileEntry["source"],
      path,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      malformedLines: entry.malformedLines,
      ...(wal !== undefined ? { wal } : {}),
      identifiedEvents,
      diagnostics: Array.isArray(entry.diagnostics)
        ? entry.diagnostics.filter(isCachedDiagnostic)
        : [],
    };
    if (source !== "dsh") return base;
    // Optional DSH append state: absent on legacy/foreign entries, in which
    // case a changed file is simply re-parsed in full on the next scan.
    const dsh = asObject(entry.dsh);
    if (dsh == null) return base;
    const state = asObject(dsh.state);
    if (
      !nonNegativeNumber(dsh.prefixEnd) ||
      typeof dsh.prefixHash !== "string" ||
      dsh.prefixHash.length !== 64 ||
      typeof dsh.endsWithNewline !== "boolean" ||
      state == null ||
      typeof state.sessionId !== "string" ||
      typeof state.project !== "string" ||
      typeof state.model !== "string" ||
      !nonNegativeNumber(state.recordIndex)
    ) {
      return base;
    }
    return {
      ...base,
      dsh: {
        prefixEnd: dsh.prefixEnd,
        prefixHash: dsh.prefixHash,
        endsWithNewline: dsh.endsWithNewline,
        state: {
          sessionId: state.sessionId,
          project: state.project,
          model: state.model,
          recordIndex: state.recordIndex,
        },
      },
    };
  }

  if (
    !Array.isArray(entry.events) ||
    !entry.events.every((event) => isCachedEvent(event, source))
  ) {
    return undefined;
  }
  if (source === "codex" || source === "every-code") {
    return {
      source,
      path,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      malformedLines: entry.malformedLines,
      ...(wal !== undefined ? { wal } : {}),
      events: entry.events,
    };
  }
  const diagnostics = Array.isArray(entry.diagnostics)
    ? entry.diagnostics.filter(isCachedDiagnostic)
    : [];
  // P2-17: workbuddy stores a parallel per-event identity array. Malformed or
  // length-mismatched identities degrade to the aggregate fingerprint rather
  // than discarding the (already validated) cached events.
  const identities =
    Array.isArray(entry.identities) &&
    entry.identities.length === entry.events.length &&
    entry.identities.every(
      (identity) => typeof identity === "string" && identity.length > 0,
    )
      ? entry.identities
      : undefined;
  return {
    source: source as PersistentGenericFileEntry["source"],
    path,
    mtimeMs: entry.mtimeMs,
    size: entry.size,
    malformedLines: entry.malformedLines,
    ...(wal !== undefined ? { wal } : {}),
    ...(windowDays == null ? {} : { windowDays }),
    ...(sqliteBudget == null ? {} : { sqliteBudget }),
    events: entry.events,
    ...(identities == null ? {} : { identities }),
    diagnostics,
  };
}

function isLocalUsageSource(value: unknown): value is LocalUsageSource {
  return (
    typeof value === "string" &&
    BUILTIN_USAGE_ADAPTERS.some((adapter) => adapter.source === value)
  );
}

/**
 * Diagnostic codes that may be restored from the persisted scan index.
 *
 * This list is a validation gate, not documentation: a code missing here makes
 * every persisted diagnostic carrying it vanish when the index is rehydrated,
 * so a warning the user already saw silently disappears one restart later.
 * `query-truncated` was lost exactly that way, which turned a visible
 * truncation back into a silent one.
 *
 * `retained-previous` is deliberately absent: the collector synthesizes it
 * when it merges previous evidence into a committed snapshot, so it is never a
 * scan-time diagnostic.
 *
 * The annotation makes the compiler check this list against the union: adding
 * a code to `LocalUsageDiagnosticCode` fails the build until it is classified
 * here.
 */
const CACHED_DIAGNOSTIC_CODES: ReadonlySet<LocalUsageDiagnostic["code"]> =
  new Set<LocalUsageDiagnostic["code"]>([
    "config-invalid",
    "file-too-large",
    "field-mismatch",
    "malformed-json",
    "query-failed",
    "query-truncated",
    "read-failed",
  ]);

function isCachedDiagnostic(value: unknown): value is LocalUsageDiagnostic {
  const item = asObject(value);
  return (
    isLocalUsageSource(item?.source) &&
    typeof item.code === "string" &&
    CACHED_DIAGNOSTIC_CODES.has(item.code as LocalUsageDiagnostic["code"]) &&
    nonNegativeNumber(item.count) &&
    typeof item.message === "string" &&
    (item.path == null || typeof item.path === "string")
  );
}

function writeProcessIndex(
  cacheKey: string,
  files: PersistentFileEntry[],
): void {
  processUsageIndexes.set(cacheKey, {
    version: PERSISTENT_CACHE_VERSION,
    registryFingerprint: REGISTRY_FINGERPRINT,
    files,
  });
}

/**
 * Serializable snapshot of the in-memory usage scan index, for persistence
 * across processes. The scanner module never touches the disk itself — the
 * caller (composition) owns where the snapshot is stored and atomically
 * replaces it after each scan. Restoring is done via `hydrateUsageScanIndex`
 * before the next scan of a fresh process.
 */
export interface UsageScanIndexSnapshotFile {
  readonly version: 1;
  readonly indexes: ReadonlyArray<{
    readonly cacheKey: string;
    readonly index: PersistentUsageIndex;
  }>;
}

export function snapshotUsageScanIndex(): UsageScanIndexSnapshotFile | null {
  if (processUsageIndexes.size === 0) return null;
  return {
    version: 1,
    indexes: [...processUsageIndexes].map(([cacheKey, index]) => ({
      cacheKey,
      index: {
        version: index.version,
        registryFingerprint: index.registryFingerprint,
        files: index.files,
      },
    })),
  };
}

/**
 * Restore a persisted usage scan index into this process. Entries whose cache
 * version or registry fingerprint no longer matches are discarded (the next
 * scan rebuilds them); malformed entries are validated away individually.
 */
export function hydrateUsageScanIndex(state: unknown): void {
  if (state == null || typeof state !== "object" || Array.isArray(state)) {
    return;
  }
  const file = state as { version?: unknown; indexes?: unknown };
  if (file.version !== 1 || !Array.isArray(file.indexes)) return;
  for (const item of file.indexes) {
    const candidate = asObject(item);
    if (candidate == null) continue;
    const cacheKey = stringValue(candidate.cacheKey);
    const index = asObject(candidate.index);
    if (cacheKey == null || index == null) continue;
    if (
      index.version !== PERSISTENT_CACHE_VERSION ||
      index.registryFingerprint !== REGISTRY_FINGERPRINT ||
      !Array.isArray(index.files)
    ) {
      continue;
    }
    const files: PersistentFileEntry[] = [];
    for (const raw of index.files) {
      const entry = persistentFileEntry(raw);
      if (entry != null) files.push(entry);
    }
    processUsageIndexes.set(cacheKey, {
      version: PERSISTENT_CACHE_VERSION,
      registryFingerprint: REGISTRY_FINGERPRINT,
      files,
    });
  }
}

/** Test seam: clears the module-level index (simulates a fresh process). */
export function __resetUsageScanIndexForTests(): void {
  processUsageIndexes.clear();
}

function fileSignatureMatches(
  candidate: FileCandidate,
  entry: PersistentFileEntry | undefined,
  source: LocalUsageSource,
): boolean {
  return (
    entry?.source === source &&
    entry.mtimeMs === candidate.modifiedAt &&
    entry.size === candidate.size
  );
}

/**
 * WAL-companion freshness for sqlite candidates (non-sqlite files always
 * match). WAL-mode databases append new frames to `db.sqlite-wal` while the
 * main `db.sqlite` file keeps its mtime/size until the next checkpoint, so a
 * matching main-file signature alone would silently serve stale cached
 * events. A malformed/missing persisted signature never blocks a re-parse:
 * it simply means the entry cannot prove freshness.
 */
function sqliteWalMatches(
  candidate: FileCandidate & { format: UsageAdapterPath["format"] },
  entry: PersistentFileEntry | undefined,
  /**
   * Lookback the current scan was asked for. A sqlite entry is parsed through
   * a windowed query, so it only holds the rows inside the window it was run
   * with and may be reused only when that window covers this request.
   * Widening the lookback must re-parse: the narrower cache does not contain
   * the older events, and serving it would silently under-report (issue #42
   * review). Non-sqlite callers omit it, which skips the check.
   */
  requestedWindowDays?: number,
): boolean {
  if (candidate.format !== "sqlite") return true;
  if (entry == null) return false;
  if (
    requestedWindowDays !== undefined &&
    !(entry.windowDays != null && entry.windowDays >= requestedWindowDays)
  ) {
    return false;
  }
  const cached = entry.wal;
  if (cached === undefined) return false;
  const wal = candidate.wal;
  if (wal == null) return cached === null;
  return (
    cached !== null &&
    wal.modifiedAt === cached.mtimeMs &&
    wal.size === cached.size
  );
}

/**
 * P1/P2-1 cache review: whether the source's sqlite file set reproduces the
 * selection its cached entries were built from.
 *
 * A database the budget cut short does not hold "its newest rows" - it holds
 * the rows its siblings left it, because the budget keeps the newest rows of
 * the whole source (P2-1). Such an entry may be reused only while every input
 * of that selection is unchanged: the same set of databases, each with the same
 * signature, WAL companion and window, all selected under the same budget. The
 * selection is deterministic, so re-offering exactly those entries reproduces
 * exactly the previous result - which is also why the whole set is checked at
 * once rather than per file. An entry that was never cut needs none of this:
 * it holds every row of its own window.
 */
function sqliteSetReproducible(
  source: LocalUsageSource,
  sqliteFiles: readonly (FileCandidate & {
    format: UsageAdapterPath["format"];
  })[],
  cachedFiles: Map<string, PersistentFileEntry>,
  lookbackDays: number,
  limit: number,
): boolean {
  if (sqliteFiles.length === 0) return false;
  // A database that disappeared, or one that appeared, changes what the budget
  // had to distribute - and its own entry is still in the cache until this scan
  // replaces the index, so the two sets are comparable.
  const cachedSqlitePaths = new Set<string>();
  for (const entry of cachedFiles.values()) {
    if (entry.source !== source || entry.sqliteBudget == null) continue;
    cachedSqlitePaths.add(entry.path);
  }
  if (cachedSqlitePaths.size !== sqliteFiles.length) return false;
  for (const file of sqliteFiles) {
    if (!cachedSqlitePaths.has(file.path)) return false;
    const cached = cachedFiles.get(file.path);
    if (
      !fileSignatureMatches(file, cached, source) ||
      !sqliteWalMatches(file, cached, lookbackDays) ||
      cached?.sqliteBudget?.limit !== limit
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The budget identity of a sqlite selection: the cap it ran under and whether
 * this database lost rows to it. Rows lost because the budget is full, because
 * newer rows of another database displaced them, or because the read stopped
 * once this database could no longer contribute all mean the same thing for
 * reuse - the entry no longer describes the database on its own.
 */
function sqliteBudgetIdentity(
  limit: number,
  truncated: boolean,
): SqliteBudgetIdentity {
  return { limit, truncated };
}

/**
 * Stat the `-wal` companion of a sqlite database: `null` when it does not
 * exist (the database is not in WAL mode, or its WAL was checkpointed and
 * removed on a clean close).
 */
async function walSignatureFor(
  databasePath: string,
): Promise<{ modifiedAt: number; size: number } | null> {
  try {
    const info = await stat(`${databasePath}-wal`);
    return info.isFile() ? { modifiedAt: info.mtimeMs, size: info.size } : null;
  } catch {
    return null;
  }
}

async function collectRecentJsonlFiles(
  roots: string[],
  cutoffTime: number,
  maxFiles: number,
  fileMatches: (name: string) => boolean,
  signal?: AbortSignal,
): Promise<{ available: boolean; files: FileCandidate[] }> {
  const candidates: FileCandidate[] = [];
  let available = false;
  let discoveredEntries = 0;

  for (const root of roots) {
    signal?.throwIfAborted();
    try {
      const rootStat = await stat(root);
      if (!rootStat.isDirectory()) {
        continue;
      }
      available = true;
    } catch {
      continue;
    }

    const pendingDirectories = [root];
    while (
      pendingDirectories.length > 0 &&
      discoveredEntries < MAX_DISCOVERED_ENTRIES_PER_SOURCE
    ) {
      // P5-T5-02: abort promptly between directory entries.
      signal?.throwIfAborted();
      const directoryPath = pendingDirectories.pop();
      if (directoryPath == null) {
        break;
      }

      let directory;
      try {
        directory = await opendir(directoryPath);
      } catch {
        continue;
      }

      for await (const entry of directory) {
        signal?.throwIfAborted();
        discoveredEntries += 1;
        if (discoveredEntries >= MAX_DISCOVERED_ENTRIES_PER_SOURCE) {
          break;
        }

        const entryPath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(entryPath);
          continue;
        }
        if (!entry.isFile() || !fileMatches(entry.name)) {
          continue;
        }

        try {
          const fileStat = await stat(entryPath);
          if (fileStat.mtimeMs >= cutoffTime) {
            candidates.push({
              path: entryPath,
              modifiedAt: fileStat.mtimeMs,
              size: fileStat.size,
            });
          }
        } catch {
          continue;
        }
      }
    }
  }

  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return { available, files: candidates.slice(0, maxFiles) };
}

function globExpression(glob: string): RegExp {
  let expression = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*" && glob[index + 1] === "*") {
      if (glob[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else if (character === "[") {
      const end = glob.indexOf("]", index + 1);
      if (end > index) {
        expression += glob.slice(index, end + 1);
        index = end;
      } else {
        expression += "\\[";
      }
    } else {
      expression += character.replace(/[\\^$+?.()|{}]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

interface UsagePlacement {
  /** Absolute directory to scan for this path config. */
  root: string;
  pathConfig: UsageAdapterPath;
}

type UsageOverrideMap = ReadonlyMap<string, string>;

export interface ToolUsageOverride {
  segment: string;
  dir: string;
}

/**
 * Resolve the override shape for one usage source: the override directory
 * plus the uniform HOME-anchored data segment of its registry usage roots.
 * Tools without a uniform segment (or without any usage roots) are not
 * rebasable and simply keep their default placement.
 */
export function usageOverrideFor(
  source: string,
  overrides: UsageOverrideMap | undefined,
): ToolUsageOverride | null {
  const dir = overrides?.get(source)?.trim();
  if (!dir) return null;
  const def = getTool(source);
  const roots = (def?.capabilities.usage.paths ?? []).map((path) => path.root);
  const segment = uniformDataSegment(roots.filter(isHomeFlattenedRoot));
  return segment == null ? null : { segment, dir };
}

/**
 * Turn per-path usage configs into absolute scan placements. Without an
 * override this is the historic join(home, root); with an override the
 * HOME-anchored roots are rebased under the override directory and every
 * non-HOME platform arm is skipped.
 */
export function rebaseUsagePathConfigs(
  pathConfigs: readonly UsageAdapterPath[],
  homeDirectory: string,
  override: ToolUsageOverride | null,
): UsagePlacement[] {
  if (override == null) {
    return pathConfigs.map((pathConfig) => ({
      root: join(homeDirectory, pathConfig.root),
      pathConfig,
    }));
  }
  const placements: UsagePlacement[] = [];
  for (const pathConfig of pathConfigs) {
    if (!isHomeFlattenedRoot(pathConfig.root)) continue;
    const rebased = rebaseRoot(pathConfig.root, override.segment, override.dir);
    if (rebased == null) continue;
    placements.push({ root: rebased, pathConfig });
  }
  return placements;
}

async function collectAdapterFiles(
  placements: readonly UsagePlacement[],
  cutoffTime: number,
  maxFiles: number,
  signal?: AbortSignal,
): Promise<{
  detected: boolean;
  files: Array<FileCandidate & { format: UsageAdapterPath["format"] }>;
}> {
  const candidates = new Map<
    string,
    FileCandidate & { format: UsageAdapterPath["format"] }
  >();
  let discoveredEntries = 0;
  let detected = false;

  for (const placement of placements) {
    signal?.throwIfAborted();
    const root = placement.root;
    let rootStat;
    try {
      rootStat = await stat(root);
    } catch {
      continue;
    }
    if (!rootStat.isDirectory()) continue;
    detected = true;

    const matcher = globExpression(placement.pathConfig.glob);
    const pendingDirectories = [root];
    while (
      pendingDirectories.length > 0 &&
      discoveredEntries < MAX_DISCOVERED_ENTRIES_PER_SOURCE
    ) {
      // P5-T5-03: stop walking the directory tree once cancelled.
      signal?.throwIfAborted();
      const directoryPath = pendingDirectories.pop();
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
        if (discoveredEntries >= MAX_DISCOVERED_ENTRIES_PER_SOURCE) break;
        const entryPath = join(directoryPath, entry.name);
        if (entry.isDirectory()) {
          pendingDirectories.push(entryPath);
          continue;
        }
        const relativePath = relative(root, entryPath).split(sep).join("/");
        if (!entry.isFile() || !matcher.test(relativePath)) continue;
        try {
          const fileStat = await stat(entryPath);
          if (fileStat.mtimeMs >= cutoffTime) {
            const candidate: FileCandidate & {
              format: UsageAdapterPath["format"];
            } = {
              path: entryPath,
              modifiedAt: fileStat.mtimeMs,
              size: fileStat.size,
              format: placement.pathConfig.format,
            };
            if (placement.pathConfig.format === "sqlite") {
              candidate.wal = await walSignatureFor(entryPath);
            }
            candidates.set(entryPath, candidate);
          }
        } catch {
          continue;
        }
      }
    }
  }

  return {
    detected,
    files: [...candidates.values()]
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(0, maxFiles),
  };
}

/**
 * Usage paths are declared for concrete registry targets (for example,
 * AiPy's macOS Application Support path and its Windows AppData path). The
 * compiled adapter retains those targets so the scanner cannot walk a path
 * belonging to another operating system when both path shapes happen to
 * exist under a test fixture or a shared home directory.
 */
function adapterPathsForPlatform(
  paths: readonly UsageAdapterPath[],
  os: PlatformOs,
): UsageAdapterPath[] {
  const targets =
    os === "macos"
      ? ["macos"]
      : os === "windows"
        ? ["windows10", "windows11"]
        : ["linux"];
  return paths.filter(
    (path) =>
      path.targets == null ||
      path.targets.some((target) => targets.includes(target)),
  );
}

async function readJsonLines(
  filePath: string,
  onRecord: (record: JsonObject) => void,
  signal?: AbortSignal,
  maxFileBytes: number = MAX_JSONL_FILE_BYTES,
): Promise<{ malformedLines: number; oversized: boolean }> {
  let malformedLines = 0;
  // P2-17: stat pre-check before streaming so a file above the whole-file cap
  // is skipped instead of buffered (bounded collection memory). Callers turn
  // the flag into a file-too-large diagnostic. Native readers may pass a
  // tighter registry-declared cap; the shared default is the hard JSONL cap.
  try {
    const fileStat = await stat(filePath);
    if (fileStat.size > maxFileBytes) {
      return { malformedLines: 0, oversized: true };
    }
  } catch {
    // Stat failure is non-fatal; the stream reports read errors below.
  }
  const input = createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 64 * 1024,
  });
  const lines = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
      // P5-T5-02/03: stop parsing promptly once the refresh is cancelled.
      signal?.throwIfAborted();
      if (line.length === 0 || line.length > MAX_JSONL_LINE_LENGTH) {
        if (line.length > MAX_JSONL_LINE_LENGTH) {
          malformedLines += 1;
        }
        continue;
      }

      try {
        const record = asObject(JSON.parse(line));
        if (record != null) {
          onRecord(record);
        } else {
          malformedLines += 1;
        }
      } catch {
        malformedLines += 1;
      }
    }
  } catch {
    malformedLines += 1;
  } finally {
    lines.close();
    input.destroy();
  }

  return { malformedLines, oversized: false };
}

function claudeEventFromRecord(
  record: JsonObject,
  fallbackSessionId: string,
  homeDirectory: string,
): { id: string; event: LocalUsageEvent } | undefined {
  const message = asObject(record.message);
  const usage = asObject(message?.usage);
  const id = stringValue(message?.id);
  const timestamp = timestampValue(record.timestamp ?? message?.timestamp);

  if (id == null || usage == null || timestamp == null) {
    return undefined;
  }

  const inputTokens = tokenValue(usage.input_tokens);
  const cachedInputTokens = tokenValue(usage.cache_read_input_tokens);
  const cacheCreationInputTokens = tokenValue(
    usage.cache_creation_input_tokens,
  );
  const outputTokens = tokenValue(usage.output_tokens);
  const reasoningOutputTokens = tokenValue(usage.reasoning_output_tokens);
  // P1-8: totalTokens includes every consumed component — reasoning is parsed
  // separately from output and must not be dropped from the grand total.
  const totalTokens =
    inputTokens +
    cachedInputTokens +
    cacheCreationInputTokens +
    outputTokens +
    reasoningOutputTokens;

  if (totalTokens === 0) {
    return undefined;
  }

  // Collection context (tools/skills/commands), structural metadata only, clean-room compliant.
  const context = collectClaudeContext(message);

  return {
    id,
    event: {
      source: "claude-code",
      timestamp: timestamp.toISOString(),
      sessionId:
        sessionIdFromStructuredValue(
          "claude-code",
          record.sessionId ??
            record.session_id ??
            record.conversationId ??
            record.conversation_id ??
            record.threadId ??
            record.thread_id ??
            message?.sessionId ??
            message?.session_id,
        ) ?? fallbackSessionId,
      model:
        stringValue(message?.model) ?? stringValue(record.model) ?? "unknown",
      project: normalizeProjectPath(
        stringValue(record.cwd) ?? stringValue(record.project) ?? "unknown",
        homeDirectory,
      ),
      inputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens,
      ...(context ? { context } : {}),
    },
  };
}

async function scanClaude(
  roots: string[],
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal?: AbortSignal,
): Promise<SourceScanResult> {
  const selected = await collectRecentJsonlFiles(
    roots,
    cutoffTime,
    maxFiles,
    (name) => name.endsWith(".jsonl"),
    signal,
  );
  const byMessageId = new Map<string, LocalUsageEvent>();
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;
  const claudeDiagnostics: LocalUsageDiagnostic[] = [];
  const cacheEntries: PersistentClaudeFileEntry[] = [];

  for (const file of selected.files) {
    signal?.throwIfAborted();
    const cached = cachedFiles.get(file.path);
    let entry: PersistentClaudeFileEntry;
    if (fileSignatureMatches(file, cached, "claude-code")) {
      entry = cached as PersistentClaudeFileEntry;
      filesReused += 1;
    } else {
      const claudeEvents: CachedClaudeEvent[] = [];
      const toolUseEventById = new Map<string, LocalUsageEvent>();
      const root =
        roots.find((candidate) => {
          const relativePath = relative(candidate, file.path);
          return relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
        }) ?? roots[0];
      const fallbackSessionId = sessionIdFromRelativeFile(
        "claude-code",
        `${basename(root)}:${relative(root, file.path)}`,
      );
      const { malformedLines: fileMalformedLines, oversized } =
        await readJsonLines(
          file.path,
          (record) => {
            const parsed = claudeEventFromRecord(
              record,
              fallbackSessionId,
              homeDirectory,
            );
            if (parsed != null) {
              claudeEvents.push({ messageId: parsed.id, event: parsed.event });
              for (const toolUseId of collectClaudeToolUseIds(record.message)) {
                toolUseEventById.set(toolUseId, parsed.event);
              }
            }
            for (const result of collectClaudeToolResults(record.message)) {
              const event = toolUseEventById.get(result.toolUseId);
              if (event == null) continue;
              const previous = event.context?.toolOutputs;
              event.context = {
                ...event.context,
                toolOutputs: {
                  characters:
                    (previous?.characters ?? 0) + result.summary.characters,
                  lines: (previous?.lines ?? 0) + result.summary.lines,
                  completed:
                    (previous?.completed ?? true) && result.summary.completed,
                  calls: (previous?.calls ?? 0) + result.summary.calls,
                },
              };
            }
          },
          signal,
        );
      signal?.throwIfAborted();
      if (oversized) {
        claudeDiagnostics.push({
          source: "claude-code",
          code: "file-too-large",
          path: file.path,
          count: 1,
          message: `日志超过 ${MAX_JSONL_FILE_BYTES} 字节读取上限，已跳过。`,
        });
      }
      entry = {
        source: "claude-code",
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: fileMalformedLines,
        claudeEvents,
      };
      filesParsed += 1;
    }
    cacheEntries.push(entry);
    filesRead += 1;
    malformedLines += entry.malformedLines;

    for (const parsed of entry.claudeEvents) {
      if (
        !isTimestampInRange(
          new Date(parsed.event.timestamp),
          cutoffTime,
          nowTime,
        )
      ) {
        continue;
      }
      const messageIdentity = `${parsed.event.sessionId}:${parsed.messageId}`;
      const existing = byMessageId.get(messageIdentity);
      if (
        existing == null ||
        parsed.event.totalTokens > existing.totalTokens ||
        (parsed.event.totalTokens === existing.totalTokens &&
          parsed.event.timestamp > existing.timestamp)
      ) {
        byMessageId.set(messageIdentity, parsed.event);
      }
    }
  }

  const events = [...byMessageId.values()];
  return {
    events,
    summary: {
      source: "claude-code",
      available: events.length > 0,
      detected: selected.available,
      paths: roots,
      filesConsidered: selected.files.length,
      filesRead,
      filesReused,
      filesParsed,
      malformedLines,
      events: events.length,
      diagnostics: claudeDiagnostics,
    },
    cacheEntries,
  };
}

function codexContextFromRecord(
  record: JsonObject,
): { model?: string; project?: string } | undefined {
  const payload = asObject(record.payload);
  const recordType = stringValue(record.type);
  const payloadType = stringValue(payload?.type);
  if (recordType !== "turn_context" && payloadType !== "turn_context") {
    return undefined;
  }

  const context =
    payloadType === "turn_context" || recordType === "turn_context"
      ? payload
      : record;
  return {
    model: stringValue(context?.model),
    project: stringValue(context?.cwd) ?? stringValue(context?.project),
  };
}

function codexSessionIdFromRecord(
  record: JsonObject,
  source: RolloutSource,
): string | undefined {
  const payload = asObject(record.payload);
  const explicitIdentifier =
    record.sessionId ??
    record.session_id ??
    record.conversationId ??
    record.conversation_id ??
    record.threadId ??
    record.thread_id ??
    payload?.sessionId ??
    payload?.session_id ??
    payload?.conversationId ??
    payload?.conversation_id ??
    payload?.threadId ??
    payload?.thread_id;
  const explicitSessionId = sessionIdFromStructuredValue(
    source,
    explicitIdentifier,
  );
  if (explicitSessionId != null) {
    return explicitSessionId;
  }

  const recordType = stringValue(record.type);
  const payloadType = stringValue(payload?.type);
  if (recordType === "session_meta" || payloadType === "session_meta") {
    return sessionIdFromStructuredValue(source, payload?.id ?? record.id);
  }
  return undefined;
}

function codexEventFromRecord(
  record: JsonObject,
  context: { model: string; project: string; sessionId: string },
  pendingContext: LocalUsageEvent["context"],
  previousTotalUsage?: JsonObject,
  source: RolloutSource = "codex",
): LocalUsageEvent | undefined {
  const payload = asObject(record.payload);
  const nestedMessage = asObject(payload?.msg);
  const tokenPayload =
    stringValue(payload?.type) === "token_count"
      ? payload
      : stringValue(nestedMessage?.type) === "token_count"
        ? nestedMessage
        : undefined;
  if (tokenPayload == null) {
    return undefined;
  }

  const info = asObject(tokenPayload.info);
  const lastUsage = asObject(info?.last_token_usage);
  const totalUsage = asObject(info?.total_token_usage);
  let usage = lastUsage;
  if (usage == null && totalUsage != null && previousTotalUsage != null) {
    usage = {};
    for (const key of [
      "input_tokens",
      "cached_input_tokens",
      "cache_creation_input_tokens",
      "cache_write_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
    ]) {
      usage[key] = Math.max(
        0,
        tokenValue(totalUsage[key]) - tokenValue(previousTotalUsage[key]),
      );
    }
  }
  const timestamp = timestampValue(record.timestamp ?? tokenPayload.timestamp);
  if (usage == null || timestamp == null) {
    return undefined;
  }

  const cachedInputTokens = tokenValue(usage.cached_input_tokens);
  const rawInputTokens = tokenValue(usage.input_tokens);
  const inputTokens = Math.max(0, rawInputTokens - cachedInputTokens);
  const cacheCreationInputTokens =
    tokenValue(usage.cache_creation_input_tokens) +
    tokenValue(usage.cache_write_input_tokens);
  const outputTokens = tokenValue(usage.output_tokens);
  const reasoningOutputTokens = tokenValue(usage.reasoning_output_tokens);
  // P1-8: totalTokens includes every consumed component — reasoning is parsed
  // separately from output and must not be dropped from the grand total.
  const totalTokens =
    inputTokens +
    cachedInputTokens +
    cacheCreationInputTokens +
    outputTokens +
    reasoningOutputTokens;

  if (totalTokens === 0) {
    return undefined;
  }

  return {
    source,
    timestamp: timestamp.toISOString(),
    sessionId: context.sessionId,
    model: context.model,
    project: context.project,
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
    ...(pendingContext == null ? {} : { context: pendingContext }),
  };
}

/**
 * Codex (OpenAI CLI) native reader entry point: scan the passed session roots
 * (regular + archived, per configured home) with the shared rollout parser.
 * Behavior is pinned by the codex regression tests; it must stay exactly the
 * default-parameter path of {@link scanCodexFamily}.
 */
async function scanCodex(
  roots: string[],
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal?: AbortSignal,
): Promise<SourceScanResult> {
  return scanCodexFamily(
    "codex",
    roots,
    homeDirectory,
    cutoffTime,
    nowTime,
    maxFiles,
    cachedFiles,
    signal,
  );
}

/**
 * Every Code native usage reader. Every Code is a Codex-family CLI that
 * persists session rollouts with the SAME JSONL schema as codex (context
 * lines `turn_context` with payload.model/cwd, token lines carrying
 * `last_token_usage`/`total_token_usage` — both the flat
 * `payload.type === "token_count"` envelope and the nested
 * `payload.msg.type === "token_count"` form are accepted). Roots are kept
 * simple by design: only `join(home, ".code", "sessions")` per home is
 * scanned — no `archived_sessions` tree and no WSL arm, unlike codex. The
 * registry-declared per-file cap (64 MiB) is enforced before streaming.
 */
async function scanEveryCodeUsageAdapter(
  roots: string[],
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal?: AbortSignal,
): Promise<SourceScanResult> {
  const adapter = BUILTIN_USAGE_ADAPTERS.find(
    (candidate) => candidate.source === "every-code",
  );
  return scanCodexFamily(
    "every-code",
    roots,
    homeDirectory,
    cutoffTime,
    nowTime,
    maxFiles,
    cachedFiles,
    signal,
    adapter?.maxFileSizeBytes,
  );
}

/**
 * Shared Codex-family rollout scan (codex + every-code). `roots` are passed
 * in (each caller computes its own home/archive topology) and `source`
 * parameterizes event/cache/summary identity. `maxFileBytes` is the optional
 * registry-declared whole-file cap; omitting it keeps the reader's hard JSONL
 * cap (the codex default).
 */
async function scanCodexFamily(
  source: RolloutSource,
  roots: string[],
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal?: AbortSignal,
  maxFileBytes?: number,
): Promise<SourceScanResult> {
  const fileCap = maxFileBytes ?? MAX_JSONL_FILE_BYTES;
  const selected = await collectRecentJsonlFiles(
    roots,
    cutoffTime,
    maxFiles,
    (name) => name.endsWith(".jsonl"),
    signal,
  );
  const events: LocalUsageEvent[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;
  const rolloutDiagnostics: LocalUsageDiagnostic[] = [];
  const cacheEntries: PersistentCodexFileEntry[] = [];

  for (const file of selected.files) {
    signal?.throwIfAborted();
    const cached = cachedFiles.get(file.path);
    let entry: PersistentCodexFileEntry;
    if (fileSignatureMatches(file, cached, source)) {
      entry = cached as PersistentCodexFileEntry;
      filesReused += 1;
    } else {
      const root =
        roots.find((candidate) => {
          const relativePath = relative(candidate, file.path);
          return relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
        }) ?? roots[0];
      const relativeFileIdentity = `${basename(root)}:${relative(root, file.path)}`;
      const context = {
        model: "unknown",
        project: "unknown",
        sessionId: sessionIdFromRelativeFile(source, relativeFileIdentity),
      };
      const fileEvents: LocalUsageEvent[] = [];
      let pendingContext = createCodexPendingContext();
      let previousTotalUsage: JsonObject | undefined;
      const { malformedLines: fileMalformedLines, oversized } =
        await readJsonLines(
          file.path,
          (record) => {
            context.sessionId =
              codexSessionIdFromRecord(record, source) ?? context.sessionId;
            const nextContext = codexContextFromRecord(record);
            if (nextContext != null) {
              context.model = nextContext.model ?? context.model;
              context.project =
                nextContext.project == null
                  ? context.project
                  : normalizeProjectPath(nextContext.project, homeDirectory);
              return;
            }

            const event = codexEventFromRecord(
              record,
              context,
              consumeCodexPendingContext(pendingContext),
              previousTotalUsage,
              source,
            );
            const payload = asObject(record.payload);
            const nestedMessage = asObject(payload?.msg);
            const tokenPayload =
              stringValue(payload?.type) === "token_count"
                ? payload
                : stringValue(nestedMessage?.type) === "token_count"
                  ? nestedMessage
                  : undefined;
            const totalUsage = asObject(
              asObject(tokenPayload?.info)?.total_token_usage,
            );
            if (totalUsage != null) previousTotalUsage = totalUsage;
            if (event != null) {
              fileEvents.push(event);
              pendingContext = createCodexPendingContext();
              return;
            }
            collectCodexContextRecord(pendingContext, record);
          },
          signal,
          fileCap,
        );
      signal?.throwIfAborted();
      if (oversized) {
        rolloutDiagnostics.push({
          source,
          code: "file-too-large",
          path: file.path,
          count: 1,
          message: `日志超过 ${fileCap} 字节读取上限，已跳过。`,
        });
      }
      entry = {
        source,
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: fileMalformedLines,
        events: fileEvents,
      };
      filesParsed += 1;
    }
    cacheEntries.push(entry);
    filesRead += 1;
    malformedLines += entry.malformedLines;
    events.push(
      ...entry.events.filter((event) =>
        isTimestampInRange(new Date(event.timestamp), cutoffTime, nowTime),
      ),
    );
  }

  return {
    events,
    summary: {
      source,
      available: events.length > 0,
      detected: selected.available,
      paths: roots,
      filesConsidered: selected.files.length,
      filesRead,
      filesReused,
      filesParsed,
      malformedLines,
      events: events.length,
      diagnostics: rolloutDiagnostics,
    },
    cacheEntries,
  };
}

function workbuddyEventFromRecord(
  record: JsonObject,
  fallbackSessionId: string,
  homeDirectory: string,
): LocalUsageEvent | undefined {
  const providerData = asObject(record.providerData);
  const rawUsage = asObject(providerData?.rawUsage);
  const timestamp = timestampValue(record.timestamp);
  if (rawUsage == null || timestamp == null) return undefined;

  const promptDetails = asObject(rawUsage.prompt_tokens_details);
  const completionDetails = asObject(rawUsage.completion_tokens_details);
  const promptTokens = tokenValue(rawUsage.prompt_tokens);
  const completionTokens = tokenValue(rawUsage.completion_tokens);
  const cachedInputTokens = Math.max(
    tokenValue(rawUsage.cache_read_input_tokens),
    tokenValue(promptDetails?.cached_tokens),
    tokenValue(rawUsage.prompt_cache_hit_tokens),
  );
  const cacheCreationInputTokens = tokenValue(
    rawUsage.cache_creation_input_tokens,
  );
  const inputTokens = Math.max(
    0,
    promptTokens - cachedInputTokens - cacheCreationInputTokens,
  );
  const reasoningOutputTokens = Math.min(
    completionTokens,
    Math.max(
      tokenValue(completionDetails?.reasoning_tokens),
      tokenValue(rawUsage.completion_thinking_tokens),
    ),
  );
  const outputTokens = Math.max(0, completionTokens - reasoningOutputTokens);
  const totalTokens =
    inputTokens +
    cachedInputTokens +
    cacheCreationInputTokens +
    outputTokens +
    reasoningOutputTokens;
  if (totalTokens === 0) return undefined;

  return {
    source: "workbuddy",
    timestamp: timestamp.toISOString(),
    sessionId:
      sessionIdFromStructuredValue("workbuddy", record.sessionId) ??
      fallbackSessionId,
    model:
      stringValue(providerData?.requestModelName) ??
      stringValue(providerData?.requestModelId) ??
      stringValue(providerData?.model) ??
      "auto",
    project: normalizeProjectPath(
      stringValue(record.cwd) ?? "unknown",
      homeDirectory,
    ),
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

async function scanWorkbuddy(
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal?: AbortSignal,
): Promise<SourceScanResult> {
  const workbuddyRoot = join(homeDirectory, ".workbuddy");
  const projectsRoot = join(workbuddyRoot, "projects");
  const databasePath = join(workbuddyRoot, "workbuddy.db");
  const selected = await collectRecentJsonlFiles(
    [projectsRoot],
    cutoffTime,
    maxFiles,
    (name) => name.endsWith(".jsonl"),
    signal,
  );
  const cacheEntries: PersistentGenericFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  const seenResponseIds = new Set<string>();
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  for (const file of selected.files) {
    signal?.throwIfAborted();
    const cached = cachedFiles.get(file.path);
    let entry: PersistentGenericFileEntry;
    if (fileSignatureMatches(file, cached, "workbuddy")) {
      entry = cached as PersistentGenericFileEntry;
      filesReused += 1;
    } else {
      const fileEvents: LocalUsageEvent[] = [];
      const fileIdentities: string[] = [];
      const fallbackSessionId = sessionIdFromRelativeFile(
        "workbuddy",
        relative(projectsRoot, file.path),
      );
      const { malformedLines: fileMalformedLines, oversized } =
        await readJsonLines(
          file.path,
          (record) => {
            const providerData = asObject(record.providerData);
            if (asObject(providerData?.rawUsage) == null) return;
            const responseId =
              stringValue(record.id) ??
              stringValue(providerData?.messageId) ??
              `${stringValue(record.sessionId) ?? relative(projectsRoot, file.path)}:${String(record.timestamp)}`;
            if (seenResponseIds.has(responseId)) return;
            const event = workbuddyEventFromRecord(
              record,
              fallbackSessionId,
              homeDirectory,
            );
            if (event != null) {
              seenResponseIds.add(responseId);
              fileEvents.push(event);
              // P2-17: persist the response identity so a later scan can dedupe
              // this file's events against a rotated copy even when the file
              // itself is cache-reused (identity survives the cache path).
              fileIdentities.push(privacyFingerprint("workbuddy", responseId));
            }
          },
          signal,
        );
      signal?.throwIfAborted();
      if (oversized) {
        diagnostics.push({
          source: "workbuddy",
          code: "file-too-large",
          path: file.path,
          count: 1,
          message: `日志超过 ${MAX_JSONL_FILE_BYTES} 字节读取上限，已跳过。`,
        });
      }
      entry = {
        source: "workbuddy",
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: fileMalformedLines,
        events: fileEvents,
        identities: fileIdentities,
        diagnostics: [],
      };
      filesParsed += 1;
    }
    cacheEntries.push(entry);
    filesRead += 1;
    malformedLines += entry.malformedLines;
  }

  // P2-17: dedup across every file — freshly parsed and cache-reused alike —
  // so a response present in both a newly parsed file and a reused rotated
  // copy is counted once. Cached entries carry per-event identities; legacy
  // entries without stored identities fall back to an event fingerprint.
  const events: LocalUsageEvent[] = [];
  const byIdentity = new Map<string, LocalUsageEvent>();
  for (const entry of cacheEntries) {
    const identities = entry.identities;
    for (let index = 0; index < entry.events.length; index += 1) {
      const event = entry.events[index];
      if (!isTimestampInRange(new Date(event.timestamp), cutoffTime, nowTime)) {
        continue;
      }
      const identity =
        identities?.[index] ??
        privacyFingerprint("workbuddy", [
          event.sessionId ?? null,
          event.timestamp,
          event.totalTokens,
          "workbuddy",
        ]);
      if (byIdentity.has(identity)) continue;
      byIdentity.set(identity, event);
    }
  }
  events.push(...byIdentity.values());

  let databaseDetected = false;
  // WorkBuddy can retain only cumulative session usage in SQLite. Use that as
  // a fallback when detailed JSONL usage is absent so we do not double-count.
  if (events.length === 0) {
    let database: DatabaseSync | undefined;
    try {
      const databaseStat = await stat(databasePath);
      databaseDetected = databaseStat.isFile();
      if (databaseDetected) {
        database = new DatabaseSync(databasePath, { readOnly: true });
        const rows = database
          .prepare(
            `SELECT
               su.session_id AS sessionId,
               su.used AS used,
               su.updated_at AS updatedAt,
               s.model AS model,
               s.cwd AS project
             FROM session_usage su
             LEFT JOIN sessions s ON s.id = su.session_id
             WHERE su.used > 0 AND su.updated_at > 0`,
          )
          .all() as Array<Record<string, unknown>>;
        for (const row of rows) {
          const rawTimestamp = tokenValue(row.updatedAt);
          const timestamp = timestampValue(
            rawTimestamp > 10_000_000_000 ? rawTimestamp : rawTimestamp * 1_000,
          );
          const inputTokens = tokenValue(row.used);
          if (
            timestamp == null ||
            inputTokens === 0 ||
            !isTimestampInRange(timestamp, cutoffTime, nowTime)
          ) {
            continue;
          }
          events.push({
            source: "workbuddy",
            timestamp: timestamp.toISOString(),
            sessionId:
              sessionIdFromStructuredValue("workbuddy", row.sessionId) ??
              sessionIdFromRelativeFile("workbuddy", `sqlite:${events.length}`),
            model: stringValue(row.model) ?? "auto",
            project: normalizeProjectPath(
              stringValue(row.project) ?? "unknown",
              homeDirectory,
            ),
            inputTokens,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: inputTokens,
          });
        }
      }
    } catch {
      if (databaseDetected) {
        diagnostics.push({
          source: "workbuddy",
          code: "query-failed",
          path: databasePath,
          count: 1,
          message: "WorkBuddy SQLite 用量读取失败，已保留 JSONL 扫描结果。",
        });
      }
    } finally {
      database?.close();
    }
  } else {
    databaseDetected = await stat(databasePath)
      .then((value) => value.isFile())
      .catch(() => false);
  }

  return {
    events,
    summary: {
      source: "workbuddy",
      available: events.length > 0,
      detected: selected.available || databaseDetected,
      paths: [projectsRoot, databasePath],
      filesConsidered: selected.files.length + (databaseDetected ? 1 : 0),
      filesRead: filesRead + (databaseDetected ? 1 : 0),
      filesReused,
      filesParsed:
        filesParsed + (databaseDetected && events.length > 0 ? 1 : 0),
      malformedLines,
      events: events.length,
      diagnostics,
    },
    cacheEntries,
  };
}

function geminiTokenSnapshot(value: unknown): LocalTokenCounts | undefined {
  const tokens = asObject(value);
  if (tokens == null) return undefined;
  const inputTokens = tokenValue(tokens.input);
  const cachedInputTokens = tokenValue(tokens.cached);
  const output = tokenValue(tokens.output);
  const tool = tokenValue(tokens.tool);
  const reasoningOutputTokens = tokenValue(tokens.thoughts);
  const outputTokens = output + tool;
  const componentTotal =
    inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;
  const totalTokens = Math.max(tokenValue(tokens.total), componentTotal);
  return {
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens: 0,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function diffGeminiSnapshot(
  current: LocalTokenCounts,
  previous?: LocalTokenCounts,
): LocalTokenCounts | undefined {
  if (previous == null) return current.totalTokens > 0 ? current : undefined;
  const reset = current.totalTokens < previous.totalTokens;
  if (reset) return current.totalTokens > 0 ? current : undefined;
  const deltaComponents = {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(
      0,
      current.cachedInputTokens - previous.cachedInputTokens,
    ),
    cacheCreationInputTokens: Math.max(
      0,
      current.cacheCreationInputTokens - previous.cacheCreationInputTokens,
    ),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(
      0,
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
    ),
  };
  const componentTotal =
    deltaComponents.inputTokens +
    deltaComponents.cachedInputTokens +
    deltaComponents.cacheCreationInputTokens +
    deltaComponents.outputTokens +
    deltaComponents.reasoningOutputTokens;
  const delta = {
    ...deltaComponents,
    totalTokens: Math.max(
      componentTotal,
      current.totalTokens - previous.totalTokens,
    ),
  };
  return delta.totalTokens > 0 ? delta : undefined;
}

async function parseGeminiUsageFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  fallbackSessionId: string,
  signal?: AbortSignal,
): Promise<{
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  signal?.throwIfAborted();
  let session: JsonObject | undefined;
  try {
    session = asObject(JSON.parse(await readFile(file.path, "utf8")));
  } catch {
    return { identifiedEvents: [], malformedLines: 1, diagnostics: [] };
  }
  signal?.throwIfAborted();
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  const sessionId =
    sessionIdFromStructuredValue(
      "gemini-cli",
      session?.id ?? session?.sessionId ?? session?.session_id,
    ) ?? fallbackSessionId;
  const identifiedEvents: CachedIdentifiedEvent[] = [];
  let previous: LocalTokenCounts | undefined;
  let model = "unknown";

  for (let index = 0; index < messages.length; index += 1) {
    signal?.throwIfAborted();
    const message = asObject(messages[index]);
    if (message == null) continue;
    model = stringValue(message.model) ?? model;
    const current = geminiTokenSnapshot(message.tokens);
    if (current == null) continue;
    const delta = diffGeminiSnapshot(current, previous);
    previous = current;
    const timestamp = timestampValue(message.timestamp);
    if (delta == null || timestamp == null) continue;
    identifiedEvents.push({
      identity: privacyFingerprint("gemini-cli", [sessionId, index]),
      event: {
        source: "gemini-cli",
        timestamp: timestamp.toISOString(),
        sessionId,
        model,
        project: "unknown",
        ...delta,
      },
    });
  }
  return { identifiedEvents, malformedLines: 0, diagnostics: [] };
}

function grokTimestamp(record: JsonObject, meta: JsonObject | undefined) {
  const agentTimestamp = meta?.agentTimestampMs;
  if (typeof agentTimestamp === "number" && agentTimestamp > 0) {
    return timestampValue(agentTimestamp);
  }
  const envelope = record.timestamp;
  if (typeof envelope === "number" && envelope > 0) {
    return timestampValue(
      envelope > 1_000_000_000_000 ? envelope : envelope * 1_000,
    );
  }
  return timestampValue(envelope);
}

function grokTokenCounts(usage: JsonObject): LocalTokenCounts | undefined {
  const rawInputTokens = tokenValue(usage.inputTokens ?? usage.input_tokens);
  const cacheReadTokens = tokenValue(
    usage.cachedReadTokens ??
      usage.cacheReadTokens ??
      usage.cache_read_input_tokens,
  );
  const cachedInputTokens =
    cacheReadTokens || tokenValue(usage.cached_input_tokens);
  const inputTokens = Math.max(0, rawInputTokens - cacheReadTokens);
  const cacheCreationInputTokens = tokenValue(
    usage.cachedWriteTokens ??
      usage.cacheWriteTokens ??
      usage.cache_creation_input_tokens,
  );
  const outputTokens = tokenValue(usage.outputTokens ?? usage.output_tokens);
  const reasoningOutputTokens = tokenValue(
    usage.reasoningTokens ?? usage.reasoning_output_tokens,
  );
  const componentTotal =
    inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens;
  const totalTokens =
    tokenValue(usage.totalTokens ?? usage.total_tokens) || componentTotal;
  if (totalTokens === 0) return undefined;
  return {
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

async function parseGrokUsageFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  fallbackSessionId: string,
  signal?: AbortSignal,
): Promise<{
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  const identifiedEvents: CachedIdentifiedEvent[] = [];
  const { malformedLines, oversized } = await readJsonLines(
    file.path,
    (record) => {
      const params = asObject(record.params);
      const update = asObject(params?.update);
      if (stringValue(update?.sessionUpdate) !== "turn_completed") return;
      const usage = asObject(update?.usage);
      const modelUsage = asObject(usage?.modelUsage);
      const meta = asObject(params?._meta);
      const timestamp = grokTimestamp(record, meta);
      if (modelUsage == null || timestamp == null) return;
      const sessionId =
        sessionIdFromStructuredValue("grok", params?.sessionId) ??
        fallbackSessionId;
      const eventId = stringValue(meta?.eventId);

      for (const [model, rawModelUsage] of Object.entries(modelUsage)) {
        const counts = grokTokenCounts(asObject(rawModelUsage) ?? {});
        if (counts == null) continue;
        const identityMaterial =
          eventId == null
            ? [timestamp.toISOString(), sessionId, model, counts]
            : [eventId, sessionId, model];
        identifiedEvents.push({
          identity: privacyFingerprint("grok", identityMaterial),
          event: {
            source: "grok",
            timestamp: timestamp.toISOString(),
            sessionId,
            model,
            project: "unknown",
            ...counts,
          },
        });
      }
    },
    signal,
  );
  return {
    identifiedEvents,
    malformedLines,
    diagnostics: oversized
      ? [
          {
            source: "grok",
            code: "file-too-large",
            path: file.path,
            count: 1,
            message: `日志超过 ${MAX_JSONL_FILE_BYTES} 字节读取上限，已跳过。`,
          },
        ]
      : [],
  };
}

function openclawUsage(value: unknown): JsonObject | undefined {
  const usage = asObject(value);
  if (usage == null) return undefined;
  for (const field of [
    "input",
    "cacheRead",
    "cacheWrite",
    "output",
    "totalTokens",
  ]) {
    if (usage[field] != null && rawNonNegativeToken(usage[field]) == null) {
      return undefined;
    }
  }
  return usage;
}

async function parseOpenclawUsageFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  fallbackSessionId: string,
  signal?: AbortSignal,
): Promise<{
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  const identifiedEvents: CachedIdentifiedEvent[] = [];
  const { malformedLines, oversized } = await readJsonLines(
    file.path,
    (record) => {
      if (record.type !== "message") return;
      const message = asObject(record.message);
      if (message?.role !== "assistant") return;
      const usage = openclawUsage(message.usage);
      const timestamp = timestampValue(record.timestamp);
      if (usage == null || timestamp == null) return;
      const rawInputTokens = tokenValue(usage.input);
      const cachedInputTokens = tokenValue(usage.cacheRead);
      const inputTokens = Math.max(0, rawInputTokens - cachedInputTokens);
      const cacheCreationInputTokens = tokenValue(usage.cacheWrite);
      const outputTokens = tokenValue(usage.output);
      const totalTokens =
        inputTokens +
        cachedInputTokens +
        cacheCreationInputTokens +
        outputTokens;
      if (totalTokens === 0) return;
      const model = stringValue(message.model) ?? "unknown";
      const stableId = stringValue(record.id);
      const identityMaterial =
        stableId == null
          ? {
              timestamp: record.timestamp,
              messageTimestamp: message.timestamp,
              responseId: stringValue(message.responseId) ?? null,
              model,
              provider: stringValue(message.provider) ?? null,
              api: stringValue(message.api) ?? null,
              inputTokens,
              cachedInputTokens,
              cacheCreationInputTokens,
              outputTokens,
              totalTokens,
            }
          : { stableId };
      identifiedEvents.push({
        identity: privacyFingerprint("openclaw", identityMaterial),
        event: {
          source: "openclaw",
          timestamp: timestamp.toISOString(),
          sessionId: fallbackSessionId,
          model,
          project: "unknown",
          inputTokens,
          cachedInputTokens,
          cacheCreationInputTokens,
          outputTokens,
          reasoningOutputTokens: 0,
          totalTokens,
        },
      });
    },
    signal,
  );
  return {
    identifiedEvents,
    malformedLines,
    diagnostics: oversized
      ? [
          {
            source: "openclaw",
            code: "file-too-large",
            path: file.path,
            count: 1,
            message: `日志超过 ${MAX_JSONL_FILE_BYTES} 字节读取上限，已跳过。`,
          },
        ]
      : [],
  };
}

/** Legacy-compatible local estimate: CJK chars count one each, other text one per four chars. */
function estimateAntigravityTokens(value: unknown): number {
  const text =
    typeof value === "string"
      ? value
      : value == null
        ? ""
        : JSON.stringify(value);
  let cjk = 0;
  let other = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const isCjk =
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff);
    if (isCjk) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

function antigravityModelFromSelection(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(
    /changed setting `Model Selection` from .*? to ([^`\n]+?)(?:\s*\([^)]*\))?\.(?:\s+|$)/iu,
  );
  if (match == null) return undefined;
  let model = match[1]!
    .trim()
    .replace(/\([^)]*\)/gu, " ")
    .replace(/\b(thinking|xhigh|high|medium|low|fast)\b/giu, " ")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .replace(/-{2,}/gu, "-");
  if (!model) return undefined;
  for (const marker of ["gemini", "claude", "gpt"]) {
    const index = model.indexOf(marker);
    if (index >= 0) {
      model = model.slice(index);
      break;
    }
  }
  return /^(gemini|claude|gpt)-/u.test(model) ? model : `antigravity-${model}`;
}

function antigravityContextTokens(record: JsonObject): number {
  let tokens = estimateAntigravityTokens(record.content);
  if (record.type === "PLANNER_RESPONSE") {
    tokens += estimateAntigravityTokens(record.tool_calls);
  }
  return tokens;
}

/**
 * Antigravity stores no provider token usage. This reader intentionally emits
 * a labelled model-level estimate and does not expose any context breakdown.
 * Raw transcript content is used only during this scan and is never cached.
 */
async function parseAntigravityUsageFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  fallbackSessionId: string,
  signal?: AbortSignal,
): Promise<{
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  const identifiedEvents: CachedIdentifiedEvent[] = [];
  let model = "antigravity-unknown";
  let contextTokens = 0;
  let previousContextTokens = 0;
  let index = 0;
  const { malformedLines, oversized } = await readJsonLines(
    file.path,
    (record) => {
      index += 1;
      if (
        record.type === "USER_INPUT" ||
        record.type === "USER_SETTINGS_CHANGE"
      ) {
        model = antigravityModelFromSelection(record.content) ?? model;
      }
      const eventContextTokens = antigravityContextTokens(record);
      if (record.type !== "PLANNER_RESPONSE") {
        contextTokens += eventContextTokens;
        return;
      }
      const timestamp = timestampValue(record.created_at);
      const inputTokens = Math.max(0, contextTokens - previousContextTokens);
      const outputTokens =
        estimateAntigravityTokens(record.content) +
        estimateAntigravityTokens(record.tool_calls);
      const reasoningOutputTokens = estimateAntigravityTokens(record.thinking);
      const totalTokens = inputTokens + outputTokens + reasoningOutputTokens;
      previousContextTokens = contextTokens;
      contextTokens += eventContextTokens;
      if (timestamp == null || totalTokens === 0) return;
      identifiedEvents.push({
        identity: privacyFingerprint("antigravity", [
          fallbackSessionId,
          index,
          timestamp.toISOString(),
          model,
          totalTokens,
        ]),
        event: {
          source: "antigravity",
          timestamp: timestamp.toISOString(),
          sessionId: fallbackSessionId,
          model,
          project: "unknown",
          inputTokens,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          outputTokens,
          reasoningOutputTokens,
          totalTokens,
          measurement: "estimated",
        },
      });
    },
    signal,
  );
  return {
    identifiedEvents,
    malformedLines,
    diagnostics: oversized
      ? [
          {
            source: "antigravity",
            code: "file-too-large",
            path: file.path,
            count: 1,
            message: `日志超过 ${MAX_JSONL_FILE_BYTES} 字节读取上限，已跳过。`,
          },
        ]
      : [],
  };
}

/**
 * DeepSeek Harness (DSH) session-log reader. DSH persists one append-only log
 * per agent session at `~/.dsh/sessions/<workspace>/<session-id>/` — a
 * concatenated-frame zstd container of JSONL event records (plaintext `.jsonl`
 * with compression "none" is also accepted). The file is named after the
 * Session FORMAT GENERATION it stores (`session.jsonl` for generation 0,
 * `session.vN.jsonl` after that), and a format migration leaves the older
 * generation's file in place, so `scanDshUsageAdapter` resolves each session
 * directory to its highest canonical generation before reading. The first
 * record is the session header (id/cwd); later `assistant/message` records
 * carry the provider's final usage sample per turn/step, with the same field
 * names in every generation. Only stats are extracted: message content, system
 * prompts and tool payloads are read transiently and never cached.
 */
// ---------------------------------------------------------------------------
// Pi (earendil-works/pi coding agent) native reader.
//
// Pi persists one plaintext JSONL file per session under
// ~/.pi/agent/sessions/<--cwd-->/, named `<createdAt>_<encodeURIComponent(id)>.jsonl`.
// The first line is a storage header — v4 `{kind:"header", id, cwd,
// createdAt, ...}` or legacy v3 `{type:"session", version:3, id, timestamp,
// cwd}` — and assistant turns append metadata-only usage envelopes:
// `{type:"message", id, message:{role:"assistant", model, provider,
// timestamp, usage:{input, output, cacheRead, cacheWrite, reasoningTokens?,
// reasoning?, totalTokens?}}}`. Pi routes each message to its own provider,
// so model comes from the message, never from the file. Only stats are
// extracted; message content is read transiently and never retained.
// ---------------------------------------------------------------------------

/** Pi-style timestamp: message millis or an ISO string on the record. */
function piEventTimestampMs(
  record: JsonObject,
  message: JsonObject,
): number | null {
  const messageTime = message.timestamp;
  if (
    typeof messageTime === "number" &&
    Number.isFinite(messageTime) &&
    messageTime > 0
  ) {
    return messageTime;
  }
  for (const candidate of [messageTime, record.timestamp]) {
    if (typeof candidate === "string" && candidate.length > 0) {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

/**
 * Parse one pi session log into usage events. Lines are plaintext JSONL; a
 * trailing partially-written line (writer mid-append) is tolerated and not
 * counted as malformed.
 */
async function parsePiLikeUsageFile(
  source: "pi" | "omp",
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  fallbackSessionId: string,
  signal?: AbortSignal,
): Promise<{
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  signal?.throwIfAborted();
  const identifiedEvents: CachedIdentifiedEvent[] = [];
  let content: string;
  try {
    content = await readFile(file.path, "utf8");
  } catch {
    return {
      identifiedEvents,
      malformedLines: 1,
      diagnostics: [
        {
          source,
          code: "malformed-json",
          path: file.path,
          count: 1,
          message: `${source === "pi" ? "pi" : "oh-my-pi"} 会话日志无法读取，已跳过。`,
        },
      ],
    };
  }
  signal?.throwIfAborted();
  let sessionId = fallbackSessionId;
  let project = "unknown";
  let malformedLines = 0;
  const lines = content.split("\n");
  const finalLineUnterminated = !content.endsWith("\n");
  for (let index = 0; index < lines.length; index += 1) {
    signal?.throwIfAborted();
    const line = lines[index] ?? "";
    if (line.trim().length === 0) continue;
    let record: JsonObject;
    try {
      record = asObject(JSON.parse(line) as unknown) ?? {};
    } catch {
      // Tolerate a torn tail from an in-flight writer; other malformed lines
      // are diagnostics only.
      if (!(finalLineUnterminated && index === lines.length - 1)) {
        malformedLines += 1;
      }
      continue;
    }
    const recordKind = stringValue(record.kind);
    const recordType = stringValue(record.type);
    // Storage header (v4 or legacy v3): owns session id + cwd.
    if (recordKind === "header" || recordType === "session") {
      const headerId = stringValue(record.id);
      if (headerId != null) {
        sessionId = sessionIdFromStructuredValue(source, headerId) ?? sessionId;
      }
      const cwd = stringValue(record.cwd);
      if (cwd != null) project = cwd;
      continue;
    }
    if (recordType !== "message") continue;
    const message = asObject(record.message);
    if (message == null) continue;
    const role = stringValue(message.role);
    if (role !== "assistant") continue;
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
    const entryId = stringValue(record.id);
    if (entryId == null) continue;
    const timestampMs = piEventTimestampMs(record, message);
    if (timestampMs == null || totalTokens === 0) continue;
    const model = stringValue(message.model) ?? "unknown";
    identifiedEvents.push({
      identity: privacyFingerprint(source, [sessionId, entryId]),
      event: {
        source,
        timestamp: new Date(timestampMs).toISOString(),
        sessionId,
        model,
        project,
        inputTokens,
        cachedInputTokens,
        cacheCreationInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
      },
    });
  }
  return { identifiedEvents, malformedLines, diagnostics: [] };
}

async function parsePiUsageFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  fallbackSessionId: string,
  signal?: AbortSignal,
): Promise<{
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  return parsePiLikeUsageFile("pi", file, fallbackSessionId, signal);
}

async function parseOmpUsageFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  fallbackSessionId: string,
  signal?: AbortSignal,
): Promise<{
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  return parsePiLikeUsageFile("omp", file, fallbackSessionId, signal);
}

// ---------------------------------------------------------------------------
// DSH (DeepSeek Harness) native reader — append-incremental.
//
// DSH session logs are concatenated-zstd JSONL containers with one tiny frame
// per append batch, so decoding a whole log costs per-frame calls. A changed
// file whose cached parse proves a byte-identical prefix that ended on a line
// boundary is updated by decoding only the appended frames and merging their
// usage events into the cached events; rewritten/compacted logs fail the
// prefix hash check and fall back to a full parse. Only stats are extracted —
// message content is read transiently and never retained.
// ---------------------------------------------------------------------------

function dshUsageInitialState(fallbackSessionId: string): DshUsageParserState {
  return {
    sessionId: fallbackSessionId,
    project: "unknown",
    model: "unknown",
    recordIndex: 0,
  };
}

/**
 * Apply one JSONL line's record to the parser state. Returns true when the
 * line was malformed (mirrors the uncached whole-file parse). The header
 * record (position 1) is recognized only on a from-scratch parse — appended
 * tails resume from the cached state and never re-process it.
 */
function applyDshUsageLine(
  state: DshUsageParserState,
  line: string,
  events: CachedIdentifiedEvent[],
  signal?: AbortSignal,
): boolean {
  signal?.throwIfAborted();
  if (line.trim().length === 0) return false;
  let record: JsonObject;
  try {
    record = asObject(JSON.parse(line) as unknown) ?? {};
  } catch {
    return true;
  }
  state.recordIndex += 1;
  if (state.recordIndex === 1) {
    // Header record: {"type":"session","id":...,"createdAt":...,"cwd":...}
    const headerId = stringValue(record.id);
    if (record.type === "session" && headerId != null) {
      state.sessionId =
        sessionIdFromStructuredValue("dsh", headerId) ?? state.sessionId;
      state.project = stringValue(record.cwd) ?? state.project;
    }
    return false;
  }
  if (record.type === "request/header") {
    const header = asObject(asObject(record.data)?.header);
    state.model = stringValue(asObject(header?.config)?.model) ?? state.model;
    return false;
  }
  if (record.type === "request/context") {
    state.model = stringValue(asObject(record.data)?.model) ?? state.model;
    return false;
  }
  if (record.type !== "assistant/message") return false;
  const usage = asObject(asObject(record.data)?.usage);
  if (usage == null) return false;
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
  const timestamp = timestampValue(record.time);
  const seq = typeof record.seq === "number" ? record.seq : state.recordIndex;
  if (timestamp == null || totalTokens === 0) return false;
  events.push({
    identity: privacyFingerprint("dsh", [state.sessionId, seq]),
    event: {
      source: "dsh",
      timestamp: timestamp.toISOString(),
      sessionId: state.sessionId,
      model: state.model,
      project: state.project,
      inputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens,
    },
  });
  return false;
}

/** Parse an already-decoded text region, mutating the parser state. */
function parseDshUsageText(
  text: string,
  state: DshUsageParserState,
  signal?: AbortSignal,
): { events: CachedIdentifiedEvent[]; malformedLines: number } {
  const events: CachedIdentifiedEvent[] = [];
  let malformedLines = 0;
  for (const line of text.split("\n")) {
    if (applyDshUsageLine(state, line, events, signal)) malformedLines += 1;
  }
  return { events, malformedLines };
}

function isDshZstdBuffer(buffer: Buffer): boolean {
  return (
    buffer.length >= ZSTD_MAGIC_BYTES.length &&
    buffer.subarray(0, ZSTD_MAGIC_BYTES.length).equals(ZSTD_MAGIC_BYTES)
  );
}

function usageSha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

interface DshParsedLogEntry {
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
  prefixEnd: number;
  prefixHash: string;
  endsWithNewline: boolean;
  state: DshUsageParserState;
}

/**
 * Parse one dsh log, reusing the cached prefix when the file only grew:
 * decode just the appended frames and merge their events into the cached
 * events (parser state carries across the boundary). Returns null when the
 * log is unreadable/undecodable.
 */
async function parseDshUsageLogForFile(
  file: FileCandidate,
  fallbackSessionId: string,
  cached: PersistentStructuredFileEntry | undefined,
  signal?: AbortSignal,
): Promise<DshParsedLogEntry | null> {
  let buffer: Buffer;
  try {
    buffer = await readFile(file.path);
  } catch {
    return null;
  }
  const isZstd = isDshZstdBuffer(buffer);
  const cachedDshEntry =
    cached?.source === "dsh"
      ? (cached as PersistentStructuredFileEntry)
      : undefined;
  const cachedDsh = cachedDshEntry?.dsh;

  // Append-only incremental path: the parsed prefix is byte-identical and
  // ended on a line boundary, so only the bytes after prefixEnd need
  // decoding. A prefix that ended mid-line (not produced by the DSH writer)
  // or any rewrite/compaction is re-parsed in full below.
  if (
    cachedDshEntry != null &&
    cachedDsh != null &&
    cachedDsh.endsWithNewline &&
    buffer.length >= cachedDsh.prefixEnd &&
    usageSha256Hex(buffer.subarray(0, cachedDsh.prefixEnd)) ===
      cachedDsh.prefixHash
  ) {
    const state = { ...cachedDsh.state };
    if (buffer.length === cachedDsh.prefixEnd) {
      // Touch only — content unchanged, refresh the entry signature.
      return {
        identifiedEvents: cachedDshEntry.identifiedEvents,
        malformedLines: cachedDshEntry.malformedLines,
        diagnostics: cachedDshEntry.diagnostics,
        prefixEnd: cachedDsh.prefixEnd,
        prefixHash: cachedDsh.prefixHash,
        endsWithNewline: cachedDsh.endsWithNewline,
        state,
      };
    }
    try {
      if (isZstd) {
        const decoded = decodeZstdSessionLogWithBounds(
          buffer.subarray(cachedDsh.prefixEnd),
        );
        if (decoded.completeEnd === 0) {
          // Torn tail extended but no complete frame yet.
          return {
            identifiedEvents: cachedDshEntry.identifiedEvents,
            malformedLines: cachedDshEntry.malformedLines,
            diagnostics: cachedDshEntry.diagnostics,
            prefixEnd: cachedDsh.prefixEnd,
            prefixHash: cachedDsh.prefixHash,
            endsWithNewline: cachedDsh.endsWithNewline,
            state,
          };
        }
        const newPrefixEnd = cachedDsh.prefixEnd + decoded.completeEnd;
        const parsed = parseDshUsageText(decoded.text, state, signal);
        return {
          identifiedEvents: [
            ...cachedDshEntry.identifiedEvents,
            ...parsed.events,
          ],
          malformedLines: cachedDshEntry.malformedLines + parsed.malformedLines,
          diagnostics: cachedDshEntry.diagnostics,
          prefixEnd: newPrefixEnd,
          prefixHash: usageSha256Hex(buffer.subarray(0, newPrefixEnd)),
          endsWithNewline: decoded.text.endsWith("\n"),
          state,
        };
      }
      // Plaintext append (compression "none").
      const text = buffer.toString("utf8", cachedDsh.prefixEnd);
      const parsed = parseDshUsageText(text, state, signal);
      return {
        identifiedEvents: [
          ...cachedDshEntry.identifiedEvents,
          ...parsed.events,
        ],
        malformedLines: cachedDshEntry.malformedLines + parsed.malformedLines,
        diagnostics: cachedDshEntry.diagnostics,
        prefixEnd: buffer.length,
        prefixHash: usageSha256Hex(buffer),
        endsWithNewline: text.endsWith("\n"),
        state,
      };
    } catch {
      // Structural change (rewrite/compaction/corruption): full reparse below.
    }
  }

  // Full parse.
  const state = dshUsageInitialState(fallbackSessionId);
  let text: string;
  let prefixEnd = buffer.length;
  try {
    if (isZstd) {
      const decoded = decodeZstdSessionLogWithBounds(buffer);
      text = decoded.text;
      prefixEnd = decoded.completeEnd;
    } else {
      text = buffer.toString("utf8");
    }
  } catch {
    return null;
  }
  const parsed = parseDshUsageText(text, state, signal);
  return {
    identifiedEvents: parsed.events,
    malformedLines: parsed.malformedLines,
    diagnostics: [],
    prefixEnd,
    prefixHash: usageSha256Hex(buffer.subarray(0, prefixEnd)),
    endsWithNewline: text.endsWith("\n"),
    state,
  };
}

/**
 * Shared 'unique' merge for structured readers: events are deduplicated by
 * their identity (session+seq fingerprints) and time-range filtered, so a
 * cached prefix plus appended events never double-count.
 */
function mergeUniqueIdentifiedEvents(
  cacheEntries: readonly PersistentStructuredFileEntry[],
  cutoffTime: number,
  nowTime: number,
): LocalUsageEvent[] {
  const byIdentity = new Map<string, LocalUsageEvent>();
  for (const entry of cacheEntries) {
    for (const identified of entry.identifiedEvents) {
      if (
        isTimestampInRange(
          new Date(identified.event.timestamp),
          cutoffTime,
          nowTime,
        ) &&
        !byIdentity.has(identified.identity)
      ) {
        byIdentity.set(identified.identity, identified.event);
      }
    }
  }
  return [...byIdentity.values()];
}

type StructuredParser = typeof parseGeminiUsageFile;

async function scanStructuredAdapter(
  adapter: UsageAdapterContract,
  parser: StructuredParser,
  mergeMode: "unique" | "multiset",
  platformOs: PlatformOs,
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal?: AbortSignal,
  overrides?: UsageOverrideMap,
): Promise<SourceScanResult> {
  const pathConfigs = adapterPathsForPlatform(adapter.paths, platformOs);
  const placements = rebaseUsagePathConfigs(
    pathConfigs,
    homeDirectory,
    usageOverrideFor(adapter.source, overrides),
  );
  const selected = await collectAdapterFiles(
    placements,
    cutoffTime,
    maxFiles,
    signal,
  );
  const cacheEntries: PersistentStructuredFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  for (const file of selected.files) {
    signal?.throwIfAborted();
    const cached = cachedFiles.get(file.path);
    let entry: PersistentStructuredFileEntry;
    if (fileSignatureMatches(file, cached, adapter.source)) {
      entry = cached as PersistentStructuredFileEntry;
      filesReused += 1;
    } else if (file.size > adapter.maxFileSizeBytes) {
      entry = {
        source: adapter.source as PersistentStructuredFileEntry["source"],
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: 0,
        identifiedEvents: [],
        diagnostics: [
          diagnostic(
            adapter,
            "file-too-large",
            file.path,
            `日志超过 ${adapter.maxFileSizeBytes} 字节读取上限，已跳过。`,
          ),
        ],
      };
      filesParsed += 1;
    } else {
      const parsed = await parser(
        file,
        sessionIdFromRelativeFile(
          adapter.source,
          relative(homeDirectory, file.path),
        ),
        signal,
      );
      entry = {
        source: adapter.source as PersistentStructuredFileEntry["source"],
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: parsed.malformedLines,
        identifiedEvents: parsed.identifiedEvents,
        diagnostics: parsed.diagnostics,
      };
      filesParsed += 1;
    }
    cacheEntries.push(entry);
    diagnostics.push(...entry.diagnostics);
    malformedLines += entry.malformedLines;
    filesRead += 1;
  }

  const events: LocalUsageEvent[] = [];
  if (mergeMode === "unique") {
    events.push(
      ...mergeUniqueIdentifiedEvents(cacheEntries, cutoffTime, nowTime),
    );
  } else {
    const maximumCount = new Map<string, number>();
    const representative = new Map<string, LocalUsageEvent>();
    for (const entry of cacheEntries) {
      const perFileCount = new Map<string, number>();
      for (const identified of entry.identifiedEvents) {
        if (
          !isTimestampInRange(
            new Date(identified.event.timestamp),
            cutoffTime,
            nowTime,
          )
        ) {
          continue;
        }
        perFileCount.set(
          identified.identity,
          (perFileCount.get(identified.identity) ?? 0) + 1,
        );
        representative.set(identified.identity, identified.event);
      }
      for (const [identity, count] of perFileCount) {
        maximumCount.set(
          identity,
          Math.max(maximumCount.get(identity) ?? 0, count),
        );
      }
    }
    for (const [identity, count] of maximumCount) {
      const event = representative.get(identity);
      if (event == null) continue;
      for (let occurrence = 0; occurrence < count; occurrence += 1) {
        events.push(event);
      }
    }
  }

  return {
    events,
    summary: {
      source: adapter.source,
      available: events.length > 0,
      detected: selected.detected,
      paths: placements.map((placement) => placement.root),
      filesConsidered: selected.files.length,
      filesRead,
      filesReused,
      filesParsed,
      malformedLines,
      events: events.length,
      diagnostics,
    },
    cacheEntries,
  };
}
/**
 * DSH native scan: same per-file cache contract as the other structured
 * readers, but changed logs are parsed append-incrementally (only the frames
 * after the last parsed prefix are decoded and merged) instead of being
 * re-decoded in full.
 */
async function scanDshUsageAdapter(
  adapter: UsageAdapterContract,
  platformOs: PlatformOs,
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal?: AbortSignal,
  overrides?: UsageOverrideMap,
): Promise<SourceScanResult> {
  const pathConfigs = adapterPathsForPlatform(adapter.paths, platformOs);
  const placements = rebaseUsagePathConfigs(
    pathConfigs,
    homeDirectory,
    usageOverrideFor(adapter.source, overrides),
  );
  const candidates = await collectAdapterFiles(
    placements,
    cutoffTime,
    maxFiles,
    signal,
  );
  // One session directory can hold several format generations: a migration
  // rewrites the session under the new generation's name and leaves the source
  // file behind. The newest generation is a COMPLETE re-encoding of that
  // session, so it supersedes the older files rather than extending them —
  // reading both would count every migrated event twice. Superseded files are
  // dropped before the read budget is spent; `detected` still reflects the
  // placement walk, so a DSH install holding only superseded files stays
  // visible as detected-but-empty instead of disappearing.
  const selected = selectDshSessionLogs(candidates.files);
  const cacheEntries: PersistentStructuredFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  for (const file of selected) {
    signal?.throwIfAborted();
    const cached = cachedFiles.get(file.path);
    const cachedDsh =
      cached?.source === "dsh"
        ? (cached as PersistentStructuredFileEntry)
        : undefined;
    let entry: PersistentStructuredFileEntry;
    if (cachedDsh != null && fileSignatureMatches(file, cachedDsh, "dsh")) {
      entry = cachedDsh;
      filesReused += 1;
    } else if (file.size > adapter.maxFileSizeBytes) {
      entry = {
        source: "dsh",
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: 0,
        identifiedEvents: [],
        diagnostics: [
          diagnostic(
            adapter,
            "file-too-large",
            file.path,
            `日志超过 ${adapter.maxFileSizeBytes} 字节读取上限，已跳过。`,
          ),
        ],
      };
      filesParsed += 1;
    } else {
      const fallbackSessionId = sessionIdFromRelativeFile(
        "dsh",
        relative(homeDirectory, file.path),
      );
      const parsed = await parseDshUsageLogForFile(
        file,
        fallbackSessionId,
        cachedDsh,
        signal,
      );
      if (parsed == null) {
        entry = {
          source: "dsh",
          path: file.path,
          mtimeMs: file.modifiedAt,
          size: file.size,
          malformedLines: 1,
          identifiedEvents: [],
          diagnostics: [
            {
              source: "dsh",
              code: "malformed-json",
              path: file.path,
              count: 1,
              message: "DSH 会话日志无法解码，已跳过。",
            },
          ],
        };
      } else {
        entry = {
          source: "dsh",
          path: file.path,
          mtimeMs: file.modifiedAt,
          size: file.size,
          malformedLines: parsed.malformedLines,
          identifiedEvents: parsed.identifiedEvents,
          diagnostics: parsed.diagnostics,
          dsh: {
            prefixEnd: parsed.prefixEnd,
            prefixHash: parsed.prefixHash,
            endsWithNewline: parsed.endsWithNewline,
            state: parsed.state,
          },
        };
      }
      filesParsed += 1;
    }
    // Format-drift tripwire. A generation newer than the highest verified one
    // is read like any other, and one that keeps the records this reader
    // consumes needs no change here. When it does NOT keep them the file parses
    // cleanly and yields nothing, which would otherwise look exactly like a
    // harness that simply is not collecting: the user sees a source that is
    // detected, empty, and silent. Report the mismatch instead, from the file
    // name alone so no extra read or parser state is needed. Only a freshly
    // parsed entry can add it - a reused entry already carries the diagnostics
    // it was parsed with.
    if (entry !== cachedDsh) {
      const generation =
        parseDshLogFilename(basename(file.path))?.generation ?? 0;
      if (
        generation > DSH_MAX_VERIFIED_GENERATION &&
        entry.identifiedEvents.length === 0
      ) {
        entry = {
          ...entry,
          diagnostics: [
            ...entry.diagnostics,
            fieldMismatchDiagnostic(adapter, file.path, 1),
          ],
        };
      }
    }
    cacheEntries.push(entry);
    diagnostics.push(...entry.diagnostics);
    malformedLines += entry.malformedLines;
    filesRead += 1;
  }

  const events = mergeUniqueIdentifiedEvents(cacheEntries, cutoffTime, nowTime);
  return {
    events,
    summary: {
      source: "dsh",
      available: events.length > 0,
      detected: candidates.detected,
      paths: placements.map((placement) => placement.root),
      filesConsidered: selected.length,
      filesRead,
      filesReused,
      filesParsed,
      malformedLines,
      events: events.length,
      diagnostics,
    },
    cacheEntries,
  };
}

// Zed Agent (threads.db) parsing contract (TokenTracker-sourced). Every thread
// row stores the full thread JSON in `data` as utf8 text (`data_type='json'`)
// or as zstd-compressed utf8 text (`data_type='zstd'`). The thread JSON carries
// `request_token_usage` (a per-request map/array) and/or
// `cumulative_token_usage` (one object) with input_tokens / output_tokens /
// cache_read_input_tokens / cache_creation_input_tokens (integers, though some
// historical rows used numeric strings). A row is rewritten with larger
// cumulative totals on every send, so each scan emits one event per thread with
// its CURRENT totals (no per-thread delta bookkeeping).
//
// Providers whose usage is ALSO captured by a dedicated AITracker reader are
// skipped so the same tokens are never counted twice. Zed's native providers
// (zed.dev, copilot_chat, openai*, anthropic, google, ollama, lmstudio, ...) do
// not overlap any dedicated reader (e.g. Zed's copilot_chat talks to the
// Copilot API directly and never writes the ~/.copilot data the Copilot parser
// reads), so the set is empty today — the extension point if Zed ever persists
// external-ACP-agent usage (Claude Code / Codex run inside Zed) into
// threads.db with a recognizable provider id.
const ZED_DOUBLE_COUNTED_PROVIDERS: ReadonlySet<string> = new Set();
/** Cap on one decoded thread blob (raw or zstd-expanded), mirroring tokscale. */
const MAX_ZED_THREAD_JSON_BYTES = 16 * 1024 * 1024;

interface ZedTokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Coerce one token field: numbers and numeric strings, negatives -> 0. */
function zedTokenCount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  return 0;
}

/** Pull the 4-tuple out of one Zed TokenUsage object (null for non-objects). */
function zedReadUsage(value: unknown): ZedTokenTotals | null {
  const usage = asObject(value);
  if (usage == null) return null;
  return {
    input: zedTokenCount(usage.input_tokens),
    output: zedTokenCount(usage.output_tokens),
    cacheRead: zedTokenCount(usage.cache_read_input_tokens),
    cacheWrite: zedTokenCount(usage.cache_creation_input_tokens),
  };
}

function zedZeroTotals(): ZedTokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function zedTotalsSum(totals: ZedTokenTotals): number {
  return totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
}

/** Sum per-request usage (array items or object values). */
function zedSumRequestUsage(value: unknown): ZedTokenTotals {
  const totals = zedZeroTotals();
  const entries = Array.isArray(value)
    ? value
    : asObject(value) != null
      ? Object.values(asObject(value)!)
      : [];
  for (const entry of entries) {
    const usage = zedReadUsage(entry);
    if (usage == null) continue;
    totals.input += usage.input;
    totals.output += usage.output;
    totals.cacheRead += usage.cacheRead;
    totals.cacheWrite += usage.cacheWrite;
  }
  return totals;
}

/**
 * Extract the model + current totals from one decoded thread JSON.
 * Returns undefined for rows that must never become events: imported threads,
 * threads without a model id, threads of a double-counted provider, and
 * threads with no recorded usage at all.
 */
function zedThreadUsage(thread: unknown):
  | {
      model: string;
      totals: ZedTokenTotals;
    }
  | undefined {
  const value = asObject(thread);
  if (value == null) return undefined;
  if (value.imported === true) return undefined;
  const model = asObject(value.model);
  const modelId = stringValue(model?.model);
  if (modelId == null) return undefined;
  const provider =
    typeof model?.provider === "string" ? model.provider.trim() : "";
  if (
    provider.length > 0 &&
    ZED_DOUBLE_COUNTED_PROVIDERS.has(provider.toLowerCase())
  ) {
    return undefined;
  }
  const request = zedSumRequestUsage(value.request_token_usage);
  if (zedTotalsSum(request) > 0) return { model: modelId, totals: request };
  const cumulative = zedReadUsage(value.cumulative_token_usage);
  if (cumulative != null && zedTotalsSum(cumulative) > 0) {
    return { model: modelId, totals: cumulative };
  }
  return undefined;
}

/**
 * Decode + extract one threads.db row into an event payload. Throws for
 * undecodable rows (unsupported data_type, oversized/undecodable blobs,
 * invalid JSON); rows that simply carry no countable usage return undefined.
 */
function decodeZedThread(row: Record<string, unknown>):
  | {
      model: string;
      totals: ZedTokenTotals;
      updatedAt: Date;
    }
  | undefined {
  const id = stringValue(row.id);
  if (id == null) return undefined;
  const type = stringValue(row.data_type)?.trim().toLowerCase();
  const raw = row.data;
  const data = Buffer.isBuffer(raw)
    ? raw
    : raw instanceof Uint8Array
      ? Buffer.from(raw)
      : null;
  if (data == null) return undefined;
  let text: string;
  if (type === "json") {
    if (data.length > MAX_ZED_THREAD_JSON_BYTES) {
      throw new Error(`json blob exceeds ${MAX_ZED_THREAD_JSON_BYTES} bytes`);
    }
    text = data.toString("utf8");
  } else if (type === "zstd") {
    const out = zstdDecompressSync(data);
    if (out.length > MAX_ZED_THREAD_JSON_BYTES) {
      throw new Error(
        `decoded zstd blob exceeds ${MAX_ZED_THREAD_JSON_BYTES} bytes`,
      );
    }
    text = out.toString("utf8");
  } else {
    throw new Error(`unsupported data_type: ${String(row.data_type)}`);
  }
  const usage = zedThreadUsage(JSON.parse(text) as unknown);
  if (usage == null) return undefined;
  const updatedAt = timestampValue(row.updated_at);
  if (updatedAt == null) return undefined;
  return { model: usage.model, totals: usage.totals, updatedAt };
}

/**
 * Parse Zed's `threads.db` (one event per thread row, current cumulative
 * totals). Rows that cannot be decoded are skipped and counted as malformed;
 * a row-level failure never fails the whole database.
 */
function parseZedThreadsDb(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  adapter: UsageAdapterContract,
  signal: AbortSignal | undefined,
  budget: SqliteRowBudget,
  cutoffTime: number,
): {
  events: LocalUsageEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
} {
  signal?.throwIfAborted();
  const events: LocalUsageEvent[] = [];
  let malformedLines = 0;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(file.path, { readOnly: true });
    // Issue #42: `threads.db` grows with every conversation, so its size must
    // never gate the read - a sqlite file is queried, not buffered. Rows are
    // streamed and the walk stops at the shared row budget.
    let exceeded = false;
    // `updated_at` is an ISO-8601 TEXT column, so it is compared as text: the
    // numeric cutoff has to be converted first, or SQLite applies TEXT
    // affinity to the parameter and a lexicographic comparison makes every
    // ISO date satisfy `>= "<digits>"`. Two bindings of the same value because
    // the window is compared twice - once as the type the column stores, once
    // as the same instant in milliseconds, so a row whose timestamp is a bare
    // epoch (every other reader accepts both) is filtered either way.
    const cutoffIso = new Date(cutoffTime).toISOString().replace(".000Z", "Z");
    for (const row of database
      .prepare(
        `SELECT id, updated_at, data_type, data FROM threads
         WHERE updated_at >= ? OR CAST(updated_at AS INTEGER) >= ?
         ORDER BY updated_at DESC, rowid DESC`,
      )
      .iterate(cutoffIso, cutoffTime) as IterableIterator<
      Record<string, unknown>
    >) {
      signal?.throwIfAborted();
      if (budget.exhausted()) {
        exceeded = true;
        break;
      }
      let decoded;
      try {
        decoded = decodeZedThread(row);
      } catch {
        malformedLines += 1;
        continue;
      }
      if (decoded == null) continue;
      const totals = decoded.totals;
      const totalTokens =
        totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
      budget.take();
      events.push({
        source: adapter.source as LocalUsageSource,
        timestamp: decoded.updatedAt.toISOString(),
        // decodeZedThread only returns rows with a non-empty id, so the
        // structured session id is always derivable here.
        sessionId: sessionIdFromStructuredValue(adapter.source, row.id)!,
        model: decoded.model,
        project: "unknown",
        inputTokens: totals.input,
        cachedInputTokens: totals.cacheRead,
        cacheCreationInputTokens: totals.cacheWrite,
        outputTokens: totals.output,
        reasoningOutputTokens: 0,
        totalTokens,
      });
    }
    const diagnostics: LocalUsageDiagnostic[] = [];
    if (exceeded) {
      diagnostics.push(
        diagnostic(
          adapter,
          "query-truncated",
          file.path,
          `SQLite 查询结果超过 ${budget.limit} 行读取上限，其余记录未统计。`,
        ),
      );
    }
    if (events.length === 0 && malformedLines > 0) {
      diagnostics.push({
        source: adapter.source,
        code: "malformed-json",
        path: file.path,
        count: malformedLines,
        message: "threads.db 包含无法解码的线程记录。",
      });
    }
    return { events, malformedLines, diagnostics };
  } catch {
    return {
      events: [],
      malformedLines: 0,
      diagnostics: [
        diagnostic(
          adapter,
          "query-failed",
          file.path,
          "SQLite 只读查询执行失败，已跳过。",
        ),
      ],
    };
  } finally {
    database?.close();
  }
}

/**
 * Zed Agent native scan: same per-file cache contract as the generic sqlite
 * adapters (main-file signature + WAL companion), producing one event per
 * thread row with its current cumulative totals. Every thread row decodes to
 * its own structured session id, so identical rows across scans (cache reuse
 * or rotated copies of the same database) collapse to a single event.
 */
async function scanZedUsageAdapter(
  adapter: UsageAdapterContract,
  platformOs: PlatformOs,
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal: AbortSignal | undefined,
  overrides: UsageOverrideMap | undefined,
  maxSqliteRows: number,
  lookbackDays: number,
): Promise<SourceScanResult> {
  const pathConfigs = adapterPathsForPlatform(adapter.paths, platformOs);
  const placements = rebaseUsagePathConfigs(
    pathConfigs,
    homeDirectory,
    usageOverrideFor(adapter.source, overrides),
  );
  const selected = await collectAdapterFiles(
    placements,
    cutoffTime,
    maxFiles,
    signal,
  );
  const cacheEntries: PersistentGenericFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  // Single-file source, but the budget is built the same shared way so the
  // cap has one definition.
  const budget = createSqliteRowBudget(maxSqliteRows);

  for (const file of selected.files) {
    signal?.throwIfAborted();
    const cached = cachedFiles.get(file.path);
    const identity = cached?.sqliteBudget;
    // Zed is a one-database source, so its cached entry is the whole file set:
    // it may be reused while its own signature, WAL companion and window match
    // and the budget it was read under is the same. An entry the budget cut
    // short still holds the newest rows of that database (nothing else competes
    // for them), so it is the reason the identity is checked at all - and its
    // rows are charged back to the budget below, or the next database would
    // start from rows this one already spent.
    const charge = (cached as PersistentGenericFileEntry | undefined)?.events
      .length;
    let entry: PersistentGenericFileEntry;
    if (
      identity != null &&
      (identity.truncated === false || identity.limit === maxSqliteRows) &&
      charge != null &&
      charge <= budget.remaining() &&
      fileSignatureMatches(file, cached, adapter.source) &&
      sqliteWalMatches(file, cached, lookbackDays)
    ) {
      budget.take(charge);
      entry = cached as PersistentGenericFileEntry;
      filesReused += 1;
    } else {
      const parsed = await parseZedThreadsDb(
        file,
        adapter,
        signal,
        budget,
        cutoffTime,
      );
      parsed.events = parsed.events.map((event) => ({
        ...event,
        project: normalizeProjectPath(event.project, homeDirectory),
      }));
      entry = {
        source: adapter.source as PersistentGenericFileEntry["source"],
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: parsed.malformedLines,
        ...(file.format === "sqlite"
          ? {
              wal:
                file.wal == null
                  ? null
                  : { mtimeMs: file.wal.modifiedAt, size: file.wal.size },
              // How much history this parse actually holds, so a later scan
              // cannot reuse it for a wider window.
              windowDays: lookbackDays,
              // And what the budget did to it, so a later scan cannot reuse a
              // partial result a different budget would not have produced.
              sqliteBudget: sqliteBudgetIdentity(
                maxSqliteRows,
                parsed.diagnostics.some(
                  (item) => item.code === "query-truncated",
                ),
              ),
            }
          : {}),
        events: parsed.events,
        diagnostics: parsed.diagnostics,
      };
      filesParsed += 1;
    }
    diagnostics.push(...entry.diagnostics);
    cacheEntries.push(entry);
    filesRead += 1;
    malformedLines += entry.malformedLines;
  }

  const events = zedEventsInRange(
    cacheEntries,
    homeDirectory,
    adapter,
    cutoffTime,
    nowTime,
  );
  return {
    events,
    summary: {
      source: adapter.source,
      available: events.length > 0,
      detected: selected.detected,
      paths: placements.map((placement) => placement.root),
      filesConsidered: selected.files.length,
      filesRead,
      filesReused,
      filesParsed,
      malformedLines,
      events: events.length,
      diagnostics,
    },
    cacheEntries,
  };
}

/**
 * Zed events carry structured session ids, so identical current-totals rows
 * dedupe across every considered file (cache-reused and freshly parsed alike)
 * and out-of-window threads are dropped.
 */
function zedEventsInRange(
  cacheEntries: readonly PersistentGenericFileEntry[],
  homeDirectory: string,
  adapter: UsageAdapterContract,
  cutoffTime: number,
  nowTime: number,
): LocalUsageEvent[] {
  const byIdentity = new Map<string, LocalUsageEvent>();
  for (const entry of cacheEntries) {
    const fileFallbackSessionId = sessionIdFromRelativeFile(
      adapter.source,
      relative(homeDirectory, entry.path),
    );
    for (const event of entry.events) {
      if (!isTimestampInRange(new Date(event.timestamp), cutoffTime, nowTime)) {
        continue;
      }
      const identity = genericEventIdentity(
        adapter,
        event,
        fileFallbackSessionId,
      );
      if (byIdentity.has(identity)) continue;
      byIdentity.set(identity, event);
    }
  }
  return [...byIdentity.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Droid (Factory CLI) parsing contract (TokenTracker-sourced). Each Droid
// session has two sibling files under ~/.factory/sessions/<id>:
//   <session-id>.settings.json   — one JSON object whose tokenUsage holds the
//                                  CUMULATIVE session-level totals:
//     {
//       "model": "custom:GLM-5.1-[Proxy]-0",
//       "tokenUsage": {
//         "inputTokens": 12345,     // already excludes cached reads
//         "outputTokens": 678,
//         "cacheCreationTokens": 0,
//         "cacheReadTokens": 0,
//         "thinkingTokens": 0
//       }
//     }
//   <session-id>.jsonl           — per-message transcript (no token counts).
// The settings file is rewritten every turn, so the event timestamp is the
// settings file's own mtime; each parsed file emits one event carrying its
// CURRENT session-level cumulative totals. Token mapping: inputTokens ->
// input, cacheReadTokens -> cached input, cacheCreationTokens -> cache
// creation, outputTokens -> output, thinkingTokens -> reasoning output; the
// event total is the component sum (the optional `totalTokens` field is not
// redistributed).
//
// The model id falls back settings.model -> the sibling transcript's first
// `Model:` line -> "droid-unknown". Normalization mirrors TokenTracker's
// normalizeDroidModelName (ccusage droid parser parity): strip a `custom:`
// prefix, delete `[...]` segments, lowercase, and collapse runs of
// whitespace/dots and of dashes to a single `-` (underscores are preserved).
//
// The structured session id is derived from the settings stem, so when the
// SAME session stem appears in several folders under the sessions root
// (TokenTracker #204), every copy would share one cumulative counter and
// emitting them all would double count. The canonical copy per stem — largest
// cumulative token sum, ties to the newest mtime then lexicographically
// smaller path — is therefore selected per scan, mirroring TokenTracker's
// dedupeDroidSettingsFilesBySession.
// ─────────────────────────────────────────────────────────────────────────────

const DROID_SETTINGS_SUFFIX = ".settings.json";
/** Fallback model id when neither settings.model nor the transcript yields one. */
const DROID_UNKNOWN_MODEL = "droid-unknown";
/** Cap on sibling-transcript bytes probed for the fallback model id. */
const MAX_DROID_MODEL_SIDECAR_BYTES = 1024 * 1024;
/** Cap on sibling-transcript lines probed for the fallback model id (ccusage parity). */
const MAX_DROID_MODEL_SIDECAR_LINES = 500;

/** Coerce one Droid token field: numbers and numeric strings, <= 0 -> 0. */
function droidTokenCount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
  }
  return 0;
}

/**
 * Model-id normalization mirroring TokenTracker's normalizeDroidModelName
 * (itself ccusage `normalize_droid_model_name` parity): strip a `custom:`
 * prefix, delete `[...]` segments, lowercase, and collapse runs of
 * whitespace/dots and of dashes to a single `-`. Underscores are preserved so
 * `glm_5_1` stays distinct from `glm-5-1`.
 */
function normalizeDroidModelName(raw: string): string {
  let value = raw.startsWith("custom:") ? raw.slice("custom:".length) : raw;
  value = value.replace(/\[[^\]]*\]/g, "");
  value = value.toLowerCase();
  value = value.replace(/[\s.]+/g, "-");
  value = value.replace(/-+/g, "-");
  value = value.replace(/^-+|-+$/g, "");
  return value;
}

/** Session stem of a settings file: basename minus `.settings.json`. */
function droidSettingsStem(filePath: string): string | undefined {
  const name = basename(filePath);
  return name.endsWith(DROID_SETTINGS_SUFFIX)
    ? name.slice(0, -DROID_SETTINGS_SUFFIX.length)
    : undefined;
}

/**
 * Read the bounded head of a UTF-8 text file (used for the sibling-transcript
 * model probe). Rejects when the file does not exist or cannot be read.
 */
function readFileHead(
  filePath: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, {
      encoding: "utf8",
      start: 0,
      end: maxBytes - 1,
    });
    let text = "";
    stream.on("data", (chunk) => {
      if (typeof chunk === "string") text += chunk;
    });
    stream.on("error", (error) => reject(error));
    stream.on("end", () => {
      signal?.throwIfAborted();
      resolve(text);
    });
  });
}

/**
 * Fallback model resolution: scan the sibling `<id>.jsonl` transcript for the
 * first `Model:` marker (first 500 lines, mirroring TokenTracker/ccusage) and
 * normalize the trailing text, cut at the first `"`, `\`, or `[`. Returns ""
 * when no line yields a usable model id.
 */
async function droidModelFromSidecarJsonl(
  settingsPath: string,
  signal?: AbortSignal,
): Promise<string> {
  const sidecarPath = `${settingsPath.slice(0, -DROID_SETTINGS_SUFFIX.length)}.jsonl`;
  let head: string;
  try {
    head = await readFileHead(
      sidecarPath,
      MAX_DROID_MODEL_SIDECAR_BYTES,
      signal,
    );
  } catch {
    return "";
  }
  const lines = head.split("\n");
  const limit = Math.min(lines.length, MAX_DROID_MODEL_SIDECAR_LINES);
  for (let index = 0; index < limit; index += 1) {
    signal?.throwIfAborted();
    const marker = lines[index].indexOf("Model:");
    if (marker < 0) continue;
    const tail = lines[index].slice(marker + "Model:".length);
    let cut = tail.length;
    for (const character of ['"', "\\", "["]) {
      const position = tail.indexOf(character);
      if (position >= 0 && position < cut) cut = position;
    }
    const candidate = normalizeDroidModelName(tail.slice(0, cut).trim());
    if (candidate.length > 0) return candidate;
  }
  return "";
}

/**
 * Model resolution chain mirroring TokenTracker's resolveDroidModel up to the
 * unknown fallback: settings.model (normalized) -> sibling transcript's
 * `Model:` line (normalized) -> "droid-unknown".
 */
async function droidModelForSettings(
  settings: JsonObject,
  filePath: string,
  signal?: AbortSignal,
): Promise<string> {
  const direct = stringValue(settings.model);
  if (direct != null) {
    const normalized = normalizeDroidModelName(direct);
    if (normalized.length > 0) return normalized;
  }
  const sidecar = await droidModelFromSidecarJsonl(filePath, signal);
  return sidecar.length > 0 ? sidecar : DROID_UNKNOWN_MODEL;
}

/**
 * Parse one Droid `<sessionId>.settings.json` into a single event carrying
 * the session's current cumulative totals, timestamped with the file mtime.
 * Files with malformed JSON, without a tokenUsage object, or whose component
 * tokens sum to zero are skipped; a failing file never fails the whole scan.
 */
async function parseDroidSettingsFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  adapter: UsageAdapterContract,
  signal?: AbortSignal,
): Promise<{
  events: LocalUsageEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  signal?.throwIfAborted();
  if (file.size > adapter.maxFileSizeBytes) {
    return {
      events: [],
      malformedLines: 0,
      diagnostics: [
        diagnostic(
          adapter,
          "file-too-large",
          file.path,
          `日志超过 ${adapter.maxFileSizeBytes} 字节读取上限，已跳过。`,
        ),
      ],
    };
  }
  // Only `<id>.settings.json` files are collected by the registry glob, so the
  // structured session id is always derivable from the stem.
  const stem = droidSettingsStem(file.path);
  if (stem == null || stem.length === 0) {
    return { events: [], malformedLines: 0, diagnostics: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file.path, "utf8")) as unknown;
  } catch {
    return {
      events: [],
      malformedLines: 1,
      diagnostics: [
        diagnostic(
          adapter,
          "malformed-json",
          file.path,
          "Droid 会话 settings.json 无法解析，已跳过。",
        ),
      ],
    };
  }
  const settings = asObject(parsed);
  const usage = settings == null ? undefined : asObject(settings.tokenUsage);
  if (settings == null || usage == null) {
    return { events: [], malformedLines: 0, diagnostics: [] };
  }
  const inputTokens = droidTokenCount(usage.inputTokens);
  const cachedInputTokens = droidTokenCount(usage.cacheReadTokens);
  const cacheCreationInputTokens = droidTokenCount(usage.cacheCreationTokens);
  const outputTokens = droidTokenCount(usage.outputTokens);
  const reasoningOutputTokens = droidTokenCount(usage.thinkingTokens);
  const totalTokens =
    inputTokens +
    cachedInputTokens +
    cacheCreationInputTokens +
    outputTokens +
    reasoningOutputTokens;
  // A zero-sum payload (mid-write or a wiped tokenUsage) is transient and must
  // never surface as an event.
  if (totalTokens <= 0) {
    return { events: [], malformedLines: 0, diagnostics: [] };
  }
  const model = await droidModelForSettings(settings, file.path, signal);
  const event: LocalUsageEvent = {
    source: adapter.source as LocalUsageSource,
    // The settings file is rewritten each turn, so its mtime is the most
    // accurate "when did these tokens land" signal available.
    timestamp: new Date(file.modifiedAt).toISOString(),
    sessionId: sessionIdFromStructuredValue(adapter.source, stem)!,
    model,
    project: "unknown",
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
  return { events: [event], malformedLines: 0, diagnostics: [] };
}

/**
 * Droid (Factory CLI) native scan: same per-file cache contract as the Zed
 * adapter (main-file signature + WAL companion), producing one event per
 * parsed settings file with its current cumulative totals.
 */
async function scanDroidUsageAdapter(
  adapter: UsageAdapterContract,
  platformOs: PlatformOs,
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal?: AbortSignal,
  overrides?: UsageOverrideMap,
): Promise<SourceScanResult> {
  const pathConfigs = adapterPathsForPlatform(adapter.paths, platformOs);
  const placements = rebaseUsagePathConfigs(
    pathConfigs,
    homeDirectory,
    usageOverrideFor(adapter.source, overrides),
  );
  const selected = await collectAdapterFiles(
    placements,
    cutoffTime,
    maxFiles,
    signal,
  );
  const cacheEntries: PersistentGenericFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  for (const file of selected.files) {
    signal?.throwIfAborted();
    const cached = cachedFiles.get(file.path);
    let entry: PersistentGenericFileEntry;
    if (
      fileSignatureMatches(file, cached, adapter.source) &&
      sqliteWalMatches(file, cached)
    ) {
      entry = cached as PersistentGenericFileEntry;
      filesReused += 1;
    } else {
      const parsed = await parseDroidSettingsFile(file, adapter, signal);
      parsed.events = parsed.events.map((event) => ({
        ...event,
        project: normalizeProjectPath(event.project, homeDirectory),
      }));
      entry = {
        source: adapter.source as PersistentGenericFileEntry["source"],
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: parsed.malformedLines,
        // settings files are plain JSON, never sqlite: no WAL companion.
        events: parsed.events,
        diagnostics: parsed.diagnostics,
      };
      filesParsed += 1;
    }
    diagnostics.push(...entry.diagnostics);
    cacheEntries.push(entry);
    filesRead += 1;
    malformedLines += entry.malformedLines;
  }

  const events = droidEventsInRange(cacheEntries, adapter, cutoffTime, nowTime);
  return {
    events,
    summary: {
      source: adapter.source,
      available: events.length > 0,
      detected: selected.detected,
      paths: placements.map((placement) => placement.root),
      filesConsidered: selected.files.length,
      filesRead,
      filesReused,
      filesParsed,
      malformedLines,
      events: events.length,
      diagnostics,
    },
    cacheEntries,
  };
}

/**
 * Droid events carry structured session ids derived from the settings stem,
 * and the same stem may legitimately appear in several folders under the
 * sessions root (moved/duplicated sessions, TokenTracker #204). Those copies
 * share one cumulative counter, so each scan emits only the most complete one:
 * the canonical copy per stem is the largest cumulative token sum, ties broken
 * by the newer mtime then the lexicographically smaller path (matching
 * TokenTracker's dedupeDroidSettingsFilesBySession). Cache-reused entries
 * participate too, so a copy that grows past its siblings after a re-parse can
 * win without re-reading the others. Out-of-window events are dropped.
 */
function droidEventsInRange(
  cacheEntries: readonly PersistentGenericFileEntry[],
  adapter: UsageAdapterContract,
  cutoffTime: number,
  nowTime: number,
): LocalUsageEvent[] {
  const canonicalByStem = new Map<
    string,
    { event?: LocalUsageEvent; mtimeMs: number; path: string; sum: number }
  >();
  for (const entry of cacheEntries) {
    const stem = droidSettingsStem(entry.path);
    if (stem == null) continue;
    let event: LocalUsageEvent | undefined;
    for (const candidate of entry.events) {
      if (
        isTimestampInRange(new Date(candidate.timestamp), cutoffTime, nowTime)
      ) {
        event = candidate;
        break;
      }
    }
    const sum = event?.totalTokens ?? 0;
    const previous = canonicalByStem.get(stem);
    if (
      previous == null ||
      sum > previous.sum ||
      (sum === previous.sum && entry.mtimeMs > previous.mtimeMs) ||
      (sum === previous.sum &&
        entry.mtimeMs === previous.mtimeMs &&
        entry.path.localeCompare(previous.path) < 0)
    ) {
      canonicalByStem.set(stem, {
        ...(event == null ? {} : { event }),
        mtimeMs: entry.mtimeMs,
        path: entry.path,
        sum,
      });
    }
  }
  const events: LocalUsageEvent[] = [];
  for (const best of canonicalByStem.values()) {
    if (best.event != null) events.push(best.event);
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// CodeBuddy CLI parsing contract (TokenTracker-sourced, parseCodebuddy-
// Incremental parity). CodeBuddy is structurally cloned from Claude Code and
// writes one JSONL transcript per session under
// `~/.codebuddy/projects/<encoded-cwd>/<sessionId>.jsonl`. ANY record type
// (assistant message or function_call) whose `providerData.rawUsage` object is
// present represents one LLM round-trip; real installs carry usage on
// function_call rows too (~93% of round-trips), so filtering by record type
// would drop the majority of usage. The function_call/message rows of the
// SAME round-trip share `providerData.messageId`, so rows are deduped by
// message id with the FIRST row in file order deciding the outcome — a
// zero-sum or timestamp-less first row consumes the id and later mirrors are
// skipped, mirroring TokenTracker's incremental seenIds cursor on a
// from-scratch parse.
//
// Token math (must be exact; prompt_tokens INCLUDES cached + cache-creation
// input, and completion_tokens INCLUDES reasoning, so neither may be passed
// through unchanged):
//   cachedRead   = max(prompt_tokens_details.cached_tokens,
//                      prompt_cache_hit_tokens, cache_read_input_tokens)
//   cacheCreation = max(cache_creation_input_tokens, prompt_cache_write_tokens)
//   input        = prompt_tokens - cachedRead - cacheCreation
//   reasoning    = min(completion_tokens,
//                      completion_tokens_details.reasoning_tokens)
//   output       = completion_tokens - reasoning
// Rows whose components sum to zero are transient (mid-write) and skipped.
// ─────────────────────────────────────────────────────────────────────────────

/** Fallback model id when a row carries no providerData.model. */
const CODEBUDDY_UNKNOWN_MODEL = "unknown";

/** Coerce one CodeBuddy token field: numbers and numeric strings, <= 0 -> 0. */
function codebuddyTokenCount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
  }
  return 0;
}

/**
 * Coerce an epoch timestamp to milliseconds, mirroring TokenTracker's
 * coerceEpochMs: numbers and numeric strings; <= 0 / non-finite -> 0 (absent);
 * values below 1e12 are epoch SECONDS and are scaled up to milliseconds.
 */
function coerceEpochMs(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? Math.trunc(n * 1000) : Math.trunc(n);
}

/**
 * Parse one CodeBuddy `<sessionId>.jsonl` transcript into one event per
 * round-trip (deduped by `providerData.messageId`, first row in file order
 * wins, mirroring TokenTracker's parseCodebuddyIncremental). Files above the
 * adapter size cap and unparseable lines are reported through diagnostics; a
 * failing line never fails the whole file.
 */
async function parseCodebuddyJsonlFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  adapter: UsageAdapterContract,
  signal?: AbortSignal,
): Promise<{
  events: LocalUsageEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  signal?.throwIfAborted();
  if (file.size > adapter.maxFileSizeBytes) {
    return {
      events: [],
      malformedLines: 0,
      diagnostics: [
        diagnostic(
          adapter,
          "file-too-large",
          file.path,
          `日志超过 ${adapter.maxFileSizeBytes} 字节读取上限，已跳过。`,
        ),
      ],
    };
  }
  // TokenTracker falls back to the transcript stem when a row lacks its own
  // sessionId; the file layout guarantees the stem is the real session id.
  const fileSessionId = basename(file.path, ".jsonl");
  const events: LocalUsageEvent[] = [];
  const consumedMessageIds = new Set<string>();
  const { malformedLines, oversized } = await readJsonLines(
    file.path,
    (record) => {
      const providerData = asObject(record.providerData);
      const rawUsage = asObject(providerData?.rawUsage);
      if (rawUsage == null) return;
      const rowSessionId = stringValue(record.sessionId) ?? fileSessionId;
      const tsMs = coerceEpochMs(record.timestamp);
      const messageId =
        stringValue(providerData?.messageId) ??
        stringValue(record.uuid) ??
        stringValue(record.id) ??
        (tsMs > 0 ? `${rowSessionId}:${tsMs}` : null);
      if (messageId == null || consumedMessageIds.has(messageId)) return;
      const promptTokens = codebuddyTokenCount(rawUsage.prompt_tokens);
      const completionTokensRaw = codebuddyTokenCount(
        rawUsage.completion_tokens,
      );
      const promptDetails = asObject(rawUsage.prompt_tokens_details);
      const completionDetails = asObject(rawUsage.completion_tokens_details);
      // Cache-read mirrors three ways depending on upstream (Anthropic-style
      // cache_read_input_tokens, OpenAI-style prompt_tokens_details
      // .cached_tokens, DeepSeek-style prompt_cache_hit_tokens); on real data
      // exactly one is non-zero. Take the max, same as TokenTracker.
      const cachedInputTokens = Math.max(
        codebuddyTokenCount(promptDetails?.cached_tokens),
        codebuddyTokenCount(rawUsage.prompt_cache_hit_tokens),
        codebuddyTokenCount(rawUsage.cache_read_input_tokens),
      );
      const cacheCreationInputTokens = Math.max(
        codebuddyTokenCount(rawUsage.cache_creation_input_tokens),
        codebuddyTokenCount(rawUsage.prompt_cache_write_tokens),
      );
      const reasoningOutputTokens = Math.min(
        completionTokensRaw,
        codebuddyTokenCount(completionDetails?.reasoning_tokens),
      );
      const outputTokens = completionTokensRaw - reasoningOutputTokens;
      const inputTokens = Math.max(
        0,
        promptTokens - cachedInputTokens - cacheCreationInputTokens,
      );
      const totalTokens =
        inputTokens +
        cachedInputTokens +
        cacheCreationInputTokens +
        outputTokens +
        reasoningOutputTokens;
      // A zero-sum payload (mid-write) is transient: consume the id and never
      // surface it (matching TT, which marks zero-sum and timestamp-less ids
      // as seen before continuing).
      if (totalTokens <= 0 || tsMs <= 0) {
        consumedMessageIds.add(messageId);
        return;
      }
      consumedMessageIds.add(messageId);
      events.push({
        source: adapter.source as LocalUsageSource,
        timestamp: new Date(tsMs).toISOString(),
        sessionId: sessionIdFromStructuredValue(adapter.source, rowSessionId)!,
        model: stringValue(providerData?.model) ?? CODEBUDDY_UNKNOWN_MODEL,
        project: "unknown",
        inputTokens,
        cachedInputTokens,
        cacheCreationInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
      });
    },
    signal,
  );
  const diagnostics: LocalUsageDiagnostic[] = [];
  if (oversized) {
    diagnostics.push(
      diagnostic(
        adapter,
        "file-too-large",
        file.path,
        `日志超过 ${MAX_JSONL_FILE_BYTES} 字节读取上限，已跳过。`,
      ),
    );
  }
  if (malformedLines > 0) {
    const item = diagnostic(
      adapter,
      "malformed-json",
      file.path,
      "JSONL 包含无法解析的记录。",
    );
    item.count = malformedLines;
    diagnostics.push(item);
  }
  return { events, malformedLines, diagnostics };
}

/**
 * CodeBuddy native scan: same per-file cache contract as the Droid adapter
 * (main-file signature reuse through `fileSignatureMatches`; plain JSONL
 * entries use the generic `PersistentGenericFileEntry` shape — no WAL
 * companion), producing one event per parsed round-trip row.
 */
async function scanCodebuddyUsageAdapter(
  adapter: UsageAdapterContract,
  platformOs: PlatformOs,
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal?: AbortSignal,
  overrides?: UsageOverrideMap,
): Promise<SourceScanResult> {
  const pathConfigs = adapterPathsForPlatform(adapter.paths, platformOs);
  const placements = rebaseUsagePathConfigs(
    pathConfigs,
    homeDirectory,
    usageOverrideFor(adapter.source, overrides),
  );
  const selected = await collectAdapterFiles(
    placements,
    cutoffTime,
    maxFiles,
    signal,
  );
  const cacheEntries: PersistentGenericFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  for (const file of selected.files) {
    signal?.throwIfAborted();
    const cached = cachedFiles.get(file.path);
    let entry: PersistentGenericFileEntry;
    if (
      fileSignatureMatches(file, cached, adapter.source) &&
      sqliteWalMatches(file, cached)
    ) {
      entry = cached as PersistentGenericFileEntry;
      filesReused += 1;
    } else {
      const parsed = await parseCodebuddyJsonlFile(file, adapter, signal);
      parsed.events = parsed.events.map((event) => ({
        ...event,
        project: normalizeProjectPath(event.project, homeDirectory),
      }));
      entry = {
        source: adapter.source as PersistentGenericFileEntry["source"],
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: parsed.malformedLines,
        // transcript files are plain JSONL, never sqlite: no WAL companion.
        events: parsed.events,
        diagnostics: parsed.diagnostics,
      };
      filesParsed += 1;
    }
    diagnostics.push(...entry.diagnostics);
    cacheEntries.push(entry);
    filesRead += 1;
    malformedLines += entry.malformedLines;
  }

  const events = codebuddyEventsInRange(
    cacheEntries,
    homeDirectory,
    adapter,
    cutoffTime,
    nowTime,
  );
  return {
    events,
    summary: {
      source: adapter.source,
      available: events.length > 0,
      detected: selected.detected,
      paths: placements.map((placement) => placement.root),
      filesConsidered: selected.files.length,
      filesRead,
      filesReused,
      filesParsed,
      malformedLines,
      events: events.length,
      diagnostics,
    },
    cacheEntries,
  };
}

/**
 * CodeBuddy events carry structured session ids (from `row.sessionId` with
 * the transcript stem fallback), so identical round-trip rows in rotated
 * copies of a transcript (cache-reused and freshly parsed alike) collapse to
 * a single event; out-of-window rows are dropped.
 */
function codebuddyEventsInRange(
  cacheEntries: readonly PersistentGenericFileEntry[],
  homeDirectory: string,
  adapter: UsageAdapterContract,
  cutoffTime: number,
  nowTime: number,
): LocalUsageEvent[] {
  const byIdentity = new Map<string, LocalUsageEvent>();
  for (const entry of cacheEntries) {
    const fileFallbackSessionId = sessionIdFromRelativeFile(
      adapter.source,
      relative(homeDirectory, entry.path),
    );
    for (const event of entry.events) {
      if (!isTimestampInRange(new Date(event.timestamp), cutoffTime, nowTime)) {
        continue;
      }
      const identity = genericEventIdentity(
        adapter,
        event,
        fileFallbackSessionId,
      );
      if (byIdentity.has(identity)) continue;
      byIdentity.set(identity, event);
    }
  }
  return [...byIdentity.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// Kilo Code task usage parsing contract (TokenTracker-sourced,
// parseKilocodeIncremental parity). Kilo Code is a Cline-family VS Code
// extension writing one WHOLE-FILE JSON array per task under
// `<IDE config>/User/globalStorage/kilocode.kilo-code/tasks/<taskUuid>/
// ui_messages.json`; the file is rewritten in full on every turn (no byte
// tailing), so a changed file is always re-read and re-parsed from scratch.
//
// Records are messages of shape
//   { type: "say", say: "api_req_started" | "api_req_deleted",
//     ts: <epoch ms>, text: "<JSON-stringified payload>" }
// whose `text` holds the JSON-stringified token payload:
//   { tokensIn, tokensOut, cacheReads, cacheWrites, cost,
//     inferenceProvider, apiProtocol }
// (token and provider facts live INSIDE the text string — the reason this
// reader must be native). `api_req_deleted` rows represent provider-billed
// tokens removed from the task (edit-and-retry) and count exactly like
// `api_req_started`. Per request:
//   input = tokensIn, cached = cacheReads, cacheCreation = cacheWrites,
//   output = tokensOut, reasoning = 0, total = the sum of the four.
// Rows that are not one of the two says, whose text is not JSON (or does not
// parse), or whose ts is invalid are skipped. An all-zero payload never
// produces an event: `api_req_started` is written at request START with zero
// tokens and back-filled in place at the same ts, so the back-fill simply
// shows up as a same-ts row with a positive total — with no seen set,
// identity (sessionId, ts, total) is naturally idempotent as long as zero
// rows emit nothing.
//
// Kilo Code persists only the inference provider (e.g. "minimax", "Moonshot
// AI", "Stealth") in ui_messages.json — never a per-turn model id — so the
// model field is `provider:<slug>` (normalizeKilocodeProviderToModel).
// ─────────────────────────────────────────────────────────────────────────────

/** Fallback model id when a payload carries no usable inferenceProvider. */
const KILOCODE_UNKNOWN_MODEL = "provider:unknown";

/**
 * Coerce one Kilo Code token field, mirroring TokenTracker's toNonNegativeInt
 * exactly: numbers and numeric strings, negative or non-finite -> 0,
 * fractional values floored.
 */
function kilocodeTokenCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Normalize a Kilo Code inference provider into the display model id,
 * mirroring TokenTracker's normalizeKilocodeProviderToModel: trimmed,
 * lowercased, whitespace runs -> "-", everything outside [a-z0-9._-]
 * stripped; a slug without any alphanumeric character carries no information
 * and degrades to "provider:unknown".
 */
function normalizeKilocodeProviderToModel(providerName: unknown): string {
  if (typeof providerName !== "string" || providerName.trim().length === 0) {
    return KILOCODE_UNKNOWN_MODEL;
  }
  const slug = providerName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "");
  if (slug.length === 0 || !/[a-z0-9]/u.test(slug)) {
    return KILOCODE_UNKNOWN_MODEL;
  }
  return `provider:${slug}`;
}

/**
 * Parse one Kilo Code `<taskUuid>/ui_messages.json` (a single top-level JSON
 * array) into one event per token-bearing api_req_started/api_req_deleted
 * message, following the TokenTracker rules above. Files above the adapter
 * size cap and unparseable files are reported through diagnostics; a failing
 * element never fails the whole file.
 */
async function parseKilocodeUiMessagesFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  adapter: UsageAdapterContract,
  signal?: AbortSignal,
): Promise<{
  events: LocalUsageEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  signal?.throwIfAborted();
  if (file.size > adapter.maxFileSizeBytes) {
    return {
      events: [],
      malformedLines: 0,
      diagnostics: [
        diagnostic(
          adapter,
          "file-too-large",
          file.path,
          `日志超过 ${adapter.maxFileSizeBytes} 字节读取上限，已跳过。`,
        ),
      ],
    };
  }
  // The registry glob only collects `<taskUuid>/ui_messages.json`, so the
  // structured session id is always derivable from the immediate parent dir.
  const taskUuid = basename(dirname(file.path));
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file.path, "utf8")) as unknown;
  } catch {
    // ui_messages.json is rewritten whole on every turn; a read racing a
    // rewrite is transient and must not fail the scan (mirrors TokenTracker,
    // which skips unparseable files silently).
    return {
      events: [],
      malformedLines: 1,
      diagnostics: [
        diagnostic(
          adapter,
          "malformed-json",
          file.path,
          "Kilo Code ui_messages.json 无法解析，已跳过。",
        ),
      ],
    };
  }
  if (!Array.isArray(parsed)) {
    return { events: [], malformedLines: 0, diagnostics: [] };
  }
  const sessionId = sessionIdFromStructuredValue(adapter.source, taskUuid);
  const events: LocalUsageEvent[] = [];
  for (const element of parsed) {
    signal?.throwIfAborted();
    const message = asObject(element);
    if (message == null) continue;
    if (
      message.say !== "api_req_started" &&
      message.say !== "api_req_deleted"
    ) {
      continue;
    }
    const text = stringValue(message.text);
    if (text == null || !text.startsWith("{")) continue;
    let payload: JsonObject | undefined;
    try {
      payload = asObject(JSON.parse(text) as unknown);
    } catch {
      continue;
    }
    if (payload == null) continue;
    const ts = Number(message.ts);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const inputTokens = kilocodeTokenCount(payload.tokensIn);
    const cachedInputTokens = kilocodeTokenCount(payload.cacheReads);
    const cacheCreationInputTokens = kilocodeTokenCount(payload.cacheWrites);
    const outputTokens = kilocodeTokenCount(payload.tokensOut);
    // A zero-sum payload is a request-START placeholder (back-filled in place
    // at the same ts on completion): never an event, and no seen-id is needed
    // because the back-filled row is the same ts with a positive total.
    if (
      inputTokens === 0 &&
      cachedInputTokens === 0 &&
      cacheCreationInputTokens === 0 &&
      outputTokens === 0
    ) {
      continue;
    }
    events.push({
      source: adapter.source as LocalUsageSource,
      timestamp: new Date(ts).toISOString(),
      ...(sessionId == null ? {} : { sessionId }),
      model: normalizeKilocodeProviderToModel(payload.inferenceProvider),
      project: "unknown",
      inputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
      outputTokens,
      reasoningOutputTokens: 0,
      totalTokens:
        inputTokens +
        cachedInputTokens +
        cacheCreationInputTokens +
        outputTokens,
    });
  }
  return { events, malformedLines: 0, diagnostics: [] };
}

/**
 * Kilo Code native scan: same per-file cache contract as the CodeBuddy
 * adapter (main-file signature reuse through `fileSignatureMatches`; plain
 * JSON entries use the generic `PersistentGenericFileEntry` shape — no WAL
 * companion), producing one event per parsed token-bearing message.
 */
async function scanKilocodeUsageAdapter(
  adapter: UsageAdapterContract,
  platformOs: PlatformOs,
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal?: AbortSignal,
  overrides?: UsageOverrideMap,
): Promise<SourceScanResult> {
  const pathConfigs = adapterPathsForPlatform(adapter.paths, platformOs);
  const placements = rebaseUsagePathConfigs(
    pathConfigs,
    homeDirectory,
    usageOverrideFor(adapter.source, overrides),
  );
  const selected = await collectAdapterFiles(
    placements,
    cutoffTime,
    maxFiles,
    signal,
  );
  const cacheEntries: PersistentGenericFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  for (const file of selected.files) {
    signal?.throwIfAborted();
    const cached = cachedFiles.get(file.path);
    let entry: PersistentGenericFileEntry;
    if (
      fileSignatureMatches(file, cached, adapter.source) &&
      sqliteWalMatches(file, cached)
    ) {
      entry = cached as PersistentGenericFileEntry;
      filesReused += 1;
    } else {
      const parsed = await parseKilocodeUiMessagesFile(file, adapter, signal);
      parsed.events = parsed.events.map((event) => ({
        ...event,
        project: normalizeProjectPath(event.project, homeDirectory),
      }));
      entry = {
        source: adapter.source as PersistentGenericFileEntry["source"],
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: parsed.malformedLines,
        // ui_messages.json files are plain whole-file JSON, never sqlite: no
        // WAL companion.
        events: parsed.events,
        diagnostics: parsed.diagnostics,
      };
      filesParsed += 1;
    }
    diagnostics.push(...entry.diagnostics);
    cacheEntries.push(entry);
    filesRead += 1;
    malformedLines += entry.malformedLines;
  }

  const events = kilocodeEventsInRange(
    cacheEntries,
    homeDirectory,
    adapter,
    cutoffTime,
    nowTime,
  );
  return {
    events,
    summary: {
      source: adapter.source,
      available: events.length > 0,
      detected: selected.detected,
      paths: placements.map((placement) => placement.root),
      filesConsidered: selected.files.length,
      filesRead,
      filesReused,
      filesParsed,
      malformedLines,
      events: events.length,
      diagnostics,
    },
    cacheEntries,
  };
}

/**
 * Kilo Code events carry structured session ids (derived from the taskUuid
 * directory), so identical messages in rotated copies of a task file
 * (cache-reused and freshly parsed alike) collapse to a single event by
 * (sessionId, timestamp, totalTokens); out-of-window events are dropped.
 */
function kilocodeEventsInRange(
  cacheEntries: readonly PersistentGenericFileEntry[],
  homeDirectory: string,
  adapter: UsageAdapterContract,
  cutoffTime: number,
  nowTime: number,
): LocalUsageEvent[] {
  const byIdentity = new Map<string, LocalUsageEvent>();
  for (const entry of cacheEntries) {
    const fileFallbackSessionId = sessionIdFromRelativeFile(
      adapter.source,
      relative(homeDirectory, entry.path),
    );
    for (const event of entry.events) {
      if (!isTimestampInRange(new Date(event.timestamp), cutoffTime, nowTime)) {
        continue;
      }
      const identity = genericEventIdentity(
        adapter,
        event,
        fileFallbackSessionId,
      );
      if (byIdentity.has(identity)) continue;
      byIdentity.set(identity, event);
    }
  }
  return [...byIdentity.values()];
}

function diagnostic(
  adapter: UsageAdapterContract,
  code: LocalUsageDiagnostic["code"],
  path: string,
  message: string,
): LocalUsageDiagnostic {
  return { source: adapter.source, code, path, count: 1, message };
}

/** The row-budget warning for one sqlite database: rows of it went uncounted. */
function truncationWarning(
  adapter: UsageAdapterContract,
  path: string,
  limit: number,
): LocalUsageDiagnostic {
  return diagnostic(
    adapter,
    "query-truncated",
    path,
    `本地用量扫描超过 ${limit} 行读取上限，较旧的记录未统计。`,
  );
}

/**
 * P2-2 review: the diagnostics a sqlite entry carries must describe the budget
 * decision THIS scan reached, never the one the cache was written under.
 *
 * A reused entry's rows can still be displaced by a newer sibling - a complete
 * database that loses rows that way is exactly as truncated as a fresh read
 * stopped by the cap - so its warning is rebuilt from `truncated` instead of
 * inherited. The same rule clears a warning the entry no longer deserves, which
 * is what keeps "this source is complete" and "this source dropped rows" from
 * disagreeing with each other.
 */
function withTruncationWarning(
  adapter: UsageAdapterContract,
  path: string,
  diagnostics: readonly LocalUsageDiagnostic[],
  truncated: boolean,
  limit: number,
): LocalUsageDiagnostic[] {
  const kept = diagnostics.filter((item) => item.code !== "query-truncated");
  if (truncated) kept.push(truncationWarning(adapter, path, limit));
  return kept;
}

/**
 * Reads one generic usage file that is NOT a sqlite database (json/jsonl),
 * where every row of the file belongs to the file and no row budget is shared.
 * Sqlite files are read by `selectSqliteFileRows` instead: their rows compete
 * for the source's row budget with every other database of the same source.
 */
async function parseGenericFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  adapter: UsageAdapterContract,
  fallbackSessionId: string,
  signal: AbortSignal | undefined,
  cutoffTime: number,
): Promise<{
  events: LocalUsageEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  signal?.throwIfAborted();
  // Issue #42: the byte cap belongs to formats read in one piece, which is
  // every format that reaches this function. A sqlite database only ever runs a
  // prepared statement, so its file size says nothing about scan memory and the
  // cap never applied to it - applying it there skipped the whole file before
  // its read-only query ran, which is why a ~1.4 GB ZCode `db.sqlite` reported
  // "no logs" for an adapter that could read it fine.
  if (file.size > adapter.maxFileSizeBytes) {
    return {
      events: [],
      malformedLines: 0,
      diagnostics: [
        diagnostic(
          adapter,
          "file-too-large",
          file.path,
          `日志超过 ${adapter.maxFileSizeBytes} 字节读取上限，已跳过。`,
        ),
      ],
    };
  }

  const events: LocalUsageEvent[] = [];
  let mismatches = 0;
  if (file.format === "jsonl") {
    const { malformedLines, oversized } = await readJsonLines(
      file.path,
      (record) => {
        const event = eventFromMappedRecord(record, adapter, fallbackSessionId);
        if (event == null) mismatches += 1;
        else events.push(event);
      },
      signal,
    );
    const diagnostics: LocalUsageDiagnostic[] = [];
    if (oversized) {
      diagnostics.push(
        diagnostic(
          adapter,
          "file-too-large",
          file.path,
          `日志超过 ${MAX_JSONL_FILE_BYTES} 字节读取上限，已跳过。`,
        ),
      );
    }
    if (malformedLines > 0) {
      diagnostics.push(
        diagnostic(
          adapter,
          "malformed-json",
          file.path,
          "JSONL 包含无法解析的记录。",
        ),
      );
      diagnostics[diagnostics.length - 1].count = malformedLines;
    }
    if (events.length === 0 && mismatches > 0) {
      diagnostics.push(fieldMismatchDiagnostic(adapter, file.path, mismatches));
    }
    return { events, malformedLines, diagnostics };
  }

  try {
    const parsed = JSON.parse(await readFile(file.path, "utf8")) as unknown;
    const extracted = recordsFromJson(parsed, adapter.mapping);
    for (const record of extracted.records) {
      const event = eventFromMappedRecord(record, adapter, fallbackSessionId);
      if (event == null) mismatches += 1;
      else events.push(event);
    }
    return {
      events,
      malformedLines: 0,
      diagnostics:
        events.length === 0
          ? [
              fieldMismatchDiagnostic(
                adapter,
                file.path,
                Math.max(1, mismatches),
              ),
            ]
          : [],
    };
  } catch {
    return {
      events: [],
      malformedLines: 1,
      diagnostics: [
        diagnostic(
          adapter,
          "malformed-json",
          file.path,
          "JSON 日志无法解析，已跳过。",
        ),
      ],
    };
  }
}

/**
 * What reading one sqlite database of a generic source contributed to the
 * source-wide selection: the diagnostics of the read itself, how many of its
 * rows could not become an event, and whether the read stopped early.
 */
interface SqliteReadOutcome {
  diagnostics: LocalUsageDiagnostic[];
  mismatches: number;
  /** Rows were left unread because the selection could not take them. */
  cut: boolean;
}

/**
 * P2-1: reads one sqlite database newest-first and offers its events to the
 * source's selection, which keeps the newest events of the whole source.
 *
 * A row is ranked by its own event time first, because that is a plain column
 * read while turning it into an event derives a privacy-safe session id - a
 * hash - and the read is abandoned at the first row the selection can no longer
 * take: every later row of an ordered read is older still. A row only becomes
 * an event once it is known to earn a place, so the rows of a database that
 * cannot contribute at all are never mapped.
 *
 * Only events are retained (never the reader's row objects, which measure an
 * order of magnitude larger), which keeps the scan's memory at the row budget
 * this whole mechanism exists to enforce.
 *
 * The window filter is written against the adapter query's own output columns
 * and applied by wrapping it in a subquery, which keeps the comparison in the
 * units the adapter already normalized to. Adapters without one still work -
 * the JavaScript range check stays the authority either way - they just pay the
 * full read.
 */
async function selectSqliteFileRows(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  adapter: UsageAdapterContract,
  selection: NewestSelection<LocalUsageEvent>,
  fileIndex: number,
  homeDirectory: string,
  cutoffTime: number,
  signal: AbortSignal | undefined,
): Promise<SqliteReadOutcome> {
  if (adapter.query == null) {
    return {
      diagnostics: [
        diagnostic(
          adapter,
          "query-failed",
          file.path,
          "SQLite 适配器缺少只读查询。",
        ),
      ],
      mismatches: 0,
      cut: false,
    };
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(file.path, { readOnly: true });
    const windowFilter = adapter.windowFilter;
    const statement =
      windowFilter == null
        ? database.prepare(adapter.query)
        : database.prepare(
            `SELECT * FROM (${adapter.query}) WHERE ${windowFilter}`,
          );
    // Rows are streamed instead of collected with `.all()` so a large table
    // never materializes a second full copy of its records.
    const rows =
      windowFilter == null
        ? statement.iterate()
        : statement.iterate(cutoffTime);
    const fallbackSessionId = sessionIdFromRelativeFile(
      adapter.source,
      relative(homeDirectory, file.path),
    );
    let mismatches = 0;
    for (const record of rows as IterableIterator<JsonObject>) {
      signal?.throwIfAborted();
      const key = recordTimestampMs(record, adapter.mapping);
      if (key == null) {
        mismatches += 1;
        continue;
      }
      if (selection.rejects(key)) {
        return { diagnostics: [], mismatches, cut: true };
      }
      const event = eventFromMappedRecord(record, adapter, fallbackSessionId);
      // A row that cannot become an event never takes a budget slot, exactly as
      // it never took one before the budget was shared with the other
      // databases of the source.
      if (event == null) {
        mismatches += 1;
        continue;
      }
      // The mapping just built this object and nothing else holds it, so the
      // path is normalized in place: at half a million retained rows, one saved
      // allocation per row is tens of megabytes of heap the budget does not
      // have to explain.
      event.project = normalizeProjectPath(event.project, homeDirectory);
      selection.offer(fileIndex, key, event);
    }
    return { diagnostics: [], mismatches, cut: false };
  } catch {
    return {
      diagnostics: [
        diagnostic(
          adapter,
          "query-failed",
          file.path,
          "SQLite 只读查询执行失败，已跳过。",
        ),
      ],
      mismatches: 0,
      cut: false,
    };
  } finally {
    database?.close();
  }
}

/**
 * P5-T5-07: runs the generic usage adapters through a bounded worker pool
 * (max GENERIC_ADAPTER_CONCURRENCY). Together with the 8 native readers this
 * keeps concurrent file reads within the `maxFileOperations: 16` runtime
 * budget instead of fanning out one worker per adapter.
 */
const GENERIC_ADAPTER_CONCURRENCY = 8;

async function runBoundedGenericAdapters(
  adapters: readonly UsageAdapterContract[],
  platformOs: PlatformOs,
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal: AbortSignal | undefined,
  overrides: UsageOverrideMap | undefined,
  maxSqliteRows: number,
  lookbackDays: number,
): Promise<SourceScanResult[]> {
  const results: SourceScanResult[] = new Array(adapters.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(adapters.length, GENERIC_ADAPTER_CONCURRENCY) },
    async () => {
      while (cursor < adapters.length) {
        signal?.throwIfAborted();
        const index = cursor++;
        const adapter = adapters[index];
        if (adapter == null) continue;
        results[index] = await scanGenericAdapter(
          adapter,
          platformOs,
          homeDirectory,
          cutoffTime,
          nowTime,
          maxFiles,
          cachedFiles,
          signal,
          overrides,
          maxSqliteRows,
          lookbackDays,
        ).catch((error) => sourceFailure(adapter.source, error));
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function scanGenericAdapter(
  adapter: UsageAdapterContract,
  platformOs: PlatformOs,
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
  signal: AbortSignal | undefined,
  overrides: UsageOverrideMap | undefined,
  maxSqliteRows: number,
  lookbackDays: number,
): Promise<SourceScanResult> {
  const pathConfigs = adapterPathsForPlatform(adapter.paths, platformOs);
  const placements = rebaseUsagePathConfigs(
    pathConfigs,
    homeDirectory,
    usageOverrideFor(adapter.source, overrides),
  );
  const selected = await collectAdapterFiles(
    placements,
    cutoffTime,
    maxFiles,
    signal,
  );
  const cacheEntries: PersistentGenericFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  // P2-1: one row budget for the whole source (several files - Hermes keeps one
  // state.db per profile - share it), and the rows that survive it are the
  // newest rows of the source, not of whichever database the walk read first.
  // A database's file mtime says when it was written, not how old its rows are,
  // so spending the budget in file order kept day-old sessions and hid the
  // ten-minute-old ones in the profile behind it.
  const sqliteFiles = selected.files.filter((file) => file.format === "sqlite");
  const sqliteIndexes = new Map(
    sqliteFiles.map((file, index) => [file.path, index] as const),
  );
  const selection = createNewestSelection<LocalUsageEvent>(
    maxSqliteRows,
    sqliteFiles.length,
  );
  // Whether the set of databases, and every one of their signatures, still
  // reproduces the selection the cached entries were built from.
  const reproducible = sqliteSetReproducible(
    adapter.source,
    sqliteFiles,
    cachedFiles,
    lookbackDays,
    maxSqliteRows,
  );
  const sqliteReads = new Map<string, SqliteReadOutcome>();
  const cachedTruncation = new Map<string, boolean>();
  /** Databases whose cached entry the reproduced set carried over as it is. */
  const carriedOver = new Set<string>();
  // Entries are keyed by path and emitted in file order below, so the per-source
  // dedupe keeps seeing the files in the same order it always has.
  const entries = new Map<string, PersistentGenericFileEntry>();
  let truncationReported = false;

  for (const file of selected.files) {
    signal?.throwIfAborted();
    const cached = cachedFiles.get(file.path);
    const signatureMatches =
      fileSignatureMatches(file, cached, adapter.source) &&
      sqliteWalMatches(file, cached, lookbackDays);

    if (file.format === "sqlite") {
      const index = sqliteIndexes.get(file.path) ?? 0;
      const identity = cached?.sqliteBudget;
      // Reuse is safe when the whole set reproduces (the selection is
      // deterministic, so its result comes back unchanged), or when this
      // database was never cut by the budget and therefore holds every row of
      // its own window no matter what its siblings did.
      const reusableVerbatim =
        reproducible && signatureMatches && identity != null;
      const reusableAlone =
        !reproducible && signatureMatches && identity?.truncated === false;
      if (reusableVerbatim || reusableAlone) {
        if (!reusableVerbatim) {
          // A database that holds all of its own rows is a full input of the
          // new selection, exactly like a fresh read would be.
          const entry = cached as PersistentGenericFileEntry;
          for (const event of entry.events) {
            selection.offer(index, Date.parse(event.timestamp), event);
          }
        }
        entries.set(file.path, cached as PersistentGenericFileEntry);
        cachedTruncation.set(file.path, identity?.truncated ?? false);
        if (reusableVerbatim) carriedOver.add(file.path);
        sqliteReads.set(file.path, {
          diagnostics: [],
          mismatches: 0,
          cut: false,
        });
        filesReused += 1;
        continue;
      }
      sqliteReads.set(
        file.path,
        await selectSqliteFileRows(
          file,
          adapter,
          selection,
          index,
          homeDirectory,
          cutoffTime,
          signal,
        ),
      );
      filesParsed += 1;
      continue;
    }

    if (signatureMatches) {
      entries.set(file.path, cached as PersistentGenericFileEntry);
      filesReused += 1;
      continue;
    }
    const parsed = await parseGenericFile(
      file,
      adapter,
      sessionIdFromRelativeFile(
        adapter.source,
        relative(homeDirectory, file.path),
      ),
      signal,
      cutoffTime,
    );
    parsed.events = parsed.events.map((event) => ({
      ...event,
      project: normalizeProjectPath(event.project, homeDirectory),
    }));
    entries.set(file.path, {
      source: adapter.source as PersistentGenericFileEntry["source"],
      path: file.path,
      mtimeMs: file.modifiedAt,
      size: file.size,
      malformedLines: parsed.malformedLines,
      events: parsed.events,
      diagnostics: parsed.diagnostics,
    });
    filesParsed += 1;
  }

  // Only now is it known what each database keeps: the budget is shared, so a
  // database's rows survive only if no newer row of any other database takes
  // their place.
  const retained = selection.finish();
  sqliteFiles.forEach((file, index) => {
    const kept = retained.items[index] ?? [];
    const read = sqliteReads.get(file.path) ?? {
      diagnostics: [],
      mismatches: 0,
      cut: false,
    };
    const truncated =
      (cachedTruncation.get(file.path) ?? false) ||
      retained.truncated[index] === true ||
      read.cut;
    const reused = entries.get(file.path);
    if (carriedOver.has(file.path)) {
      // The whole set reproduced, so this entry is the answer the selection
      // would compute again - it was never even offered.
      return;
    }
    if (reused != null) {
      // P2-2 review: a reused entry keeps everything the cache knew about the
      // database (WAL companion, window, diagnostics), and only the rows the
      // rest of the source left it can change. Its budget warning has to follow
      // that change, though: a complete database whose rows a newer sibling
      // pushed out of the budget drops events exactly like a fresh read that
      // hit the cap, and staying silent about it reported a partial result as
      // if it were whole. The warning is therefore rebuilt from `truncated`
      // here, never inherited.
      entries.set(file.path, {
        ...reused,
        events: kept,
        sqliteBudget: sqliteBudgetIdentity(maxSqliteRows, truncated),
        diagnostics: withTruncationWarning(
          adapter,
          file.path,
          reused.diagnostics,
          truncated,
          maxSqliteRows,
        ),
      });
      return;
    }
    const events = kept as LocalUsageEvent[];
    const fileDiagnostics = [...read.diagnostics];
    if (events.length === 0 && read.mismatches > 0) {
      fileDiagnostics.push(
        fieldMismatchDiagnostic(adapter, file.path, read.mismatches),
      );
    }
    if (truncated)
      fileDiagnostics.push(
        truncationWarning(adapter, file.path, maxSqliteRows),
      );
    entries.set(file.path, {
      source: adapter.source as PersistentGenericFileEntry["source"],
      path: file.path,
      mtimeMs: file.modifiedAt,
      size: file.size,
      malformedLines: 0,
      wal:
        file.wal == null
          ? null
          : { mtimeMs: file.wal.modifiedAt, size: file.wal.size },
      // How much history this selection actually holds, so a later scan cannot
      // reuse it for a wider window.
      windowDays: lookbackDays,
      // And what the shared budget did to it, so a later scan cannot reuse a
      // partial result its siblings no longer explain.
      sqliteBudget: sqliteBudgetIdentity(maxSqliteRows, truncated),
      events,
      diagnostics: fileDiagnostics,
    });
  });

  for (const file of selected.files) {
    const entry = entries.get(file.path);
    if (entry == null) continue;
    // A shared budget reports once, not once per database it stopped.
    for (const item of entry.diagnostics) {
      if (item.code === "query-truncated") {
        if (truncationReported) continue;
        truncationReported = true;
      }
      diagnostics.push(item);
    }
    cacheEntries.push(entry);
    filesRead += 1;
    malformedLines += entry.malformedLines;
  }

  // P2-17: dedupe identical records across every file — freshly parsed and
  // cache-reused alike — so rotated copies of the same log never accumulate.
  // Only a structured session id participates in the identity; the file-derived
  // fallback session id is excluded so identical session-less records in
  // rotated copies collapse to one instead of double-counting.
  const byIdentity = new Map<string, LocalUsageEvent>();
  for (const entry of cacheEntries) {
    const fileFallbackSessionId = sessionIdFromRelativeFile(
      adapter.source,
      relative(homeDirectory, entry.path),
    );
    for (const event of entry.events) {
      if (!isTimestampInRange(new Date(event.timestamp), cutoffTime, nowTime)) {
        continue;
      }
      const identity = genericEventIdentity(
        adapter,
        event,
        fileFallbackSessionId,
      );
      if (byIdentity.has(identity)) continue;
      byIdentity.set(identity, event);
    }
  }
  const events = [...byIdentity.values()];

  return {
    events,
    summary: {
      source: adapter.source,
      available: events.length > 0,
      detected: selected.detected,
      paths: placements.map((placement) => placement.root),
      filesConsidered: selected.files.length,
      filesRead,
      filesReused,
      filesParsed,
      malformedLines,
      events: events.length,
      diagnostics,
    },
    cacheEntries,
  };
}

/**
 * P2-17: dedup identity for a generic-adapter event. The event's session id
 * participates only when it is a structured one; the file-derived fallback
 * differs between rotated copies and would defeat cross-file dedup, so
 * session-less records identify by (timestamp, totalTokens, source) alone.
 */
function genericEventIdentity(
  adapter: UsageAdapterContract,
  event: LocalUsageEvent,
  fileFallbackSessionId: string,
): string {
  const sessionId =
    event.sessionId != null && event.sessionId !== fileFallbackSessionId
      ? event.sessionId
      : null;
  return privacyFingerprint(adapter.source, [
    sessionId,
    event.timestamp,
    event.totalTokens,
    adapter.source,
  ]);
}

function sourceFailure(
  source: LocalUsageSource,
  error?: unknown,
): SourceScanResult {
  return {
    events: [],
    summary: {
      source,
      available: false,
      detected: false,
      filesConsidered: 0,
      filesRead: 0,
      filesReused: 0,
      filesParsed: 0,
      malformedLines: 0,
      events: 0,
      diagnostics:
        error == null
          ? []
          : [
              {
                source,
                code: "read-failed",
                count: 1,
                message: "本地 Token 日志扫描失败。",
              },
            ],
    },
    cacheEntries: [],
  };
}

export async function scanLocalUsage(
  options: LocalUsageScanOptions = {},
): Promise<LocalUsageSnapshot> {
  const now = options.now ?? new Date();
  const platform = options.platform ?? process.platform;
  const nowTime = now.getTime();
  const lookbackDays = Math.max(
    1,
    Math.trunc(options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS),
  );
  const maxFiles = Math.max(
    1,
    Math.min(
      MAX_FILES_PER_SOURCE,
      Math.trunc(options.maxFilesPerSource ?? MAX_FILES_PER_SOURCE),
    ),
  );
  // Issue #42: the row budget is overridable so the truncation path is
  // testable without a 500k-row fixture.
  const maxSqliteRows = Math.max(
    1,
    Math.trunc(options.maxSqliteRowsPerSource ?? MAX_SQLITE_ROWS),
  );
  const isolatedUsageHome = process.env[ENV.USAGE_HOME]?.trim();
  const homeDirectory =
    options.homeDirectory ??
    (isolatedUsageHome && isAbsolute(isolatedUsageHome)
      ? isolatedUsageHome
      : homedir());
  const configuredRoot = (
    value: string | undefined,
    fallback: string,
  ): string => {
    const candidate = value?.trim();
    if (!candidate) return fallback;
    return isAbsolute(candidate)
      ? candidate
      : resolve(homeDirectory, candidate);
  };
  const uniqueRoots = (roots: string[]): string[] => {
    const seen = new Set<string>();
    return roots.filter((root) => {
      const key = process.platform === "win32" ? root.toLowerCase() : root;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const windowsEnvironmentHomes =
    process.platform === "win32" && options.homeDirectory == null
      ? [
          process.env.USERPROFILE,
          process.env.HOME,
          process.env.HOMEDRIVE && process.env.HOMEPATH
            ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
            : undefined,
        ]
      : [];
  const homeDirectories = uniqueRoots(
    [
      homeDirectory,
      ...(options.additionalHomeDirectories ?? []),
      ...windowsEnvironmentHomes,
    ].filter((value): value is string => Boolean(value?.trim())),
  );
  const [wslClaudeHomes, wslCodexHomes] = await (async () => {
    // P3-T3-04: enumerate WSL topology once per scan and share it between
    // providers. An injected topology (from the shared WSL fact snapshot)
    // skips the local enumeration entirely.
    const topology =
      options.wslTopology ??
      (await (async () => {
        if (options.enumerateWslTopology) {
          return options.enumerateWslTopology({
            platform,
            signal: options.signal,
          });
        }
        const { enumerateWslTopology } =
          await import("../../platform/discovery/wsl-topology.server.ts");
        // P5-T5-04: the fallback enumeration is cancelled with the scan.
        return enumerateWslTopology({ platform, signal: options.signal });
      })());
    return [
      await discoverWindowsWslHomes(".claude", topology, platform),
      await discoverWindowsWslHomes(".codex", topology, platform),
    ];
  })();
  const claudeRoots = uniqueRoots([
    join(
      configuredRoot(
        options.claudeConfigDirectory ?? process.env.CLAUDE_CONFIG_DIR,
        join(homeDirectory, ".claude"),
      ),
      "projects",
    ),
    ...homeDirectories.map((directory) =>
      join(directory, ".claude", "projects"),
    ),
    ...wslClaudeHomes.map((directory) => join(directory, "projects")),
  ]);
  const codexHomes = uniqueRoots([
    configuredRoot(
      options.codexHomeDirectory ?? process.env.CODEX_HOME,
      join(homeDirectory, ".codex"),
    ),
    ...homeDirectories.map((directory) => join(directory, ".codex")),
    ...wslCodexHomes,
  ]);
  const codexRoots = codexHomes.flatMap((root) => [
    join(root, "sessions"),
    join(root, "archived_sessions"),
  ]);
  // Every Code is a Codex-family CLI writing the same rollout schema under
  // `~/.code/sessions`. Kept simple by design: one sessions root per home —
  // no archived_sessions tree and no WSL arm (unlike codex).
  const everyCodeRoots = uniqueRoots(
    homeDirectories.map((directory) => join(directory, ".code", "sessions")),
  );
  const cutoffTime = nowTime - lookbackDays * DAY_IN_MS;
  // Rebuildable performance index. The scanner itself never writes files;
  // callers that want fast restarts may persist `snapshotUsageScanIndex()` and
  // restore it with `hydrateUsageScanIndex()` (composition owns that storage).
  const cacheKey = options.cacheDirectory ?? homeDirectory;
  const cachedIndex = options.disablePersistentCache
    ? undefined
    : processUsageIndexes.get(cacheKey);
  const persistentIndex =
    cachedIndex?.version === PERSISTENT_CACHE_VERSION &&
    cachedIndex.registryFingerprint === REGISTRY_FINGERPRINT
      ? cachedIndex
      : undefined;
  const cachedFiles = new Map(
    (persistentIndex?.files ?? []).map((entry) => [entry.path, entry] as const),
  );

  // External usage adapters were removed (v1.5 M4-T1, TC-REG-005): tool facts
  // are offline-only. Only built-in generic adapters run here; native readers
  // (claude/codex/workbuddy) run below.
  const genericAdapters = GENERIC_BUILTIN_USAGE_ADAPTERS.filter(
    (adapter) => adapter.source !== "workbuddy",
  );
  // P5-T5-02: check the caller's signal before starting any source I/O.
  options.signal?.throwIfAborted();
  const structuredReader = (
    reader:
      | "gemini-session-v1"
      | "grok-turn-v1"
      | "openclaw-session-v1"
      | "antigravity-transcript-v1"
      | "dsh-session-v1"
      | "pi-session-v1"
      | "omp-session-v1",
    parser: StructuredParser,
    mergeMode: "unique" | "multiset",
  ) => {
    const adapter = BUILTIN_USAGE_ADAPTERS.find(
      (candidate) => candidate.reader === reader,
    );
    if (adapter == null) {
      throw new Error(`Missing registered usage reader plan: ${reader}`);
    }
    return scanStructuredAdapter(
      adapter,
      parser,
      mergeMode,
      osFromProcess(platform),
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
      options.toolDataRoots,
    );
  };
  const [
    claude,
    codex,
    everyCode,
    workbuddy,
    gemini,
    grok,
    openclaw,
    antigravity,
    dsh,
    pi,
    omp,
    zed,
    droid,
    codebuddy,
    kilocode,
    ...genericResults
  ] = await Promise.all([
    scanClaude(
      claudeRoots,
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
    ).catch((error) => sourceFailure("claude-code", error)),
    scanCodex(
      codexRoots,
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
    ).catch((error) => sourceFailure("codex", error)),
    scanEveryCodeUsageAdapter(
      everyCodeRoots,
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
    ).catch((error) => sourceFailure("every-code", error)),
    scanWorkbuddy(
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
    ).catch((error) => sourceFailure("workbuddy", error)),
    structuredReader("gemini-session-v1", parseGeminiUsageFile, "unique").catch(
      (error) => sourceFailure("gemini-cli", error),
    ),
    structuredReader("grok-turn-v1", parseGrokUsageFile, "unique").catch(
      (error) => sourceFailure("grok", error),
    ),
    structuredReader(
      "openclaw-session-v1",
      parseOpenclawUsageFile,
      "multiset",
    ).catch((error) => sourceFailure("openclaw", error)),
    structuredReader(
      "antigravity-transcript-v1",
      parseAntigravityUsageFile,
      "unique",
    ).catch((error) => sourceFailure("antigravity", error)),
    structuredReader("pi-session-v1", parsePiUsageFile, "unique").catch(
      (error) => sourceFailure("pi", error),
    ),
    structuredReader("omp-session-v1", parseOmpUsageFile, "unique").catch(
      (error) => sourceFailure("omp", error),
    ),
    scanDshUsageAdapter(
      BUILTIN_USAGE_ADAPTERS.find(
        (candidate) => candidate.reader === "dsh-session-v1",
      )!,
      osFromProcess(platform),
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
      options.toolDataRoots,
    ).catch((error) => sourceFailure("dsh", error)),
    scanZedUsageAdapter(
      BUILTIN_USAGE_ADAPTERS.find(
        (candidate) => candidate.reader === "zed-threads-v1",
      )!,
      osFromProcess(platform),
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
      options.toolDataRoots,
      maxSqliteRows,
      lookbackDays,
    ).catch((error) => sourceFailure("zed", error)),
    scanDroidUsageAdapter(
      BUILTIN_USAGE_ADAPTERS.find(
        (candidate) => candidate.reader === "droid-settings-v1",
      )!,
      osFromProcess(platform),
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
      options.toolDataRoots,
    ).catch((error) => sourceFailure("droid", error)),
    scanCodebuddyUsageAdapter(
      BUILTIN_USAGE_ADAPTERS.find(
        (candidate) => candidate.reader === "codebuddy-log-v1",
      )!,
      osFromProcess(platform),
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
      options.toolDataRoots,
    ).catch((error) => sourceFailure("codebuddy", error)),
    scanKilocodeUsageAdapter(
      BUILTIN_USAGE_ADAPTERS.find(
        (candidate) => candidate.reader === "kilocode-task-v1",
      )!,
      osFromProcess(platform),
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
      options.toolDataRoots,
    ).catch((error) => sourceFailure("kilocode", error)),
    ...(await runBoundedGenericAdapters(
      genericAdapters,
      osFromProcess(platform),
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
      options.signal,
      options.toolDataRoots,
      maxSqliteRows,
      lookbackDays,
    )),
  ]);

  // The snapshot is built exclusively from the native adapters above.
  const currentCacheEntries = [
    ...claude.cacheEntries,
    ...codex.cacheEntries,
    ...everyCode.cacheEntries,
    ...workbuddy.cacheEntries,
    ...gemini.cacheEntries,
    ...grok.cacheEntries,
    ...openclaw.cacheEntries,
    ...antigravity.cacheEntries,
    ...dsh.cacheEntries,
    ...pi.cacheEntries,
    ...omp.cacheEntries,
    ...zed.cacheEntries,
    ...droid.cacheEntries,
    ...codebuddy.cacheEntries,
    ...kilocode.cacheEntries,
    ...genericResults.flatMap((result) => result.cacheEntries),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const shouldWritePersistentIndex =
    !options.disablePersistentCache &&
    (persistentIndex == null ||
      claude.summary.filesParsed > 0 ||
      codex.summary.filesParsed > 0 ||
      everyCode.summary.filesParsed > 0 ||
      workbuddy.summary.filesParsed > 0 ||
      gemini.summary.filesParsed > 0 ||
      grok.summary.filesParsed > 0 ||
      openclaw.summary.filesParsed > 0 ||
      antigravity.summary.filesParsed > 0 ||
      dsh.summary.filesParsed > 0 ||
      pi.summary.filesParsed > 0 ||
      omp.summary.filesParsed > 0 ||
      zed.summary.filesParsed > 0 ||
      droid.summary.filesParsed > 0 ||
      codebuddy.summary.filesParsed > 0 ||
      kilocode.summary.filesParsed > 0 ||
      genericResults.some((result) => result.summary.filesParsed > 0) ||
      persistentIndex.files.length !== currentCacheEntries.length);
  if (shouldWritePersistentIndex) {
    writeProcessIndex(cacheKey, currentCacheEntries);
  }

  const nativeEvents = [
    ...claude.events,
    ...codex.events,
    ...everyCode.events,
    ...workbuddy.events,
    ...gemini.events,
    ...grok.events,
    ...openclaw.events,
    ...antigravity.events,
    ...dsh.events,
    ...pi.events,
    ...omp.events,
    ...zed.events,
    ...droid.events,
    ...codebuddy.events,
    ...kilocode.events,
    ...genericResults.flatMap((result) => result.events),
  ];
  const canonicalProjectPaths = new Map<string, Promise<string>>();
  const events = await Promise.all(
    nativeEvents.map((event) => {
      let canonicalProject = canonicalProjectPaths.get(event.project);
      if (canonicalProject == null) {
        canonicalProject = canonicalizeProjectPath(
          event.project,
          homeDirectory,
          platform,
        );
        canonicalProjectPaths.set(event.project, canonicalProject);
      }
      return canonicalProject.then((project) => ({ ...event, project }));
    }),
  );
  const summaryBySource = new Map<LocalUsageSource, LocalUsageSourceSummary>();
  for (const summary of [
    claude.summary,
    codex.summary,
    everyCode.summary,
    workbuddy.summary,
    gemini.summary,
    grok.summary,
    openclaw.summary,
    antigravity.summary,
    dsh.summary,
    pi.summary,
    omp.summary,
    zed.summary,
    droid.summary,
    codebuddy.summary,
    kilocode.summary,
    ...genericResults.map((result) => result.summary),
  ]) {
    if (summary.events > 0 || !summaryBySource.has(summary.source)) {
      summaryBySource.set(summary.source, summary);
    }
  }
  for (const supportedSource of KNOWN_LOCAL_USAGE_SOURCES) {
    if (!summaryBySource.has(supportedSource)) {
      summaryBySource.set(
        supportedSource,
        sourceFailure(supportedSource).summary,
      );
    }
  }

  return buildLocalUsageSnapshot(events, [...summaryBySource.values()], now);
}
