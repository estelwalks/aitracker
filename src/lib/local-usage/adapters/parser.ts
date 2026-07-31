import type { LocalUsageDiagnostic, LocalUsageEvent } from "../types.ts";
import { sessionIdFromStructuredValue } from "../session-id.ts";
import type { UsageAdapterContract, UsageFieldMapping } from "./types.ts";

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function valueAtPath(record: JsonObject, path: string): unknown {
  let value: unknown = record;
  for (const segment of path.split(".")) {
    const object = objectValue(value);
    if (object == null) return undefined;
    value = object[segment];
  }
  return value;
}

function firstValue(record: JsonObject, paths: string[] | undefined): unknown {
  if (paths == null) return undefined;
  for (const path of paths) {
    const value = valueAtPath(record, path);
    if (value != null) return value;
  }
  return undefined;
}

function textValue(record: JsonObject, paths: string[] | undefined): string | undefined {
  const value = firstValue(record, paths);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tokenValue(record: JsonObject, paths: string[] | undefined): number {
  const value = firstValue(record, paths);
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }
  return 0;
}

function timestampValue(record: JsonObject, mapping: UsageFieldMapping): Date | undefined {
  const raw = firstValue(record, mapping.timestamp);
  if (typeof raw !== "string" && typeof raw !== "number") {
    return undefined;
  }
  const timestamp = new Date(raw);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp;
}

export function recordsFromJson(
  value: unknown,
  mapping: UsageFieldMapping,
): { records: JsonObject[]; mappingMatched: boolean } {
  if (Array.isArray(value)) {
    return {
      records: value.map(objectValue).filter((record): record is JsonObject => record != null),
      mappingMatched: true,
    };
  }
  const root = objectValue(value);
  if (root == null) {
    return { records: [], mappingMatched: false };
  }

  for (const path of mapping.records ?? []) {
    const records = valueAtPath(root, path);
    if (Array.isArray(records)) {
      return {
        records: records.map(objectValue).filter((record): record is JsonObject => record != null),
        mappingMatched: true,
      };
    }
  }
  return { records: [root], mappingMatched: true };
}

export function eventFromMappedRecord(
  record: JsonObject,
  adapter: UsageAdapterContract,
  fallbackSessionId?: string,
): LocalUsageEvent | undefined {
  const timestamp = timestampValue(record, adapter.mapping);
  if (timestamp == null) {
    return undefined;
  }

  const inputTokens = tokenValue(record, adapter.mapping.inputTokens);
  const cachedInputTokens = tokenValue(record, adapter.mapping.cachedInputTokens);
  const cacheCreationInputTokens = tokenValue(record, adapter.mapping.cacheCreationInputTokens);
  const outputTokens = tokenValue(record, adapter.mapping.outputTokens);
  const reasoningOutputTokens = tokenValue(record, adapter.mapping.reasoningOutputTokens);
  const mappedTotalTokens = tokenValue(record, adapter.mapping.totalTokens);
  const componentTotal = inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens;
  const totalTokens = componentTotal > 0 ? componentTotal : mappedTotalTokens;
  if (totalTokens === 0) {
    return undefined;
  }
  const sessionId =
    sessionIdFromStructuredValue(adapter.source, firstValue(record, adapter.mapping.sessionId)) ??
    fallbackSessionId;

  return {
    source: adapter.source,
    timestamp: timestamp.toISOString(),
    ...(sessionId == null ? {} : { sessionId }),
    model: textValue(record, adapter.mapping.model) ?? "unknown",
    project: textValue(record, adapter.mapping.project) ?? "unknown",
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

export function fieldMismatchDiagnostic(
  adapter: UsageAdapterContract,
  path: string,
  count: number,
): LocalUsageDiagnostic {
  return {
    source: adapter.source,
    code: "field-mismatch",
    path,
    count,
    message: "日志存在，但没有记录匹配已确认的 Token 字段映射。",
  };
}
