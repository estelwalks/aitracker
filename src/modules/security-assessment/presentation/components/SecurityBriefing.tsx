import { ScanLine } from "lucide-react";

import { InsightCard } from "../../../insights/page/presentation/insight-card";
import { useI18n } from "../../../../lib/i18n/context";
import type { SecurityScanPhase, SecurityTotals } from "../security-view";

/**
 * Security-page insight hero. The copy and layout intentionally use the same
 * shared 今日洞察 card as the dashboard; security keeps only its health ring
 * and scan action in the right-hand action slot.
 */
export function SecurityBriefing({
  totals,
  scanning,
  onScan,
}: {
  totals: SecurityTotals;
  dimensions: number;
  lastScan: string;
  latestStatus: SecurityScanPhase | null;
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
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  const actions = (
    <div className="security-briefing-actions">
      <div
        className="security-briefing-health-ring relative grid shrink-0 place-items-center"
        title={`${t("security.center.briefing.health")} ${health}%`}
        aria-label={`${t("security.center.briefing.health")} ${health}%`}
      >
        <svg viewBox="0 0 100 100" className="size-full -rotate-90">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="var(--surface-2)"
            strokeWidth="7"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={tone}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - health / 100)}
            style={{ transition: "stroke-dashoffset 1s ease" }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span
            className="aitracker-num aitracker-text-metric leading-none font-bold"
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
    <InsightCard
      surfaceId="security"
      variant="hero"
      headingLevel={2}
      title={t("security.center.briefing.title")}
      showRotate={false}
      actions={actions}
    />
  );
}
