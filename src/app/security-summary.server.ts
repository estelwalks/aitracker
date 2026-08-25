import type { SecurityScanHistoryEntry } from "../../electron/contracts.ts";
import { DESKTOP_HISTORY_KEY } from "./desktop-state-broker.server.ts";
import type { MonitoringSecuritySummary } from "../modules/monitoring/contracts.ts";
import {
  latestHistory,
  securityHistoryEntryIsSafe,
  summarizeReports,
  type SecurityVerdict,
} from "../modules/security-assessment/presentation/security-view.ts";
import { historyView } from "../modules/security-assessment/query/desktop-client.ts";

export interface SecuritySkillVerdictReadModel {
  readonly byName: Readonly<Record<string, SecurityVerdict>>;
  /** Counts from pre-fix history rows whose name was privacy-projected to "Skill". */
  readonly legacyGeneric: {
    readonly safe: number;
    readonly total: number;
  };
}

/**
 * Resolves the renderer-safe security summary shared by the dashboard, the
 * security/widge insight adapters and the monitoring facade.
 *
 * The real scan history persisted by the desktop/dev scanner service under
 * `DESKTOP_HISTORY_KEY` is authoritative. The monitoring summary is retained
 * only as a fallback for installations that have no persisted scan history.
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

  try {
    const raw =
      root.database.features.appPreferences.get(DESKTOP_HISTORY_KEY)?.value;
    if (Array.isArray(raw) && raw.length > 0) {
      const history = (raw as unknown as SecurityScanHistoryEntry[]).map(
        historyView,
      );
      const totals = summarizeReports(history);
      if (totals.total > 0) {
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
      }
    }
  } catch {
    // Fall through to the last monitoring snapshot when history is not
    // readable, preserving the existing unavailable-state behavior.
  }
  return status?.security ?? null;
}

/**
 * Returns the latest renderer-safe verdict for each Skill name.
 *
 * Agent overview needs to answer a narrower question than the global security
 * summary: how many Skills installed for this Agent are actually safe. Keep
 * the history lookup server-side and expose only the verdict keyed by the
 * already-public Skill name; paths, file contents and scan evidence never
 * cross the server boundary.
 */
export async function getSecuritySkillVerdicts(): Promise<SecuritySkillVerdictReadModel> {
  const { getCompositionRoot } = await import("./composition.server.ts");
  const root = await getCompositionRoot();

  try {
    const raw =
      root.database.features.appPreferences.get(DESKTOP_HISTORY_KEY)?.value;
    if (!Array.isArray(raw) || raw.length === 0) {
      return { byName: {}, legacyGeneric: { safe: 0, total: 0 } };
    }

    const latestByRef = new Map<string, ReturnType<typeof historyView>>();
    for (const item of raw as unknown as SecurityScanHistoryEntry[]) {
      const entry = historyView(item);
      const previous = latestByRef.get(entry.skillRef);
      if (
        previous != null &&
        Date.parse(previous.finishedAt) >= Date.parse(entry.finishedAt)
      ) {
        continue;
      }
      latestByRef.set(entry.skillRef, entry);
    }

    const latestByName = new Map<string, ReturnType<typeof historyView>>();
    for (const entry of latestByRef.values()) {
      const skillName = entry.skillName.trim();
      if (!skillName || skillName === "Skill") continue;
      const previous = latestByName.get(skillName);
      if (
        previous == null ||
        Date.parse(previous.finishedAt) < Date.parse(entry.finishedAt)
      ) {
        latestByName.set(skillName, entry);
      }
    }

    const verdictFor = (
      entry: ReturnType<typeof historyView>,
    ): SecurityVerdict =>
      securityHistoryEntryIsSafe(entry)
        ? "allow"
        : entry.report?.verdict === "allow"
          ? "unknown"
          : (entry.report?.verdict ?? "unknown");
    const legacyGeneric = [...latestByRef.values()].filter(
      (entry) => entry.skillName.trim() === "Skill",
    );

    return {
      byName: Object.fromEntries(
        [...latestByName.entries()].map(([skillName, entry]) => {
          const verdict = verdictFor(entry);
          return [skillName, verdict];
        }),
      ),
      legacyGeneric: {
        safe: legacyGeneric.filter((entry) => verdictFor(entry) === "allow")
          .length,
        total: legacyGeneric.length,
      },
    };
  } catch {
    return { byName: {}, legacyGeneric: { safe: 0, total: 0 } };
  }
}
