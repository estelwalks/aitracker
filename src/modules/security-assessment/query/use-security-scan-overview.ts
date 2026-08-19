import { useEffect, useRef, useState } from "react";

import type { MonitoringSecuritySummary } from "../../monitoring/contracts";
import { latestHistory, summarizeReports } from "../presentation/security-view";
import { getBrowserSecurityClient } from "./browser-client";
import {
  getDesktopSecurityClient,
  type SecurityClient,
} from "./desktop-client";

/** Matches the dashboard's 30s router.invalidate cadence. */
const REFRESH_INTERVAL_MS = 30_000;

export interface SecurityScanOverview {
  readonly summary: MonitoringSecuritySummary | null;
  readonly runCount: number;
  /** Deduplicated count of unique scanned Skills across ALL scan history. */
  readonly coverage: number;
  readonly loading: boolean;
  /**
   * True once a real scan-history client (desktop IPC or companion API) has
   * been resolved. Distinguishes "no scans yet" (runCount 0, available true)
   * from "no scan backend reachable" (available false), so consumers can keep
   * their server-composed fallback instead of displaying a fabricated zero.
   */
  readonly available: boolean;
}

/**
 * Live security-scan overview for the homepage.
 *
 * Resolves the same query client the /security page uses and derives an
 * aggregate from the REAL scan history (not the monitoring module's separate
 * placeholder). Returns `summary: null` when no real scan exists yet so the
 * dashboard keeps its existing unavailable/fallback state — never invents
 * data. The fetch runs only in `useEffect`, so server render and the first
 * client paint both see the initial `{ summary: null, runCount: 0, coverage:
 * 0, loading: true }` state, avoiding a hydration mismatch.
 */
export function useSecurityScanOverview(): SecurityScanOverview {
  const clientRef = useRef<SecurityClient | null>(null);
  const [summary, setSummary] = useState<MonitoringSecuritySummary | null>(
    null,
  );
  const [runCount, setRunCount] = useState(0);
  const [coverage, setCoverage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let disposed = false;
    let busy = false;

    const resolveClient = async (): Promise<SecurityClient | null> => {
      if (clientRef.current != null) return clientRef.current;
      const client =
        getDesktopSecurityClient() ?? (await getBrowserSecurityClient());
      if (client != null) clientRef.current = client;
      return client;
    };

    const refresh = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const client = await resolveClient();
        if (disposed) return;
        if (client == null) {
          setSummary(null);
          setRunCount(0);
          setCoverage(0);
          setAvailable(false);
          setLoading(false);
          return;
        }
        const history = await client.getHistory();
        if (disposed) return;
        // The real scan history was read successfully: from here on the
        // overview counts are authoritative even if a later tick fails
        // (last-known-good), so consumers must not fall back to the separate
        // monitoring placeholder. A failed first read keeps `available`
        // false and the server-composed fallback intact.
        setAvailable(true);
        // summarizeReports dedups across all history by content hash, so the
        // latest run skipping unchanged skills never drops their totals.
        const totals = summarizeReports(history);
        const latest = latestHistory(history);
        // 检测次数 = the number of scan RUNS (distinct scanIds), not history
        // entries: one full scan covering 16 skills counts as 1, not 16.
        setRunCount(new Set(history.map((entry) => entry.scanId)).size);
        // Dedup by the stable content hash so each skill is counted once (an
        // unchanged skill re-scanned, or installed under two roots, shares one
        // content hash — consistent with skill management's dedup).
        setCoverage(
          new Set(
            history.map((entry) => entry.report?.contentHash ?? entry.skillRef),
          ).size,
        );
        setSummary(
          totals.total === 0
            ? null
            : {
                assessedAt: latest?.finishedAt ?? new Date().toISOString(),
                discoveredAssetCount: totals.total,
                assessedAssetCount: totals.total,
                failedAssetCount: totals.failed,
                cleanCount: totals.safe,
                suspiciousCount: totals.warn,
                dangerousCount: totals.danger,
                unknownCount: totals.unknown,
              },
        );
        setLoading(false);
      } catch {
        // Keep last-known-good values on a transient failure; the dashboard
        // falls back to its server-composed monitoring state while summary is
        // null (the initial state on the first error).
        if (!disposed) setLoading(false);
      } finally {
        busy = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  return { summary, runCount, coverage, loading, available };
}
