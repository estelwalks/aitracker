import { FolderOpen, RadarIcon, ScanLine, Settings2 } from "lucide-react";
import { useMemo } from "react";

import { JarvisInsight } from "../../../../components/JarvisInsight";
import { useI18n } from "../../../../lib/i18n/context";
import type {
  SecurityRuntimeCapabilityView,
  SecurityScanPhase,
  SecurityTotals,
} from "../security-view";

/**
 * Security hero card. Renders the shared `JarvisInsight` insight template
 * (orb + typewriter + dot carousel + pill row + right action column) with the
 * Radar logo and localized security copy — the health donut, status chips and
 * directory-picker hint text live elsewhere / are removed.
 */
export function SecurityBriefing({
  totals,
  dimensions,
  lastScan,
  latestStatus,
  runtime,
  scanning,
  canSelectDirectory,
  devMode,
  onScan,
  onFullScan,
  onSelectDirectory,
}: {
  totals: SecurityTotals;
  dimensions: number;
  lastScan: string;
  latestStatus: SecurityScanPhase | null;
  runtime: SecurityRuntimeCapabilityView | null;
  scanning: boolean;
  canSelectDirectory: boolean;
  devMode: boolean;
  onScan: () => void;
  onFullScan: () => void;
  onSelectDirectory: () => void;
}) {
  const { t } = useI18n();
  const risky = totals.warn + totals.danger + totals.unknown + totals.failed;
  const health = totals.total
    ? Math.round((totals.safe / totals.total) * 100)
    : null;
  const lines = useMemo(() => {
    const first =
      totals.total === 0
        ? t("security.center.briefing.noReportLine")
        : risky > 0
          ? t("security.center.briefing.riskyLine", {
              total: totals.total,
              risky,
              danger: totals.danger,
              warn: totals.warn + totals.unknown + totals.failed,
            })
          : totals.findings > 0
            ? t("security.center.briefing.findingLine", {
                total: totals.total,
                findings: totals.findings,
              })
            : t("security.center.briefing.cleanLine", {
                dimensions,
                total: totals.total,
              });
    return [
      first,
      latestStatus === "partial"
        ? t("security.center.briefing.partialLine")
        : t("security.center.briefing.boundaryLine"),
    ];
  }, [dimensions, latestStatus, risky, t, totals]);

  return (
    <JarvisInsight
      icon={RadarIcon}
      title={t("security.center.briefing.title")}
      lines={lines}
      rotateLabel={t("security.center.briefing.refresh")}
      dotsLabel={t("security.center.briefing.title")}
      pills={
        <>
          <span className="dashboard-hero-pill">
            {runtime?.capability === "detection-only"
              ? t("security.center.briefing.detectionOnly")
              : t("security.center.briefing.monitorUnavailable")}
          </span>
          <span className="dashboard-hero-pill">
            <span>{t("security.center.briefing.health")}</span>
            <span className="font-semibold">
              {health == null ? "—" : `${health}%`}
            </span>
          </span>
          {devMode && (
            <span className="dashboard-hero-pill dashboard-hero-pending">
              {t("security.center.briefing.devOnly")}
            </span>
          )}
        </>
      }
      actions={
        <div className="flex w-full flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={onScan}
            disabled={scanning}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[13px] font-medium text-primary-foreground transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ScanLine className="size-4" strokeWidth={2} />
            {t("security.center.briefing.startGlobalScan")}
          </button>
          <button
            type="button"
            onClick={onFullScan}
            disabled={scanning}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-surface-2 px-3 py-2 text-[11px] hover:bg-accent disabled:opacity-40"
          >
            <Settings2 className="size-3.5" />
            {t("security.center.briefing.fullScan")}
          </button>
          {canSelectDirectory && (
            <button
              type="button"
              onClick={onSelectDirectory}
              disabled={scanning}
              className="inline-flex items-center justify-center gap-1.5 rounded-full bg-surface-2 px-3 py-2 text-[11px] hover:bg-accent disabled:opacity-40"
            >
              <FolderOpen className="size-3.5" />
              {t("security.center.briefing.selectDirectory")}
            </button>
          )}
        </div>
      }
    />
  );
}
