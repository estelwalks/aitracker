import type { SecurityScanHistoryEntry } from "../../electron/contracts.ts";
import { DESKTOP_HISTORY_KEY } from "./desktop-state-broker.server.ts";
import type { MonitoringSecuritySummary } from "../modules/monitoring/contracts.ts";
import {
  latestHistory,
  summarizeReports,
} from "../modules/security-assessment/presentation/security-view.ts";
import { historyView } from "../modules/security-assessment/query/desktop-client.ts";

/**
 * Resolves the renderer-safe security summary shared by the dashboard, the
 * security/widge insight adapters and the monitoring facade.
 *
 * Precedence:
 *  1. the explicitly-recorded `monitoring.security` summary (the push path,
 *     wired when a scanner completion is published through the monitoring
 *     runtime);
 *  2. a lazy derivation from the real scan history persisted by the
 *     desktop/dev scanner service under `DESKTOP_HISTORY_KEY`.
 *
 * The derivation reuses the exact `summarizeReports`/`latestHistory` logic the
 * dashboard's client-side overview already applies, so a completed scan becomes
 * visible to every consumer as soon as its history row is committed — no
 * separate refresh/event plumbing is required. When neither source exists the
 * result is `null` (honest "unknown", never a fabricated zero).
 */
export async function getMonitoringSecuritySummary(): Promise<MonitoringSecuritySummary | null> {
  const { getCompositionRoot } = await import("./composition.server.ts");
  const root = await getCompositionRoot();

  const status = await root.monitoring.status().catch(() => null);
  if (status?.security) return status.security;

  try {
    const raw = root.database.features.appPreferences.get(DESKTOP_HISTORY_KEY)
      ?.value;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const history = (raw as unknown as SecurityScanHistoryEntry[]).map(
      historyView,
    );
    const totals = summarizeReports(history);
    if (totals.total === 0) return null;
    const latest = latestHistory(history);
    return {
      assessedAt: latest?.finishedAt ?? new Date().toISOString(),
      discoveredAssetCount: totals.total,
      assessedAssetCount: totals.total,
      failedAssetCount: totals.failed,
      cleanCount: totals.safe,
      suspiciousCount: totals.warn,
      dangerousCount: totals.danger,
      unknownCount: totals.unknown,
    };
  } catch {
    return null;
  }
}
