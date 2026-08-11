import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../lib/i18n/context.tsx";
import type { UsagePeriod } from "../../../lib/local-usage/presentation.ts";
import {
  createDashboardV2HeroView,
  createDashboardV2View,
} from "../application/v2.ts";
import { refreshDashboardAIInsight } from "../ai-insight.query.ts";
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

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * The route only coordinates period/tool selections. Each visual section is
 * intentionally data-only: no reference mock, random factor, or client-side
 * usage estimate can enter the dashboard from this presentation boundary.
 */
export function DashboardV2Page({ data }: { data: DashboardReadModel }) {
  const { format, locale, t } = useI18n();
  const router = useRouter();
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [selectedTool, setSelectedTool] = useState("all");
  const [aiInsight, setAiInsight] = useState(data.aiInsight);
  const [generatingAIInsight, setGeneratingAIInsight] = useState(false);

  useEffect(() => {
    const refresh = window.setInterval(() => void router.invalidate(), 30_000);
    return () => window.clearInterval(refresh);
  }, [router]);
  useEffect(() => setAiInsight(data.aiInsight), [data.aiInsight]);

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
  async function generateAIInsight() {
    if (!aiInsight?.configured || generatingAIInsight) return;
    setGeneratingAIInsight(true);
    try {
      setAiInsight(await refreshDashboardAIInsight({ data: locale }));
    } finally {
      setGeneratingAIInsight(false);
    }
  }

  return (
    <div className="dashboard-v3 space-y-6 pb-12">
      <DashboardJarvisInsight
        hero={hero}
        aiInsight={aiInsight}
        onGenerateAIInsight={generateAIInsight}
        generatingAIInsight={generatingAIInsight}
      />
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
      <DashboardMetricGrid view={allToolsView} monitoring={hero.monitoring} />
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
