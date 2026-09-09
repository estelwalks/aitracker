/**
 * Per-source last-known-good retention for usage snapshots.
 *
 * Why this exists (issue #35): the Usage snapshot is whole-generation
 * replaced on every successful collection. When one source — say `pi` after a
 * data-directory override whose rebased layout does not exist — scans to zero
 * files while other sources stay healthy, the zero result used to be committed
 * unconditionally: the collector's "keep the last snapshot" guard only fires
 * when the WHOLE snapshot is unhealthy, and the Sources cards read exactly
 * this snapshot, so a single transiently failing scan silently zeroed a
 * previously working tool (and every 5-minute scheduled refresh re-stamped
 * the zero).
 *
 * This module protects the *per-source* level: when the previous committed
 * snapshot carries evidence for a source (events or readable files) and the
 * new scan reports that source lifeless (no files, no events, not detected),
 * the previous source row and its aggregate buckets are merged into the new
 * snapshot instead of being dropped. Sources that did scan fresh data are
 * never touched, so a repaired data directory converges on the next good
 * scan. Retained rows carry a `retained-previous` diagnostic so operators can
 * tell "kept last known good" apart from "freshly collected".
 *
 * The merge happens at the persisted bucket granularity
 * (`compactUsageSnapshot` / `buildUsageSnapshotFromProjection`), so every
 * derived aggregate (totals, bySource/byModel/byProject, daily) stays
 * mutually consistent without re-deriving from per-event detail rows.
 */

import type {
  LocalUsageSource,
  LocalUsageSourceSummary,
} from "../../../lib/local-usage/types.ts";
import type { UsageSnapshotDto } from "../contracts.ts";
import {
  buildUsageSnapshotFromProjection,
  compactUsageSnapshot,
} from "./aggregate-projection.ts";

export const RETAINED_PREVIOUS_CODE = "retained-previous" as const;

export interface SourceRetentionOutcome {
  /** Merged snapshot ready to be committed in place of the raw scan result. */
  readonly snapshot: UsageSnapshotDto;
  /** Sources whose previous evidence was carried into the new snapshot. */
  readonly retainedSources: readonly LocalUsageSource[];
}

function markerDiagnostic(
  source: LocalUsageSource,
): NonNullable<LocalUsageSourceSummary["diagnostics"]>[number] {
  return {
    source,
    code: RETAINED_PREVIOUS_CODE,
    count: 1,
    message: `usage.${RETAINED_PREVIOUS_CODE}`,
  };
}

/** A source row is "evidence" when it reported data or readable files. */
function hasEvidence(row: LocalUsageSourceSummary | undefined): boolean {
  if (row == null) return false;
  return (
    row.available === true ||
    (row.events ?? 0) > 0 ||
    (row.filesRead ?? 0) > 0 ||
    (row.filesConsidered ?? 0) > 0
  );
}

/** A source row is lifeless when this scan found nothing attributable. */
function isLifeless(row: LocalUsageSourceSummary | undefined): boolean {
  if (row == null) return true;
  return (
    row.available !== true &&
    row.detected !== true &&
    (row.events ?? 0) === 0 &&
    (row.filesRead ?? 0) === 0 &&
    (row.filesConsidered ?? 0) === 0
  );
}

/**
 * Merge the previous committed snapshot's per-source evidence into the fresh
 * scan result for every source that had evidence before and reports none now.
 * Returns null when nothing needs protecting (no previous evidence shape, no
 * lifeless source with previous evidence, or no persisted buckets to carry).
 *
 * `previous` must be a persisted-shape snapshot (carrying `aggregateBuckets`);
 * freshly scanned snapshots have no buckets and are always used verbatim.
 */
export function retainSourceEvidence(
  previous: UsageSnapshotDto,
  current: UsageSnapshotDto,
): SourceRetentionOutcome | null {
  const previousBuckets = previous.aggregateBuckets;
  if (previousBuckets == null || previousBuckets.length === 0) return null;
  const previousRows = new Map(
    previous.sources.map((row) => [row.source, row] as const),
  );
  const currentRows = new Map(
    current.sources.map((row) => [row.source, row] as const),
  );

  const retained: LocalUsageSource[] = [];
  for (const previousRow of previousRows.values()) {
    if (!hasEvidence(previousRow)) continue;
    if (isLifeless(currentRows.get(previousRow.source))) {
      retained.push(previousRow.source);
    }
  }
  if (retained.length === 0) return null;

  const retainedSet = new Set<LocalUsageSource>(retained);
  const currentCompacted = compactUsageSnapshot(current);
  const mergedBuckets = [
    ...(currentCompacted.aggregateBuckets ?? []),
    ...previousBuckets.filter((bucket) => retainedSet.has(bucket.source)),
  ];
  const previousTracker = previous.trackerBuckets ?? [];
  const mergedTracker = [
    ...(currentCompacted.trackerBuckets ?? []),
    ...previousTracker.filter((bucket) => retainedSet.has(bucket.source)),
  ];
  const mergedSources = current.sources.map((row) => {
    if (!retainedSet.has(row.source)) return row;
    const previousRow = previousRows.get(row.source);
    if (previousRow == null) return row;
    return {
      ...previousRow,
      diagnostics: [
        ...(previousRow.diagnostics ?? []),
        markerDiagnostic(row.source),
      ],
    };
  });

  const rebuilt = buildUsageSnapshotFromProjection({
    generatedAt: current.generatedAt,
    sources: mergedSources,
    buckets: mergedBuckets,
    trackerBuckets: mergedTracker,
  });
  return {
    snapshot: { ...rebuilt, details: current.details, recent: current.recent },
    retainedSources: retained,
  };
}
