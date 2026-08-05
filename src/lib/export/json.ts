import type { ExportRow } from "./types.ts";
import { CSV_HEADER } from "./csv.ts";

/**
 * Resolve a source id to its display label, falling back to the raw id when no
 * mapping is supplied or the id is not in the map. Mirrors the CSV helper so
 * both serializers stay in lockstep.
 */
function resolveSourceLabel(
  source: string,
  sourceLabels?: Record<string, string>,
): string {
  return sourceLabels?.[source] ?? source;
}

/**
 * Convert a list of usage rows to a pretty-printed JSON array string.
 *
 * Each element is an object keyed by the same Chinese field names as the CSV
 * header (see {@link CSV_HEADER}), so the JSON and CSV exports expose an
 * identical column vocabulary. Values mirror the CSV semantics:
 * - `project` is `""` when `undefined`;
 * - `cost` is `null` when `undefined` (there is no JSON "empty number"), or the
 *   raw number when present (no fixed-decimal forcing — JSON numbers render
 *   naturally);
 * - token counts are integers (the input contract).
 *
 * Output is serialized with a 2-space indent. Pure and deterministic.
 *
 * @param rows          Usage rows to export, in the order they should appear.
 * @param sourceLabels  Optional `sourceId → displayLabel` map.
 * @returns Pretty-printed JSON array string.
 */
export function toExportJson(
  rows: ExportRow[],
  sourceLabels?: Record<string, string>,
): string {
  const [
    dateKey,
    sourceKey,
    modelKey,
    projectKey,
    inputKey,
    outputKey,
    cacheReadKey,
    cacheWriteKey,
    reasoningKey,
    costKey,
    costDisplayKey,
    currencyKey,
    rateKey,
    rateDateKey,
  ] = CSV_HEADER;

  const records = rows.map((row) => ({
    [dateKey]: row.timestamp,
    [sourceKey]: resolveSourceLabel(row.source, sourceLabels),
    [modelKey]: row.model,
    [projectKey]: row.project ?? "",
    [inputKey]: row.inputTokens,
    [outputKey]: row.outputTokens,
    [cacheReadKey]: row.cachedInputTokens,
    [cacheWriteKey]: row.cacheCreationInputTokens,
    [reasoningKey]: row.reasoningOutputTokens,
    [costKey]: row.cost ?? null,
    [costDisplayKey]: row.costDisplay ?? null,
    [currencyKey]: row.currency ?? null,
    [rateKey]: row.rate ?? null,
    [rateDateKey]: row.rateDate ?? null,
  }));

  return JSON.stringify(records, null, 2);
}
