import { createServerFn } from "@tanstack/react-start";
import { homedir } from "node:os";

import { AI_TOOLS, type AiTool } from "../tools/catalog.ts";
import type { LocalUsageSourceSummary } from "./types.ts";

export type UsageSourceStatus = "has-data" | "no-logs" | "not-installed";

export interface UsageSourceEntry {
  id: string;
  nameZh: string;
  status: UsageSourceStatus;
  events: number;
  malformedLines: number;
  /** ISO timestamp of the last scan that touched this tool, else null. */
  lastScannedAt: string | null;
  /** HOME-relative probe paths (normalized to ~/) used to detect the tool. */
  paths: string[];
}

export interface UsageSourcesTotals {
  toolCount: number;
  connectedCount: number;
  noLogsCount: number;
  notInstalledCount: number;
  eventCount: number;
  malformedCount: number;
}

export interface UsageSourcesSummary {
  generatedAt: string;
  entries: UsageSourceEntry[];
  totals: UsageSourcesTotals;
}

/**
 * Normalize an absolute filesystem path to a ~/ form for display. Catalog
 * `detectRoots` are already HOME-relative (e.g. ".claude"), so they get a
 * leading "~/". Absolute scanner `paths` that start with HOME are rewritten;
 * anything else is returned unchanged.
 */
function normalizeForDisplay(path: string, homeDir: string): string {
  if (path.startsWith("/")) {
    if (path === homeDir) return "~";
    if (path.startsWith(`${homeDir}/`))
      return `~/${path.slice(homeDir.length + 1)}`;
    return path;
  }
  return path.startsWith("~/") ? path : `~/${path}`;
}

/**
 * Derive the data-source summary purely from a catalog and a snapshot's
 * per-source summaries. No filesystem access — kept separate so it can be
 * unit-tested without scanning a real HOME.
 */
export function deriveUsageSources(
  tools: readonly AiTool[],
  sourceSummaries: readonly LocalUsageSourceSummary[],
  generatedAt: string,
  homeDir: string,
): UsageSourcesSummary {
  const bySource = new Map<string, LocalUsageSourceSummary>();
  for (const summary of sourceSummaries) {
    bySource.set(summary.source, summary);
  }

  let connectedCount = 0;
  let noLogsCount = 0;
  let notInstalledCount = 0;
  let eventCount = 0;
  let malformedCount = 0;

  const entries: UsageSourceEntry[] = tools.map((tool) => {
    const summary = bySource.get(tool.id);
    const scanned = summary != null;
    const events = summary?.events ?? 0;
    const malformedLines = summary?.malformedLines ?? 0;

    // Path display: prefer the concrete paths the scanner actually walked;
    // fall back to the catalog's known probe roots.
    const rawPaths =
      summary?.paths && summary.paths.length > 0
        ? summary.paths
        : tool.detectRoots;
    const paths = rawPaths.map((path) => normalizeForDisplay(path, homeDir));

    let status: UsageSourceStatus;
    if (scanned && summary.available && events > 0) {
      status = "has-data";
      connectedCount += 1;
      eventCount += events;
    } else if (
      scanned &&
      (summary.detected ||
        (summary.filesConsidered ?? 0) > 0 ||
        (summary.paths != null && summary.paths.length > 0))
    ) {
      // The tool's install dir was found but no parseable token events came
      // out of its logs (or it has no logs yet).
      status = "no-logs";
      noLogsCount += 1;
    } else {
      status = "not-installed";
      notInstalledCount += 1;
    }
    malformedCount += malformedLines;

    return {
      id: tool.id,
      nameZh: tool.nameZh,
      status,
      events,
      malformedLines,
      lastScannedAt: scanned ? generatedAt : null,
      paths,
    };
  });

  return {
    generatedAt,
    entries,
    totals: {
      toolCount: tools.length,
      connectedCount,
      noLogsCount,
      notInstalledCount,
      eventCount,
      malformedCount,
    },
  };
}

export const getUsageSources = createServerFn({ method: "GET" }).handler(
  async (): Promise<UsageSourcesSummary> => {
    const { getCachedLocalUsageSnapshot } =
      await import("./snapshot.server.ts");
    const snapshot = await getCachedLocalUsageSnapshot();
    return deriveUsageSources(
      AI_TOOLS,
      snapshot.sources,
      snapshot.generatedAt,
      homedir(),
    );
  },
);

export const refreshUsageSources = createServerFn({ method: "POST" }).handler(
  async (): Promise<UsageSourcesSummary> => {
    const { clearLocalUsageSnapshotCache, getCachedLocalUsageSnapshot } =
      await import("./snapshot.server.ts");
    clearLocalUsageSnapshotCache();
    const snapshot = await getCachedLocalUsageSnapshot();
    return deriveUsageSources(
      AI_TOOLS,
      snapshot.sources,
      snapshot.generatedAt,
      homedir(),
    );
  },
);
