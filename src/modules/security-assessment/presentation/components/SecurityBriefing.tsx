import {
  Clock3,
  RadarIcon,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { InsightCard } from "../../../insights/index.ts";
import { useI18n } from "../../../../lib/i18n/context";
import { detectedRiskCount, type SecurityTotals } from "../security-view";

/**
 * Security-page insight hero. The card frame, insight lifecycle, AI label and
 * rotation behavior all come from the shared 今日洞察 component. Security
 * supplies the evidence-derived copy/actions plus the adjacent status bar.
 */
export function SecurityBriefing({
  totals,
  dimensions,
  lastScan,
  nextScan,
  scanning,
  onScan,
}: {
  totals: SecurityTotals;
  dimensions: number;
  lastScan: string;
  nextScan: string;
  scanning: boolean;
  onScan: () => void;
}) {
  const { t } = useI18n();
  const health = totals.total
    ? Math.round((totals.safe / totals.total) * 100)
    : 0;
  const tone =
    totals.danger > 0
      ? "var(--danger)"
      : totals.warn > 0
        ? "var(--warn)"
        : "var(--ok)";
  const risky = detectedRiskCount(totals);
  const first =
    totals.total === 0
      ? t("security.center.briefing.noReportLine")
      : risky > 0
        ? t("security.center.briefing.riskyLine", {
            total: totals.total,
            risky,
            danger: totals.danger,
            warn: totals.warn,
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
  const status = `${t("security.center.briefing.lastScan", {
    dimensions,
    time: lastScan,
  })} · ${health}% ${t("security.center.briefing.health")}`;
  const localLines = [
    first,
    status,
    t("security.center.briefing.boundaryLine"),
  ];
  const pending = risky;
  const statusBar = (
    <section
      className="rounded-xl bg-card px-4 py-3"
      aria-label={t("security.center.briefing.title")}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {pending === 0 ? (
            <ShieldCheck className="size-3.5 text-ok" strokeWidth={1.8} />
          ) : (
            <ShieldAlert className="size-3.5" strokeWidth={1.8} />
          )}
          {t("security.center.briefing.needsAttention", { count: pending })}
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Clock3 className="size-3.5" strokeWidth={1.8} />
          {t("security.center.briefing.recentScan", { time: lastScan })}
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {t("security.center.briefing.scannedSkills", { count: totals.total })}
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          {t("security.center.briefing.nextScan", { time: nextScan })}
        </span>
      </div>
    </section>
  );
  const actions = (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <div
        className="relative grid size-20 shrink-0 place-items-center"
        title={`${t("security.center.briefing.health")} ${health}%`}
        aria-label={`${t("security.center.briefing.health")} ${health}%`}
      >
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth="7"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={tone}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 42}
            strokeDashoffset={2 * Math.PI * 42 * (1 - health / 100)}
            style={{ transition: "stroke-dashoffset 1s ease" }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span
            className="aitracker-num text-[18px] leading-none font-bold"
            style={{ color: tone }}
          >
            {health}%
          </span>
          <span className="aitracker-text-caption mt-0.5 font-mono text-muted-foreground">
            {t("security.center.briefing.health")}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onScan}
        disabled={scanning}
        className="security-briefing-scan group inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 font-medium whitespace-nowrap text-primary-foreground transition-transform hover:scale-[1.02] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ScanLine
          className="size-3.5 transition-transform group-hover:rotate-6"
          strokeWidth={2}
        />
        {t("security.center.briefing.startGlobalScan")}
      </button>
    </div>
  );

  return (
    <>
      <InsightCard
        surfaceId="security"
        variant="hero"
        headingLevel={2}
        title={t("security.center.briefing.title")}
        icon={RadarIcon}
        accent={tone}
        fallbackLines={localLines}
        showFallbackStatus={false}
        actions={actions}
        actionsLayout="title-row"
      />
      {statusBar}
    </>
  );
}
