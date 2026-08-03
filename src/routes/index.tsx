import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Database,
  Download,
  FileDown,
  Image,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
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
  TTButton,
} from "../components/tt";
import { UsageTrendChart } from "../components/dashboard/UsageTrendChart";
import { ContextBreakdown } from "../components/dashboard/ContextBreakdown";
import { UsageHeatmapPanel } from "../components/dashboard/UsageHeatmapPanel";
import { ModelDistribution } from "../components/dashboard/ModelDistribution";
import { UsageDetailTable } from "../components/dashboard/UsageDetailTable";
import {
  TokenPoster,
  type PosterData,
  type PosterPeriod,
} from "../components/TokenPoster";
import {
  getLocalUsageSnapshot,
  refreshLocalUsageSnapshot,
} from "../lib/local-usage";
import {
  aggregateEventsByTime,
  cacheRate,
  computeMoM,
  createEmptyUsageSnapshot,
  filterDailyUsage,
  filterUsageEvents,
  formatDateTime,
  formatTokens,
  previousPeriodTotal,
  resolveUsageRange,
  shareOf,
  sourceLabel,
  totalsFromDaily,
  type UsagePeriod,
} from "../lib/local-usage/presentation";
import type { LocalUsageSnapshot } from "../lib/local-usage";
import {
  aggregatePricedUsage,
  applyPricingSnapshot,
  estimateEventCost,
  estimateUsageCost,
  formatMoney,
} from "../lib/pricing";
import { getPricingSnapshot } from "../lib/pricing/server-fns";
import { getLocalSkills } from "../lib/local-skills/server-fns";
import type { SkillHealth, SkillSnapshot } from "../lib/local-skills/types";
import { AI_TOOLS } from "../lib/tools/catalog";
import {
  toExportCsv,
  toExportJson,
  downloadExport,
  type ExportRow,
} from "../lib/export";

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
      { title: "首页总览 · TrustTools V3.0" },
      {
        name: "description",
        content: "从本机受支持 AI 客户端日志生成的真实 Token 使用概览。",
      },
    ],
  }),
  component: Dashboard,
});

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
const periodOptions: { value: UsagePeriod; label: string }[] = [
  { value: "today", label: "今日" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "all", label: "全部" },
  { value: "custom", label: "自定义" },
];

const periodLabels: Record<UsagePeriod, string> = {
  today: "今日",
  week: "本周",
  "7d": "近 7 天",
  "30d": "近 30 天",
  month: "本月",
  year: "本年",
  all: "全部",
  custom: "自定义区间",
};

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function Dashboard() {
  const { snapshot, error, skills, pricing } = Route.useLoaderData();
  const router = useRouter();
  applyPricingSnapshot(pricing);
  const [period, setPeriod] = useState<UsagePeriod>("today");
  const [from, setFrom] = useState(daysAgo(14));
  const [to, setTo] = useState(daysAgo(0));
  const [dashboardSections, setDashboardSections] = useState(dashboardDefaults);
  const [layouts, setLayouts] = useState<Layouts>(dashboardLayouts);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  // Gate client-only rendering behind mount so the first client render
  // matches the server HTML (avoids hydration mismatch with react-grid-layout,
  // whose WidthProvider cannot measure width until after mount).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(
        "trusttools-dashboard-sections",
      );
      if (saved)
        setDashboardSections({ ...dashboardDefaults, ...JSON.parse(saved) });
      const savedLayouts = window.localStorage.getItem(
        "trusttools-dashboard-layouts",
      );
      if (savedLayouts) {
        // Only adopt a saved breakpoint layout when it still references every
        // widget. A degenerate/empty entry (e.g. left over from a prior SSR
        // glitch where RGL fired onLayoutChange with no children) would make
        // react-grid-layout render nothing at that width, so fall back to the
        // default for that breakpoint instead.
        const parsed = JSON.parse(savedLayouts);
        const expectedIds = dashboardLayouts.lg.map((item) => item.i);
        const merged: Layouts = { ...dashboardLayouts };
        for (const breakpoint of Object.keys(dashboardLayouts)) {
          const candidate = parsed[breakpoint];
          if (
            Array.isArray(candidate) &&
            candidate.length === expectedIds.length &&
            expectedIds.every((id) =>
              candidate.some((item: Layout) => item.i === id),
            )
          ) {
            merged[breakpoint] = candidate;
          }
        }
        setLayouts(merged);
      }
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
    () => filterUsageEvents(snapshot.details, period, from, to),
    [snapshot.details, period, from, to],
  );
  const selectedCost = useMemo(
    () => estimateUsageCost(selectedEvents),
    [selectedEvents],
  );
  const skillHealth = buildSkillHealth(skills);

  // KPI Row 1 — period-driven headline metrics.
  const intervalCostCny = formatMoney(selectedCost.knownUsd, "CNY");
  const intervalCostHint =
    selectedCost.unknownEvents > 0
      ? "部分模型价格未知，金额为已知下限"
      : `${periodLabels[period]} · 按本地模型目录估算`;
  const tokenMoM = useMemo(
    () =>
      computeMoM(
        selectedTotals.totalTokens,
        previousPeriodTotal(
          snapshot.details,
          "totalTokens",
          period,
          from,
          to,
        ) ?? 0,
      ),
    [selectedTotals.totalTokens, snapshot.details, period, from, to],
  );
  const cacheSavingsCny = formatMoney(selectedCost.cacheSavingsUsd, "CNY");
  const cacheHitRate = cacheRate(selectedTotals);

  // KPI Row 2 — token composition breakdown for the selected range.
  const tokenTypeRows = useMemo(
    () =>
      aggregatePricedUsage(selectedEvents, "tokenType").filter(
        (row) => row.totalTokens > 0,
      ),
    [selectedEvents],
  );
  const tokenRowBy = (key: string) =>
    tokenTypeRows.find((row) => row.key === key)?.totalTokens ?? 0;

  // Manual refresh: re-scan logs then re-run loaders. Mirrors the
  // LocalUsageAutoRefresh effect in __root.tsx but is user-triggered.
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState(snapshot.generatedAt);
  useEffect(() => {
    setLastSync(snapshot.generatedAt);
  }, [snapshot.generatedAt]);
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshLocalUsageSnapshot();
      await router.invalidate();
      setLastSync(new Date().toISOString());
    } finally {
      setRefreshing(false);
    }
  };

  // FR-008 - Token poster modal state.
  const [showPoster, setShowPoster] = useState(false);

  // FR-032 - Export dropdown state.
  const [showExportMenu, setShowExportMenu] = useState(false);

  const posterData = useMemo(
    () =>
      buildPosterData(
        selectedEvents,
        selectedTotals,
        selectedCost,
        period,
        from,
        to,
      ),
    [selectedEvents, selectedTotals, selectedCost, period, from, to],
  );

  const handleExport = (format: "csv" | "json") => {
    const rows: ExportRow[] = selectedEvents.map((event) => {
      const cost = estimateEventCost(event);
      return {
        timestamp: event.timestamp,
        source: event.source,
        model: event.model,
        project: event.project,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cachedInputTokens: event.cachedInputTokens,
        cacheCreationInputTokens: event.cacheCreationInputTokens,
        reasoningOutputTokens: event.reasoningOutputTokens,
        ...(cost.unknownEvents === 0 ? { cost: cost.knownUsd } : {}),
      };
    });
    const sourceLabels: Record<string, string> = {};
    for (const event of selectedEvents) {
      if (!(event.source in sourceLabels)) {
        sourceLabels[event.source] = sourceLabel(event.source);
      }
    }
    const content =
      format === "csv"
        ? toExportCsv(rows, sourceLabels)
        : toExportJson(rows, sourceLabels);
    downloadExport(content, format, Date.now());
    setShowExportMenu(false);
  };

  if (snapshot.mode === "empty") {
    return (
      <OnboardingDashboard
        snapshot={snapshot}
        error={error}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />
    );
  }

  return (
    <>
      <div className="dashboard-intro">
        <div>
          <h1>首页总览</h1>
          <p>
            {periodLabels[period]} · {snapshot.events.toLocaleString()}{" "}
            条真实事件 · 最近同步 {formatDateTime(lastSync)}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                    activity: "消耗明细",
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

      {/* Global time-range selector — drives every dashboard module. */}
      <div className="tt-panel mb-3 flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
        <span className="tt-label">时间范围</span>
        <Segmented
          value={period}
          onChange={(value) => setPeriod(value)}
          options={periodOptions}
        />
        {period === "custom" && (
          <>
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
          </>
        )}
        <span className="ml-auto text-muted-foreground">
          {periodGrainLabel(period)}
        </span>
        <button
          type="button"
          onClick={() => setShowPoster(true)}
          disabled={selectedEvents.length === 0}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2.5 py-1 text-xs transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
          title="生成 Token 海报"
        >
          <Image className="size-3.5" />
          导出海报
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowExportMenu(!showExportMenu)}
            disabled={selectedEvents.length === 0}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2.5 py-1 text-xs transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
            title="导出 CSV / JSON"
          >
            <Download className="size-3.5" />
            导出数据
          </button>
          {showExportMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowExportMenu(false)}
              />
              <div className="absolute right-0 top-full z-20 mt-1 flex w-32 flex-col gap-0.5 rounded-sm border border-border bg-surface p-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => handleExport("csv")}
                  className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-accent"
                >
                  <FileDown className="size-3.5" /> CSV
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("json")}
                  className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs transition-colors hover:bg-accent"
                >
                  <FileDown className="size-3.5" /> JSON
                </button>
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2.5 py-1 text-xs transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
          title="立即重新扫描本机日志"
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "同步中…" : "立即刷新"}
        </button>
      </div>

      {(() => {
        const widgets: ReactNode[] = [
          visibleWidgets.includes("kpis") && (
            <div key="kpis" className="dashboard-widget dashboard-widget-kpis">
              <div className="dashboard-kpis">
                <KpiCard
                  to="/"
                  label="区间总费用"
                  value={intervalCostCny}
                  hint={intervalCostHint}
                  accent
                />
                <KpiCard
                  to="/"
                  label="Token 消耗总量"
                  value={formatTokens(selectedTotals.totalTokens)}
                  hint={
                    <span className="inline-flex items-center gap-1.5">
                      <span>
                        {selectedTotals.events.toLocaleString()} 个真实事件
                      </span>
                      <MoMBadge value={tokenMoM} goodWhenDown />
                    </span>
                  }
                />
                <KpiCard
                  to="/"
                  label="缓存命中节省费用"
                  value={cacheSavingsCny}
                  hint={`命中率 ${cacheHitRate.toFixed(0)}%`}
                  tone="ok"
                />
                <KpiCard
                  to="/skills"
                  label="本地 Skill 总数"
                  value={`${skillHealth.total}`}
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
              </div>
              <div className="dashboard-kpis dashboard-kpis-secondary">
                <KpiCard
                  to="/"
                  label="区间总 Token"
                  value={formatTokens(selectedTotals.totalTokens)}
                  hint={`${selectedTotals.events.toLocaleString()} 个事件`}
                />
                <KpiCard
                  to="/"
                  label="区间总费用"
                  value={intervalCostCny}
                  hint={intervalCostHint}
                />
                <KpiCard
                  to="/"
                  label="输入 Token"
                  value={formatTokens(tokenRowBy("input"))}
                  hint={`${shareOf(tokenRowBy("input"), selectedTotals.totalTokens).toFixed(0)}% 占比`}
                />
                <KpiCard
                  to="/"
                  label="输出 Token"
                  value={formatTokens(tokenRowBy("output"))}
                  hint={`${shareOf(tokenRowBy("output"), selectedTotals.totalTokens).toFixed(0)}% 占比`}
                />
                <KpiCard
                  to="/"
                  label="缓存读 Token"
                  value={formatTokens(tokenRowBy("cacheRead"))}
                  hint={`${shareOf(tokenRowBy("cacheRead"), selectedTotals.totalTokens).toFixed(0)}% 占比`}
                />
                <KpiCard
                  to="/"
                  label="缓存写 Token"
                  value={formatTokens(tokenRowBy("cacheWrite"))}
                  hint={`${shareOf(tokenRowBy("cacheWrite"), selectedTotals.totalTokens).toFixed(0)}% 占比`}
                />
              </div>
            </div>
          ),

          dashboardSections.trend && (
            <div key="trend" className="dashboard-widget">
              <Panel
                className="dashboard-trend"
                title="Token 消耗趋势（按 AI 客户端分色）"
              >
                <UsageTrendChart
                  events={selectedEvents}
                  daily={selectedDaily}
                  period={period}
                  customFrom={from}
                  customTo={to}
                />
              </Panel>
            </div>
          ),

          dashboardSections.provider && (
            <div key="provider" className="dashboard-widget">
              <Panel
                className="dashboard-context"
                title="上下文构成"
                action={<span className="tt-label">按工具 · 按维度</span>}
              >
                <ContextBreakdown events={selectedEvents} />
              </Panel>
            </div>
          ),

          dashboardSections.models && (
            <div key="models" className="dashboard-widget">
              <Panel title="模型分布">
                <ModelDistribution events={selectedEvents} />
              </Panel>
            </div>
          ),

          dashboardSections.heatmap && (
            <div key="heatmap" className="dashboard-widget">
              <Panel
                className="dashboard-heatmap"
                title="7 × 24 消耗热力图"
                action={
                  <span className="text-[10px] text-muted-foreground">
                    按周导航 · 本机时区
                  </span>
                }
              >
                <UsageHeatmapPanel events={selectedEvents} />
              </Panel>
            </div>
          ),

          dashboardSections.activity && (
            <div key="activity" className="dashboard-widget">
              <Panel
                className="dashboard-activity"
                title="消耗明细"
                bodyClassName="p-3"
              >
                <UsageDetailTable events={selectedEvents} />
              </Panel>
            </div>
          ),
        ];
        return !mounted || isNarrowViewport ? (
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
      {showPoster && (
        <TokenPoster
          data={posterData}
          filePeriod={(period === "all" ? "30d" : period) as PosterPeriod}
          onClose={() => setShowPoster(false)}
        />
      )}
    </>
  );
}

function KpiCard({
  to,
  label,
  value,
  hint,
  accent = false,
  tone,
}: {
  to: "/" | "/skills" | "/security";
  label: string;
  value: string;
  hint: ReactNode;
  accent?: boolean;
  tone?: "ok";
}) {
  return (
    <Link
      to={to}
      className={`dashboard-kpi ${accent ? "dashboard-kpi-accent" : ""}`}
    >
      <span className="tt-label">{label}</span>
      <strong
        className={`tt-num tabular-nums ${tone === "ok" ? "text-ok" : ""}`}
      >
        {value}
      </strong>
      <span className="dashboard-kpi-hint">{hint}</span>
    </Link>
  );
}

/**
 * Render a 环比 (period-over-period) delta badge. `value` is the percentage
 * returned by `computeMoM` (null when there is no previous window, e.g. "全部"
 * or no history) — null renders "−−". For consumption metrics (tokens/cost)
 * a decrease is good, so `goodWhenDown` colors it green; a rise is red.
 */
function MoMBadge({
  value,
  goodWhenDown = false,
}: {
  value: number | null;
  goodWhenDown?: boolean;
}) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="tt-num text-muted-foreground">环比 −−</span>;
  }
  const up = value > 0;
  const good = goodWhenDown ? !up : up;
  const arrow = up ? "▲" : value < 0 ? "▼" : "·";
  return (
    <span className={`tt-num ${good ? "text-ok" : "text-danger"}`}>
      环比 {arrow} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/**
 * Map the selected period to the aggregation grain the dashboard uses and a
 * short label for the selector area. "今日" buckets hourly, the rolling
 * windows daily, "全部" monthly, and "自定义" defers to the picked span.
 */
function periodGrainLabel(period: UsagePeriod): string {
  switch (period) {
    case "today":
    case "week":
      return "粒度 · 小时";
    case "7d":
    case "30d":
    case "month":
      return "粒度 · 日";
    case "year":
    case "all":
      return "粒度 · 月";
    case "custom":
      return "粒度 · 日";
  }
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

/**
 * FR-013 - Onboarding / empty-state / error views.
 *
 * Three branches:
 * 1. Data load failed -> error + "重新加载" button.
 * 2. No AI tools detected -> welcome view with 3 core capabilities, the 27-tool
 *    list, and a "开始扫描" button that triggers a full re-scan.
 * 3. Tools detected but no log data -> per-tool status + hint.
 */
function OnboardingDashboard({
  snapshot,
  error,
  onRefresh,
  refreshing,
}: {
  snapshot: LocalUsageSnapshot;
  error: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (error) {
    return (
      <>
        <PageHeader
          eyebrow="本地用量"
          title="首页总览"
          desc={`生成于 ${formatDateTime(snapshot.generatedAt)}`}
          status={<StatusBadge tone="danger">读取失败</StatusBadge>}
        />
        <EmptyState
          icon={<Database className="size-8" />}
          title="数据读取失败"
          desc={`真实数据读取失败：${error}`}
          actions={
            <TTButton
              variant="primary"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              重新加载
            </TTButton>
          }
        />
      </>
    );
  }

  const detectedSources = snapshot.sources.filter(
    (s) => s.available || s.detected,
  );
  const hasTools = detectedSources.length > 0;
  const hasEvents = snapshot.events > 0;

  if (!hasTools) {
    return (
      <>
        <PageHeader
          eyebrow="本地用量"
          title="首页总览"
          desc="把散落在各 AI 工具的 token、skill、会话，统一收回你手里。"
          status={<StatusBadge tone="warn">未检测到 AI 工具</StatusBadge>}
        />
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CapabilityCard
              icon={<Activity className="size-6" />}
              title="Token 追踪"
              desc="统一扫描 27 款 AI 编码工具的本机日志，按日/模型/项目维度汇总真实消耗。"
            />
            <CapabilityCard
              icon={<Sparkles className="size-6" />}
              title="Skill 管理"
              desc="集中管理 Claude Code、Codex、Cursor 等工具的 Skills，健康度一目了然。"
            />
            <CapabilityCard
              icon={<ShieldCheck className="size-6" />}
              title="安全检测"
              desc="对本机 AI 生成代码进行安全审计，每日 AI 审查限额可控。"
            />
          </div>
          <Panel title="受支持的 AI 工具（27 款）">
            <div className="flex flex-wrap gap-2">
              {AI_TOOLS.map((tool) => (
                <span
                  key={tool.id}
                  className="inline-flex items-center rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs text-muted-foreground"
                >
                  {tool.nameZh}
                </span>
              ))}
            </div>
          </Panel>
          <div className="flex justify-center py-2">
            <TTButton
              variant="primary"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "扫描中…" : "开始扫描"}
            </TTButton>
          </div>
        </div>
      </>
    );
  }

  if (!hasEvents) {
    return (
      <>
        <PageHeader
          eyebrow="本地用量"
          title="首页总览"
          desc={`生成于 ${formatDateTime(snapshot.generatedAt)}`}
          status={<StatusBadge tone="warn">暂无使用记录</StatusBadge>}
        />
        <Panel title="检测到的 AI 工具">
          <div className="flex flex-col gap-2">
            {detectedSources.map((source) => (
              <div
                key={source.source}
                className="flex items-center justify-between border-b border-border/60 px-1 py-2 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <Dot className="bg-ok" />
                  <span className="text-sm">{sourceLabel(source.source)}</span>
                </div>
                <span className="tt-num text-xs text-muted-foreground">
                  {source.events > 0
                    ? `${source.events} 条记录`
                    : "工具刚安装尚未使用"}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <EmptyState
          icon={<Database className="size-8" />}
          title="暂无使用记录"
          desc="检测到已安装的 AI 工具，但尚未发现可解析的使用日志。使用对应工具后点击刷新。"
          actions={
            <TTButton
              variant="primary"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing ? "扫描中…" : "重新扫描"}
            </TTButton>
          }
        />
      </>
    );
  }

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
        desc="未在本机发现任何受支持客户端的可解析使用日志，不会回退到 Mock 数据。"
      />
    </>
  );
}

function CapabilityCard({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="tt-panel flex flex-col gap-2 p-4">
      <div className="text-primary">{icon}</div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}

/**
 * FR-008 - Build the {@link PosterData} shape from the current selection.
 *
 * Reconstructs the poster data from the period-filtered events, totals, and
 * cost estimate. Trend points are daily token totals; providers are source
 * breakdowns; models are the top 3 by tokens.
 */
function buildPosterData(
  events: LocalUsageSnapshot["details"],
  totals: ReturnType<typeof totalsFromDaily>,
  cost: ReturnType<typeof estimateUsageCost>,
  period: UsagePeriod,
  from: string,
  to: string,
): PosterData {
  const range = resolveUsageRange(period, from, to);
  const rangeLabel =
    range.valid && range.from && range.to ? `${range.from} ~ ${range.to}` : "";

  const trend = aggregateEventsByTime(events, "day").map((b) => b.totalTokens);

  const sourceRows = aggregatePricedUsage(events, "source").filter(
    (r) => r.totalTokens > 0,
  );
  const providers = sourceRows.map((r) => ({
    name: sourceLabel(r.key),
    value: r.totalTokens,
  }));

  const modelRows = aggregatePricedUsage(events, "model").filter(
    (r) => r.totalTokens > 0,
  );
  const grandTotal = modelRows.reduce((s, r) => s + r.totalTokens, 0);
  const models = modelRows.slice(0, 3).map((r) => ({
    name: r.key,
    tokens: formatTokens(r.totalTokens),
    pct: shareOf(r.totalTokens, grandTotal),
  }));

  return {
    periodLabel: periodLabels[period],
    rangeLabel,
    tokens: totals.totalTokens,
    costLabel: formatMoney(cost.knownUsd, "CNY"),
    savedLabel: formatMoney(cost.cacheSavingsUsd, "CNY"),
    hitRate: cacheRate(totals),
    trend,
    providers,
    models,
    unknownPriceModels: cost.unknownModels.length,
  };
}
