import { Link } from "@tanstack/react-router";
import {
  Activity,
  Brain,
  CalendarRange,
  ChevronDown,
  CircleDollarSign,
  Coins,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BrandIcon, brandColorOf } from "../../../components/BrandIcon.tsx";
import { useI18n } from "../../../lib/i18n/context.tsx";
import type { UsagePeriod } from "../../../lib/local-usage/presentation.ts";
import type {
  DashboardAIInsightView,
  DashboardV2BreakdownRow,
  DashboardV2CalendarPoint,
  DashboardV2HeroView,
  DashboardV2Insight,
  DashboardV2Tool,
  DashboardV2View,
} from "../contracts.ts";

export function DashboardDeltaChip({
  value,
  points = false,
}: {
  value: number | null;
  points?: boolean;
}) {
  const { format, t } = useI18n();
  if (value == null || !Number.isFinite(value)) {
    return (
      <span className="font-mono text-[10px] text-muted-foreground">
        {t("dashboard.kpi.unavailable")}
      </span>
    );
  }
  return (
    <span
      className={`font-mono text-[10px] ${value >= 0 ? "text-[var(--color-ok)]" : "text-[var(--color-warning)]"}`}
      title={t("dashboard.kpi.vsPrevious")}
    >
      {value > 0 ? "+" : ""}
      {format.formatPercent(value)}
      {points ? " pt" : ""}
    </span>
  );
}

function insightMessage(
  insight: DashboardV2Insight,
  t: ReturnType<typeof useI18n>["t"],
  format: ReturnType<typeof useI18n>["format"],
) {
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

/** Renderer accepts server-composed insights as-is; a future LLM adapter only needs to supply this contract. */
export function DashboardJarvisInsight({
  hero,
  aiInsight,
}: {
  hero: DashboardV2HeroView;
  aiInsight?: DashboardAIInsightView;
}) {
  const { t, format } = useI18n();
  const [index, setIndex] = useState(0);
  const insight = hero.insights[index % Math.max(1, hero.insights.length)];
  const serverInsight =
    aiInsight?.status === "ready" ? aiInsight.insight : null;
  useEffect(() => setIndex(0), [hero.insights]);
  return (
    <section
      className="dashboard-insight-hero"
      aria-label={t("dashboard.v2.heroTitle")}
    >
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
            {serverInsight?.headline ??
              (insight
                ? insightMessage(insight, t, format)
                : t("dashboard.v2.insights.empty"))}
          </p>
          {serverInsight?.insights[0]?.detail ? (
            <p className="max-w-4xl font-mono text-[11px] leading-5 text-muted-foreground">
              {serverInsight.insights[0].detail}
            </p>
          ) : null}
          <div
            className="mt-5 flex gap-1.5"
            role="tablist"
            aria-label={t("dashboard.v2.insightDotsAria")}
          >
            {hero.insights.map((item, itemIndex) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={itemIndex === index}
                aria-label={t("dashboard.v2.insightDot", {
                  index: itemIndex + 1,
                })}
                onClick={() => setIndex(itemIndex)}
                className={
                  itemIndex === index
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
            setIndex((current) =>
              hero.insights.length ? (current + 1) % hero.insights.length : 0,
            )
          }
          className="dashboard-hero-refresh"
        >
          {t("dashboard.v2.rotateInsight")}
        </button>
      </div>
    </section>
  );
}

export function DashboardTrustHero({
  view,
  today,
  hero,
}: {
  view: DashboardV2View;
  today: DashboardV2View;
  hero: DashboardV2HeroView;
}) {
  const { t, format } = useI18n();
  const security = view.outputAvailability.securityRuns;
  const distill = view.outputAvailability.distillationOutputs;
  const cards = [
    {
      icon: Wrench,
      label: t("dashboard.v2.agentActivityLabel"),
      value: format.formatNumber(view.activeTools),
      sub: t("dashboard.v2.toolCountHint", {
        detected: hero.monitoring.detectedTools,
        supported: view.usageSupportedToolCount,
        total: view.tools.length,
      }),
      to: "/sources" as const,
      action: t("dashboard.v2.openSkills"),
    },
    {
      icon: ShieldCheck,
      label: t("dashboard.v2.securityRunsLabel"),
      value:
        security.available && security.count != null
          ? format.formatNumber(security.count)
          : t("dashboard.kpi.unavailable"),
      sub: security.available
        ? t("dashboard.v2.securityLabel")
        : t("dashboard.v2.outputUnavailableHint"),
      to: "/security" as const,
      action: t("nav.security"),
    },
    {
      icon: Brain,
      label: t("dashboard.v2.distillationOutputsLabel"),
      value:
        distill.available && distill.count != null
          ? format.formatNumber(distill.count)
          : t("dashboard.kpi.unavailable"),
      sub: distill.available
        ? t("dashboard.v2.distillationAssetsLabel")
        : t("dashboard.v2.outputUnavailableHint"),
      to: "/distill" as const,
      action: t("nav.distill"),
    },
    {
      icon: Coins,
      label: t("dashboard.v2.todayUsage"),
      value: format.formatTokens(today.totals.totalTokens),
      sub:
        today.estimatedCostUsd == null
          ? t("dashboard.kpi.unavailable")
          : format.formatUsd(today.estimatedCostUsd),
      to: "/sessions" as const,
      action: t("dashboard.v2.viewUsage"),
    },
  ];
  return (
    <section className="space-y-3">
      <div
        className={`dashboard-monitoring-strip dashboard-monitoring-${hero.monitoring.health}`}
        aria-label={t("dashboard.v2.monitoringAria")}
      >
        <span className="dashboard-monitoring-status">
          <span className="dashboard-monitoring-indicator" />
          {t(`dashboard.v2.monitoring.${hero.monitoring.health}`)}
        </span>
        <span>
          {t("dashboard.v2.agentsLive", {
            live: hero.monitoring.liveTools,
            detected: hero.monitoring.detectedTools,
          })}
        </span>
        {hero.monitoring.isLive ? (
          <strong>{t("dashboard.v2.liveBadge")}</strong>
        ) : null}
      </div>
      <div className="dashboard-spotlight-grid">
        {cards.map(({ icon: Icon, label, value, sub, to, action }) => (
          <article key={label} className="dashboard-spotlight-card">
            <Icon className="size-4" />
            <p>{label}</p>
            <strong className="tt-num">{value}</strong>
            <small>{sub}</small>
            <Link to={to}>{action}</Link>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DashboardRangePicker({
  period,
  from,
  to,
  onChange,
}: {
  period: UsagePeriod;
  from: string;
  to: string;
  onChange: (next: { period: UsagePeriod; from?: string; to?: string }) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const presets: readonly { period: UsagePeriod; days: number }[] = [
    { period: "7d", days: 7 },
    { period: "30d", days: 30 },
    { period: "90d", days: 90 },
    { period: "180d", days: 180 },
    { period: "1y", days: 365 },
  ];
  return (
    <div
      className="relative flex items-center gap-1"
      role="group"
      aria-label={t("dashboard.v2.rangeLabel")}
    >
      {presets.map((preset) => (
        <button
          key={preset.period}
          type="button"
          onClick={() => {
            setOpen(false);
            onChange({ period: preset.period });
          }}
          aria-pressed={period === preset.period}
          className={period === preset.period ? "dashboard-range-active" : ""}
        >
          {t("dashboard.period.lastNDays", { count: preset.days })}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          onChange({ period: "custom" });
        }}
        aria-pressed={period === "custom"}
        className={
          period === "custom"
            ? "dashboard-range-active inline-flex items-center gap-1"
            : "inline-flex items-center gap-1"
        }
      >
        <CalendarRange className="size-3" />
        {t("dashboard.period.custom")}
      </button>
      {open && (
        <div className="dashboard-range-popover">
          <label>
            {t("dashboard.header.customFrom")}
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) =>
                onChange({ period: "custom", from: event.target.value, to })
              }
            />
          </label>
          <label>
            {t("dashboard.header.customTo")}
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) =>
                onChange({ period: "custom", from, to: event.target.value })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function DashboardToolSwitcher({
  tools,
  selected,
  onChange,
}: {
  tools: readonly (DashboardV2Tool & { tokens: number; events: number })[];
  selected: string;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="dashboard-tool-rail"
      role="group"
      aria-label={t("dashboard.v2.toolsTitle")}
    >
      <button
        type="button"
        onClick={() => onChange("all")}
        aria-pressed={selected === "all"}
        className={selected === "all" ? "dashboard-tool-active" : ""}
      >
        {t("dashboard.context.allTools")}
      </button>
      {tools.map((tool) => {
        const color = brandColorOf(tool.name);
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => onChange(tool.id)}
            aria-pressed={selected === tool.id}
            className={selected === tool.id ? "dashboard-tool-active" : ""}
            style={{ "--dashboard-tool-color": color } as React.CSSProperties}
          >
            <BrandIcon name={tool.name} className="size-3.5" color={color} />
            {tool.name}
          </button>
        );
      })}
    </div>
  );
}

export function DashboardTrendPanel({ view }: { view: DashboardV2View }) {
  const { format, t } = useI18n();
  const points = view.trend;
  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2>{t("dashboard.v2.trendTitle")}</h2>
          <p>
            {t("dashboard.v2.dailyAverage", {
              tokens: format.formatTokens(
                points.length
                  ? Math.round(view.totals.totalTokens / points.length)
                  : 0,
              ),
            })}
          </p>
        </div>
        <DashboardDeltaChip value={view.comparison.tokens.deltaPercent} />
      </div>
      {points.length === 0 ? (
        <p className="py-10 text-sm text-muted-foreground">
          {t("dashboard.v2.noData")}
        </p>
      ) : (
        <>
          <div className="mt-4 h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={[...points]}
                margin={{ top: 8, right: 4, bottom: 0, left: -18 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--color-border)"
                  strokeOpacity={0.55}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={20}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickFormatter={(value: number) => format.formatTokens(value)}
                  tickLine={false}
                  axisLine={false}
                  width={54}
                />
                <Tooltip
                  cursor={{
                    fill: "var(--color-foreground)",
                    fillOpacity: 0.04,
                  }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const point = payload[0]
                      .payload as DashboardV2View["trend"][number];
                    return (
                      <div className="rounded-xl bg-card px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
                        <div className="font-mono text-[11px] font-semibold">
                          {point.date}
                        </div>
                        <div className="mt-1 space-y-0.5 font-mono text-[10.5px] text-muted-foreground">
                          <div>
                            {t("dashboard.kpi.tokens")}{" "}
                            {format.formatTokens(point.tokens)}
                          </div>
                          <div>
                            {t("dashboard.tokens.cacheRead")}{" "}
                            {format.formatTokens(point.cacheTokens)}
                          </div>
                          <div>
                            {t("dashboard.tokens.input")}{" "}
                            {format.formatTokens(point.netInputTokens)}
                          </div>
                          <div>
                            {t("dashboard.kpi.sessions")}{" "}
                            {point.sessions == null
                              ? t("dashboard.kpi.unavailable")
                              : format.formatNumber(point.sessions)}
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="cacheTokens"
                  stackId="input"
                  fill="var(--color-chart-1)"
                  radius={[0, 0, 3, 3]}
                  maxBarSize={26}
                />
                <Bar
                  dataKey="netInputTokens"
                  stackId="input"
                  fill="var(--color-chart-2)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={26}
                />
                {points.some((point) => point.previousTokens != null) ? (
                  <Line
                    type="monotone"
                    dataKey="previousTokens"
                    stroke="var(--color-chart-3)"
                    strokeDasharray="4 4"
                    strokeWidth={1.6}
                    dot={false}
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex gap-3 font-mono text-[10px] text-muted-foreground">
            <span>■ {t("dashboard.tokens.cacheRead")}</span>
            <span>■ {t("dashboard.tokens.input")}</span>
            {points.some((point) => point.previousTokens != null) ? (
              <span>┈ {t("dashboard.kpi.vsPrevious")}</span>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

const modelColors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];
export function DashboardModelDonut({ view }: { view: DashboardV2View }) {
  const { format, t } = useI18n();
  const [restOpen, setRestOpen] = useState(false);
  const top = view.models.slice(0, 8);
  const rest = view.models.slice(8);
  const max = top[0]?.share ?? 1;
  const row = (item: DashboardV2BreakdownRow, index: number) => (
    <div key={item.key} className="space-y-1.5">
      <div className="flex items-end gap-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold">
          {item.key}
        </span>
        <span className="tt-num shrink-0 font-mono text-[11px] text-muted-foreground">
          {format.formatNumber(item.events)}
        </span>
        <span className="tt-num w-16 text-right font-mono text-[12px] font-semibold">
          {format.formatTokens(item.tokens)}
        </span>
        <span className="tt-num w-12 text-right font-mono text-[11px]">
          {format.formatPercent(item.share)}
        </span>
      </div>
      <div className="h-[3px] bg-surface-2">
        <div
          className="h-full"
          style={{
            width: `${Math.max(3, (item.share / max) * 100)}%`,
            background: modelColors[index % modelColors.length],
            boxShadow: `0 0 6px -1px ${modelColors[index % modelColors.length]}`,
          }}
        />
      </div>
    </div>
  );
  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2>{t("dashboard.v2.modelsTitle")}</h2>
          <p>{t("dashboard.v2.modelHint", { count: view.modelCount })}</p>
        </div>
        <DashboardDeltaChip value={view.comparison.tokens.deltaPercent} />
      </div>
      <div className="mt-4 space-y-4">
        {top.map(row)}
        {rest.length ? (
          <div>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg bg-surface px-2 py-1.5 text-left font-mono text-[10.5px] text-muted-foreground"
              onClick={() => setRestOpen((value) => !value)}
            >
              {t("dashboard.detail.items", { count: rest.length })}
              <ChevronDown
                className={restOpen ? "size-3 rotate-180" : "size-3"}
              />
            </button>
            {restOpen ? (
              <div className="mt-3 space-y-3">
                {rest.map((item, index) => row(item, index + top.length))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ThinRing({ rows }: { rows: readonly DashboardV2BreakdownRow[] }) {
  const circumference = 2 * Math.PI * 42;
  let offset = 0;
  return (
    <svg
      viewBox="0 0 100 100"
      className="size-[136px] -rotate-90"
      aria-hidden="true"
    >
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke="var(--color-surface-2)"
        strokeWidth="10"
      />
      {rows.map((row, index) => {
        const length = (row.share / 100) * circumference;
        const circle = (
          <circle
            key={row.key}
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={modelColors[index % modelColors.length]}
            strokeWidth="10"
            strokeDasharray={`${Math.max(0, length - 1.4)} ${circumference}`}
            strokeDashoffset={-offset}
          />
        );
        offset += length;
        return circle;
      })}
    </svg>
  );
}

export function DashboardProjectOverview({ view }: { view: DashboardV2View }) {
  const { format, t } = useI18n();
  const [topN, setTopN] = useState<3 | 5 | 10>(5);
  const named = view.projects.filter((item) => item.key !== "other");
  const top = named.slice(0, topN);
  const share = top.reduce((sum, item) => sum + item.share, 0);
  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2>{t("dashboard.v2.projectsTitle")}</h2>
          <p>{t("dashboard.v2.projectHint")}</p>
        </div>
        <div className="flex rounded-full bg-surface-1 p-0.5">
          {([3, 5, 10] as const).map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => setTopN(count)}
              className={`rounded-full px-2.5 py-1 font-mono text-[10px] ${topN === count ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              TOP {count}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-col overflow-hidden rounded-xl bg-surface-1/30 md:flex-row">
        <div className="flex min-w-56 flex-col items-center justify-center gap-2 px-6 py-5">
          <div className="relative">
            <ThinRing rows={top} />
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <strong className="tt-num block font-mono text-[22px] leading-none">
                  {format.formatNumber(view.projectCount)}
                </strong>
                <span className="mt-1 block font-mono text-[9.5px] uppercase tracking-widest text-muted-foreground">
                  {t("dashboard.v2.projectCountLabel")}
                </span>
              </div>
            </div>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            TOP {topN} · {format.formatPercent(share)}
          </p>
        </div>
        <div className="min-w-0 flex-1 bg-card px-4 py-2">
          <div className="space-y-2">
            {top.map((item, index) => (
              <div
                key={item.key}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2 text-[12px]"
              >
                <span className="min-w-0 truncate">
                  <i
                    className="mr-2 inline-block h-[3px] w-3"
                    style={{
                      background: modelColors[index % modelColors.length],
                    }}
                  />
                  {item.key}
                </span>
                <span className="font-mono text-muted-foreground">
                  {format.formatTokens(item.tokens)} /{" "}
                  {item.sessions == null
                    ? t("dashboard.kpi.unavailable")
                    : format.formatNumber(item.sessions)}
                </span>
                <DashboardDeltaChip value={item.deltaPercent} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function DashboardContribHeatmap({
  points,
  summary,
}: {
  points: readonly DashboardV2CalendarPoint[];
  summary: DashboardV2View["calendarSummary"];
}) {
  const { format, t } = useI18n();
  const cells = points.slice(-365);
  const max = Math.max(...cells.map((point) => point.tokens), 1);
  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2>{t("dashboard.v2.calendarTitle")}</h2>
          <p>
            {t("dashboard.v2.calendarHint", {
              count: summary.activeDays,
              tokens: format.formatTokens(summary.totalTokens),
            })}{" "}
            · {t("dashboard.v2.streakHint", { count: summary.longestStreak })}
          </p>
        </div>
      </div>
      <div
        className="mt-5 dashboard-calendar-grid"
        aria-label={t("dashboard.v2.calendarTitle")}
      >
        {cells.map((point) => {
          const level =
            point.events === 0
              ? 0
              : Math.min(4, Math.max(1, Math.ceil((point.tokens / max) * 4)));
          return (
            <span
              key={point.date}
              className={`dashboard-calendar-cell dashboard-calendar-cell-level-${level}`}
              title={`${point.date} · ${format.formatTokens(point.tokens)} · ${format.formatNumber(point.events)} ${t("dashboard.v2.eventShort")}${point.sessions == null ? "" : ` · ${format.formatNumber(point.sessions)} ${t("dashboard.kpi.sessions")}`} · ${t("dashboard.v2.modelsTitle")} ${t("dashboard.kpi.unavailable")}`}
            />
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        <span>{t("dashboard.heatmap.low")}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={`dashboard-calendar-cell dashboard-calendar-cell-level-${level}`}
          />
        ))}
        <span>{t("dashboard.heatmap.high")}</span>
      </div>
    </section>
  );
}

export function DashboardAgentWorkstreams({
  view,
  selectedTool,
}: {
  view: DashboardV2View;
  selectedTool: string;
}) {
  const { format, t } = useI18n();
  const [open, setOpen] = useState<string | null>(
    selectedTool === "all" ? null : selectedTool,
  );
  useEffect(
    () => setOpen(selectedTool === "all" ? null : selectedTool),
    [selectedTool],
  );
  const tools =
    selectedTool === "all"
      ? view.tools
      : view.tools.filter((tool) => tool.id === selectedTool);
  if (!tools.length) return null;
  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2>{t("dashboard.v2.contextTitle")}</h2>
          <p>{t("dashboard.v2.contextNote")}</p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {tools.map((tool) => {
          const expanded = open === tool.id;
          const live = tool.events > 0;
          return (
            <li key={tool.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 py-3 text-left"
                onClick={() => setOpen(expanded ? null : tool.id)}
              >
                <BrandIcon
                  name={tool.name}
                  color={brandColorOf(tool.name)}
                  className="size-5"
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {tool.name}
                </span>
                <span
                  className={`font-mono text-[10px] ${live ? "text-[var(--color-ok)]" : "text-muted-foreground"}`}
                >
                  {live ? "LIVE" : "IDLE"}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {format.formatTokens(tool.tokens)} ·{" "}
                  {format.formatNumber(tool.events)}
                </span>
                <ChevronDown
                  className={expanded ? "size-4 rotate-180" : "size-4"}
                />
              </button>
              {expanded ? (
                <div className="dashboard-workflow-grid mt-0 mb-3">
                  <div>
                    <dt>{t("dashboard.kpi.sessions")}</dt>
                    <dd>
                      {view.sessions == null
                        ? t("dashboard.kpi.unavailable")
                        : format.formatNumber(view.sessions)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.kpi.tokens")}</dt>
                    <dd>{format.formatTokens(view.totals.totalTokens)}</dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.v2.responses")}</dt>
                    <dd>
                      {view.contextAvailability.textResponses
                        ? format.formatNumber(view.context.textResponses)
                        : t("dashboard.kpi.unavailable")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.context.dimTool")}</dt>
                    <dd>
                      {view.contextAvailability.toolCalls
                        ? format.formatNumber(view.context.toolCalls)
                        : t("dashboard.kpi.unavailable")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.v2.securityLabel")}</dt>
                    <dd>
                      {view.outputAvailability.securityRuns.available
                        ? t("dashboard.v2.securityClean")
                        : t("dashboard.kpi.unavailable")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.v2.distillationOutputsLabel")}</dt>
                    <dd>
                      {view.outputAvailability.distillationOutputs.available
                        ? format.formatNumber(
                            view.outputAvailability.distillationOutputs.count ??
                              0,
                          )
                        : t("dashboard.kpi.unavailable")}
                    </dd>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
