import { Link } from "@tanstack/react-router";
import {
  Activity,
  Brain,
  Boxes,
  CalendarRange,
  Check,
  ChevronDown,
  CircleDollarSign,
  Coins,
  FileText,
  ShieldCheck,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
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
import type { MonitoringStatus } from "../../monitoring/contracts.ts";

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
  onGenerateAIInsight,
  generatingAIInsight = false,
}: {
  hero: DashboardV2HeroView;
  aiInsight?: DashboardAIInsightView;
  onGenerateAIInsight?: () => void;
  generatingAIInsight?: boolean;
}) {
  const { t, format } = useI18n();
  const [index, setIndex] = useState(0);
  const insight = hero.insights[index % Math.max(1, hero.insights.length)];
  const serverInsight =
    aiInsight?.status === "ready" ? aiInsight.insight : null;
  const completeMessage =
    serverInsight?.headline ??
    (insight
      ? insightMessage(insight, t, format)
      : t("dashboard.v2.insights.empty"));
  const [typedMessage, setTypedMessage] = useState(completeMessage);
  useEffect(() => setIndex(0), [hero.insights]);
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setTypedMessage(completeMessage);
      return;
    }
    setTypedMessage("");
    let cursor = 0;
    const timer = window.setInterval(() => {
      cursor += 1;
      setTypedMessage(completeMessage.slice(0, cursor));
      if (cursor >= completeMessage.length) window.clearInterval(timer);
    }, 18);
    return () => window.clearInterval(timer);
  }, [completeMessage]);
  return (
    <section
      className="dashboard-insight-hero"
      aria-label={t("dashboard.v2.heroTitle")}
    >
      <div className="relative flex min-w-0 gap-5">
        <span className="dashboard-insight-orb tt-breathe">
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
          <p
            className="mt-3 min-h-20 max-w-5xl text-[19px] leading-[1.7] font-medium tracking-tight md:text-[22px]"
            aria-label={completeMessage}
          >
            {typedMessage}
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
        <div className="flex shrink-0 flex-col items-end gap-2">
          {aiInsight?.configured && onGenerateAIInsight ? (
            <button
              type="button"
              onClick={onGenerateAIInsight}
              disabled={generatingAIInsight}
              className="dashboard-hero-refresh"
            >
              {generatingAIInsight
                ? t("dashboard.v2.generatingAIInsight")
                : t("dashboard.v2.generateAIInsight")}
            </button>
          ) : null}
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
          {aiInsight?.status === "not-configured" ? (
            <span className="dashboard-hero-pill dashboard-hero-pending">
              {t("dashboard.v2.aiNotConfigured")}
              <Link
                to="/settings"
                title={t("dashboard.v2.aiNotConfiguredDesc")}
                className="underline decoration-dotted underline-offset-2"
              >
                {t("dashboard.v2.aiNotConfiguredDesc")}
              </Link>
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function DashboardTrustHero({
  view,
  today,
  hero,
  security,
}: {
  view: DashboardV2View;
  today: DashboardV2View;
  hero: DashboardV2HeroView;
  security?: MonitoringStatus["security"];
}) {
  const { t, format } = useI18n();
  const distill = view.outputAvailability.distillationOutputs;
  const dormantTools = Math.max(
    0,
    hero.monitoring.detectedTools - view.activeTools,
  );
  const securityValue =
    security == null
      ? t("dashboard.kpi.unavailable")
      : `${format.formatNumber(security.cleanCount)}/${format.formatNumber(security.assessedAssetCount)}`;
  const securitySub =
    security == null
      ? t("dashboard.v2.outputUnavailableHint")
      : t("dashboard.v2.securityScanSummary", {
          assessed: security.assessedAssetCount,
          discovered: security.discoveredAssetCount,
        });
  const todaySub =
    today.estimatedCostUsd == null
      ? t("dashboard.kpi.unavailable")
      : `${format.formatUsd(today.estimatedCostUsd)} · ${t("dashboard.v2.cacheLabel")} ${today.cacheRate == null ? t("dashboard.kpi.unavailable") : format.formatPercent(Math.round(today.cacheRate))}`;
  const cards = [
    {
      icon: Boxes,
      label: t("dashboard.v2.toolCoverageLabel"),
      value: format.formatNumber(hero.monitoring.detectedTools),
      sub: t("dashboard.v2.toolCountHint", {
        detected: hero.monitoring.detectedTools,
        active: view.activeTools,
        dormant: dormantTools,
      }),
      to: "/sources" as const,
      action: t("dashboard.v2.viewTools"),
    },
    {
      icon: ShieldCheck,
      label: t("dashboard.v2.securityLabel"),
      value: securityValue,
      sub: securitySub,
      to: "/security" as const,
      action: t("dashboard.v2.viewScan"),
      accent: true,
    },
    {
      icon: Brain,
      label: t("dashboard.v2.distillationAssetsLabel"),
      value:
        distill.available && distill.count != null
          ? format.formatNumber(distill.count)
          : t("dashboard.kpi.unavailable"),
      sub: distill.available
        ? t("dashboard.v2.distillationAssetsLabel")
        : t("dashboard.v2.outputUnavailableHint"),
      to: "/distill" as const,
      action: t("dashboard.v2.viewAssets"),
    },
    {
      icon: Coins,
      label: t("dashboard.v2.todayUsage"),
      value: format.formatTokens(today.totals.totalTokens),
      sub: todaySub,
      to: "/tracker" as const,
      action: t("dashboard.v2.viewTokens"),
    },
  ];
  return (
    <section className="space-y-4">
      <div
        className={`dashboard-monitoring-strip dashboard-monitoring-${hero.monitoring.health}`}
        aria-label={t("dashboard.v2.monitoringAria")}
      >
        <span className="dashboard-monitoring-status">
          <span className="dashboard-monitoring-pulse" aria-hidden="true">
            <span />
            <span />
          </span>
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
        {cards.map(({ icon: Icon, label, value, sub, to, action, accent }) => (
          <article key={label} className="dashboard-spotlight-card">
            <div className="dashboard-spotlight-card-heading">
              <p>{label}</p>
              <Icon
                className={accent ? "size-4 text-[var(--color-ok)]" : "size-4"}
                strokeWidth={1.8}
              />
            </div>
            <strong className="tt-num">{value}</strong>
            <small>{sub}</small>
            <Link to={to}>{action}</Link>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * The reference dashboard keeps these eight period-scoped signals directly
 * below the hero. Every value comes from the same DashboardV2View; where the
 * local service has no real history source, the card remains explicitly
 * unavailable instead of manufacturing a count.
 */
export function DashboardMetricGrid({
  view,
  monitoring,
  securityRunsCount = null,
}: {
  view: DashboardV2View;
  monitoring: DashboardV2HeroView["monitoring"];
  securityRunsCount?: number | null;
}) {
  const { t, format } = useI18n();
  const unavailable = t("dashboard.kpi.unavailable");
  const availabilityValue = (value: {
    available: boolean;
    count: number | null;
  }) =>
    value.available && value.count != null
      ? format.formatNumber(value.count)
      : unavailable;
  const availabilityHint = (value: { available: boolean }) =>
    value.available
      ? t("dashboard.v2.selectedRange")
      : t("dashboard.v2.outputUnavailableHint");
  const hasRealSecurityRuns =
    securityRunsCount != null && securityRunsCount > 0;
  const cards = [
    {
      icon: Coins,
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
          ? unavailable
          : format.formatUsd(view.estimatedCostUsd),
      hint:
        view.estimatedCostUsd == null
          ? t("dashboard.kpi.costUnknownHint")
          : t(
              view.estimatedCostIsPartial
                ? "dashboard.kpi.costUnknownHint"
                : "dashboard.v2.estimatedCost",
            ),
      delta: view.comparison.cost.deltaPercent,
    },
    {
      icon: Activity,
      label: t("dashboard.kpi.sessions"),
      value:
        view.sessions == null
          ? unavailable
          : format.formatNumber(view.sessions),
      hint:
        view.sessions == null
          ? t("dashboard.kpi.sessionUnavailableHint")
          : t("dashboard.v2.selectedRange"),
      delta: null,
    },
    {
      icon: Zap,
      label: t("dashboard.v2.cacheLabel"),
      value:
        view.cacheRate == null
          ? unavailable
          : format.formatPercent(Math.round(view.cacheRate)),
      hint: t("dashboard.v2.cacheHint"),
      delta: view.comparison.cacheRate.deltaPoints,
      deltaPoints: true,
    },
    {
      icon: Wrench,
      label: t("dashboard.v2.agentActivityLabel"),
      value: format.formatNumber(view.activeTools),
      hint: t("dashboard.v2.agentsLive", {
        live: monitoring.liveTools,
        detected: monitoring.detectedTools,
      }),
      delta: null,
    },
    {
      icon: ShieldCheck,
      label: t("dashboard.v2.securityRunsLabel"),
      value: hasRealSecurityRuns
        ? format.formatNumber(securityRunsCount as number)
        : availabilityValue(view.outputAvailability.securityRuns),
      hint: hasRealSecurityRuns
        ? t("dashboard.v2.selectedRange")
        : availabilityHint(view.outputAvailability.securityRuns),
      delta: null,
    },
    {
      icon: Brain,
      label: t("dashboard.v2.distillationOutputsLabel"),
      value: availabilityValue(view.outputAvailability.distillationOutputs),
      hint: availabilityHint(view.outputAvailability.distillationOutputs),
      delta: null,
    },
    {
      icon: FileText,
      label: t("dashboard.v2.dailyReportsLabel"),
      value: availabilityValue(view.outputAvailability.dailyReports),
      hint: availabilityHint(view.outputAvailability.dailyReports),
      delta: null,
    },
  ] as const;
  return (
    <section
      className="dashboard-metric-grid"
      aria-label={t("dashboard.v2.overviewLabel")}
    >
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <article key={card.label} className="dashboard-metric-card">
            <div className="flex items-center justify-between gap-2 text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon className="size-3 shrink-0" />
                <span className="truncate">{card.label}</span>
              </span>
              {card.delta != null ? (
                <DashboardDeltaChip
                  value={card.delta}
                  points={"deltaPoints" in card && card.deltaPoints === true}
                />
              ) : null}
            </div>
            <strong className="tt-num mt-2 block truncate text-[25px] leading-none font-black tracking-tight">
              {card.value}
            </strong>
            <p
              className="mt-2 truncate font-mono text-[10px] text-muted-foreground"
              title={card.hint}
            >
              {card.hint}
            </p>
          </article>
        );
      })}
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
  const customPopoverId = useId();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const presets: readonly (
    | { period: "today" | "all"; label: string }
    | { period: "7d" | "30d"; days: 7 | 30 }
  )[] = [
    { period: "today", label: t("dashboard.period.today") },
    { period: "7d", days: 7 },
    { period: "30d", days: 30 },
    { period: "all", label: t("dashboard.period.all") },
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
          {"label" in preset
            ? preset.label
            : t("dashboard.period.lastNDays", { count: preset.days })}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          setDraftFrom(from);
          setDraftTo(to);
          setOpen((value) => !value);
        }}
        aria-controls={customPopoverId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-pressed={period === "custom"}
        className={
          period === "custom"
            ? "dashboard-range-active inline-flex items-center gap-1"
            : "inline-flex items-center gap-1"
        }
      >
        <CalendarRange className="size-3" />
        {period === "custom"
          ? `${from.slice(5)} → ${to.slice(5)}`
          : t("dashboard.period.custom")}
      </button>
      {open && (
        <form
          id={customPopoverId}
          className="dashboard-range-popover"
          role="dialog"
          aria-label={t("dashboard.period.customRange")}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const nextFrom = values.get("from");
            const nextTo = values.get("to");
            if (
              typeof nextFrom !== "string" ||
              typeof nextTo !== "string" ||
              !nextFrom ||
              !nextTo ||
              nextFrom > nextTo
            ) {
              return;
            }
            onChange({ period: "custom", from: nextFrom, to: nextTo });
            setOpen(false);
          }}
        >
          <label>
            {t("dashboard.header.customFrom")}
            <input
              type="date"
              name="from"
              aria-label={t("dashboard.header.customFrom")}
              value={draftFrom}
              max={draftTo}
              onChange={(event) => setDraftFrom(event.target.value)}
            />
          </label>
          <label>
            {t("dashboard.header.customTo")}
            <input
              type="date"
              name="to"
              aria-label={t("dashboard.header.customTo")}
              value={draftTo}
              min={draftFrom}
              onChange={(event) => setDraftTo(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={!draftFrom || !draftTo || draftFrom > draftTo}
            className="col-span-2 mt-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check className="size-3.5" strokeWidth={2.2} />
            {t("common.confirm")}
          </button>
        </form>
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
