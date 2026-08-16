import { useMemo, useState } from "react";
import { useI18n } from "../../../lib/i18n/context.tsx";
import type { UsagePeriod } from "../../../lib/local-usage/presentation.ts";
import {
  createDashboardV2HeroView,
  createDashboardV2View,
} from "../application/v2.ts";
import type { DashboardReadModel } from "../contracts.ts";
import {
  DashboardAgentWorkstreams,
  DashboardContribHeatmap,
  DashboardJarvisInsight,
  DashboardMetricGrid,
  DashboardModelDonut,
  DashboardProjectOverview,
  DashboardRangePicker,
  DashboardToolSwitcher,
  DashboardTrendPanel,
  DashboardTrustHero,
} from "./dashboard-v2-sections.tsx";

function localDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * The route only coordinates period/tool selections. Each visual section is
 * intentionally data-only: no reference mock, random factor, or client-side
 * usage estimate can enter the dashboard from this presentation boundary.
 */
export function DashboardV2Page({ data }: { data: DashboardReadModel }) {
  const { format, t } = useI18n();
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  // Date-only range inputs must use the same local calendar convention as
  // resolveUsageRange. Serialising with toISOString() would move the default
  // day around UTC midnight and make the visible range disagree with the
  // server-composed read model.
  const [from, setFrom] = useState(localDateDaysAgo(29));
  const [to, setTo] = useState(localDateDaysAgo(0));
  const [selectedTool, setSelectedTool] = useState("all");

  const scopedSnapshot = useMemo(
    () =>
      selectedTool === "all"
        ? data.v2
        : {
            ...data.v2,
            events: data.v2.events.filter(
              (event) => event.source === selectedTool,
            ),
            sessions: {
              ...data.v2.sessions,
              byProjectDay: data.v2.sessions.byProjectDay.filter(
                (row) => row.source === selectedTool,
              ),
              bySourceDay: data.v2.sessions.bySourceDay.filter(
                (row) => row.source === selectedTool,
              ),
            },
          },
    [data.v2, selectedTool],
  );
  const view = useMemo(
    () => createDashboardV2View(scopedSnapshot, period, from, to),
    [from, period, scopedSnapshot, to],
  );
  const allToolsView = useMemo(
    () => createDashboardV2View(data.v2, period, from, to),
    [data.v2, from, period, to],
  );
  const today = useMemo(
    () => createDashboardV2View(data.v2, "today"),
    [data.v2],
  );
  const hero = useMemo(
    () =>
      createDashboardV2HeroView({
        snapshot: data.v2,
        monitoring: data.monitoring,
        activeInsightCount: data.activeInsightCount ?? 0,
      }),
    [data.activeInsightCount, data.monitoring, data.v2],
  );
  const rangeLabel = useMemo(() => {
    switch (period) {
      case "today":
        return t("dashboard.period.today");
      case "7d":
        return t("dashboard.period.lastNDays", { count: 7 });
      case "30d":
        return t("dashboard.period.lastNDays", { count: 30 });
      case "all":
        return t("dashboard.period.all");
      default:
        return `${from.slice(5)} → ${to.slice(5)}`;
    }
  }, [from, period, t, to]);
  const baselineLabel = useMemo(() => {
    switch (period) {
      case "today":
        return t("dashboard.v2.baselineToday");
      case "7d":
        return t("dashboard.v2.baselineLastNDays", { count: 7 });
      case "30d":
        return t("dashboard.v2.baselineLastNDays", { count: 30 });
      default:
        return t("dashboard.v2.baselinePrevious");
    }
  }, [period, t]);

  return (
    <div className="dashboard-v3 space-y-6 pb-12">
      <DashboardJarvisInsight hero={hero} rangeLabel={rangeLabel} />
      <DashboardTrustHero
        view={allToolsView}
        today={today}
        hero={hero}
        security={data.monitoring?.security}
      />
      <div className="dashboard-range-bar sticky top-14 z-20">
        <div className="min-w-0">
          <span className="font-semibold text-[13px]">
            {t("dashboard.v2.overviewLabel")}
          </span>
          <span className="ml-3 font-mono text-[11px] text-muted-foreground">
            {format.formatTokens(view.totals.totalTokens)} tokens ·{" "}
            {view.estimatedCostUsd == null
              ? t("dashboard.kpi.unavailable")
              : format.formatUsd(view.estimatedCostUsd)}{" "}
            ·{" "}
            {view.sessions == null
              ? t("dashboard.kpi.unavailable")
              : format.formatNumber(view.sessions)}
          </span>
        </div>
        <DashboardRangePicker
          period={period}
          from={from}
          to={to}
          onChange={(next) => {
            setPeriod(next.period);
            if (next.from) setFrom(next.from);
            if (next.to) setTo(next.to);
          }}
        />
      </div>
      <DashboardMetricGrid
        view={allToolsView}
        monitoring={hero.monitoring}
        baselineLabel={baselineLabel}
      />
      <DashboardToolSwitcher
        tools={allToolsView.tools}
        selected={selectedTool}
        onChange={setSelectedTool}
      />
      <DashboardTrendPanel view={view} />
      <DashboardModelDonut view={view} />
      <DashboardProjectOverview view={view} />
      <DashboardContribHeatmap
        points={view.calendar}
        summary={view.calendarSummary}
      />
      <DashboardAgentWorkstreams view={view} selectedTool={selectedTool} />
    </div>
  );
}
