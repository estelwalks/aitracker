import type { UsageLogParsing } from "../../../../lib/tools/catalog";

export type SourcesQueryStatus = "has-data" | "no-logs" | "not-installed";
export interface SourcesQueryEntry {
  readonly id: string;
  readonly nameZh: string;
  readonly status: SourcesQueryStatus;
  readonly events: number;
  readonly malformedLines: number;
  readonly lastScannedAt: string | null;
  readonly usageLogParsing: UsageLogParsing;
}
export interface SourcesQueryTotals {
  readonly toolCount: number;
  readonly connectedCount: number;
  readonly noLogsCount: number;
  readonly notInstalledCount: number;
  readonly eventCount: number;
  readonly malformedCount: number;
}
export interface SourcesQuerySummary {
  readonly generatedAt: string;
  readonly entries: readonly SourcesQueryEntry[];
  readonly totals: SourcesQueryTotals;
}

/** Public projection deliberately drops probe paths and raw diagnostics. */
export function toSourcesQuerySummary(input: {
  readonly generatedAt: string;
  readonly entries: readonly (SourcesQueryEntry & {
    readonly paths?: readonly string[];
  })[];
  readonly totals: SourcesQueryTotals;
}): SourcesQuerySummary {
  return {
    generatedAt: input.generatedAt,
    entries: input.entries.map(
      ({
        id,
        nameZh,
        status,
        events,
        malformedLines,
        lastScannedAt,
        usageLogParsing,
      }) => ({
        id,
        nameZh,
        status,
        events,
        malformedLines,
        lastScannedAt,
        usageLogParsing,
      }),
    ),
    totals: { ...input.totals },
  };
}
