import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  Cell,
  CartesianGrid,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, Database, Image, Shield } from "lucide-react";
import RGL, {
  WidthProvider,
  type Layout,
  type Layouts,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import {
  Dot,
  EmptyState,
  PageHeader,
  Panel,
  Segmented,
  StatusBadge,
} from "../components/tt";
import { UsageHeatmap } from "../components/UsageHeatmap";
import { getLocalUsageSnapshot } from "../lib/local-usage";
import {
  createEmptyUsageSnapshot,
  filterDailyUsage,
  formatDateTime,
  formatEventTime,
  formatTokens,
  shareOf,
  sourceLabel,
  totalsFromDaily,
  type UsagePeriod,
} from "../lib/local-usage/presentation";
import type {
  LocalUsageEvent,
  LocalUsageSnapshot,
  LocalUsageSource,
} from "../lib/local-usage";
import {
  applyPricingSnapshot,
  currentUsdToCny,
  estimateEventCost,
  estimateUsageCost,
  filterEventsByPeriod,
  formatCost,
  totalsFromEvents,
} from "../lib/pricing";
import { getPricingSnapshot } from "../lib/pricing/server-fns";
import {
  DAILY_SCAN_LIMIT,
  readDailyScanCount,
} from "../lib/security/daily-limit";
import type { ProviderBudget } from "../lib/settings/store";
import type { BudgetIndicator } from "../components/UsageHeatmap";
import { getLocalSkills } from "../lib/local-skills/server-fns";
import type { SkillHealth, SkillSnapshot } from "../lib/local-skills/types";
import {
  buildProviderBudgetIndicators,
  readRemainingSecurityScans,
  resolveEventProvider,
  type ProviderAwareUsageEvent,
  type ProviderBudgetIndicators,
} from "../lib/local-usage/provider-utils";
import { useAITrackerSettings } from "../lib/settings/store";

export const Route = createFileRoute("/")({
  loader: async () => {
    const usageResult = await Promise.resolve(getLocalUsageSnapshot()).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason) => ({ status: "rejected" as const, reason }),
    );
    const snapshot =
      usageResult.status === "fulfilled"
        ? usageResult.value
        : createEmptyUsageSnapshot();
    const [skillsResult, pricingResult] = await Promise.allSettled([
      getLocalSkills(),
      getPricingSnapshot({
        data: [...new Set(snapshot.details.map((event) => event.model))],
      }),
    ]);
    return {
      snapshot,
      error:
        usageResult.status === "rejected"
          ? usageResult.reason instanceof Error
            ? usageResult.reason.message
            : "本地数据读取失败"
          : null,
      skills: skillsResult.status === "fulfilled" ? skillsResult.value : null,
      pricing:
        pricingResult.status === "fulfilled" ? pricingResult.value : null,
    };
  },
  head: () => ({
    meta: [
      { title: "首页总览 · AITracker V3.0" },
      {
        name: "description",
        content: "从本机受支持 AI 客户端日志生成的真实 Token 使用概览。",
      },
    ],
  }),
  component: Dashboard,
});

type ChartMode = "area" | "bar" | "line";
type DashboardSection =
  "kpis" | "trend" | "provider" | "models" | "heatmap" | "activity";
type DashboardWidget = DashboardSection;
const dashboardDefaults: Record<DashboardSection, boolean> = {
  kpis: true,
  trend: true,
  provider: true,
  models: true,
  heatmap: true,
  activity: true,
};
const ResponsiveGridLayout = WidthProvider(RGL.Responsive);
const dashboardLayouts: Layouts = {
  lg: [
    { i: "kpis", x: 0, y: 0, w: 12, h: 3, minW: 6, minH: 2 },
    { i: "trend", x: 0, y: 3, w: 8, h: 10, minW: 5, minH: 7 },
    { i: "provider", x: 8, y: 3, w: 4, h: 6, minW: 3, minH: 5 },
    { i: "models", x: 8, y: 9, w: 4, h: 5, minW: 3, minH: 4 },
    { i: "heatmap", x: 0, y: 13, w: 8, h: 8, minW: 5, minH: 6 },
    { i: "activity", x: 0, y: 21, w: 12, h: 7, minW: 6, minH: 5 },
  ],
  md: [
    { i: "kpis", x: 0, y: 0, w: 10, h: 3, minW: 6, minH: 2 },
    { i: "trend", x: 0, y: 3, w: 10, h: 10, minW: 5, minH: 7 },
    { i: "provider", x: 0, y: 13, w: 5, h: 6, minW: 3, minH: 5 },
    { i: "models", x: 5, y: 13, w: 5, h: 6, minW: 3, minH: 4 },
    { i: "heatmap", x: 0, y: 19, w: 10, h: 8, minW: 5, minH: 6 },
    { i: "activity", x: 0, y: 27, w: 10, h: 7, minW: 6, minH: 5 },
  ],
  sm: [
    { i: "kpis", x: 0, y: 0, w: 6, h: 5, minW: 6, minH: 4 },
    { i: "trend", x: 0, y: 5, w: 6, h: 10, minW: 6, minH: 7 },
    { i: "provider", x: 0, y: 15, w: 6, h: 7, minW: 6, minH: 5 },
    { i: "models", x: 0, y: 22, w: 6, h: 6, minW: 6, minH: 4 },
    { i: "heatmap", x: 0, y: 28, w: 6, h: 8, minW: 6, minH: 6 },
    { i: "activity", x: 0, y: 36, w: 6, h: 8, minW: 6, minH: 5 },
  ],
  xs: [
    { i: "kpis", x: 0, y: 0, w: 1, h: 5, minW: 1, minH: 4 },
    { i: "trend", x: 0, y: 5, w: 1, h: 10, minW: 1, minH: 7 },
    { i: "provider", x: 0, y: 15, w: 1, h: 7, minW: 1, minH: 5 },
    { i: "models", x: 0, y: 22, w: 1, h: 6, minW: 1, minH: 4 },
    { i: "heatmap", x: 0, y: 28, w: 1, h: 8, minW: 1, minH: 6 },
    { i: "activity", x: 0, y: 36, w: 1, h: 8, minW: 1, minH: 5 },
  ],
};
type SourceSeries = {
  key: LocalUsageSource;
  name: string;
  color: string;
};

const chartColors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

const periodOptions: { value: UsagePeriod; label: string }[] = [
  { value: "today", label: "今日" },
  { value: "week", label: "本周" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "month", label: "本月" },
  { value: "custom", label: "自定义" },
];

const periodLabels: Record<UsagePeriod, string> = {
  today: "今日",
  week: "本周",
  "7d": "近 7 天",
  "30d": "近 30 天",
  month: "本月",
  year: "本年",
  custom: "自定义区间",
};

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function Dashboard() {
  const { snapshot, error, skills, pricing } = Route.useLoaderData();
  applyPricingSnapshot(pricing);
  const [period, setPeriod] = useState<UsagePeriod>("today");
  const [from, setFrom] = useState(daysAgo(14));
  const [to, setTo] = useState(daysAgo(0));
  const [chartMode, setChartMode] = useState<ChartMode>("area");
  const [hiddenSources, setHiddenSources] = useState<LocalUsageSource[]>([]);
  const [dashboardSections, setDashboardSections] = useState(dashboardDefaults);
  const [layouts, setLayouts] = useState<Layouts>(dashboardLayouts);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(
        "trusttools-dashboard-sections",
      );
      if (saved)
        setDashboardSections({ ...dashboardDefaults, ...JSON.parse(saved) });
      const savedLayouts = window.localStorage.getItem(
        "trusttools-dashboard-layouts",
      );
      if (savedLayouts)
        setLayouts({ ...dashboardLayouts, ...JSON.parse(savedLayouts) });
    } catch {
      // Ignore unavailable or malformed local preferences.
    }
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 479px)");
    const updateViewport = () => setIsNarrowViewport(media.matches);
    updateViewport();
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  const remainingSecurityScans = useMemo(
    () =>
      typeof window !== "undefined"
        ? readRemainingSecurityScans(window.localStorage)
        : null,
    [],
  );

  const updateDashboardSections = (section: DashboardSection) => {
    setDashboardSections((current) => {
      const next = { ...current, [section]: !current[section] };
      window.localStorage.setItem(
        "trusttools-dashboard-sections",
        JSON.stringify(next),
      );
      return next;
    });
  };

  const visibleWidgets = (
    Object.keys(dashboardSections) as DashboardWidget[]
  ).filter((widget) => dashboardSections[widget]);
  const onLayoutChange = (_layout: Layout[], nextLayouts: Layouts) => {
    setLayouts(nextLayouts);
    window.localStorage.setItem(
      "trusttools-dashboard-layouts",
      JSON.stringify(nextLayouts),
    );
  };

  const selectedDaily = useMemo(
    () => filterDailyUsage(snapshot.daily, period, from, to),
    [snapshot.daily, period, from, to],
  );
  const selectedTotals = useMemo(
    () => totalsFromDaily(selectedDaily),
    [selectedDaily],
  );
  const selectedEvents = useMemo(
    () => filterEventsByPeriod(snapshot.details, period, from, to),
    [snapshot.details, period, from, to],
  );
  const selectedCost = useMemo(
    () => estimateUsageCost(selectedEvents),
    [selectedEvents],
  );
  const todayEvents = useMemo(
    () => filterEventsByPeriod(snapshot.details, "today"),
    [snapshot.details],
  );
  const sevenDayEvents = useMemo(
    () => filterEventsByPeriod(snapshot.details, "7d"),
    [snapshot.details],
  );
  const primaryTokenEvents =
    sevenDayEvents.length > 0 ? sevenDayEvents : todayEvents;
  const primaryTokenLabel =
    sevenDayEvents.length > 0 ? "近 7 天 Token" : "今日 Token";
  const primaryTokenTotals = useMemo(
    () => totalsFromEvents(primaryTokenEvents),
    [primaryTokenEvents],
  );
  const cacheCost = useMemo(
    () => estimateUsageCost(primaryTokenEvents),
    [primaryTokenEvents],
  );
  const cachedTokens = primaryTokenTotals.cachedInputTokens;
  const cacheHitRate =
    primaryTokenTotals.totalTokens > 0
      ? (cachedTokens / primaryTokenTotals.totalTokens) * 100
      : 0;
  const skillHealth = buildSkillHealth(skills);
  const { settings } = useAITrackerSettings();
  const budgetIndicators = useMemo(
    () =>
      settings.providerBudgets.length > 0
        ? buildProviderBudgetIndicators(
            snapshot.details as ProviderAwareUsageEvent[],
            settings.providerBudgets,
            settings.alertThreshold,
          )
        : [],
    [snapshot.details, settings.providerBudgets, settings.alertThreshold],
  );
  const exceededProviders = useMemo(
    () =>
      budgetIndicators.filter((indicator) =>
        indicator.periods.some(
          (p) => p.state === "exceeded" || p.state === "warning",
        ),
      ),
    [budgetIndicators],
  );
  const topSources: SourceSeries[] = snapshot.bySource
    .slice(0, 5)
    .map((source, index) => ({
      key: source.key as LocalUsageSource,
      name: sourceLabel(source.key),
      color: chartColors[index % chartColors.length]!,
    }));
  const chartData = useMemo(
    () =>
      selectedDaily.map((day) => ({
        label: day.date.slice(5),
        total: day.totalTokens,
        ...Object.fromEntries(
          topSources.map((source) => [
            source.key,
            day.bySource[source.key]?.totalTokens ?? 0,
          ]),
        ),
      })),
    [selectedDaily, topSources],
  );
  const visibleSeries = topSources.filter(
    (item) => !hiddenSources.includes(item.key),
  );
  const providerShare = snapshot.bySource.slice(0, 5).map((item, index) => ({
    name: sourceLabel(item.key),
    value: shareOf(item.totalTokens, snapshot.totals.totalTokens),
    tokens: item.totalTokens,
    color: chartColors[index % chartColors.length]!,
  }));
  const recentModels = snapshot.byModel.slice(0, 6);
  const maxModelTokens = recentModels[0]?.totalTokens || 1;

  if (snapshot.mode === "empty") {
    return <EmptyDashboard snapshot={snapshot} error={error} />;
  }

  return (
    <>
      <div className="dashboard-intro">
        <div>
          <h1>首页总览</h1>
          <p>
            近 7 天 · {snapshot.events.toLocaleString()} 条真实事件 · 更新于{" "}
            {formatDateTime(snapshot.generatedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/tokens"
            className="tt-button inline-flex items-center gap-1.5"
            title="生成海报"
          >
            <Image className="size-4" />
            <span>生成海报</span>
          </Link>
          <details className="dashboard-settings">
            <summary className="tt-button">看板设置</summary>
            <div className="dashboard-settings-popover">
              {(Object.keys(dashboardDefaults) as DashboardSection[]).map(
                (section) => {
                  const labels: Record<DashboardSection, string> = {
                    kpis: "5 个 KPI",
                    trend: "趋势",
                    provider: "AI 客户端",
                    models: "最近模型",
                    heatmap: "热力图",
                    activity: "最近活动",
                  };
                  return (
                    <label key={section}>
                      <input
                        type="checkbox"
                        checked={dashboardSections[section]}
                        onChange={() => updateDashboardSections(section)}
                      />
                      {labels[section]}
                    </label>
                  );
                },
              )}
              <button
                type="button"
                onClick={() => {
                  setDashboardSections(dashboardDefaults);
                  setLayouts(dashboardLayouts);
                  window.localStorage.removeItem(
                    "trusttools-dashboard-sections",
                  );
                  window.localStorage.removeItem(
                    "trusttools-dashboard-layouts",
                  );
                }}
              >
                恢复默认
              </button>
            </div>
          </details>
          <StatusBadge tone="ok">
            <Dot className="size-1 bg-ok" /> 数据已更新
          </StatusBadge>
        </div>
      </div>

      {exceededProviders.length > 0 && (
        <div className="mb-3 space-y-2">
          {exceededProviders.map((indicator) =>
            indicator.periods
              .filter((p) => p.state === "exceeded" || p.state === "warning")
              .map((p) => (
                <div
                  key={`${indicator.provider}-${p.key}`}
                  className={`rounded-sm border px-4 py-2.5 text-sm ${
                    p.state === "exceeded"
                      ? "border-danger/50 bg-danger/10 text-danger"
                      : "border-warn/50 bg-warn/10 text-warn"
                  }`}
                >
                  <strong>{indicator.provider}</strong> {p.label} {p.message}
                  {p.budgetCny > 0 && (
                    <span className="ml-2 text-xs opacity-75">
                      (预算 {p.budgetCny.toFixed(0)} 元，已用{" "}
                      {p.spentCny.toFixed(0)} 元)
                    </span>
                  )}
                </div>
              )),
          )}
        </div>
      )}

      {period === "custom" && (
        <div className="tt-panel mb-3 flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
          <span className="tt-label">趋势区间</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-sm border border-border bg-surface-2 px-2 py-1 outline-none"
            aria-label="开始日期"
          />
          <span className="text-muted-foreground">至</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-sm border border-border bg-surface-2 px-2 py-1 outline-none"
            aria-label="结束日期"
          />
        </div>
      )}

      {(() => {
        const widgets = (
          <>
            {visibleWidgets.includes("kpis") && (
              <div
                key="kpis"
                className="dashboard-widget dashboard-widget-kpis"
              >
                <div className="dashboard-kpis">
                  <KpiCard
                    to="/tokens"
                    label={primaryTokenLabel}
                    value={formatTokens(primaryTokenTotals.totalTokens)}
                    hint={`${primaryTokenTotals.events.toLocaleString()} 个真实事件`}
                    accent
                  />
                  <KpiCard
                    to="/tokens"
                    label="区间费用"
                    value={formatCost(selectedCost, "CNY")}
                    hint={
                      selectedCost.unknownEvents > 0
                        ? "部分模型价格未知，金额为已知下限"
                        : `${periodLabels[period]} · 按本地模型目录估算`
                    }
                  />
                  <KpiCard
                    to="/tokens"
                    label="缓存节省"
                    value={formatMoneyCny(cacheCost.cacheSavingsUsd)}
                    hint={`命中率 ${cacheHitRate.toFixed(0)}% · ${formatTokens(cachedTokens)} 缓存 Token`}
                    tone="ok"
                  />
                  <KpiCard
                    to="/skills"
                    label="活跃 Skill 数"
                    value={`${skillHealth.active} / ${skillHealth.total}`}
                    hint={
                      <span className="dashboard-health">
                        {skillHealth.rows.map((item) => (
                          <span key={item.health}>
                            <Dot className={item.dot} /> {item.count}
                          </span>
                        ))}
                      </span>
                    }
                  />
                  <KpiCard
                    to="/security"
                    label="安全扫描"
                    value={`${remainingSecurityScans} / ${DAILY_SCAN_LIMIT}`}
                    hint="今日剩余安全扫描次数"
                    icon={<Shield className="size-4" />}
                  />
                </div>
              </div>
            )}

            {dashboardSections.trend && (
              <div key="trend" className="dashboard-widget">
                <Panel
                  className="dashboard-trend"
                  title={`Token 消耗趋势（按 AI 客户端分色，单位 K）`}
                  action={
                    <div className="flex items-center gap-2">
                      <Segmented
                        value={chartMode}
                        onChange={setChartMode}
                        options={[
                          { value: "area", label: "堆叠" },
                          { value: "bar", label: "柱状+趋势" },
                          { value: "line", label: "折线" },
                        ]}
                      />
                      <Segmented
                        value={period}
                        onChange={setPeriod}
                        options={periodOptions.slice(0, 5)}
                      />
                    </div>
                  }
                >
                  <div className="dashboard-trend-summary">
                    <Metric
                      label="区间合计"
                      value={formatTokens(selectedTotals.totalTokens)}
                    />
                    <Metric
                      label="日均"
                      value={formatTokens(
                        selectedDaily.length
                          ? selectedTotals.totalTokens / selectedDaily.length
                          : 0,
                      )}
                    />
                    <Metric
                      label="峰值"
                      value={formatTokens(
                        Math.max(
                          0,
                          ...selectedDaily.map((item) => item.totalTokens),
                        ),
                      )}
                    />
                    <Metric
                      label="区间费用"
                      value={formatCost(selectedCost, "CNY")}
                    />
                  </div>
                  <div className="h-[268px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={chartData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          stroke="var(--color-border)"
                          vertical={false}
                          strokeDasharray="2 4"
                        />
                        <XAxis
                          dataKey="label"
                          tick={{
                            fontSize: 11,
                            fill: "var(--color-muted-foreground)",
                          }}
                          axisLine={{ stroke: "var(--color-border)" }}
                          tickLine={false}
                        />
                        <YAxis
                          tickFormatter={formatTokens}
                          width={48}
                          tick={{
                            fontSize: 11,
                            fill: "var(--color-muted-foreground)",
                          }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(value, name) => [
                            `${Number(value).toLocaleString()} Token`,
                            sourceLabel(String(name)),
                          ]}
                          contentStyle={{
                            background: "var(--color-popover)",
                            border: "1px solid var(--color-border)",
                            borderRadius: 5,
                            fontSize: 12,
                          }}
                        />
                        {visibleSeries.map((item) =>
                          chartMode === "area" ? (
                            <Area
                              key={item.key}
                              type="monotone"
                              stackId="usage"
                              dataKey={item.key}
                              name={item.name}
                              stroke={item.color}
                              fill={item.color}
                              fillOpacity={0.22}
                              isAnimationActive={false}
                            />
                          ) : chartMode === "bar" ? (
                            <Bar
                              key={item.key}
                              stackId="usage"
                              dataKey={item.key}
                              name={item.name}
                              fill={item.color}
                              maxBarSize={24}
                              isAnimationActive={false}
                            />
                          ) : (
                            <Line
                              key={item.key}
                              type="monotone"
                              dataKey={item.key}
                              name={item.name}
                              stroke={item.color}
                              strokeWidth={1.8}
                              dot={false}
                              isAnimationActive={false}
                            />
                          ),
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {topSources.map((item) => {
                      const hidden = hiddenSources.includes(item.key);
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() =>
                            setHiddenSources((current) =>
                              current.includes(item.key)
                                ? current.filter((key) => key !== item.key)
                                : [...current, item.key],
                            )
                          }
                          className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] ${
                            hidden
                              ? "border-border text-muted-foreground opacity-50"
                              : "border-border-strong"
                          }`}
                        >
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: item.color }}
                          />
                          {item.name}
                        </button>
                      );
                    })}
                  </div>
                </Panel>
              </div>
            )}

            {dashboardSections.provider && (
              <div key="provider" className="dashboard-widget">
                <Panel
                  title="AI 客户端消耗占比"
                  action={<span className="tt-label">RING · 全量</span>}
                >
                  <div className="dashboard-provider">
                    <div className="dashboard-donut">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={providerShare}
                            dataKey="tokens"
                            nameKey="name"
                            innerRadius="68%"
                            outerRadius="88%"
                            stroke="var(--color-surface)"
                            strokeWidth={2}
                            isAnimationActive={false}
                          >
                            {providerShare.map((provider) => (
                              <Cell key={provider.name} fill={provider.color} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value) =>
                              `${Number(value).toLocaleString()} Token`
                            }
                            contentStyle={{
                              background: "var(--color-popover)",
                              border: "1px solid var(--color-border)",
                              borderRadius: 4,
                              fontSize: 11,
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="dashboard-donut-label">
                        <strong>100%</strong>
                        <span>TOTAL</span>
                      </div>
                    </div>
                    <div className="dashboard-provider-list">
                      {providerShare.map((provider, index) => (
                        <div
                          key={provider.name}
                          className="dashboard-provider-row"
                        >
                          <span className="tt-num text-muted-foreground">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span
                            className="size-1.5 rounded-full"
                            style={{ background: provider.color }}
                          />
                          <span className="truncate">{provider.name}</span>
                          <span className="h-1 flex-1 overflow-hidden bg-surface-2">
                            <span
                              className="block h-full"
                              style={{
                                width: `${provider.value}%`,
                                background: provider.color,
                              }}
                            />
                          </span>
                          <span className="tt-num w-11 text-right">
                            {provider.value.toFixed(0)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Panel>
              </div>
            )}

            {dashboardSections.models && (
              <div key="models" className="dashboard-widget">
                <Panel title="最近模型用量">
                  <div className="space-y-3">
                    {recentModels.map((model) => (
                      <div
                        key={model.key}
                        className="flex items-center gap-3 text-xs"
                      >
                        <span
                          className="tt-num w-32 truncate"
                          title={model.key}
                        >
                          {model.key}
                        </span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full bg-primary/75"
                            style={{
                              width: `${(model.totalTokens / maxModelTokens) * 100}%`,
                            }}
                          />
                        </span>
                        <span className="tt-num w-14 text-right text-muted-foreground">
                          {formatTokens(model.totalTokens)}
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            )}

            {dashboardSections.heatmap && (
              <div key="heatmap" className="dashboard-widget">
                <Panel
                  className="dashboard-heatmap"
                  title="7 × 24 消耗热力图"
                  action={
                    <span className="text-[10px] text-muted-foreground">
                      近 7 天 · 本机时区
                    </span>
                  }
                >
                  <UsageHeatmap events={sevenDayEvents} />
                </Panel>
              </div>
            )}

            {dashboardSections.activity && (
              <div key="activity" className="dashboard-widget">
                <Panel
                  className="dashboard-activity"
                  title="最近活动"
                  action={
                    <Link
                      to="/tokens"
                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      查看全部 <ArrowRight className="size-3" />
                    </Link>
                  }
                  bodyClassName="p-0"
                >
                  <div className="tt-xscroll">
                    <table className="w-full min-w-[760px] text-[13px]">
                      <thead>
                        <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                          <th className="px-4 py-2.5 font-normal">时间</th>
                          <th className="px-4 py-2.5 font-normal">来源</th>
                          <th className="px-4 py-2.5 font-normal">模型</th>
                          <th className="px-4 py-2.5 font-normal">项目</th>
                          <th className="px-4 py-2.5 text-right font-normal">
                            Token
                          </th>
                          <th className="px-4 py-2.5 text-right font-normal">
                            估算费用
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.recent.slice(0, 10).map((event, index) => (
                          <tr
                            key={`${event.timestamp}-${event.model}-${index}`}
                            className="border-b border-border last:border-0 hover:bg-accent/40"
                          >
                            <td className="tt-num px-4 py-2.5 text-muted-foreground">
                              {formatEventTime(event.timestamp)}
                            </td>
                            <td className="px-4 py-2.5">
                              {sourceLabel(event.source)}
                            </td>
                            <td className="tt-num max-w-48 truncate px-4 py-2.5">
                              {event.model}
                            </td>
                            <td className="max-w-56 truncate px-4 py-2.5 text-muted-foreground">
                              {event.project}
                            </td>
                            <td className="tt-num px-4 py-2.5 text-right">
                              {formatTokens(event.totalTokens)}
                            </td>
                            <td className="tt-num px-4 py-2.5 text-right">
                              {formatCost(estimateEventCost(event), "CNY")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>
            )}
          </>
        );
        return isNarrowViewport ? (
          <div className="flex flex-col gap-4">{widgets}</div>
        ) : (
          <ResponsiveGridLayout
            className="dashboard-grid-layout"
            layouts={layouts}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480 }}
            cols={{ lg: 12, md: 10, sm: 6, xs: 1 }}
            rowHeight={36}
            margin={[12, 12]}
            containerPadding={[0, 0]}
            compactType="vertical"
            preventCollision={false}
            isDraggable={!isNarrowViewport}
            isResizable={!isNarrowViewport}
            draggableHandle=".dashboard-panel-title"
            onLayoutChange={onLayoutChange}
          >
            {widgets}
          </ResponsiveGridLayout>
        );
      })()}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2/50 px-3 py-2">
      <div className="tt-label">{label}</div>
      <div className="tt-num mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function KpiCard({
  to,
  label,
  value,
  hint,
  accent = false,
  tone,
  icon,
}: {
  to: "/tokens" | "/skills" | "/security";
  label: string;
  value: string;
  hint: ReactNode;
  accent?: boolean;
  tone?: "ok";
  icon?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`dashboard-kpi ${accent ? "dashboard-kpi-accent" : ""}`}
    >
      {icon && <span className="dashboard-kpi-icon">{icon}</span>}
      <span className="tt-label">{label}</span>
      <strong className={`tt-num ${tone === "ok" ? "text-ok" : ""}`}>
        {value}
      </strong>
      <span className="dashboard-kpi-hint">{hint}</span>
    </Link>
  );
}

function formatMoneyCny(usd: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd * currentUsdToCny());
}

function buildSkillHealth(snapshot: SkillSnapshot | null) {
  const counts: Record<SkillHealth, number> = {
    active: 0,
    low: 0,
    doze: 0,
    dead: 0,
    unknown: 0,
  };
  for (const skill of snapshot?.skills ?? []) counts[skill.health] += 1;
  return {
    active: counts.active,
    total: snapshot?.skills.length ?? 0,
    rows: [
      { health: "active", count: counts.active, dot: "bg-ok" },
      { health: "low", count: counts.low, dot: "bg-warn" },
      { health: "doze", count: counts.doze, dot: "bg-orange-500" },
      { health: "dead", count: counts.dead, dot: "bg-danger" },
      { health: "unknown", count: counts.unknown, dot: "bg-muted-foreground" },
    ] as const,
  };
}

function EmptyDashboard({
  snapshot,
  error,
}: {
  snapshot: LocalUsageSnapshot;
  error: string | null;
}) {
  return (
    <>
      <PageHeader
        eyebrow="本地用量"
        title="首页总览"
        desc={`生成于 ${formatDateTime(snapshot.generatedAt)}`}
        status={<StatusBadge tone="warn">暂无数据</StatusBadge>}
      />
      <EmptyState
        icon={<Database className="size-8" />}
        title="未发现本地日志"
        desc={
          error
            ? `真实数据读取失败：${error}`
            : "未在本机发现任何受支持客户端的可解析使用日志，不会回退到 Mock 数据。"
        }
      />
      <Panel
        className="mt-3"
        title="周 × 时使用热力图"
        action={
          <span className="text-[10px] text-muted-foreground">
            无事件时不生成模拟数据
          </span>
        }
      >
        <UsageHeatmap events={[]} />
      </Panel>
    </>
  );
}
