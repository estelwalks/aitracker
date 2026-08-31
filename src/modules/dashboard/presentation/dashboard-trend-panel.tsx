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

import { useI18n } from "../../../lib/i18n/context.tsx";
import type { DashboardV2View } from "../contracts.ts";
import { DashboardDeltaChip } from "./dashboard-v2-sections.tsx";

/**
 * P6-T6-05: trend chart section, split into its own module so Recharts is
 * loaded on demand instead of being part of the initial shared shell.
 */
export function DashboardTrendPanel({
  view,
  baselineLabel,
}: {
  view: DashboardV2View;
  /** Comparative baseline copy (such as "compared to the previous 30 days") changes with the period; it is not displayed when there is no chain comparison. */
  baselineLabel?: string;
}) {
  const { format, t } = useI18n();
  const points = view.trend;
  const total = points.reduce((sum, point) => sum + point.tokens, 0);
  const avg = total / Math.max(1, points.length);
  const peak = points.reduce(
    (best, point) => (point.tokens > best.tokens ? point : best),
    points[0],
  );
  const avgCache = view.cacheRate;
  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2>{t("dashboard.v2.trendTitle")}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span className="aitracker-num">
              {t("dashboard.v2.dailyAverage", {
                tokens: format.formatTokens(Math.round(avg)),
              })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <DashboardDeltaChip value={view.comparison.tokens.deltaPercent} />
              {view.comparison.tokens.deltaPercent != null && baselineLabel ? (
                <span>{baselineLabel}</span>
              ) : null}
            </span>
            {peak && (
              <span className="aitracker-num">
                {t("dashboard.v2.peakLabel", {
                  date: format.formatDate(`${peak.date}T00:00:00`, {
                    month: "numeric",
                    day: "numeric",
                    year: undefined,
                  }),
                  tokens: format.formatTokens(peak.tokens),
                })}
              </span>
            )}
          </div>
        </div>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {t("dashboard.v2.cacheLabel")}{" "}
          {avgCache == null
            ? t("dashboard.kpi.unavailable")
            : format.formatPercent(Math.round(avgCache))}
        </span>
      </div>
      {points.length === 0 ? (
        <p className="py-10 text-sm text-muted-foreground">
          {t("dashboard.v2.noData")}
        </p>
      ) : (
        <>
          <div className="mt-3 h-[220px]">
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
                  tickFormatter={(value: string) =>
                    format.formatDate(`${value}T00:00:00`, {
                      month: "numeric",
                      day: "numeric",
                      year: undefined,
                    })
                  }
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
                          {format.formatDate(`${point.date}T00:00:00`, {
                            month: "numeric",
                            day: "numeric",
                            year: undefined,
                          })}
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
                            {t("dashboard.tokens.output")}{" "}
                            {format.formatTokens(point.outputTokens)}
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
                  radius={[0, 0, 0, 0]}
                  maxBarSize={26}
                />
                <Bar
                  dataKey="outputTokens"
                  stackId="input"
                  fill="var(--color-chart-4)"
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
          <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <i
                className="size-2 rounded-[2px]"
                style={{ background: "var(--color-chart-1)" }}
              />{" "}
              {t("dashboard.tokens.cacheRead")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i
                className="size-2 rounded-[2px]"
                style={{ background: "var(--color-chart-2)" }}
              />{" "}
              {t("dashboard.tokens.input")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i
                className="size-2 rounded-[2px]"
                style={{ background: "var(--color-chart-4)" }}
              />{" "}
              {t("dashboard.tokens.output")}
            </span>
            {points.some((point) => point.previousTokens != null) ? (
              <span className="inline-flex items-center gap-1.5">
                <i
                  className="h-px w-4 border-t border-dashed"
                  style={{ borderColor: "var(--color-chart-3)" }}
                />{" "}
                {t("dashboard.kpi.vsPrevious")}
              </span>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
