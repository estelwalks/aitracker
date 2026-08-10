import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  opendir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";

import { APP_DATA_DIR, ENV } from "../app-config";
import {
  getDefaultRegistry,
  getScannerPolicy,
} from "../tool-registry/registry.ts";
import { computeToolRegistryVersion } from "../tool-registry/fingerprint.server.ts";
import { buildLocalUsageSnapshot } from "./aggregate.ts";
import {
  collectCodexContextRecord,
  consumeCodexPendingContext,
  createCodexPendingContext,
} from "./codex-context.ts";
import { collectClaudeContext } from "./claude-context.ts";
import {
  BUILTIN_USAGE_ADAPTERS,
  GENERIC_BUILTIN_USAGE_ADAPTERS,
} from "./adapters/catalog.ts";
import {
  eventFromMappedRecord,
  fieldMismatchDiagnostic,
  recordsFromJson,
} from "./adapters/parser.ts";
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
const FUTURE_TIMESTAMP_TOLERANCE_MS =
  SCANNER_POLICY?.futureTimestampToleranceMs ?? DAY_IN_MS;
const PERSISTENT_CACHE_VERSION = 12;
const PERSISTENT_CACHE_FILE_NAME =
  SCANNER_POLICY?.cacheFileName ?? "local-usage-index-v10.json";
/**
 * Fingerprint of the tool-registry config that produced this cache. A config
 * change (paths, reader, command, pricing-rule set, or any JSON definition)
 * invalidates the cache so stale parse results are never served. Bumped with
 * PERSISTENT_CACHE_VERSION (11 -> 12) to force a one-time rebuild on first run
 * after the migration.
 */
const REGISTRY_FINGERPRINT = computeToolRegistryVersion(getDefaultRegistry());
const LEGACY_PERSISTENT_CACHE_FILE_NAMES = [
  "local-usage-index-v1.json",
  "local-usage-index-v2.json",
  "local-usage-index-v3.json",
  "local-usage-index-v4.json",
  "local-usage-index-v5.json",
  "local-usage-index-v6.json",
  "local-usage-index-v7.json",
  "local-usage-index-v8.json",
  "local-usage-index-v9.json",
];
const execFileAsync = promisify(execFile);

interface JsonObject {
  [key: string]: unknown;
}

interface FileCandidate {
  path: string;
  modifiedAt: number;
  size: number;
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
  cacheDirectory?: string;
  disablePersistentCache?: boolean;
}

async function discoverWindowsWslHomes(
  providerDirectory: string,
): Promise<string[]> {
  if (process.platform !== "win32") return [];

  let stdout: string | Buffer;
  try {
    ({ stdout } = await execFileAsync("wsl.exe", ["-l", "-q"], {
      encoding: "buffer",
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    }));
  } catch {
    return [];
  }

  const raw = Buffer.isBuffer(stdout) ? stdout.toString("utf16le") : stdout;
  const distributions = raw
    .split(/\r?\n/)
    .map((value) => value.replace(/\0/g, "").trim())
    .filter(Boolean);
  const homes: string[] = [];

  for (const distribution of distributions) {
    try {
      const result = await execFileAsync(
        "wsl.exe",
        ["-d", distribution, "-e", "sh", "-lc", 'printf %s "$HOME"'],
        {
          encoding: "utf8",
          timeout: 5_000,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      );
      const linuxHome = result.stdout.trim();
      if (!linuxHome.startsWith("/")) continue;
      const suffix = `${linuxHome.replaceAll("/", "\\")}\\${providerDirectory}`;
      homes.push(`\\\\wsl.localhost\\${distribution}${suffix}`);
      homes.push(`\\\\wsl$\\${distribution}${suffix}`);
    } catch {
      continue;
    }
  }

  return homes;
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
}

interface PersistentClaudeFileEntry extends PersistentFileEntryBase {
  source: "claude-code";
  claudeEvents: CachedClaudeEvent[];
}

interface PersistentCodexFileEntry extends PersistentFileEntryBase {
  source: "codex";
  events: LocalUsageEvent[];
}

interface PersistentStructuredFileEntry extends PersistentFileEntryBase {
  source: "gemini-cli" | "grok" | "openclaw";
  identifiedEvents: CachedIdentifiedEvent[];
  diagnostics: LocalUsageDiagnostic[];
}

interface PersistentGenericFileEntry extends PersistentFileEntryBase {
  source: Exclude<
    LocalUsageSource,
    "claude-code" | "codex" | "gemini-cli" | "grok" | "openclaw"
  >;
  events: LocalUsageEvent[];
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
    .update("trusttools-local-usage-event\0")
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
      claudeEvents,
    };
  }

  if (source === "gemini-cli" || source === "grok" || source === "openclaw") {
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
    return {
      source,
      path,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      malformedLines: entry.malformedLines,
      identifiedEvents,
      diagnostics: Array.isArray(entry.diagnostics)
        ? entry.diagnostics.filter(isCachedDiagnostic)
        : [],
    };
  }

  if (
    !Array.isArray(entry.events) ||
    !entry.events.every((event) => isCachedEvent(event, source))
  ) {
    return undefined;
  }
  if (source === "codex") {
    return {
      source,
      path,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      malformedLines: entry.malformedLines,
      events: entry.events,
    };
  }
  const diagnostics = Array.isArray(entry.diagnostics)
    ? entry.diagnostics.filter(isCachedDiagnostic)
    : [];
  return {
    source: source as PersistentGenericFileEntry["source"],
    path,
    mtimeMs: entry.mtimeMs,
    size: entry.size,
    malformedLines: entry.malformedLines,
    events: entry.events,
    diagnostics,
  };
}

function isLocalUsageSource(value: unknown): value is LocalUsageSource {
  return (
    typeof value === "string" &&
    BUILTIN_USAGE_ADAPTERS.some((adapter) => adapter.source === value)
  );
}

function isCachedDiagnostic(value: unknown): value is LocalUsageDiagnostic {
  const item = asObject(value);
  return (
    isLocalUsageSource(item?.source) &&
    (item.code === "config-invalid" ||
      item.code === "file-too-large" ||
      item.code === "field-mismatch" ||
      item.code === "malformed-json" ||
      item.code === "read-failed") &&
    nonNegativeNumber(item.count) &&
    typeof item.message === "string" &&
    (item.path == null || typeof item.path === "string")
  );
}

async function loadPersistentIndex(
  cacheFilePath: string,
): Promise<PersistentUsageIndex | undefined> {
  try {
    const raw = JSON.parse(await readFile(cacheFilePath, "utf8")) as unknown;
    const index = asObject(raw);
    if (
      index?.version !== PERSISTENT_CACHE_VERSION ||
      !Array.isArray(index.files) ||
      index.registryFingerprint !== REGISTRY_FINGERPRINT
    ) {
      return undefined;
    }

    const files: PersistentFileEntry[] = [];
    for (const value of index.files) {
      const entry = persistentFileEntry(value);
      if (entry == null) {
        return undefined;
      }
      files.push(entry);
    }
    return {
      version: PERSISTENT_CACHE_VERSION,
      registryFingerprint: REGISTRY_FINGERPRINT,
      files,
    };
  } catch {
    return undefined;
  }
}

async function writePersistentIndex(
  cacheDirectory: string,
  cacheFilePath: string,
  files: PersistentFileEntry[],
): Promise<void> {
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    cacheDirectory,
    `.${PERSISTENT_CACHE_FILE_NAME}.${process.pid}.${Date.now()}.tmp`,
  );
  const payload = JSON.stringify({
    version: PERSISTENT_CACHE_VERSION,
    registryFingerprint: REGISTRY_FINGERPRINT,
    files,
  } satisfies PersistentUsageIndex);

  try {
    await writeFile(temporaryPath, payload, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, cacheFilePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
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

async function collectRecentJsonlFiles(
  roots: string[],
  cutoffTime: number,
  maxFiles: number,
  fileMatches: (name: string) => boolean,
): Promise<{ available: boolean; files: FileCandidate[] }> {
  const candidates: FileCandidate[] = [];
  let available = false;
  let discoveredEntries = 0;

  for (const root of roots) {
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

async function collectAdapterFiles(
  homeDirectory: string,
  pathConfigs: UsageAdapterPath[],
  cutoffTime: number,
  maxFiles: number,
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

  for (const pathConfig of pathConfigs) {
    const root = join(homeDirectory, pathConfig.root);
    let rootStat;
    try {
      rootStat = await stat(root);
    } catch {
      continue;
    }
    if (!rootStat.isDirectory()) continue;
    detected = true;

    const matcher = globExpression(pathConfig.glob);
    const pendingDirectories = [root];
    while (
      pendingDirectories.length > 0 &&
      discoveredEntries < MAX_DISCOVERED_ENTRIES_PER_SOURCE
    ) {
      const directoryPath = pendingDirectories.pop();
      if (directoryPath == null) break;
      let directory;
      try {
        directory = await opendir(directoryPath);
      } catch {
        continue;
      }

      for await (const entry of directory) {
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
            candidates.set(entryPath, {
              path: entryPath,
              modifiedAt: fileStat.mtimeMs,
              size: fileStat.size,
              format: pathConfig.format,
            });
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

async function readJsonLines(
  filePath: string,
  onRecord: (record: JsonObject) => void,
): Promise<number> {
  let malformedLines = 0;
  const input = createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 64 * 1024,
  });
  const lines = createInterface({ input, crlfDelay: Infinity });

  try {
    for await (const line of lines) {
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

  return malformedLines;
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
  const totalTokens =
    inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens;

  if (totalTokens === 0) {
    return undefined;
  }

  // 采集上下文（tools/skills/commands），仅结构元数据，clean-room 合规。
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
): Promise<SourceScanResult> {
  const selected = await collectRecentJsonlFiles(
    roots,
    cutoffTime,
    maxFiles,
    (name) => name.endsWith(".jsonl"),
  );
  const byMessageId = new Map<string, LocalUsageEvent>();
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;
  const cacheEntries: PersistentClaudeFileEntry[] = [];

  for (const file of selected.files) {
    const cached = cachedFiles.get(file.path);
    let entry: PersistentClaudeFileEntry;
    if (fileSignatureMatches(file, cached, "claude-code")) {
      entry = cached as PersistentClaudeFileEntry;
      filesReused += 1;
    } else {
      const claudeEvents: CachedClaudeEvent[] = [];
      const root =
        roots.find((candidate) => {
          const relativePath = relative(candidate, file.path);
          return relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
        }) ?? roots[0];
      const fallbackSessionId = sessionIdFromRelativeFile(
        "claude-code",
        `${basename(root)}:${relative(root, file.path)}`,
      );
      const fileMalformedLines = await readJsonLines(file.path, (record) => {
        const parsed = claudeEventFromRecord(
          record,
          fallbackSessionId,
          homeDirectory,
        );
        if (parsed != null) {
          claudeEvents.push({ messageId: parsed.id, event: parsed.event });
        }
      });
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
      diagnostics: [],
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

function codexSessionIdFromRecord(record: JsonObject): string | undefined {
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
    "codex",
    explicitIdentifier,
  );
  if (explicitSessionId != null) {
    return explicitSessionId;
  }

  const recordType = stringValue(record.type);
  const payloadType = stringValue(payload?.type);
  if (recordType === "session_meta" || payloadType === "session_meta") {
    return sessionIdFromStructuredValue("codex", payload?.id ?? record.id);
  }
  return undefined;
}

function normalizeProjectPath(project: string, homeDirectory: string): string {
  if (project === homeDirectory) {
    return "~";
  }

  const relativeProject = relative(homeDirectory, project);
  if (
    isAbsolute(project) &&
    relativeProject !== ".." &&
    !relativeProject.startsWith(`..${sep}`)
  ) {
    return `~/${relativeProject.split(sep).join("/")}`;
  }

  return isAbsolute(project) ? "external" : project;
}

function codexEventFromRecord(
  record: JsonObject,
  context: { model: string; project: string; sessionId: string },
  pendingContext: LocalUsageEvent["context"],
  previousTotalUsage?: JsonObject,
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
  const totalTokens =
    inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens;

  if (totalTokens === 0) {
    return undefined;
  }

  return {
    source: "codex",
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

async function scanCodex(
  roots: string[],
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
): Promise<SourceScanResult> {
  const selected = await collectRecentJsonlFiles(
    roots,
    cutoffTime,
    maxFiles,
    (name) => name.endsWith(".jsonl"),
  );
  const events: LocalUsageEvent[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;
  const cacheEntries: PersistentCodexFileEntry[] = [];

  for (const file of selected.files) {
    const cached = cachedFiles.get(file.path);
    let entry: PersistentCodexFileEntry;
    if (fileSignatureMatches(file, cached, "codex")) {
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
        sessionId: sessionIdFromRelativeFile("codex", relativeFileIdentity),
      };
      const fileEvents: LocalUsageEvent[] = [];
      let pendingContext = createCodexPendingContext();
      let previousTotalUsage: JsonObject | undefined;
      const fileMalformedLines = await readJsonLines(file.path, (record) => {
        context.sessionId =
          codexSessionIdFromRecord(record) ?? context.sessionId;
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
      });
      entry = {
        source: "codex",
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
      source: "codex",
      available: events.length > 0,
      detected: selected.available,
      paths: roots,
      filesConsidered: selected.files.length,
      filesRead,
      filesReused,
      filesParsed,
      malformedLines,
      events: events.length,
      diagnostics: [],
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
): Promise<SourceScanResult> {
  const workbuddyRoot = join(homeDirectory, ".workbuddy");
  const projectsRoot = join(workbuddyRoot, "projects");
  const databasePath = join(workbuddyRoot, "workbuddy.db");
  const selected = await collectRecentJsonlFiles(
    [projectsRoot],
    cutoffTime,
    maxFiles,
    (name) => name.endsWith(".jsonl"),
  );
  const events: LocalUsageEvent[] = [];
  const cacheEntries: PersistentGenericFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  const seenResponseIds = new Set<string>();
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  for (const file of selected.files) {
    const cached = cachedFiles.get(file.path);
    let entry: PersistentGenericFileEntry;
    if (fileSignatureMatches(file, cached, "workbuddy")) {
      entry = cached as PersistentGenericFileEntry;
      filesReused += 1;
    } else {
      const fileEvents: LocalUsageEvent[] = [];
      const fallbackSessionId = sessionIdFromRelativeFile(
        "workbuddy",
        relative(projectsRoot, file.path),
      );
      const fileMalformedLines = await readJsonLines(file.path, (record) => {
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
        }
      });
      entry = {
        source: "workbuddy",
        path: file.path,
        mtimeMs: file.modifiedAt,
        size: file.size,
        malformedLines: fileMalformedLines,
        events: fileEvents,
        diagnostics: [],
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
): Promise<{
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  let session: JsonObject | undefined;
  try {
    session = asObject(JSON.parse(await readFile(file.path, "utf8")));
  } catch {
    return { identifiedEvents: [], malformedLines: 1, diagnostics: [] };
  }
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
): Promise<{
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  const identifiedEvents: CachedIdentifiedEvent[] = [];
  const malformedLines = await readJsonLines(file.path, (record) => {
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
          : [eventId, model];
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
  });
  return { identifiedEvents, malformedLines, diagnostics: [] };
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
): Promise<{
  identifiedEvents: CachedIdentifiedEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
  const identifiedEvents: CachedIdentifiedEvent[] = [];
  const malformedLines = await readJsonLines(file.path, (record) => {
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
      inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens;
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
  });
  return { identifiedEvents, malformedLines, diagnostics: [] };
}

type StructuredParser = typeof parseGeminiUsageFile;

async function scanStructuredAdapter(
  adapter: UsageAdapterContract,
  parser: StructuredParser,
  mergeMode: "unique" | "multiset",
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
): Promise<SourceScanResult> {
  const selected = await collectAdapterFiles(
    homeDirectory,
    adapter.paths,
    cutoffTime,
    maxFiles,
  );
  const cacheEntries: PersistentStructuredFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  for (const file of selected.files) {
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
    events.push(...byIdentity.values());
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
      paths: adapter.paths.map((pathConfig) =>
        join(homeDirectory, pathConfig.root),
      ),
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

function diagnostic(
  adapter: UsageAdapterContract,
  code: LocalUsageDiagnostic["code"],
  path: string,
  message: string,
): LocalUsageDiagnostic {
  return { source: adapter.source, code, path, count: 1, message };
}

async function parseGenericFile(
  file: FileCandidate & { format: UsageAdapterPath["format"] },
  adapter: UsageAdapterContract,
  fallbackSessionId: string,
): Promise<{
  events: LocalUsageEvent[];
  malformedLines: number;
  diagnostics: LocalUsageDiagnostic[];
}> {
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
  if (file.format === "sqlite") {
    if (adapter.query == null) {
      return {
        events: [],
        malformedLines: 0,
        diagnostics: [
          diagnostic(
            adapter,
            "query-failed",
            file.path,
            "SQLite 适配器缺少只读查询。",
          ),
        ],
      };
    }
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(file.path, { readOnly: true });
      const records = database.prepare(adapter.query).all() as Array<
        Record<string, unknown>
      >;
      for (const record of records) {
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
  if (file.format === "jsonl") {
    const malformedLines = await readJsonLines(file.path, (record) => {
      const event = eventFromMappedRecord(record, adapter, fallbackSessionId);
      if (event == null) mismatches += 1;
      else events.push(event);
    });
    const diagnostics: LocalUsageDiagnostic[] = [];
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

async function scanGenericAdapter(
  adapter: UsageAdapterContract,
  homeDirectory: string,
  cutoffTime: number,
  nowTime: number,
  maxFiles: number,
  cachedFiles: Map<string, PersistentFileEntry>,
): Promise<SourceScanResult> {
  const selected = await collectAdapterFiles(
    homeDirectory,
    adapter.paths,
    cutoffTime,
    maxFiles,
  );
  const events: LocalUsageEvent[] = [];
  const cacheEntries: PersistentGenericFileEntry[] = [];
  const diagnostics: LocalUsageDiagnostic[] = [];
  let filesRead = 0;
  let filesReused = 0;
  let filesParsed = 0;
  let malformedLines = 0;

  for (const file of selected.files) {
    const cached = cachedFiles.get(file.path);
    let entry: PersistentGenericFileEntry;
    if (fileSignatureMatches(file, cached, adapter.source)) {
      entry = cached as PersistentGenericFileEntry;
      filesReused += 1;
    } else {
      const parsed = await parseGenericFile(
        file,
        adapter,
        sessionIdFromRelativeFile(
          adapter.source,
          relative(homeDirectory, file.path),
        ),
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
        events: parsed.events,
        diagnostics: parsed.diagnostics,
      };
      filesParsed += 1;
    }
    diagnostics.push(...entry.diagnostics);
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
      source: adapter.source,
      available: events.length > 0,
      detected: selected.detected,
      paths: adapter.paths.map((pathConfig) =>
        join(homeDirectory, pathConfig.root),
      ),
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
    process.platform === "win32"
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
  const [wslClaudeHomes, wslCodexHomes] = await Promise.all([
    discoverWindowsWslHomes(".claude"),
    discoverWindowsWslHomes(".codex"),
  ]);
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
  const cutoffTime = nowTime - lookbackDays * DAY_IN_MS;
  const cacheDirectory =
    options.cacheDirectory ?? join(homeDirectory, APP_DATA_DIR, "cache");
  const cacheFilePath = join(cacheDirectory, PERSISTENT_CACHE_FILE_NAME);
  const legacyCacheFilePaths = LEGACY_PERSISTENT_CACHE_FILE_NAMES.map(
    (fileName) => join(cacheDirectory, fileName),
  );
  const persistentIndex = options.disablePersistentCache
    ? undefined
    : await loadPersistentIndex(cacheFilePath);
  const cachedFiles = new Map(
    (persistentIndex?.files ?? []).map((entry) => [entry.path, entry] as const),
  );

  // External usage adapters were removed (v1.5 M4-T1, TC-REG-005): tool facts
  // are offline-only. Only built-in generic adapters run here; native readers
  // (claude/codex/workbuddy) run below.
  const genericAdapters = GENERIC_BUILTIN_USAGE_ADAPTERS.filter(
    (adapter) => adapter.source !== "workbuddy",
  );
  const structuredReader = (
    reader: "gemini-session-v1" | "grok-turn-v1" | "openclaw-session-v1",
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
      homeDirectory,
      cutoffTime,
      nowTime,
      maxFiles,
      cachedFiles,
    );
  };
  const [claude, codex, workbuddy, gemini, grok, openclaw, ...genericResults] =
    await Promise.all([
      scanClaude(
        claudeRoots,
        homeDirectory,
        cutoffTime,
        nowTime,
        maxFiles,
        cachedFiles,
      ).catch((error) => sourceFailure("claude-code", error)),
      scanCodex(
        codexRoots,
        homeDirectory,
        cutoffTime,
        nowTime,
        maxFiles,
        cachedFiles,
      ).catch((error) => sourceFailure("codex", error)),
      scanWorkbuddy(
        homeDirectory,
        cutoffTime,
        nowTime,
        maxFiles,
        cachedFiles,
      ).catch((error) => sourceFailure("workbuddy", error)),
      structuredReader(
        "gemini-session-v1",
        parseGeminiUsageFile,
        "unique",
      ).catch((error) => sourceFailure("gemini-cli", error)),
      structuredReader("grok-turn-v1", parseGrokUsageFile, "unique").catch(
        (error) => sourceFailure("grok", error),
      ),
      structuredReader(
        "openclaw-session-v1",
        parseOpenclawUsageFile,
        "multiset",
      ).catch((error) => sourceFailure("openclaw", error)),
      ...genericAdapters.map((adapter) =>
        scanGenericAdapter(
          adapter,
          homeDirectory,
          cutoffTime,
          nowTime,
          maxFiles,
          cachedFiles,
        ).catch((error) => sourceFailure(adapter.source, error)),
      ),
    ]);

  // The snapshot is built exclusively from the native adapters above.
  const currentCacheEntries = [
    ...claude.cacheEntries,
    ...codex.cacheEntries,
    ...workbuddy.cacheEntries,
    ...gemini.cacheEntries,
    ...grok.cacheEntries,
    ...openclaw.cacheEntries,
    ...genericResults.flatMap((result) => result.cacheEntries),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const shouldWritePersistentIndex =
    !options.disablePersistentCache &&
    (persistentIndex == null ||
      claude.summary.filesParsed > 0 ||
      codex.summary.filesParsed > 0 ||
      workbuddy.summary.filesParsed > 0 ||
      gemini.summary.filesParsed > 0 ||
      grok.summary.filesParsed > 0 ||
      openclaw.summary.filesParsed > 0 ||
      genericResults.some((result) => result.summary.filesParsed > 0) ||
      persistentIndex.files.length !== currentCacheEntries.length);
  if (shouldWritePersistentIndex) {
    await writePersistentIndex(
      cacheDirectory,
      cacheFilePath,
      currentCacheEntries,
    )
      .then(() =>
        Promise.all(
          legacyCacheFilePaths.map((path) =>
            unlink(path).catch(() => undefined),
          ),
        ),
      )
      .catch(() => undefined);
  }

  const nativeEvents = [
    ...claude.events,
    ...codex.events,
    ...workbuddy.events,
    ...gemini.events,
    ...grok.events,
    ...openclaw.events,
    ...genericResults.flatMap((result) => result.events),
  ];
  const events = nativeEvents.map((event) => ({
    ...event,
    project: normalizeProjectPath(event.project, homeDirectory),
  }));
  const summaryBySource = new Map<LocalUsageSource, LocalUsageSourceSummary>();
  for (const summary of [
    claude.summary,
    codex.summary,
    workbuddy.summary,
    gemini.summary,
    grok.summary,
    openclaw.summary,
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
