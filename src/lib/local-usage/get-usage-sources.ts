import {
  AI_TOOLS,
  type AiTool,
  type UsageLogParsing,
  usageLogParsingFor,
} from "../tools/catalog.ts";
import type { ToolSurface } from "../tool-registry/registry.ts";
import {
  detectToolInstallations,
  type ToolInstallationFact,
} from "../tools/detection.server.ts";
import type { LocalUsageSourceSummary } from "./types.ts";

export type UsageSourceStatus = "has-data" | "no-logs" | "not-installed";

export interface UsageSourceEntry {
  id: string;
  /** Registry-owned primary display name. */
  name: string;
  status: UsageSourceStatus;
  events: number;
  malformedLines: number;
  /** ISO timestamp of the last scan that touched this tool, else null. */
  lastScannedAt: string | null;
  /** HOME-relative scan/probe paths (normalized to ~/) exposed to the UI. */
  paths: string[];
  /** Registry-owned product surface, safe for the browser. */
  toolSurface: ToolSurface;
  /** Verified vendor-owned install URL, null when unavailable. */
  officialDownloadUrl: string | null;
  /** Scanner counts, never a claim that a fixed total exists. */
  filesRead: number;
  filesConsidered: number;
  /** Capability, not a claim that a usable log was found. */
  usageLogParsing: UsageLogParsing;
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
 * leading "~/". Absolute scanner paths are rendered only when they are under
 * HOME; an external path is omitted rather than leaked to the browser.
 */
function normalizeForDisplay(path: string, homeDir: string): string | null {
  if (path.startsWith("/")) {
    if (path === homeDir) return "~";
    if (path.startsWith(`${homeDir}/`))
      return `~/${path.slice(homeDir.length + 1)}`;
    // A scanner can resolve an XDG or environment path outside HOME. Those
    // paths are useful internally, but must never cross the browser boundary.
    return null;
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
  installationFacts: readonly ToolInstallationFact[],
  generatedAt: string,
  homeDir: string,
  fallbackPathsBySource: ReadonlyMap<string, readonly string[]> = new Map(),
): UsageSourcesSummary {
  const bySource = new Map<string, LocalUsageSourceSummary>();
  for (const summary of sourceSummaries) {
    bySource.set(summary.source, summary);
  }
  const installationsById = new Map(
    installationFacts.map((fact) => [fact.id, fact]),
  );

  let connectedCount = 0;
  let noLogsCount = 0;
  let notInstalledCount = 0;
  let eventCount = 0;
  let malformedCount = 0;

  const entries: UsageSourceEntry[] = tools.map((tool) => {
    const summary = bySource.get(tool.id);
    const installation = installationsById.get(tool.id);
    const events = summary?.events ?? 0;
    const malformedLines = summary?.malformedLines ?? 0;
    // A persisted usage snapshot can outlive the installation snapshot (for
    // example after a restart before the first installation probe completes).
    // A source with parsed events is definitive evidence that the tool was
    // installed when the snapshot was written, so do not regress it to
    // "not-installed" while the second snapshot is still empty.
    const inferredInstalled =
      summary?.detected === true || (summary?.available === true && events > 0);
    const installed = installation?.installed ?? inferredInstalled;

    // Path display: prefer the concrete paths reported by the usage scanner;
    // fall back to the platform-specific registry projection when a scan has
    // not produced paths yet (or failed before it could report them). The
    // installation snapshot is retained as a compatibility fallback for
    // callers that do not provide the registry projection. Keeping the
    // registry projection ahead of installation paths is important: a probe
    // root such as AiPy's ~/.aipyapp is not necessarily its usage-log root.
    const rawPaths =
      summary?.paths && summary.paths.length > 0
        ? summary.paths
        : fallbackPathsBySource.has(tool.id)
          ? (fallbackPathsBySource.get(tool.id) ?? [])
          : installation?.detectedPaths && installation.detectedPaths.length > 0
            ? installation.detectedPaths
            : tool.detectRoots;
    const paths = rawPaths
      .map((path) => normalizeForDisplay(path, homeDir))
      .filter((path): path is string => path !== null);

    let status: UsageSourceStatus;
    if (installed) {
      // "connected" follows the installation/detection fact used by the
      // dashboard and Agent overview. Log availability is reported separately
      // by the status tabs and must not lower the installed-agent count.
      connectedCount += 1;
      if (events > 0) {
        status = "has-data";
        eventCount += events;
      } else {
        status = "no-logs";
        noLogsCount += 1;
      }
    } else {
      status = "not-installed";
      notInstalledCount += 1;
    }
    malformedCount += malformedLines;

    return {
      id: tool.id,
      name: tool.nameZh,
      status,
      events,
      malformedLines,
      lastScannedAt: generatedAt,
      paths,
      toolSurface: tool.toolSurface,
      officialDownloadUrl: tool.officialDownloadUrl,
      filesRead: summary?.filesRead ?? 0,
      filesConsidered: summary?.filesConsidered ?? 0,
      usageLogParsing: usageLogParsingFor(tool.id),
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
