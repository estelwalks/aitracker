import type {
  SecurityScanHistoryEntry,
  SecuritySkillTarget,
} from "../../../electron/contracts";
import { createNodeRuntimeIdentity } from "../../platform/runtime/node-runtime-identity";
import type { MonitoringSecuritySummary } from "../monitoring/contracts";
import { historyView } from "./query/desktop-client";
import {
  dedupeHistoryByContentHash,
  historyForCurrentSkills,
  latestHistory,
  summarizeReports,
  type SecurityHistoryView,
} from "./presentation/security-view";
import type { SecurityOverviewReadModel } from "./overview.contracts";

/**
 * Global slot through which the Electron main process exposes its
 * `SecurityScannerService` to the same-process SSR/server bundle (the packaged
 * local web server runs the route loaders inside Electron main). Electron
 * writes it once at startup via `registerDesktopSecurityScanner`; the key is
 * mirrored in `electron/desktop-scanner-seam.ts` and pinned by a parity test.
 */
export const DESKTOP_SECURITY_SCANNER_GLOBAL_KEY =
  "__aitracker_desktop_security_scanner_v1__";

/** Structural subset of the scanner service the server read path may use. */
export interface SecurityEnginePort {
  listSkills(options?: {
    readonly additionalRoots?: readonly string[];
  }): Promise<readonly SecuritySkillTarget[]>;
  history(): Promise<readonly SecurityScanHistoryEntry[]>;
}

/**
 * Every surface that answers “how many of my local Skills are scanned?”
 * (dashboard posture cards, Skill management KPIs, insight evidence) reads
 * one server-composed model instead of asking the engine through the
 * renderer. This keeps the numbers identical everywhere and lets them arrive
 * with the rest of the server data instead of a second, lazily loaded
 * request.
 */
export function readDesktopSecurityScanner(): SecurityEnginePort | null {
  const value = (globalThis as unknown as Record<string, unknown>)[
    DESKTOP_SECURITY_SCANNER_GLOBAL_KEY
  ];
  if (value == null) return null;
  // The global is written by Electron main only; structurally duck-typed so
  // the server bundle never imports electron code at runtime.
  return value as SecurityEnginePort;
}

/**
 * Derives the renderer-safe aggregate from real discovery + history exactly
 * like the /security page does (dedupe identical copies by content hash,
 * scope history to the current discovery pass).
 */
export function projectSecurityOverview(
  history: readonly SecurityHistoryView[],
  skills: readonly SecuritySkillTarget[],
  now: () => Date,
): Pick<
  SecurityOverviewReadModel,
  "coverage" | "runCount" | "totalSkills" | "summary"
> {
  const current = historyForCurrentSkills(history, skills);
  const totals = summarizeReports(current);
  const latest = latestHistory(current);
  return {
    coverage: dedupeHistoryByContentHash(current).length,
    runCount: new Set(history.map((entry) => entry.scanId)).size,
    totalSkills: skills.length,
    summary:
      totals.total === 0
        ? null
        : {
            assessedAt: latest?.finishedAt ?? now().toISOString(),
            discoveredAssetCount: totals.total,
            assessedAssetCount: totals.total,
            failedAssetCount: totals.failed,
            cleanCount: totals.safe,
            suspiciousCount: totals.warn,
            dangerousCount: totals.danger,
            unknownCount: totals.unknown,
          },
  };
}

/** Resolves the in-process security engine for the current runtime. */
async function resolveEngine(): Promise<SecurityEnginePort | null> {
  const identity = createNodeRuntimeIdentity();
  if (identity.kind === "desktop") {
    return readDesktopSecurityScanner();
  }
  if (identity.kind === "web") {
    // Browser development: the dev runtime owns the production scanner
    // service in this same server process (see security-dev-server).
    try {
      const { getDevSecurityScannerService } =
        await import("./adapters/security-dev-server.server");
      return (await getDevSecurityScannerService()) as SecurityEnginePort | null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Short TTL so two loaders in the same burst share one engine round-trip. */
const OVERVIEW_CACHE_TTL_MS = 8_000;

interface OverviewResolutionOptions {
  /** Test seam: supply the engine directly and bypass the identity probe. */
  readonly engine?: SecurityEnginePort | null;
  /** Test seam: supply the persisted-history fallback directly. */
  readonly fallback?: () => Promise<MonitoringSecuritySummary | null>;
  readonly now?: () => Date;
}

/**
 * Canonical security overview. Engine path reads real discovery + history and
 * is authoritative; without an engine it degrades to the persisted
 * scan-history summary (the monitoring fallback), never fabricating numbers.
 */
export async function resolveSecurityOverview(
  options: OverviewResolutionOptions = {},
): Promise<SecurityOverviewReadModel> {
  const now = options.now ?? (() => new Date());
  const fallback =
    options.fallback ??
    (async (): Promise<MonitoringSecuritySummary | null> => {
      const { getMonitoringSecuritySummary } =
        await import("../../app/security-summary.server");
      return getMonitoringSecuritySummary();
    });
  const engine =
    options.engine !== undefined ? options.engine : await resolveEngine();
  if (engine != null) {
    try {
      const [historyDtos, skills] = await Promise.all([
        engine.history(),
        engine.listSkills(),
      ]);
      const history = historyDtos.map(historyView);
      return {
        available: true,
        resolvedAt: now().toISOString(),
        ...projectSecurityOverview(history, skills, now),
      };
    } catch {
      // Fall through to the persisted-history summary; the overview must
      // never fail its consumers because one engine read hiccuped.
    }
  }
  const summary = await fallback().catch(() => null);
  return {
    available: false,
    coverage: 0,
    runCount: 0,
    totalSkills: 0,
    summary,
    resolvedAt: null,
  };
}
