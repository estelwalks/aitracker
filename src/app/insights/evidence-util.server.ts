/**
 * Shared, renderer-safe helpers for page-insight evidence adapters (M3).
 *
 * Every helper here is read-only and produces only scalar/enumerated values.
 * No helper touches a filesystem, a scanner, a transcript, a report body, a
 * command, a path, or a credential. Adapters that need one of these fail into
 * an honest empty / partial bundle instead of fabricating a number.
 */
import { AppError } from "../../lib/errors.ts";
import type {
  InsightEvidence,
  InsightEvidenceBundle,
  InsightScope,
  InsightSurfaceId,
} from "../../modules/insights/page/contracts.ts";

/**
 * entityId whitelist: 1..128 chars from `[A-Za-z0-9._:-]`. Anything else is
 * rejected with a renderer-safe error before any read-model lookup happens.
 */
export const ENTITY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function assertEntityId(entityId: string | undefined): void {
  if (entityId !== undefined && !ENTITY_ID_PATTERN.test(entityId)) {
    throw new AppError("errors.generic");
  }
}

/** Honest empty state. `partial` marks "we know data exists but couldn't read it". */
export function emptyBundle(
  surfaceId: InsightSurfaceId,
  scope: InsightScope,
  observedAt: string,
  partial = false,
): InsightEvidenceBundle {
  return {
    surfaceId,
    scope,
    observedAt,
    evidence: [],
    ...(partial ? { partial: true } : {}),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Classify an ISO timestamp against a freshness window. Unknown timestamps
 * (missing / unparseable / clock-skewed into the future) are reported as
 * "unknown" rather than guessed.
 */
export function freshnessOf(
  observedAt: string | null | undefined,
  nowMs: number,
  maxAgeMs: number = DAY_MS,
): InsightEvidence["freshness"] {
  if (observedAt == null || observedAt === "") return "unknown";
  const parsed = Date.parse(observedAt);
  if (!Number.isFinite(parsed) || parsed <= 0) return "unknown";
  const age = nowMs - parsed;
  if (age < 0) return "unknown";
  return age <= maxAgeMs ? "fresh" : "stale";
}

export function metricEvidence(
  id: string,
  value: number,
  observedAt: string,
  freshness: InsightEvidence["freshness"],
  unit?: "count" | "tokens" | "percent" | "usd",
): InsightEvidence {
  return {
    id,
    kind: "metric",
    value,
    ...(unit == null ? {} : { unit }),
    observedAt,
    freshness,
    sensitivity: "aggregate",
  };
}

export function statusEvidence(
  id: string,
  value: string,
  observedAt: string,
  freshness: InsightEvidence["freshness"],
): InsightEvidence {
  return {
    id,
    kind: "status",
    value,
    unit: "status",
    observedAt,
    freshness,
    sensitivity: "aggregate",
  };
}

export function availabilityEvidence(
  id: string,
  value: boolean,
  observedAt: string,
): InsightEvidence {
  return {
    id,
    kind: "availability",
    value,
    observedAt,
    freshness: "unknown",
    sensitivity: "aggregate",
  };
}

/**
 * Resolve a metric from the bundle's evidence by id, yielding `undefined` when
 * absent. This is the ONLY way `composeCandidates` may read numbers — a
 * candidate's `factParams` must be copied from evidence values, never invented.
 */
export function metricValue(
  bundle: InsightEvidenceBundle,
  id: string,
): number | undefined {
  const found = bundle.evidence.find((item) => item.id === id);
  if (found == null || typeof found.value !== "number") return undefined;
  return found.value;
}

/** True when the bundle carries a metric with a numeric value for `id`. */
export function hasMetric(bundle: InsightEvidenceBundle, id: string): boolean {
  return metricValue(bundle, id) !== undefined;
}
