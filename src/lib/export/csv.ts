import type { ExportRow } from "./types.ts";

/**
 * Fixed CSV column header, in on-disk order. The Chinese labels are the
 * user-facing field names and are reused verbatim as JSON object keys (see
 * json.ts).
 */
export const CSV_HEADER = [
  "日期",
  "工具名",
  "模型名",
  "项目",
  "输入Token",
  "输出Token",
  "缓存读",
  "缓存写",
  "推理Token",
  "费用",
] as const;

/** CRLF line terminator per RFC 4180 §4 (common-parity, Excel-friendly). */
const LINE_ENDING = "\r\n";

/**
 * Quote/escape a single CSV cell per RFC 4180 §2.6/§2.7.
 *
 * A value is wrapped in double quotes when it contains any of `,`, `"`, CR or
 * LF; every embedded `"` is doubled. Values without special characters pass
 * through unchanged (no unnecessary quoting).
 */
function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Render an integer token count. The {@link ExportRow} contract types these as
 * `number`; this truncates defensively so the output is always an integer
 * literal (never a decimal), matching the "Numbers as integers" requirement.
 */
function formatTokenCell(value: number): string {
  return String(Math.trunc(value));
}

/**
 * Render a cost cell: exactly two decimals when present, empty when absent.
 */
function formatCostCell(value: number | undefined): string {
  return value === undefined ? "" : value.toFixed(2);
}

/**
 * Resolve a source id to its display label, falling back to the raw id when no
 * mapping is supplied or the id is not in the map.
 */
function resolveSourceLabel(
  source: string,
  sourceLabels?: Record<string, string>,
): string {
  return sourceLabels?.[source] ?? source;
}

/**
 * Convert a list of usage rows to an RFC 4180 CSV string.
 *
 * The output always begins with the fixed header line (even when `rows` is
 * empty) and uses CRLF line endings. Token counts render as integer literals;
 * `cost` renders as a fixed 2-decimal value or empty when `undefined`;
 * `project` renders as empty when `undefined`. `source` ids are translated via
 * the optional `sourceLabels` map (falling back to the raw id), so callers
 * control display naming without mutating input data.
 *
 * Pure and deterministic: identical `rows` + `sourceLabels` produce identical
 * output. No I/O, no React, no pricing dependency.
 *
 * @param rows          Usage rows to export, in the order they should appear.
 * @param sourceLabels  Optional `sourceId → displayLabel` map.
 * @returns CSV document including the header line.
 */
export function toExportCsv(
  rows: ExportRow[],
  sourceLabels?: Record<string, string>,
): string {
  const lines: string[] = [CSV_HEADER.join(",")];

  for (const row of rows) {
    const cells = [
      escapeCsvCell(row.timestamp),
      escapeCsvCell(resolveSourceLabel(row.source, sourceLabels)),
      escapeCsvCell(row.model),
      escapeCsvCell(row.project ?? ""),
      formatTokenCell(row.inputTokens),
      formatTokenCell(row.outputTokens),
      formatTokenCell(row.cachedInputTokens),
      formatTokenCell(row.cacheCreationInputTokens),
      formatTokenCell(row.reasoningOutputTokens),
      formatCostCell(row.cost),
    ];
    lines.push(cells.join(","));
  }

  return lines.join(LINE_ENDING);
}
