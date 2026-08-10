import { Link, useRouter } from "@tanstack/react-router";
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
} from "../../../components/tt";
import {
  UsageTrendChart,
  type TrendChartMode,
} from "../../../components/dashboard/UsageTrendChart";
import { ContextBreakdown } from "../../../components/dashboard/ContextBreakdown";
import { UsageHeatmapPanel } from "../../../components/dashboard/UsageHeatmapPanel";
import { UsageDetailTable } from "../../../components/dashboard/UsageDetailTable";
import {
  TokenPoster,
  type PosterPeriod,
} from "../../../components/TokenPoster";
import { refreshLocalUsageSnapshot } from "../../../lib/local-usage";
import {
  aggregateEventsByTime,
  cacheRate,
  computeMoM,
  filterDailyUsage,
  filterUsageEvents,
  previousPeriodTotal,
  resolveUsageRange,
  shareOf,
  sourceLabel,
  totalsFromDaily,
  type UsagePeriod,
} from "../../../lib/local-usage/presentation";
import type { LocalUsageSnapshot } from "../../../lib/local-usage";
import {
  aggregatePricedUsage,
  applyPricingSnapshot,
  estimateUsageCost,
  formatMoney,
} from "../../../lib/pricing";
import { PUBLIC_TOOL_MANIFEST } from "../../../lib/tool-registry/public-manifest.generated";
import { toExportCsv, toExportJson, downloadExport } from "../../../lib/export";
import { useI18n } from "../../../lib/i18n/context";
import {
  buildDashboardExport,
  buildDashboardPosterData,
} from "../../dashboard/presentation";
import type { DashboardReadModel } from "../contracts";

type TFunction = ReturnType<typeof useI18n>["t"];

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function DashboardPage({ data }: { data: DashboardReadModel }) {
  const { snapshot, error, skills, sessions, pricing } = data;
  const router = useRouter();
  const { locale, t, format, displayCurrency, rates } = useI18n();
  applyPricingSnapshot(pricing);
  const [period, setPeriod] = useState<UsagePeriod>("today");
  const [from, setFrom] = useState(daysAgo(14));
  const [to, setTo] = useState(daysAgo(0));
  const [trendMode, setTrendMode] = useState<TrendChartMode>("area");

  const periodOptions: { value: UsagePeriod; label: string }[] = [
    { value: "today", label: t("dashboard.period.today") },
    { value: "7d", label: t("dashboard.period.lastNDays", { count: 7 }) },
    { value: "30d", label: t("dashboard.period.lastNDays", { count: 30 }) },
    { value: "all", label: t("dashboard.period.all") },
    { value: "custom", label: t("dashboard.period.custom") },
  ];
  const periodLabels = useMemo<Record<UsagePeriod, string>>(
    () => ({
      today: t("dashboard.period.today"),
      week: t("dashboard.period.week"),
      "7d": t("dashboard.period.lastNDays", { count: 7 }),
      "30d": t("dashboard.period.lastNDays", { count: 30 }),
      month: t("dashboard.period.month"),
      year: t("dashboard.period.year"),
      all: t("dashboard.period.all"),
      custom: t("dashboard.period.customRange"),
    }),
    [t],
  );

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
  const selectedSessionMetrics = useMemo(() => {
    if (!sessions.available) return null;
    const range = resolveUsageRange(period, from, to);
    if (!range.valid || !range.fromDate || !range.toDate) return null;
    const records = sessions.records.filter((session) => {
      const startedAt = new Date(session.startedAt);
      return (
        !Number.isNaN(startedAt.getTime()) &&
        startedAt >= range.fromDate! &&
        startedAt <= range.toDate!
      );
    });
    return records.reduce(
      (summary, session) => ({
        count: summary.count + 1,
        durationMs: summary.durationMs + Math.max(0, session.durationMs),
        turns: summary.turns + Math.max(0, session.turns),
        editTurns: summary.editTurns + Math.max(0, session.editTurns),
      }),
      { count: 0, durationMs: 0, turns: 0, editTurns: 0 },
    );
  }, [sessions, period, from, to]);
  const selectedCost = useMemo(
    () => estimateUsageCost(selectedEvents),
    [selectedEvents],
  );
  // KPI Row 1 — period-driven headline metrics. The headline shows the total
  // (exact + estimated); the hint always labels estimated amounts separately so
  // estimates are never disguised as an exact/official bill (audit P1-1).
  const intervalCostCny = format.formatUsd(
    selectedCost.knownUsd + selectedCost.estimatedUsd,
  );
  const intervalCostHint =
    selectedCost.unknownEvents > 0
      ? t("dashboard.kpi.costUnknownHint")
      : selectedCost.estimatedEvents > 0
        ? t("dashboard.kpi.costEstimatedHint", {
            amount: format.formatUsd(selectedCost.estimatedUsd),
          })
        : t("dashboard.kpi.costHint", { period: periodLabels[period] });
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
  const cacheSavingsCny = formatMoney(
    locale,
    selectedCost.cacheSavingsUsd,
    "CNY",
  );
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
      buildDashboardPosterData({
        events: selectedEvents,
        totals: selectedTotals,
        cost: selectedCost,
        period,
        periodLabel: periodLabels[period],
        from,
        to,
        format,
      }),
    [
      selectedEvents,
      selectedTotals,
      selectedCost,
      period,
      periodLabels,
      from,
      to,
      format,
    ],
  );

  const handleExport = (format: "csv" | "json") => {
    const { rows, sourceLabels } = buildDashboardExport({
      events: selectedEvents,
      displayCurrency,
      rates: rates ?? undefined,
    });
    const content =
      format === "csv"
        ? toExportCsv(rows, sourceLabels, [
            t("export.column.date"),
            t("export.column.source"),
            t("export.column.model"),
            t("export.column.project"),
            t("export.column.input"),
            t("export.column.output"),
            t("export.column.cacheRead"),
            t("export.column.cacheWrite"),
            t("export.column.reasoning"),
            t("export.column.cost"),
            "costDisplay",
            "currency",
            "rate",
            "rateDate",
          ])
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
    input: t("dashboard.kpi.tokenInput"),
    output: t("dashboard.kpi.tokenOutput"),
    cacheRead: t("dashboard.kpi.tokenCacheRead"),
    cacheWrite: t("dashboard.kpi.tokenCacheWrite"),
  };

  // -- Helpers for MoM display in KPI cards --
  const renderMomIndicator = (mom: number | null) => {
    if (mom == null || !Number.isFinite(mom)) {
      return (
        <span className="text-muted-foreground">{t("dashboard.mom.dash")}</span>
      );
    }
    const up = mom > 0;
    if (mom === 0) {
      return (
        <span className="text-muted-foreground">{t("dashboard.mom.zero")}</span>
      );
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
        <span>{format.formatPercent(Math.abs(mom))}</span>
      </span>
    );
  };

  return (
    <>
      {/* ---- Sticky Header Bar ---- */}
      <div className="dashboard-overview-header sticky top-0 z-30 mb-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {t("dashboard.title")}
            </h1>
            <span className="truncate text-[12px] text-muted-foreground">
              {t("dashboard.header.range", {
                period: periodLabels[period],
                time: format.formatDateTime(lastSync),
              })}
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
                  aria-label={t("dashboard.header.customFrom")}
                />
                <span className="text-xs text-muted-foreground">
                  {t("dashboard.header.separator")}
                </span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(event) => setTo(event.target.value)}
                  className="rounded-sm border border-border bg-surface-2 px-2 py-1 text-xs outline-none"
                  aria-label={t("dashboard.header.customTo")}
                />
              </>
            )}
            <span className="text-[10px] text-muted-foreground">
              {periodGrainLabel(period, t)}
            </span>

            {/* Export Poster */}
            <button
              type="button"
              onClick={() => setShowPoster(true)}
              disabled={selectedEvents.length === 0}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2.5 py-1 text-xs transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
              title={t("dashboard.poster.generate")}
            >
              <Image className="size-3.5" />
              {t("dashboard.export.poster")}
            </button>

            {/* Export Data */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={selectedEvents.length === 0}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2.5 py-1 text-xs transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
                title={t("dashboard.export.dataTitle")}
              >
                <Download className="size-3.5" />
                {t("dashboard.export.data")}
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
              title={t("dashboard.refresh.title")}
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing
                ? t("dashboard.refresh.syncing")
                : t("dashboard.refresh.now")}
            </button>

            {/* Status badge */}
            <StatusBadge tone="ok">
              <Dot className="size-1 bg-ok" /> {t("dashboard.header.synced")}
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
                  {t("dashboard.kpi.cost")}
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
                  {t("dashboard.kpi.tokens")}
                </div>
                <div className="tt-num mt-1.5 whitespace-nowrap text-2xl">
                  {format.formatTokens(selectedTotals.totalTokens)}
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-xs">
                  {renderMomIndicator(tokenMoM)}
                  <span className="text-muted-foreground">
                    {t("dashboard.kpi.vsPrevious")}
                  </span>
                </div>
              </div>

              {/* Card: 缓存节省 */}
              <div className="tt-metric tt-corner min-w-[212px] flex-1 snap-start px-4 py-3">
                <div className="tt-label whitespace-nowrap font-mono uppercase">
                  {t("dashboard.kpi.cacheSavings")}
                </div>
                <div className="tt-num mt-1.5 whitespace-nowrap text-2xl text-ok">
                  {cacheSavingsCny}
                </div>
                <div className="mt-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  {t("dashboard.kpi.hitRate", {
                    rate: format.formatPercent(Math.round(cacheHitRate)),
                  })}
                </div>
              </div>

              {/* Card: Skill 数 */}
              <Link
                to="/skills"
                className="tt-metric tt-corner min-w-[212px] flex-1 snap-start px-4 py-3"
              >
                <div className="tt-label whitespace-nowrap font-mono uppercase">
                  {t("dashboard.kpi.skills")}
                </div>
                <div className="tt-num mt-1.5 whitespace-nowrap text-2xl">
                  {skills.count}
                  <span className="text-base text-muted-foreground">
                    {" "}
                    {t("dashboard.kpi.skillUnit")}
                  </span>
                </div>
                <div className="mt-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  {t("dashboard.kpi.skillScanNote")}
                </div>
              </Link>

              <Link
                to="/sessions"
                className="tt-metric tt-corner min-w-[212px] flex-1 snap-start px-4 py-3"
              >
                <div className="tt-label whitespace-nowrap font-mono uppercase">
                  {t("dashboard.kpi.sessions")}
                </div>
                <div className="tt-num mt-1.5 whitespace-nowrap text-2xl">
                  {selectedSessionMetrics == null
                    ? t("dashboard.kpi.unavailable")
                    : format.formatNumber(selectedSessionMetrics.count)}
                </div>
                <div className="mt-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  {selectedSessionMetrics == null
                    ? t("dashboard.kpi.sessionUnavailableHint")
                    : t("dashboard.kpi.sessionMetrics", {
                        turns: selectedSessionMetrics.turns,
                        edits: selectedSessionMetrics.editTurns,
                        minutes: Math.round(
                          selectedSessionMetrics.durationMs / 60_000,
                        ),
                      })}
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
                    {format.formatTokens(row.totalTokens)}
                  </div>
                  <div className="mt-1.5 whitespace-nowrap text-xs text-muted-foreground">
                    {t("dashboard.kpi.tokenShare", {
                      share: format.formatPercent(
                        Math.round(
                          shareOf(row.totalTokens, selectedTotals.totalTokens),
                        ),
                      ),
                    })}
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
                        aria-label={t("dashboard.metrics.page", {
                          index: i + 1,
                        })}
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
                          label: t("dashboard.metrics.prev"),
                          Icon: ChevronLeft,
                        },
                        {
                          dir: 1,
                          label: t("dashboard.metrics.next"),
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
            title={t("dashboard.trend.title")}
            action={
              <Segmented
                value={trendMode}
                onChange={(v) => setTrendMode(v as TrendChartMode)}
                options={[
                  { value: "area", label: t("dashboard.trend.area") },
                  { value: "bar", label: t("dashboard.trend.bar") },
                  { value: "line", label: t("dashboard.trend.line") },
                ]}
              />
            }
          >
            {/* Summary stats grid */}
            <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-4">
              <div className="tt-grid-bg bg-surface-2/40 px-3 py-2">
                <div className="tt-label font-mono uppercase">
                  {t("dashboard.trend.total")}
                </div>
                <div className="tt-num mt-0.5 text-sm">
                  {format.formatTokens(trendStats.sum)}
                </div>
              </div>
              <div className="tt-grid-bg bg-surface-2/40 px-3 py-2">
                <div className="tt-label font-mono uppercase">
                  {t("dashboard.trend.average")}
                </div>
                <div className="tt-num mt-0.5 text-sm">
                  {format.formatTokens(trendStats.avg)}
                </div>
              </div>
              <div className="tt-grid-bg bg-surface-2/40 px-3 py-2">
                <div className="tt-label font-mono uppercase">
                  {t("dashboard.trend.peak")}
                </div>
                <div className="tt-num mt-0.5 text-sm">
                  {format.formatTokens(trendStats.peak)}
                </div>
                {trendStats.peakLabel && (
                  <div className="text-[10px] text-muted-foreground">
                    {trendStats.peakLabel}
                  </div>
                )}
              </div>
              <div className="tt-grid-bg bg-surface-2/40 px-3 py-2">
                <div className="tt-label font-mono uppercase">
                  {t("dashboard.trend.mom")}
                </div>
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
                    ? format.formatPercent(tokenMoM, {
                        signDisplay: "exceptZero",
                      })
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

        <div key="heatmap" className="dashboard-widget">
          <Panel
            className="dashboard-heatmap"
            title={t("dashboard.heatmap.title")}
            action={
              <span className="text-[10px] text-muted-foreground">
                {t("dashboard.heatmap.navHint")}
              </span>
            }
          >
            <UsageHeatmapPanel events={selectedEvents} />
          </Panel>
        </div>

        <div key="activity" className="dashboard-widget">
          <Panel
            className="dashboard-activity"
            title={t("dashboard.detail.title")}
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
 * Map the selected period to the aggregation grain the dashboard uses and a
 * short label for the selector area. "今日" buckets hourly, the rolling
 * windows daily, "全部" monthly, and "自定义" defers to the picked span.
 */
function periodGrainLabel(period: UsagePeriod, t: TFunction): string {
  switch (period) {
    case "today":
    case "week":
      return t("dashboard.grain.hour");
    case "7d":
    case "30d":
    case "month":
    case "custom":
      return t("dashboard.grain.day");
    case "year":
    case "all":
      return t("dashboard.grain.month");
  }
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
  const { t, format } = useI18n();
  if (error) {
    return (
      <>
        <PageHeader
          title={t("dashboard.title")}
          desc={t("dashboard.onboarding.generatedAt", {
            time: format.formatDateTime(snapshot.generatedAt),
          })}
        />
        <EmptyState
          icon={<Database className="size-8" />}
          title={t("dashboard.onboarding.dataLoadFailed")}
          desc={t("dashboard.onboarding.dataLoadFailedDesc", { error })}
          actions={
            <TTButton
              variant="primary"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {t("dashboard.onboarding.reload")}
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
          title={t("dashboard.title")}
          desc={t("dashboard.onboarding.welcomeDesc")}
        />
        <div className="grid gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <CapabilityCard
              icon={<Activity className="size-6" />}
              title={t("dashboard.onboarding.capTokenTitle")}
              desc={t("dashboard.onboarding.capTokenDesc")}
            />
            <CapabilityCard
              icon={<Sparkles className="size-6" />}
              title={t("dashboard.onboarding.capSkillTitle")}
              desc={t("dashboard.onboarding.capSkillDesc")}
            />
            <CapabilityCard
              icon={<ShieldCheck className="size-6" />}
              title={t("dashboard.onboarding.capSecurityTitle")}
              desc={t("dashboard.onboarding.capSecurityDesc")}
            />
          </div>
          <Panel
            title={t("dashboard.onboarding.toolsTitle", {
              count: PUBLIC_TOOL_MANIFEST.tools.length,
            })}
          >
            <div className="flex flex-wrap gap-2">
              {PUBLIC_TOOL_MANIFEST.tools.map((tool) => (
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
              {refreshing
                ? t("dashboard.onboarding.scanning")
                : t("dashboard.onboarding.startScan")}
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
          title={t("dashboard.title")}
          desc={t("dashboard.onboarding.generatedAt", {
            time: format.formatDateTime(snapshot.generatedAt),
          })}
        />
        <Panel title={t("dashboard.onboarding.detectedTools")}>
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
                    ? t("dashboard.onboarding.records", {
                        count: source.events,
                      })
                    : t("dashboard.onboarding.notUsedYet")}
                </span>
              </div>
            ))}
          </div>
        </Panel>
        <EmptyState
          icon={<Database className="size-8" />}
          title={t("dashboard.onboarding.noUsage")}
          desc={t("dashboard.onboarding.noUsageDesc")}
          actions={
            <TTButton
              variant="primary"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing
                ? t("dashboard.onboarding.scanning")
                : t("dashboard.onboarding.rescan")}
            </TTButton>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("dashboard.title")}
        desc={t("dashboard.onboarding.generatedAt", {
          time: format.formatDateTime(snapshot.generatedAt),
        })}
      />
      <EmptyState
        icon={<Database className="size-8" />}
        title={t("dashboard.onboarding.noLogs")}
        desc={t("dashboard.onboarding.noLogsDesc")}
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
