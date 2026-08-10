import type {
  ToolSurface,
  UsageLogParsing,
} from "../../../../lib/tools/catalog";

export type SourcesQueryStatus = "has-data" | "no-logs" | "not-installed";
export interface SourcesQueryEntry {
  readonly id: string;
  readonly nameZh: string;
  readonly status: SourcesQueryStatus;
  readonly events: number;
  readonly malformedLines: number;
  readonly lastScannedAt: string | null;
  readonly usageLogParsing: UsageLogParsing;
  /** Only ~/ relative paths are allowed in this browser-safe projection. */
  readonly paths: readonly string[];
  readonly toolSurface: ToolSurface;
  readonly officialDownloadUrl: string | null;
  readonly filesRead: number;
  readonly filesConsidered: number;
  /** Null means this source has no reliable Skill-agent mapping. */
  readonly skillCount: number | null;
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

/** Public projection keeps only ~/ display paths and drops raw diagnostics. */
export function toSourcesQuerySummary(input: {
  readonly generatedAt: string;
  readonly entries: readonly SourcesQueryEntry[];
  readonly totals: SourcesQueryTotals;
}): SourcesQuerySummary {
  return {
    generatedAt: input.generatedAt,
    entries: input.entries.map((entry) => ({
      ...entry,
      // Defense in depth: source readers may only emit ~/ relative values.
      paths: entry.paths.filter(
        (path) => path === "~" || path.startsWith("~/"),
      ),
    })),
    totals: { ...input.totals },
  };
}
