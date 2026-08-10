import { Link, useRouter } from "@tanstack/react-router";
import {
  Activity,
  CalendarDays,
  CircleDollarSign,
  FolderKanban,
  ShieldCheck,
  Sparkles,
  Shuffle,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../../lib/i18n/context.tsx";
import type { UsagePeriod } from "../../../lib/local-usage/presentation.ts";
import {
  createDashboardV2HeroView,
  createDashboardV2View,
} from "../application/v2.ts";
import type {
  DashboardReadModel,
  DashboardV2BreakdownRow,
  DashboardV2CalendarPoint,
  DashboardV2Insight,
  DashboardV2TrendPoint,
} from "../contracts.ts";

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
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

function Delta({
  value = null,
  points = false,
}: {
  value?: number | null;
  points?: boolean;
}) {
  const { format, t } = useI18n();
  const unavailable = value == null || !Number.isFinite(value);
  return (
    <span
      className={
        unavailable
          ? "font-mono text-[10px] text-muted-foreground"
          : value >= 0
            ? "font-mono text-[10px] text-[var(--color-ok)]"
            : "font-mono text-[10px] text-[var(--color-warning)]"
      }
      title={t("dashboard.kpi.vsPrevious")}
    >
      {unavailable
        ? t("dashboard.kpi.unavailable")
        : `${value > 0 ? "+" : ""}${format.formatPercent(value)}${points ? " pt" : ""}`}
    </span>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  deltaPoints,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint: string;
  delta?: number | null;
  deltaPoints?: boolean;
}) {
  return (
    <div className="dashboard-metric-card">
      <div className="flex items-center justify-between gap-2 text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
        <span className="flex items-center gap-1.5">
          <Icon className="size-3" />
          {label}
        </span>
        <Delta value={delta} points={deltaPoints} />
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
            {type === "models" ? (
              <>
                <th>{t("dashboard.kpi.cost")}</th>
                <th>{t("dashboard.v2.eventShort")}</th>
              </>
            ) : (
              <>
                <th>{t("dashboard.kpi.tokens")}</th>
                <th>{t("dashboard.kpi.sessions")}</th>
              </>
            )}
            <th>{t("dashboard.kpi.vsPrevious")}</th>
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
              {type === "models" ? (
                <>
                  <td className="tt-num">
                    {row.estimatedCostUsd == null
                      ? t("dashboard.kpi.unavailable")
                      : format.formatUsd(row.estimatedCostUsd)}
                  </td>
                  <td className="tt-num">{format.formatNumber(row.events)}</td>
                </>
              ) : (
                <>
                  <td className="tt-num">{format.formatTokens(row.tokens)}</td>
                  <td className="tt-num">
                    {row.sessions == null
                      ? t("dashboard.kpi.unavailable")
                      : format.formatNumber(row.sessions)}
                  </td>
                </>
              )}
              <td>
                <Delta value={row.deltaPercent} />
              </td>
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
  points: readonly DashboardV2CalendarPoint[];
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
          // Calendar zero-fill represents coverage of the selected range, not
          // observed usage. Keep those cells visually distinct so an empty
          // day can never look like a low-volume active day.
          const intensity = point.active
            ? Math.max(0.12, point.tokens / max)
            : 0.12;
          return (
            <span
              key={point.date}
              title={`${point.date} · ${format.formatTokens(point.tokens)}`}
              className={
                point.active
                  ? "dashboard-calendar-cell"
                  : "dashboard-calendar-cell dashboard-calendar-cell-inactive"
              }
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

function HeroInsight({ insight }: { insight: DashboardV2Insight }) {
  const { t, format } = useI18n();
  switch (insight.kind) {
    case "usage":
      return t("dashboard.v2.insights.usage", {
        tool: insight.toolName ?? t("dashboard.v2.unknownTool"),
        tokens: format.formatTokens(insight.tokens ?? 0),
      });
    case "cache":
      return t("dashboard.v2.insights.cache", {
        rate: format.formatPercent(Math.round(insight.cacheRate ?? 0)),
      });
    case "cost":
      return t("dashboard.v2.insights.cost", {
        cost: format.formatUsd(insight.estimatedCostUsd ?? 0),
      });
    case "security":
      return insight.riskCount
        ? t("dashboard.v2.insights.securityRisk", { count: insight.riskCount })
        : t("dashboard.v2.insights.securityClean");
    case "monitoring":
      return t("dashboard.v2.insights.monitoring");
    case "empty":
      return t("dashboard.v2.insights.empty");
  }
}

function securityMetric(
  monitoring: DashboardReadModel["monitoring"],
  t: ReturnType<typeof useI18n>["t"],
) {
  const security = monitoring?.security;
  if (!security) {
    return {
      value: t("dashboard.kpi.unavailable"),
      hint: t("dashboard.v2.securityHint"),
      unavailable: true,
    };
  }
  const riskCount = security.dangerousCount + security.suspiciousCount;
  return {
    value: riskCount
      ? t("dashboard.v2.securityAttention", { count: riskCount })
      : t("dashboard.v2.securityClean"),
    hint: t("dashboard.v2.securityScanSummary", {
      assessed: security.assessedAssetCount,
      discovered: security.discoveredAssetCount,
    }),
    unavailable: false,
  };
}

export function DashboardV2Page({ data }: { data: DashboardReadModel }) {
  const { t, format } = useI18n();
  const router = useRouter();
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [selectedTool, setSelectedTool] = useState("all");
  const [insightIndex, setInsightIndex] = useState(0);
  useEffect(() => {
    // This only re-reads renderer-safe aggregates already persisted by the
    // background service. It neither triggers a scan nor opens local files.
    const refresh = window.setInterval(() => void router.invalidate(), 30_000);
    return () => window.clearInterval(refresh);
  }, [router]);
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
  const hero = useMemo(
    () =>
      createDashboardV2HeroView({
        snapshot: data.v2,
        monitoring: data.monitoring,
        activeInsightCount: data.activeInsightCount ?? 0,
      }),
    [data.activeInsightCount, data.monitoring, data.v2],
  );
  const activeInsight =
    hero.insights[insightIndex % hero.insights.length] ?? hero.insights[0];
  const periodOptions: readonly { value: UsagePeriod; label: string }[] = [
    { value: "today", label: t("dashboard.period.today") },
    { value: "7d", label: t("dashboard.period.lastNDays", { count: 7 }) },
    { value: "30d", label: t("dashboard.period.lastNDays", { count: 30 }) },
    { value: "year", label: t("dashboard.period.year") },
    { value: "all", label: t("dashboard.period.all") },
    { value: "custom", label: t("dashboard.period.custom") },
  ];
  const topTool = allToolsView.tools[0];
  const cache = view.cacheRate;
  const security = securityMetric(data.monitoring, t);
  const metrics = [
    {
      icon: Activity,
      label: t("dashboard.kpi.tokens"),
      value: format.formatTokens(view.totals.totalTokens),
      hint: t("dashboard.v2.eventCount", { count: view.totals.events }),
      delta: view.comparison.tokens.deltaPercent,
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
      delta: view.comparison.cost.deltaPercent,
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
    },
    {
      icon: Activity,
      label: t("dashboard.v2.cacheLabel"),
      value:
        cache == null
          ? t("dashboard.kpi.unavailable")
          : format.formatPercent(Math.round(cache)),
      hint: t("dashboard.v2.cacheHint"),
      delta: view.comparison.cacheRate.deltaPoints,
      deltaPoints: true,
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
      ...security,
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
              <span className="dashboard-hero-pill dashboard-hero-pending">
                {t("dashboard.v2.pendingItems", {
                  count: hero.monitoring.pendingCount,
                })}
              </span>
              <span
                className={`dashboard-hero-pill dashboard-hero-status dashboard-hero-status-${hero.monitoring.health}`}
              >
                {hero.monitoring.isLive
                  ? t("dashboard.v2.realtimeAnalysis")
                  : t(`dashboard.v2.monitoring.${hero.monitoring.health}`)}
              </span>
            </div>
            <p className="mt-3 min-h-20 max-w-5xl text-[19px] leading-[1.7] font-medium tracking-tight md:text-[22px]">
              {activeInsight ? <HeroInsight insight={activeInsight} /> : null}
            </p>
            <div
              className="mt-5 flex gap-1.5"
              role="tablist"
              aria-label={t("dashboard.v2.insightDotsAria")}
            >
              {hero.insights.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={index === insightIndex % hero.insights.length}
                  aria-label={t("dashboard.v2.insightDot", {
                    index: index + 1,
                  })}
                  onClick={() => setInsightIndex(index)}
                  className={
                    index === insightIndex % hero.insights.length
                      ? "dashboard-insight-dot dashboard-insight-dot-active"
                      : "dashboard-insight-dot"
                  }
                />
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              setInsightIndex((current) =>
                hero.insights.length ? (current + 1) % hero.insights.length : 0,
              )
            }
            className="dashboard-hero-refresh"
          >
            <Shuffle className="size-3" />
            {t("dashboard.v2.rotateInsight")}
          </button>
        </div>
      </section>
      <section
        className={`dashboard-monitoring-strip dashboard-monitoring-${hero.monitoring.health}`}
        aria-label={t("dashboard.v2.monitoringAria")}
      >
        <span className="dashboard-monitoring-status">
          <span className="dashboard-monitoring-indicator" aria-hidden="true" />
          {t(`dashboard.v2.monitoring.${hero.monitoring.health}`)}
        </span>
        <span>
          {t("dashboard.v2.agentsLive", {
            live: hero.monitoring.liveTools,
            detected: hero.monitoring.detectedTools,
          })}
        </span>
        <span>
          {t("dashboard.v2.pendingItems", {
            count: hero.monitoring.pendingCount,
          })}
        </span>
        {hero.monitoring.isLive ? (
          <strong>{t("dashboard.v2.liveBadge")}</strong>
        ) : null}
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
          <Link to="/agents">{t("dashboard.v2.openSkills")}</Link>
        </article>
        <article className="dashboard-spotlight-card">
          <ShieldCheck className="size-4" />
          <p>{t("dashboard.v2.securityLabel")}</p>
          <strong>{security.value}</strong>
          <small>{security.hint}</small>
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
          <Link to="/agents">{t("dashboard.v2.openSkills")}</Link>
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
              : `${format.formatUsd(todayView.estimatedCostUsd)} · ${t("dashboard.v2.cacheLabel")} ${todayView.cacheRate == null ? t("dashboard.kpi.unavailable") : format.formatPercent(Math.round(todayView.cacheRate))}`}
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
      {selectedTool !== "all" ? (
        <section
          className="dashboard-panel"
          aria-label={t("dashboard.v2.contextTitle")}
        >
          <div className="dashboard-panel-head">
            <div>
              <h2>
                {allToolsView.tools.find((tool) => tool.id === selectedTool)
                  ?.name ?? t("dashboard.v2.unknownTool")}
              </h2>
              <p>{t("dashboard.v2.contextTitle")}</p>
            </div>
            <span>{t("dashboard.v2.selectedRange")}</span>
          </div>
          <dl className="dashboard-workflow-grid">
            <div>
              <dt>{t("dashboard.kpi.tokens")}</dt>
              <dd>{format.formatTokens(view.totals.totalTokens)}</dd>
            </div>
            <div>
              <dt>{t("dashboard.v2.cacheLabel")}</dt>
              <dd>
                {view.cacheRate == null
                  ? t("dashboard.kpi.unavailable")
                  : format.formatPercent(view.cacheRate)}
              </dd>
            </div>
            <div>
              <dt>{t("dashboard.v2.responses")}</dt>
              <dd>{format.formatNumber(view.context.textResponses)}</dd>
            </div>
            <div>
              <dt>{t("dashboard.context.dimTool")}</dt>
              <dd>{format.formatNumber(view.context.toolCalls)}</dd>
            </div>
            <div>
              <dt>{t("dashboard.context.dimSkill")}</dt>
              <dd>{format.formatNumber(view.context.skillCalls)}</dd>
            </div>
            <div>
              <dt>{t("dashboard.kpi.sessions")}</dt>
              <dd>
                {view.sessions == null
                  ? t("dashboard.kpi.unavailable")
                  : format.formatNumber(view.sessions)}
              </dd>
            </div>
          </dl>
          <p className="mt-4 font-mono text-[10px] text-muted-foreground">
            {t("dashboard.v2.contextNote")}
          </p>
        </section>
      ) : null}
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
              {cache == null
                ? t("dashboard.kpi.unavailable")
                : format.formatPercent(Math.round(cache))}
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
            <Delta value={view.comparison.tokens.deltaPercent} />
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
            <Delta value={view.comparison.tokens.deltaPercent} />
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
