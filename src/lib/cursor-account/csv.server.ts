/**
 * Cursor account usage CSV (cursor.com `export-usage-events-csv?strategy=tokens`).
 *
 * The export is the only place Cursor exposes per-request token counts. Its
 * columns have changed repeatedly (new `Cloud Agent ID` / `Automation ID`
 * columns were inserted before `Kind`), so every column is resolved by header
 * name rather than by a fixed index. Unknown extra columns are ignored.
 */

/** One token-bearing Cursor request, normalized to AITracker's token classes. */
export interface CursorUsageRecord {
  readonly timestamp: string;
  readonly model: string;
  readonly kind: string;
  readonly sessionId: string | null;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2
    ? trimmed.slice(1, -1).replaceAll('""', '"')
    : trimmed;
}

/** Splits one RFC 4180 line, honouring quoted commas and doubled quotes. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === ",") {
      fields.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  fields.push(current);
  return fields;
}

function tokenNumber(raw: string | undefined): number {
  if (raw == null) return 0;
  const value = Number(stripQuotes(raw).replaceAll(",", ""));
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function columnIndex(
  headers: readonly string[],
  name: string,
): number | undefined {
  const index = headers.indexOf(name);
  return index >= 0 ? index : undefined;
}

const REQUIRED_COLUMNS = [
  "Date",
  "Model",
  "Input (w/ Cache Write)",
  "Input (w/o Cache Write)",
  "Cache Read",
  "Output Tokens",
  "Total Tokens",
] as const;

/**
 * Parses the whole export. A missing required column means Cursor changed the
 * format in a way we cannot attribute tokens from, so the result is empty
 * rather than a wrong number. Rows without any tokens are request placeholders
 * and are dropped.
 */
export function parseCursorUsageCsv(csvText: string): CursorUsageRecord[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(stripQuotes);
  const indexes = {
    date: columnIndex(headers, "Date"),
    model: columnIndex(headers, "Model"),
    inputWithCache: columnIndex(headers, "Input (w/ Cache Write)"),
    inputWithoutCache: columnIndex(headers, "Input (w/o Cache Write)"),
    cacheRead: columnIndex(headers, "Cache Read"),
    output: columnIndex(headers, "Output Tokens"),
    total: columnIndex(headers, "Total Tokens"),
    kind: columnIndex(headers, "Kind"),
    cloudAgent: columnIndex(headers, "Cloud Agent ID"),
  };
  if (
    REQUIRED_COLUMNS.some((name) => columnIndex(headers, name) === undefined)
  ) {
    return [];
  }
  const dateIndex = indexes.date as number;
  const modelIndex = indexes.model as number;
  const inputWithCacheIndex = indexes.inputWithCache as number;
  const inputWithoutCacheIndex = indexes.inputWithoutCache as number;
  const cacheReadIndex = indexes.cacheRead as number;
  const outputIndex = indexes.output as number;
  const minimumFields =
    Math.max(
      dateIndex,
      modelIndex,
      inputWithCacheIndex,
      inputWithoutCacheIndex,
      cacheReadIndex,
      outputIndex,
    ) + 1;

  const records: CursorUsageRecord[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const fields = parseCsvLine(lines[lineIndex]);
    if (fields.length < minimumFields) continue;
    const rawDate = stripQuotes(fields[dateIndex]);
    const parsedDate = new Date(rawDate);
    if (!Number.isFinite(parsedDate.getTime())) continue;

    const inputWithCache = tokenNumber(fields[inputWithCacheIndex]);
    const inputWithoutCache = tokenNumber(fields[inputWithoutCacheIndex]);
    const cachedInputTokens = tokenNumber(fields[cacheReadIndex]);
    const outputTokens = tokenNumber(fields[outputIndex]);
    const cacheCreationInputTokens = Math.max(
      0,
      inputWithCache - inputWithoutCache,
    );
    if (
      inputWithoutCache === 0 &&
      cachedInputTokens === 0 &&
      cacheCreationInputTokens === 0 &&
      outputTokens === 0
    ) {
      continue;
    }
    const reportedTotal = tokenNumber(
      indexes.total === undefined ? undefined : fields[indexes.total],
    );
    const reportedCloudAgent =
      indexes.cloudAgent === undefined
        ? ""
        : stripQuotes(fields[indexes.cloudAgent] ?? "");
    records.push({
      timestamp: parsedDate.toISOString(),
      model: stripQuotes(fields[modelIndex]) || "unknown",
      kind:
        indexes.kind === undefined
          ? "unknown"
          : stripQuotes(fields[indexes.kind]) || "unknown",
      sessionId: /^[A-Za-z0-9_-]{4,}$/u.test(reportedCloudAgent)
        ? reportedCloudAgent
        : null,
      inputTokens: inputWithoutCache,
      cachedInputTokens,
      cacheCreationInputTokens,
      outputTokens,
      totalTokens:
        inputWithoutCache +
          cachedInputTokens +
          cacheCreationInputTokens +
          outputTokens || reportedTotal,
    });
  }
  return records;
}

/**
 * A single usage file for a whole account has no sessions, so events are
 * grouped per UTC day; a Cloud Agent turn keeps its own conversation id when
 * the export carries one.
 */
function accountSessionId(record: CursorUsageRecord): string {
  if (record.sessionId != null) return `agent-${record.sessionId}`;
  return `day-${record.timestamp.slice(0, 10)}`;
}

/**
 * The on-disk cache shape the local scanner reads.
 *
 * These records are written in the shape the registry's default generic
 * mapping already understands (`timestamp`, `session_id`, `model`, `project`
 * and a nested `usage` object), so Cursor needs no bespoke mapping and the
 * scanner keeps treating it as an ordinary JSON usage log.
 */
export interface CursorUsageCacheRecord {
  readonly timestamp: string;
  readonly session_id: string;
  readonly model: string;
  readonly project: string;
  readonly usage: {
    readonly input_tokens: number;
    readonly cached_input_tokens: number;
    readonly cache_creation_input_tokens: number;
    readonly output_tokens: number;
    readonly reasoning_output_tokens: number;
    readonly total_tokens: number;
  };
}

export const CURSOR_ACCOUNT_PROJECT = "cursor-account";

export function toCursorUsageCacheRecords(
  records: readonly CursorUsageRecord[],
): CursorUsageCacheRecord[] {
  return records.map((record) => ({
    timestamp: record.timestamp,
    session_id: accountSessionId(record),
    model: record.model,
    project: CURSOR_ACCOUNT_PROJECT,
    usage: {
      input_tokens: record.inputTokens,
      cached_input_tokens: record.cachedInputTokens,
      cache_creation_input_tokens: record.cacheCreationInputTokens,
      output_tokens: record.outputTokens,
      reasoning_output_tokens: 0,
      total_tokens: record.totalTokens,
    },
  }));
}
