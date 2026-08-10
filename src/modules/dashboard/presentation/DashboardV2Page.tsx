import { Link, useRouter } from "@tanstack/react-router";
import {
  Activity,
  CalendarDays,
  CircleDollarSign,
  FolderKanban,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../../../lib/i18n/context.tsx";
import { refreshLocalUsageSnapshot } from "../../../lib/local-usage/index.ts";
import type { UsagePeriod } from "../../../lib/local-usage/presentation.ts";
import { createDashboardV2View } from "../application/v2.ts";
import type {
  DashboardReadModel,
  DashboardV2BreakdownRow,
  DashboardV2TrendPoint,
} from "../contracts.ts";

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function cacheRate(view: ReturnType<typeof createDashboardV2View>): number {
  const input =
    view.totals.inputTokens +
    view.totals.cachedInputTokens +
    view.totals.cacheCreationInputTokens;
  return input === 0 ? 0 : (view.totals.cachedInputTokens / input) * 100;
}

function TrendChart({ points }: { points: readonly DashboardV2TrendPoint[] }) {
  const { t, format } = useI18n();
  const path = useMemo(() => {
    if (points.length === 0) return "";
    const max = Math.max(...points.map((point) => point.tokens), 1);
    return points
      .map((point, index) => {
        const x =
          points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
        const y = 92 - (point.tokens / max) * 72;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [points]);
  if (points.length === 0)
    return (
      <p className="py-14 text-sm text-muted-foreground">
        {t("dashboard.v2.noData")}
      </p>
    );
  return (
    <div className="mt-5">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={t("dashboard.v2.trendAria")}
        className="h-52 w-full"
      >
        <path d="M0 92H100" stroke="var(--color-border)" strokeWidth="0.45" />
        <path
          d={path}
          fill="none"
          stroke="var(--color-chart-1)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{points[0]?.date}</span>
        <span>
          {format.formatTokens(
            Math.max(...points.map((point) => point.tokens)),
          )}
        </span>
        <span>{points.at(-1)?.date}</span>
      </div>
    </div>
  );
}

function Delta({ unavailable = false }: { unavailable?: boolean }) {
  const { t } = useI18n();
  return (
    <span className="font-mono text-[10px] text-muted-foreground">
      {unavailable ? t("dashboard.kpi.unavailable") : "—"}
    </span>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  unavailable,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint: string;
  unavailable?: boolean;
}) {
  return (
    <div className="dashboard-metric-card">
      <div className="flex items-center justify-between gap-2 text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3" />
          {label}
        </span>
        <Delta unavailable={unavailable} />
      </div>
      <div className="tt-num mt-2 text-[25px] leading-none font-black tracking-tight">
        {value}
      </div>
      <p
        className="mt-2 truncate font-mono text-[10px] text-muted-foreground"
        title={hint}
      >
        {hint}
      </p>
    </div>
  );
}

function BreakdownTable({
  rows,
  total,
  type,
}: {
  rows: readonly DashboardV2BreakdownRow[];
  total: number;
  type: "models" | "projects";
}) {
  const { format, t } = useI18n();
  if (rows.length === 0)
    return (
      <p className="py-10 text-sm text-muted-foreground">
        {t("dashboard.v2.noData")}
      </p>
    );
  return (
    <div className="tt-xscroll mt-4">
      <table className="dashboard-breakdown-table">
        <thead>
          <tr>
            <th>
              {t(
                type === "models"
                  ? "dashboard.v2.modelsTitle"
                  : "dashboard.v2.projectsTitle",
              )}
            </th>
            <th>{t("dashboard.detail.share")}</th>
            <th>{t("dashboard.kpi.tokens")}</th>
            <th>{t("dashboard.v2.eventShort")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((row) => (
            <tr key={row.key}>
              <td title={row.key}>
                <span className="block max-w-52 truncate">{row.key}</span>
              </td>
              <td>
                {format.formatPercent(
                  total ? Math.round((row.tokens / total) * 100) : 0,
                )}
              </td>
              <td className="tt-num">{format.formatTokens(row.tokens)}</td>
              <td className="tt-num">{format.formatNumber(row.events)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalendarHeatmap({
  points,
}: {
  points: readonly DashboardV2TrendPoint[];
}) {
  const { t, format } = useI18n();
  const cells = points.slice(-364);
  const max = Math.max(...cells.map((point) => point.tokens), 1);
  if (cells.length === 0)
    return (
      <p className="py-10 text-sm text-muted-foreground">
        {t("dashboard.v2.noData")}
      </p>
    );
  return (
    <div className="mt-5">
      <div
        className="dashboard-calendar-grid"
        aria-label={t("dashboard.v2.calendarTitle")}
      >
        {cells.map((point) => {
          const intensity = Math.max(0.12, point.tokens / max);
          return (
            <span
              key={point.date}
              title={`${point.date} · ${format.formatTokens(point.tokens)}`}
              className="dashboard-calendar-cell"
              style={{ opacity: intensity }}
            />
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
        <span>{t("dashboard.heatmap.low")}</span>
        <span className="size-2 rounded-sm bg-primary/20" />
        <span className="size-2 rounded-sm bg-primary/55" />
        <span className="size-2 rounded-sm bg-primary" />
        <span>{t("dashboard.heatmap.high")}</span>
      </div>
    </div>
  );
}

export function DashboardV2Page({ data }: { data: DashboardReadModel }) {
  const { t, format } = useI18n();
  const router = useRouter();
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [selectedTool, setSelectedTool] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const scopedSnapshot = useMemo(
    () =>
      selectedTool === "all"
        ? data.v2
        : {
            ...data.v2,
            events: data.v2.events.filter(
              (event) => event.source === selectedTool,
            ),
          },
    [data.v2, selectedTool],
  );
  const view = useMemo(
    () => createDashboardV2View(scopedSnapshot, period, from, to),
    [scopedSnapshot, period, from, to],
  );
  const allToolsView = useMemo(
    () => createDashboardV2View(data.v2, period, from, to),
    [data.v2, period, from, to],
  );
  const todayView = useMemo(
    () => createDashboardV2View(data.v2, "today"),
    [data.v2],
  );
  const periodOptions: readonly { value: UsagePeriod; label: string }[] = [
    { value: "today", label: t("dashboard.period.today") },
    { value: "7d", label: t("dashboard.period.lastNDays", { count: 7 }) },
    { value: "30d", label: t("dashboard.period.lastNDays", { count: 30 }) },
    { value: "all", label: t("dashboard.period.all") },
    { value: "custom", label: t("dashboard.period.custom") },
  ];
  const topTool = allToolsView.tools[0];
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshLocalUsageSnapshot();
      await router.invalidate();
    } finally {
      setRefreshing(false);
    }
  };
  const insight = !view.hasData
    ? t("dashboard.v2.noData")
    : t("dashboard.v2.insight", {
        tool:
          selectedTool === "all"
            ? (topTool?.name ?? t("dashboard.v2.unknownTool"))
            : (allToolsView.tools.find((tool) => tool.id === selectedTool)
                ?.name ?? t("dashboard.v2.unknownTool")),
        tokens: format.formatTokens(view.totals.totalTokens),
      });
  const cache = cacheRate(view);
  const metrics = [
    {
      icon: Activity,
      label: t("dashboard.kpi.tokens"),
      value: format.formatTokens(view.totals.totalTokens),
      hint: t("dashboard.v2.eventCount", { count: view.totals.events }),
    },
    {
      icon: CircleDollarSign,
      label: t("dashboard.kpi.cost"),
      value:
        view.estimatedCostUsd == null
          ? t("dashboard.kpi.unavailable")
          : format.formatUsd(view.estimatedCostUsd),
      hint: view.estimatedCostIsPartial
        ? t("dashboard.v2.partialCost")
        : t("dashboard.v2.estimatedCost"),
      unavailable: view.estimatedCostUsd == null,
    },
    {
      icon: CalendarDays,
      label: t("dashboard.kpi.sessions"),
      value:
        view.sessions == null
          ? t("dashboard.kpi.unavailable")
          : format.formatNumber(view.sessions),
      hint:
        view.sessions == null
          ? t("dashboard.kpi.sessionUnavailableHint")
          : t("dashboard.v2.selectedRange"),
      unavailable: view.sessions == null,
    },
    {
      icon: Activity,
      label: t("dashboard.v2.cacheLabel"),
      value: format.formatPercent(Math.round(cache)),
      hint: t("dashboard.v2.cacheHint"),
    },
    {
      icon: Wrench,
      label: t("dashboard.v2.activeTools", { count: "" }),
      value: format.formatNumber(allToolsView.activeTools),
      hint: t("dashboard.v2.toolCountHint", {
        detected: data.v2.tools.filter((tool) => tool.detected).length,
        total: data.v2.tools.length,
      }),
    },
    {
      icon: ShieldCheck,
      label: t("dashboard.v2.securityLabel"),
      value: t("dashboard.kpi.unavailable"),
      hint: t("dashboard.v2.securityHint"),
      unavailable: true,
    },
    {
      icon: Sparkles,
      label: t("dashboard.v2.assetsLabel"),
      value:
        view.skills == null
          ? t("dashboard.kpi.unavailable")
          : format.formatNumber(view.skills),
      hint:
        view.skills == null
          ? t("dashboard.v2.skillUnavailable")
          : t("dashboard.kpi.skillScanNote"),
      unavailable: view.skills == null,
    },
    {
      icon: FolderKanban,
      label: t("dashboard.v2.projectsTitle"),
      value: format.formatNumber(view.projects.length),
      hint: t("dashboard.v2.projectHint"),
    },
  ];
  return (
    <div className="dashboard-v3 space-y-6 pb-12">
      <section className="dashboard-insight-hero">
        <div className="relative flex min-w-0 gap-5">
          <span className="dashboard-insight-orb">
            <Sparkles className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[15px] font-semibold tracking-tight">
                {t("dashboard.v2.heroTitle")}
              </h1>
              <span className="dashboard-hero-pill">
                {t("dashboard.v2.localOnly")}
              </span>
            </div>
            <p className="mt-3 min-h-20 max-w-5xl text-[19px] leading-[1.7] font-medium tracking-tight md:text-[22px]">
              {insight}
            </p>
            <div className="mt-5 flex gap-1.5">
              <span className="h-1 w-9 rounded-full bg-foreground/70" />
              <span className="h-1 w-2.5 rounded-full bg-foreground/15" />
              <span className="h-1 w-2.5 rounded-full bg-foreground/15" />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="dashboard-hero-refresh"
          >
            <RefreshCw
              className={`size-3 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing
              ? t("dashboard.refresh.syncing")
              : t("dashboard.refresh.now")}
          </button>
        </div>
      </section>
      <section
        className="dashboard-spotlight-grid"
        aria-label={t("dashboard.v2.spotlightTitle")}
      >
        <article className="dashboard-spotlight-card">
          <Wrench className="size-4" />
          <p>{t("dashboard.v2.toolsTitle")}</p>
          <strong className="tt-num">
            {format.formatNumber(data.v2.tools.length)}
          </strong>
          <small>
            {t("dashboard.v2.toolCountHint", {
              detected: data.v2.tools.filter((tool) => tool.detected).length,
              total: data.v2.tools.length,
            })}
          </small>
          <Link to="/skills">{t("dashboard.v2.openSkills")}</Link>
        </article>
        <article className="dashboard-spotlight-card">
          <ShieldCheck className="size-4" />
          <p>{t("dashboard.v2.securityLabel")}</p>
          <strong>{t("dashboard.kpi.unavailable")}</strong>
          <small>{t("dashboard.v2.securityHint")}</small>
          <Link to="/security">{t("nav.security")}</Link>
        </article>
        <article className="dashboard-spotlight-card">
          <Sparkles className="size-4" />
          <p>{t("dashboard.v2.assetsLabel")}</p>
          <strong className="tt-num">
            {view.skills == null
              ? t("dashboard.kpi.unavailable")
              : format.formatNumber(view.skills)}
          </strong>
          <small>
            {view.skills == null
              ? t("dashboard.v2.skillUnavailable")
              : t("dashboard.kpi.skillScanNote")}
          </small>
          <Link to="/skills">{t("dashboard.v2.openSkills")}</Link>
        </article>
        <article className="dashboard-spotlight-card">
          <Activity className="size-4" />
          <p>{t("dashboard.v2.todayUsage")}</p>
          <strong className="tt-num">
            {format.formatTokens(todayView.totals.totalTokens)}
          </strong>
          <small>
            {todayView.estimatedCostUsd == null
              ? t("dashboard.kpi.unavailable")
              : `${format.formatUsd(todayView.estimatedCostUsd)} · ${t("dashboard.v2.cacheLabel")} ${format.formatPercent(Math.round(cacheRate(todayView)))}`}
          </small>
          <button type="button" onClick={() => setPeriod("today")}>
            {t("dashboard.v2.viewUsage")}
          </button>
        </article>
      </section>
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
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label={t("dashboard.v2.rangeLabel")}
        >
          {periodOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPeriod(option.value)}
              aria-pressed={period === option.value}
              className={
                period === option.value ? "dashboard-range-active" : ""
              }
            >
              {option.label}
            </button>
          ))}
          {period === "custom" && (
            <>
              <input
                type="date"
                aria-label={t("dashboard.header.customFrom")}
                value={from}
                max={to}
                onChange={(event) => setFrom(event.target.value)}
              />
              <input
                type="date"
                aria-label={t("dashboard.header.customTo")}
                value={to}
                min={from}
                onChange={(event) => setTo(event.target.value)}
              />
            </>
          )}
        </div>
      </div>
      <section className="dashboard-metric-grid">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>
      <section>
        <div
          className="dashboard-tool-rail"
          role="group"
          aria-label={t("dashboard.v2.toolsTitle")}
        >
          <button
            type="button"
            onClick={() => setSelectedTool("all")}
            aria-pressed={selectedTool === "all"}
            className={selectedTool === "all" ? "dashboard-tool-active" : ""}
          >
            {t("dashboard.context.allTools")}
          </button>
          {allToolsView.tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => setSelectedTool(tool.id)}
              aria-pressed={selectedTool === tool.id}
              className={
                selectedTool === tool.id ? "dashboard-tool-active" : ""
              }
            >
              <Wrench className="size-3.5" />
              {tool.name}
            </button>
          ))}
        </div>
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-head">
          <div>
            <h2>{t("dashboard.v2.trendTitle")}</h2>
            <p>
              {t("dashboard.v2.dailyAverage", {
                tokens: format.formatTokens(
                  view.trend.length
                    ? Math.round(view.totals.totalTokens / view.trend.length)
                    : 0,
                ),
              })}{" "}
              · {t("dashboard.v2.cacheLabel")}{" "}
              {format.formatPercent(Math.round(cache))}
            </p>
          </div>
          <span>{t("dashboard.v2.selectedRange")}</span>
        </div>
        <TrendChart points={view.trend} />
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        <article className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <h2>{t("dashboard.v2.modelsTitle")}</h2>
              <p>
                {t("dashboard.v2.modelHint", { count: view.models.length })}
              </p>
            </div>
            <Delta />
          </div>
          <BreakdownTable
            rows={view.models}
            total={view.totals.totalTokens}
            type="models"
          />
        </article>
        <article className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <h2>{t("dashboard.v2.projectsTitle")}</h2>
              <p>{t("dashboard.v2.projectHint")}</p>
            </div>
            <Delta />
          </div>
          <BreakdownTable
            rows={view.projects}
            total={view.totals.totalTokens}
            type="projects"
          />
        </article>
      </section>
      <section className="dashboard-panel">
        <div className="dashboard-panel-head">
          <div>
            <h2>{t("dashboard.v2.calendarTitle")}</h2>
            <p>
              {t("dashboard.v2.calendarHint", {
                count: view.calendarSummary.activeDays,
                tokens: format.formatTokens(view.totals.totalTokens),
              })}{" "}
              ·{" "}
              {t("dashboard.v2.streakHint", {
                count: view.calendarSummary.longestStreak,
              })}
            </p>
          </div>
        </div>
        <CalendarHeatmap points={view.calendar} />
      </section>
    </div>
  );
}
