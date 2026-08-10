import { Link, useRouter } from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  RefreshCw,
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
  const value = new Date();
  value.setDate(value.getDate() - days);
  return value.toISOString().slice(0, 10);
}

function TrendLine({ points }: { points: readonly DashboardV2TrendPoint[] }) {
  const { t, format } = useI18n();
  const path = useMemo(() => {
    if (points.length === 0) return "";
    const max = Math.max(...points.map((point) => point.tokens), 1);
    return points
      .map((point, index) => {
        const x =
          points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
        const y = 88 - (point.tokens / max) * 72;
        return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [points]);
  if (points.length === 0)
    return (
      <p className="py-10 text-sm text-muted-foreground">
        {t("dashboard.v2.noData")}
      </p>
    );
  return (
    <div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={t("dashboard.v2.trendAria")}
        className="h-48 w-full overflow-visible"
      >
        <path d="M0,88 H100" stroke="var(--color-border)" strokeWidth="0.7" />
        <path
          d={path}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
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

function BreakdownList({
  rows,
  total,
}: {
  rows: readonly DashboardV2BreakdownRow[];
  total: number;
}) {
  const { t, format } = useI18n();
  if (rows.length === 0)
    return (
      <p className="py-6 text-sm text-muted-foreground">
        {t("dashboard.v2.noData")}
      </p>
    );
  return (
    <div className="space-y-3">
      {rows.slice(0, 5).map((row) => (
        <div key={row.key}>
          <div className="flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1 truncate" title={row.key}>
              {row.key}
            </span>
            <span className="tt-num text-xs text-muted-foreground">
              {format.formatTokens(row.tokens)}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary/80"
              style={{ width: `${total ? (row.tokens / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ))}
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
  const filteredSnapshot = useMemo(
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
    () => createDashboardV2View(filteredSnapshot, period, from, to),
    [filteredSnapshot, period, from, to],
  );
  const toolView = useMemo(
    () => createDashboardV2View(data.v2, period, from, to),
    [data.v2, period, from, to],
  );
  const periodOptions: readonly { value: UsagePeriod; label: string }[] = [
    { value: "today", label: t("dashboard.period.today") },
    { value: "7d", label: t("dashboard.period.lastNDays", { count: 7 }) },
    { value: "30d", label: t("dashboard.period.lastNDays", { count: 30 }) },
    { value: "all", label: t("dashboard.period.all") },
    { value: "custom", label: t("dashboard.period.custom") },
  ];
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
  const focusTool = toolView.tools.find((tool) => tool.id === selectedTool);
  const insight = !view.hasData
    ? t("dashboard.v2.noData")
    : t("dashboard.v2.insight", {
        tool:
          focusTool?.name ??
          toolView.tools[0]?.name ??
          t("dashboard.v2.unknownTool"),
        tokens: format.formatTokens(
          focusTool?.tokens ?? toolView.tools[0]?.tokens ?? 0,
        ),
      });
  const metrics = [
    {
      label: t("dashboard.kpi.tokens"),
      value: format.formatTokens(view.totals.totalTokens),
      hint: t("dashboard.v2.eventCount", { count: view.totals.events }),
      icon: Activity,
    },
    {
      label: t("dashboard.kpi.cost"),
      value:
        view.estimatedCostUsd == null
          ? t("dashboard.kpi.unavailable")
          : format.formatUsd(view.estimatedCostUsd),
      hint: view.estimatedCostIsPartial
        ? t("dashboard.v2.partialCost")
        : t("dashboard.v2.estimatedCost"),
      icon: CircleDollarSign,
    },
    {
      label: t("dashboard.kpi.sessions"),
      value:
        view.sessions == null
          ? t("dashboard.kpi.unavailable")
          : format.formatNumber(view.sessions),
      hint:
        view.sessions == null
          ? t("dashboard.kpi.sessionUnavailableHint")
          : t("dashboard.v2.selectedRange"),
      icon: CalendarDays,
    },
    {
      label: t("dashboard.kpi.skills"),
      value:
        view.skills == null
          ? t("dashboard.kpi.unavailable")
          : format.formatNumber(view.skills),
      hint:
        view.skills == null
          ? t("dashboard.v2.skillUnavailable")
          : t("dashboard.kpi.skillScanNote"),
      icon: Sparkles,
    },
  ];
  return (
    <main className="space-y-5 pb-12">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <span className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="tt-label">{t("dashboard.v2.systemLabel")}</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight">
                {t("dashboard.title")}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-foreground/85">
                {insight}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-primary/60 disabled:opacity-60"
            >
              <RefreshCw
                className={`size-4 ${refreshing ? "animate-spin" : ""}`}
              />
              {refreshing
                ? t("dashboard.refresh.syncing")
                : t("dashboard.refresh.now")}
            </button>
          </div>
          <p className="mt-5 font-mono text-[11px] text-muted-foreground">
            {t("dashboard.header.range", {
              period:
                periodOptions.find((option) => option.value === period)
                  ?.label ?? "",
              time: format.formatDateTime(data.v2.generatedAt),
            })}
          </p>
        </div>
      </section>
      <section className="sticky top-0 z-20 -mx-1 rounded-xl border border-border/70 bg-background/90 px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-semibold">
            {t("dashboard.v2.rangeLabel")}
          </span>
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={t("dashboard.v2.rangeLabel")}
          >
            {periodOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPeriod(option.value)}
                aria-pressed={period === option.value}
                className={`rounded-md px-2.5 py-1.5 text-xs transition-colors ${period === option.value ? "bg-foreground text-background" : "bg-surface hover:bg-accent"}`}
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
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                />
                <input
                  type="date"
                  aria-label={t("dashboard.header.customTo")}
                  value={to}
                  min={from}
                  onChange={(event) => setTo(event.target.value)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
                />
              </>
            )}
          </div>
        </div>
      </section>
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-card p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <metric.icon className="size-3.5" />
              {metric.label}
            </div>
            <div className="tt-num mt-3 truncate text-2xl font-semibold">
              {metric.value}
            </div>
            <p
              className="mt-1 truncate text-[11px] text-muted-foreground"
              title={metric.hint}
            >
              {metric.hint}
            </p>
          </div>
        ))}
      </section>
      <section aria-labelledby="dashboard-tools" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="dashboard-tools" className="text-base font-semibold">
            {t("dashboard.v2.toolsTitle")}
          </h2>
          <span className="font-mono text-xs text-muted-foreground">
            {t("dashboard.v2.activeTools", { count: toolView.activeTools })}
          </span>
        </div>
        <div className="tt-xscroll flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedTool("all")}
            aria-pressed={selectedTool === "all"}
            className={`min-w-28 rounded-xl border p-3 text-left ${selectedTool === "all" ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-surface-2"}`}
          >
            <Boxes className="size-4" />
            <span className="mt-4 block text-sm font-medium">
              {t("dashboard.context.allTools")}
            </span>
            <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
              {format.formatTokens(toolView.totals.totalTokens)}
            </span>
          </button>
          {toolView.tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => setSelectedTool(tool.id)}
              aria-pressed={selectedTool === tool.id}
              className={`min-w-40 rounded-xl border p-3 text-left ${selectedTool === tool.id ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-surface-2"}`}
            >
              <Wrench className="size-4 text-primary" />
              <span className="mt-4 block truncate text-sm font-medium">
                {tool.name}
              </span>
              <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                {tool.events > 0
                  ? t("dashboard.v2.toolActivity", {
                      tokens: format.formatTokens(tool.tokens),
                      count: tool.events,
                    })
                  : t("dashboard.v2.noData")}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
        <article className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">{t("dashboard.v2.trendTitle")}</h2>
            <span className="font-mono text-[10px] text-muted-foreground">
              {t("dashboard.v2.selectedRange")}
            </span>
          </div>
          <TrendLine points={view.trend} />
        </article>
        <article className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">{t("dashboard.v2.contextTitle")}</h2>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            {(
              [
                { key: "textResponses", label: t("dashboard.v2.responses") },
                { key: "toolCalls", label: t("dashboard.context.dimTool") },
                { key: "skillCalls", label: t("dashboard.context.dimSkill") },
                { key: "toolOutputCalls", label: t("dashboard.v2.outputs") },
              ] as const
            ).map((item) => (
              <div key={item.key} className="rounded-lg bg-surface p-3">
                <dt className="text-xs text-muted-foreground">{item.label}</dt>
                <dd className="tt-num mt-1 text-xl">
                  {format.formatNumber(view.context[item.key])}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
            {t("dashboard.v2.contextNote")}
          </p>
        </article>
      </section>
      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">{t("dashboard.v2.modelsTitle")}</h2>
          <div className="mt-5">
            <BreakdownList rows={view.models} total={view.totals.totalTokens} />
          </div>
        </article>
        <article className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">{t("dashboard.v2.projectsTitle")}</h2>
          <div className="mt-5">
            <BreakdownList
              rows={view.projects}
              total={view.totals.totalTokens}
            />
          </div>
        </article>
        <article className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold">{t("dashboard.v2.calendarTitle")}</h2>
          <div className="mt-5 space-y-2">
            {view.calendar.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                {t("dashboard.v2.noData")}
              </p>
            ) : (
              view.calendar
                .slice(-7)
                .reverse()
                .map((point) => (
                  <div
                    key={point.date}
                    className="flex items-center gap-3 text-sm"
                  >
                    <time className="w-20 font-mono text-xs text-muted-foreground">
                      {point.date.slice(5)}
                    </time>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-primary/80"
                        style={{
                          width: `${Math.max(4, (point.tokens / Math.max(...view.calendar.map((row) => row.tokens), 1)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="tt-num w-16 text-right text-xs">
                      {format.formatTokens(point.tokens)}
                    </span>
                  </div>
                ))
            )}
          </div>
        </article>
      </section>
      <p className="text-center text-xs text-muted-foreground">
        <Link
          to="/skills"
          className="underline underline-offset-4 hover:text-foreground"
        >
          {t("dashboard.v2.openSkills")}
        </Link>
      </p>
    </main>
  );
}
