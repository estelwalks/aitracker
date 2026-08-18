import type { MetricSink } from "./contracts.ts";

/**
 * Loader/query/projector measurement helpers (P0-T0-09). This layer only
 * observes — it never changes the returned value. Every read path should wrap
 * its DTO construction so the team can track serialization bytes, projection
 * duration and forbidden-field leaks without altering results.
 */

export interface ReadModelMeasurement {
  readonly name: string;
  readonly durationMs: number;
  /** Serialized JSON bytes of the DTO (0 when the DTO is not serializable). */
  readonly dtoBytes: number;
}

/**
 * Fields that must never appear in a renderer DTO. Field names are checked
 * case-insensitively; nested object keys are walked but values are treated as
 * opaque (path/prompt detection belongs to `redactAttributes`).
 */
const FORBIDDEN_DTO_FIELD_NAMES = new Set([
  "command",
  "prompt",
  "transcript",
  "sessionbody",
  "messages",
  "rawcontent",
  "content",
  "response",
  "apikey",
  "api_key",
  "accesstoken",
  "authorization",
  "password",
  "secret",
]);

/** Walks object keys (shallow-ish) and reports any forbidden field name. */
export function findForbiddenDtoFields(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      hits.push(...findForbiddenDtoFields(item, `${path}[${index}]`)),
    );
    return hits;
  }
  if (value == null || typeof value !== "object") return hits;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_DTO_FIELD_NAMES.has(key.toLowerCase()))
      hits.push(`${path}.${key}`);
    hits.push(...findForbiddenDtoFields(child, `${path}.${key}`));
  }
  return hits;
}

export interface MeasureReadModelOptions {
  readonly metrics?: MetricSink;
  /** Emit a duration metric (and a counter for bytes) under these names. */
  readonly metricPrefix?: string;
}

/**
 * Runs a projector, records wall-clock duration and DTO serialized bytes, and
 * reports forbidden fields. Returns the original value unchanged (only
 * observability side effects).
 */
export function measureReadModel<T>(
  name: string,
  build: () => T,
  options: MeasureReadModelOptions = {},
): { readonly value: T; readonly measurement: ReadModelMeasurement } {
  const startedAt = performance.now();
  const value = build();
  const durationMs = performance.now() - startedAt;
  let dtoBytes = 0;
  try {
    dtoBytes = Buffer.byteLength(JSON.stringify(value as unknown), "utf8");
  } catch {
    dtoBytes = 0;
  }
  if (options.metrics) {
    const prefix = options.metricPrefix ?? "read-model";
    options.metrics.observeDuration(
      `${prefix}.${name}.duration_ms`,
      durationMs,
    );
    options.metrics.increment(`${prefix}.${name}.dto_bytes`, dtoBytes);
  }
  return { value, measurement: { name, durationMs, dtoBytes } };
}
