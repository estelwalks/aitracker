import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileDown,
  Image,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Dot,
  EmptyState,
  PageHeader,
  Panel,
  Segmented,
  StatusBadge,
  TTButton,
} from "../components/tt";
import {
  UsageTrendChart,
  type TrendChartMode,
} from "../components/dashboard/UsageTrendChart";
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
  const [trendMode, setTrendMode] = useState<TrendChartMode>("area");

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

  // KPI metric card horizontal scroll navigation.
  const summaryRef = useRef<HTMLDivElement>(null);
  const [metricNav, setMetricNav] = useState({ page: 0, pages: 1 });

  const syncMetricNav = useCallback(() => {
    const el = summaryRef.current;
    if (!el) return;
    const pageW = el.clientWidth;
    const pages = Math.max(1, Math.ceil(el.scrollWidth / pageW - 0.02));
    const page = Math.min(pages - 1, Math.round(el.scrollLeft / pageW));
    setMetricNav((p) =>
      p.page === page && p.pages === pages ? p : { page, pages },
    );
  }, []);

  useEffect(() => {
    syncMetricNav();
    window.addEventListener("resize", syncMetricNav);
    return () => window.removeEventListener("resize", syncMetricNav);
  }, [syncMetricNav]);

  const goMetricPage = useCallback(
    (next: number) => {
      const el = summaryRef.current;
      if (!el) return;
      const p = Math.max(0, Math.min(metricNav.pages - 1, next));
      el.scrollTo({ left: p * el.clientWidth, behavior: "smooth" });
    },
    [metricNav.pages],
  );

  // Trend summary stats: total, avg, peak. 今日按小时聚合（峰值显示小时），
  // 其余周期按日（峰值显示日期）——与趋势图横轴粒度一致。
  const trendStats = useMemo(() => {
    const sum = selectedTotals.totalTokens;
    if (period === "today") {
      const hourly = aggregateEventsByTime(selectedEvents, "hour");
      const avg = hourly.length > 0 ? Math.round(sum / hourly.length) : 0;
      const peak = hourly.reduce((m, b) => Math.max(m, b.totalTokens), 0);
      const peakBucket = hourly.find((b) => b.totalTokens === peak);
      // peakLabel 取峰值所在小时，显示为 HH:00（与趋势图小时桶粒度一致）
      const peakHour = peakBucket ? peakBucket.key.slice(11, 13) : "";
      const peakLabel = peakHour ? `${peakHour}:00` : "";
      return { sum, avg, peak, peakLabel };
    }
    const dailyTokens = selectedDaily.map((d) => d.totalTokens);
    const avg =
      selectedDaily.length > 0 ? Math.round(sum / selectedDaily.length) : 0;
    const peak = dailyTokens.length > 0 ? Math.max(...dailyTokens) : 0;
    const peakIdx = dailyTokens.indexOf(peak);
    const peakLabel =
      peakIdx >= 0 && selectedDaily[peakIdx] ? selectedDaily[peakIdx].date : "";
    return { sum, avg, peak, peakLabel };
  }, [selectedDaily, selectedEvents, selectedTotals.totalTokens, period]);

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

  // -- Token type label map for KPI cards --
  // 固定 4 块（输入/输出/缓存读/缓存写），与原型 KPI 8 块一致；即使当日为 0 也占位显示。
  const TOKEN_TYPE_ORDER = [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
  ] as const;
  const tokenTypeLabelMap: Record<string, string> = {
    input: "输入 Token",
    output: "输出 Token",
    cacheRead: "缓存读 Token",
    cacheWrite: "缓存写 Token",
  };

  // -- Helpers for MoM display in KPI cards --
  const renderMomIndicator = (mom: number | null) => {
    if (mom == null || !Number.isFinite(mom)) {
      return <span className="text-muted-foreground">环比 −−</span>;
    }
    const up = mom > 0;
    const absPct = `${Math.abs(mom).toFixed(1)}%`;
    if (mom === 0) {
      return <span className="text-muted-foreground">环比 0%</span>;
    }
    return (
      <span
        className={`inline-flex items-center gap-0.5 ${up ? "text-danger" : "text-ok"}`}
      >
        {up ? (
          <ArrowUpRight className="size-3.5" />
        ) : (
          <ArrowDownRight className="size-3.5" />
        )}
        <span>{absPct}</span>
      </span>
    );
  };

  return (
    <>
      {/* ---- Sticky Header Bar ---- */}
      <div className="sticky top-0 z-30 -mx-3 mb-3 border-b border-border bg-background/85 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4 md:-mx-6 md:px-6 2xl:-mx-8 2xl:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="text-base font-semibold tracking-tight">首页总览</h1>
            <span className="truncate text-[12px] text-muted-foreground">
              统计区间：{periodLabels[period]} · 最近同步{" "}
              {formatDateTime(lastSync)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                  className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs outline-none"
                  aria-label="开始日期"
                />
                <span className="text-xs text-muted-foreground">至</span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(event) => setTo(event.target.value)}
                  className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs outline-none"
                  aria-label="结束日期"
                />
              </>
            )}
            <span className="text-[10px] text-muted-foreground">
              {periodGrainLabel(period)}
            </span>

            {/* Export Poster */}
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

            {/* Export Data */}
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

            {/* Refresh */}
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

            {/* Status badge */}
            <StatusBadge tone="ok">
              <Dot className="size-1 bg-ok" /> 已同步
            </StatusBadge>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div key="kpis" className="dashboard-widget">
          <div className="group/metrics relative">
            <div
              ref={summaryRef}
              onScroll={syncMetricNav}
              className="tt-xscroll flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1"
            >
              {/* Card: 区间费用 */}
              <div className="tt-metric tt-corner min-w-[212px] flex-1 snap-start px-4 py-3">
                <div className="tt-label whitespace-nowrap font-mono uppercase">
                  区间费用
                </div>
                <div className="tt-num mt-1.5 whitespace-nowrap text-2xl">
                  {intervalCostCny}
                </div>
                <div className="mt-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  {intervalCostHint}
                </div>
              </div>

              {/* Card: Token 总量 */}
              <div className="tt-metric tt-corner min-w-[212px] flex-1 snap-start px-4 py-3">
                <div className="tt-label whitespace-nowrap font-mono uppercase">
                  Token 总量
                </div>
                <div className="tt-num mt-1.5 whitespace-nowrap text-2xl">
                  {formatTokens(selectedTotals.totalTokens)}
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-xs">
                  {renderMomIndicator(tokenMoM)}
                  <span className="text-muted-foreground">vs 上一区间</span>
                </div>
              </div>

              {/* Card: 缓存节省 */}
              <div className="tt-metric tt-corner min-w-[212px] flex-1 snap-start px-4 py-3">
                <div className="tt-label whitespace-nowrap font-mono uppercase">
                  缓存节省
                </div>
                <div className="tt-num mt-1.5 whitespace-nowrap text-2xl text-ok">
                  {cacheSavingsCny}
                </div>
                <div className="mt-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  命中率{" "}
                  <span className="tt-num text-foreground">
                    {cacheHitRate.toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Card: Skill 数 */}
              <Link
                to="/skills"
                className="tt-metric tt-corner min-w-[212px] flex-1 snap-start px-4 py-3"
              >
                <div className="tt-label whitespace-nowrap font-mono uppercase">
                  Skill 数
                </div>
                <div className="tt-num mt-1.5 whitespace-nowrap text-2xl">
                  {skillHealth.total}
                  <span className="text-base text-muted-foreground"> 个</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 whitespace-nowrap text-xs">
                  {skillHealth.rows
                    .filter((r) => r.count > 0)
                    .map((item) => (
                      <span
                        key={item.health}
                        className="inline-flex items-center gap-0.5"
                      >
                        <span
                          className={`inline-block size-1.5 rounded-full ${item.dot}`}
                        />
                        {item.count}
                      </span>
                    ))}
                </div>
              </Link>

              {/* Token breakdown cards — 固定 4 块：输入/输出/缓存读/缓存写
                  （与原型 KPI 8 块一致；即使当日为 0 也占位显示，保证始终 8 块） */}
              {(() => {
                const byKey = new Map(
                  tokenTypeRows.map((row) => [row.key, row] as const),
                );
                return TOKEN_TYPE_ORDER.map((key) => ({
                  key,
                  totalTokens: byKey.get(key)?.totalTokens ?? 0,
                }));
              })().map((row) => (
                <div
                  key={row.key}
                  className="tt-metric tt-corner min-w-[212px] flex-1 snap-start px-4 py-3"
                >
                  <div className="tt-label whitespace-nowrap font-mono uppercase">
                    {tokenTypeLabelMap[row.key] ?? row.key}
                  </div>
                  <div className="tt-num mt-1.5 whitespace-nowrap text-2xl">
                    {formatTokens(row.totalTokens)}
                  </div>
                  <div className="mt-1.5 whitespace-nowrap text-xs text-muted-foreground">
                    {shareOf(
                      row.totalTokens,
                      selectedTotals.totalTokens,
                    ).toFixed(0)}
                    % 占比
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination: fade edge + dots + chevrons */}
            {metricNav.pages > 1 && (
              <>
                <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-background to-transparent" />
                <div className="mt-2 flex items-center justify-end gap-3">
                  <span className="text-[10px] tracking-[0.18em] text-muted-foreground">
                    {String(metricNav.page + 1).padStart(2, "0")} /{" "}
                    {String(metricNav.pages).padStart(2, "0")}
                  </span>
                  <div className="flex items-center gap-[3px]">
                    {Array.from({ length: metricNav.pages }).map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        aria-label={`第 ${i + 1} 组指标`}
                        onClick={() => goMetricPage(i)}
                        className={`h-[6px] transition-all ${
                          i === metricNav.page
                            ? "w-6 bg-primary shadow-[0_0_8px_0_var(--color-primary)]"
                            : "w-[6px] bg-border hover:bg-primary/60"
                        }`}
                        style={{
                          clipPath:
                            "polygon(3px 0,100% 0,calc(100% - 3px) 100%,0 100%)",
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    {(
                      [
                        {
                          dir: -1,
                          label: "上一组指标",
                          Icon: ChevronLeft,
                        },
                        {
                          dir: 1,
                          label: "下一组指标",
                          Icon: ChevronRight,
                        },
                      ] as const
                    ).map(({ dir, label, Icon }) => {
                      const disabled =
                        dir < 0
                          ? metricNav.page === 0
                          : metricNav.page >= metricNav.pages - 1;
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-label={label}
                          disabled={disabled}
                          onClick={() => goMetricPage(metricNav.page + dir)}
                          className="grid size-6 place-items-center rounded-sm border border-border bg-surface-2 text-muted-foreground transition-all hover:border-primary/60 hover:text-primary hover:shadow-[0_0_10px_-2px_var(--color-primary)] disabled:pointer-events-none disabled:opacity-25"
                        >
                          <Icon className="size-3.5" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div key="trend" className="dashboard-widget">
          <Panel
            title="Token 消耗趋势 · 按模型（单位：K Tokens）"
            action={
              <Segmented
                value={trendMode}
                onChange={(v) => setTrendMode(v as TrendChartMode)}
                options={[
                  { value: "area", label: "堆叠面积" },
                  { value: "line", label: "多序列折线" },
                ]}
              />
            }
          >
            {/* Summary stats grid */}
            <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-4">
              <div className="tt-grid-bg bg-surface-2/40 px-3 py-2">
                <div className="tt-label font-mono uppercase">区间合计</div>
                <div className="tt-num mt-0.5 text-sm">
                  {formatTokens(trendStats.sum)}
                </div>
              </div>
              <div className="tt-grid-bg bg-surface-2/40 px-3 py-2">
                <div className="tt-label font-mono uppercase">均值</div>
                <div className="tt-num mt-0.5 text-sm">
                  {formatTokens(trendStats.avg)}
                </div>
              </div>
              <div className="tt-grid-bg bg-surface-2/40 px-3 py-2">
                <div className="tt-label font-mono uppercase">峰值</div>
                <div className="tt-num mt-0.5 text-sm">
                  {formatTokens(trendStats.peak)}
                </div>
                {trendStats.peakLabel && (
                  <div className="text-[10px] text-muted-foreground">
                    {trendStats.peakLabel}
                  </div>
                )}
              </div>
              <div className="tt-grid-bg bg-surface-2/40 px-3 py-2">
                <div className="tt-label font-mono uppercase">环比</div>
                <div
                  className={`tt-num mt-0.5 text-sm ${
                    tokenMoM != null
                      ? tokenMoM > 0
                        ? "text-danger"
                        : tokenMoM < 0
                          ? "text-ok"
                          : ""
                      : ""
                  }`}
                >
                  {tokenMoM != null && Number.isFinite(tokenMoM)
                    ? `${tokenMoM > 0 ? "+" : ""}${tokenMoM.toFixed(1)}%`
                    : "−−"}
                </div>
              </div>
            </div>

            {/* Chart area（图表框由 UsageTrendChart 内部渲染，避免双层框） */}
            <UsageTrendChart
              events={selectedEvents}
              period={period}
              customFrom={from}
              customTo={to}
              mode={trendMode}
              onModeChange={setTrendMode}
            />
          </Panel>
        </div>

        <div key="provider" className="dashboard-widget dashboard-context">
          <ContextBreakdown events={selectedEvents} />
        </div>

        <div key="models" className="dashboard-widget">
          <Panel title="模型分布">
            <ModelDistribution events={selectedEvents} />
          </Panel>
        </div>

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

        <div key="activity" className="dashboard-widget">
          <Panel
            className="dashboard-activity"
            title="消耗明细"
            bodyClassName="p-0"
          >
            <UsageDetailTable events={selectedEvents} />
          </Panel>
        </div>
      </div>
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
          title="首页总览"
          desc={`生成于 ${formatDateTime(snapshot.generatedAt)}`}
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
          title="首页总览"
          desc="把散落在各 AI 工具的 token、skill、会话，统一收回你手里。"
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
              desc="对选择的 SKILL.md 执行 11 维本地静态检测，不上传源码。"
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
          title="首页总览"
          desc={`生成于 ${formatDateTime(snapshot.generatedAt)}`}
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
        title="首页总览"
        desc={`生成于 ${formatDateTime(snapshot.generatedAt)}`}
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
