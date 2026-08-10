import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "../../lib/i18n/context";
import {
  shareOf,
  sourceLabel,
  type UsagePeriod,
  type UsageTimeGrain,
} from "../../lib/local-usage/presentation";
import type { LocalUsageEvent, LocalUsageSource } from "../../lib/local-usage";

export type TrendChartMode = "area" | "line";

const chartColors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

interface TrendPoint {
  key: string;
  label: string;
  total: number;
  [source: string]: number | string;
}

export interface UsageTrendChartProps {
  events: LocalUsageEvent[];
  period: UsagePeriod;
  customFrom?: string;
  customTo?: string;
  /** 图表模式（受控）：堆叠面积 / 多序列折线。由父级持有并渲染切换控件。 */
  mode: TrendChartMode;
  onModeChange: (mode: TrendChartMode) => void;
}

/**
 * Map the global period to the aggregation grain the trend uses. "今日"/"本周"
 * bucket hourly, the rolling windows and "本月" daily, "本年"/"全部" monthly.
 * "自定义" defers to the picked span. This must agree with
 * `periodGrainLabel` in index.tsx so the legend unit matches the bars.
 */
function grainForPeriod(period: UsagePeriod): UsageTimeGrain | "month" {
  switch (period) {
    case "today":
    case "week":
      return "hour";
    case "7d":
    case "30d":
    case "month":
    case "custom":
      return "day";
    case "year":
    case "all":
      return "month";
  }
}

function monthKey(timestamp: Date): string {
  return `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, "0")}`;
}

function aggregateByMonth(events: LocalUsageEvent[]) {
  const buckets = new Map<
    string,
    { total: number; bySource: Record<string, number> }
  >();
  for (const event of events) {
    const timestamp = new Date(event.timestamp);
    if (Number.isNaN(timestamp.getTime())) continue;
    const key = monthKey(timestamp);
    const bucket = buckets.get(key) ?? { total: 0, bySource: {} };
    bucket.total += event.totalTokens;
    bucket.bySource[event.source] =
      (bucket.bySource[event.source] ?? 0) + event.totalTokens;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      label: key,
      total: value.total,
      ...Object.fromEntries(Object.entries(value.bySource)),
    }));
}

/**
 * Aggregate events by calendar day, building per-source columns that match
 * topSources keys (both derived from event.source). This replaces the
 * daily.bySource snapshot read so source keys are always consistent.
 */
function aggregateDailyBySource(
  events: LocalUsageEvent[],
  sources: { key: LocalUsageSource; name: string; color: string }[],
): TrendPoint[] {
  const buckets = new Map<
    string,
    { label: string; total: number; bySource: Map<string, number> }
  >();
  for (const event of events) {
    const date = event.timestamp.slice(0, 10);
    const bucket = buckets.get(date) ?? {
      label: date.slice(5),
      total: 0,
      bySource: new Map(),
    };
    bucket.total += event.totalTokens;
    bucket.bySource.set(
      event.source,
      (bucket.bySource.get(event.source) ?? 0) + event.totalTokens,
    );
    buckets.set(date, bucket);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const point: TrendPoint = { key, label: value.label, total: value.total };
      for (const source of sources) {
        point[source.key] = value.bySource.get(source.key) ?? 0;
      }
      return point;
    });
}

/**
 * FR-004 — Token consumption trend, stacked-area OR multi-line, per AI tool.
 * Summary line shows 区间合计 / 均值 / 峰值(含峰值时刻) / 环比变化, with an
 * interactive legend below that hides/excludes a tool's series on click, a
 * dashed mean reference line, and a hover tooltip that lists each tool's token
 * value + share plus a total row.
 */
export function UsageTrendChart({
  events,
  period,
  customFrom,
  customTo,
  mode,
  onModeChange,
}: UsageTrendChartProps) {
  const { t, format } = useI18n();
  const [hiddenSources, setHiddenSources] = useState<LocalUsageSource[]>([]);

  const grain = grainForPeriod(period);

  const topSources: { key: LocalUsageSource; name: string; color: string }[] =
    useMemo(() => {
      const totals = new Map<string, number>();
      for (const event of events) {
        totals.set(
          event.source,
          (totals.get(event.source) ?? 0) + event.totalTokens,
        );
      }
      return [...totals.entries()]
        .filter(([_key, value]) => value > 0)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([key, _value], index) => ({
          key: key as LocalUsageSource,
          name: sourceLabel(key),
          color: chartColors[index % chartColors.length]!,
        }));
    }, [events]);

  // Recompute chart data from events for all grains so source keys are
  // guaranteed to match `topSources` (both come from event.source).
  const chartDataWithSources: TrendPoint[] = useMemo(() => {
    if (grain === "month") return aggregateByMonth(events);
    if (grain === "hour") return aggregateHourlyBySource(events, topSources);
    return aggregateDailyBySource(events, topSources);
  }, [events, grain, topSources]);

  const visibleSeries = topSources.filter(
    (item) => !hiddenSources.includes(item.key),
  );

  const hiddenSet = useMemo(() => new Set(hiddenSources), [hiddenSources]);
  const seriesTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const point of chartDataWithSources) {
      for (const source of topSources) {
        if (hiddenSet.has(source.key)) continue;
        const value = point[source.key];
        if (typeof value === "number") {
          map.set(source.key, (map.get(source.key) ?? 0) + value);
        }
      }
    }
    return map;
  }, [chartDataWithSources, topSources, hiddenSet]);

  const totalsWithVisibleSources = chartDataWithSources.reduce(
    (sum, point) => sum + (typeof point.total === "number" ? point.total : 0),
    0,
  );
  // The visible-series total excludes hidden sources; recompute it from the
  // series sums so the 区间合计/均值 reflect what the chart actually shows.
  const visibleTotal = [...seriesTotals.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const mean =
    chartDataWithSources.length > 0
      ? visibleTotal / chartDataWithSources.length
      : 0;

  return (
    <div className="flex flex-col">
      <div
        className="tt-corner relative overflow-hidden rounded-sm border border-border bg-surface-2/25"
        style={{ height: 260 }}
      >
        <div className="tt-grid-bg pointer-events-none absolute inset-0 opacity-40" />
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartDataWithSources}
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
              tickFormatter={(value) => format.formatTokens(Number(value))}
              width={48}
              tick={{
                fontSize: 11,
                fill: "var(--color-muted-foreground)",
              }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={(props) => (
                <TrendTooltip
                  active={props.active}
                  label={props.label}
                  payload={props.payload?.map((entry) => ({
                    dataKey: String(entry.dataKey ?? ""),
                    value: Number(entry.value ?? 0),
                    color: entry.color,
                  }))}
                  topSources={topSources}
                  hiddenSources={hiddenSet}
                  grandTotal={totalsWithVisibleSources}
                />
              )}
            />
            {visibleSeries.map((item) =>
              mode === "area" ? (
                <Area
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.color}
                  fill={item.color}
                  fillOpacity={0.18}
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
            {mean > 0 && (
              <ReferenceLine
                y={mean}
                stroke="var(--color-muted-foreground)"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
                label={{
                  value: t("dashboard.trend.meanLabel", {
                    tokens: format.formatTokens(mean),
                  }),
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "var(--color-muted-foreground)",
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
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
              className={`flex items-center gap-1.5 rounded-sm border px-2 py-0.5 transition-colors ${
                hidden
                  ? "border-border text-muted-foreground opacity-50"
                  : "border-border-strong text-foreground"
              }`}
            >
              <span
                className="size-1.5 rounded-full"
                style={{
                  background: hidden
                    ? "var(--color-muted-foreground)"
                    : item.color,
                }}
              />
              {item.name}
            </button>
          );
        })}
        <span className="ml-auto text-muted-foreground">
          {t("dashboard.trend.legendHint")}
        </span>
      </div>
    </div>
  );
}

function aggregateHourlyBySource(
  events: LocalUsageEvent[],
  sources: { key: LocalUsageSource }[],
): TrendPoint[] {
  // 今日小时粒度：从 00:00 铺到「当前小时」（含），无事件的小时为 0，
  // 不画未来小时——横轴止于现在。取首个事件所在日期作为当天基准。
  const todayKey =
    events.length > 0 ? events[0]!.timestamp.slice(0, 10) : undefined;
  const currentHour = new Date().getHours();
  const buckets = new Map<
    string,
    { label: string; total: number; bySource: Map<string, number> }
  >();
  if (todayKey) {
    for (let hour = 0; hour <= currentHour; hour += 1) {
      const hh = String(hour).padStart(2, "0");
      buckets.set(`${todayKey}T${hh}`, {
        label: hh,
        total: 0,
        bySource: new Map(),
      });
    }
  }
  for (const event of events) {
    const timestamp = new Date(event.timestamp);
    if (Number.isNaN(timestamp.getTime())) continue;
    const month = String(timestamp.getMonth() + 1).padStart(2, "0");
    const day = String(timestamp.getDate()).padStart(2, "0");
    const hour = String(timestamp.getHours()).padStart(2, "0");
    const key = `${timestamp.getFullYear()}-${month}-${day}T${hour}`;
    // 今日场景：事件所在小时晚于当前小时则不计入（避免横轴冒出未来点）；
    // 非今日（todayKey 缺失）则照常累加。
    if (
      todayKey &&
      key.startsWith(`${todayKey}T`) &&
      timestamp.getHours() > currentHour
    )
      continue;
    // 跨天事件：仅保留当天桶；非当天则建临时桶（不会铺满，但极少见）。
    const bucket = buckets.get(key) ?? {
      label: hour,
      total: 0,
      bySource: new Map(),
    };
    bucket.total += event.totalTokens;
    bucket.bySource.set(
      event.source,
      (bucket.bySource.get(event.source) ?? 0) + event.totalTokens,
    );
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const point: TrendPoint = { key, label: value.label, total: value.total };
      for (const source of sources) {
        point[source.key] = value.bySource.get(source.key) ?? 0;
      }
      return point;
    });
}

interface TrendTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ dataKey: string; value: number; color?: string }>;
  topSources: { key: LocalUsageSource; name: string; color: string }[];
  hiddenSources: Set<LocalUsageSource>;
  grandTotal: number;
}

function TrendTooltip({
  active,
  label,
  payload,
  topSources,
  hiddenSources,
  grandTotal,
}: TrendTooltipProps) {
  const { t, format } = useI18n();
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce(
    (sum, item) => sum + (typeof item.value === "number" ? item.value : 0),
    0,
  );
  return (
    <div className="tt-xscroll rounded-sm border border-border bg-popover px-3 py-2 text-xs shadow-sm">
      <div className="tt-num mb-1 text-muted-foreground">{String(label)}</div>
      {topSources
        .filter((source) => !hiddenSources.has(source.key))
        .map((source) => {
          const item = payload.find((entry) => entry.dataKey === source.key);
          const value = item?.value ?? 0;
          const share = total > 0 ? shareOf(value, total) : 0;
          return (
            <div key={source.key} className="flex items-center gap-2 py-0.5">
              <span
                className="size-1.5 rounded-full"
                style={{ background: source.color }}
              />
              <span className="w-24 truncate">{source.name}</span>
              <span className="tt-num ml-auto">
                {format.formatTokens(value)}
              </span>
              <span className="tt-num w-12 text-right text-muted-foreground">
                {format.formatPercent(share)}
              </span>
            </div>
          );
        })}
      <div className="mt-1 flex items-center gap-2 border-t border-border pt-1">
        <span className="w-24">{t("dashboard.trend.tooltipTotal")}</span>
        <span className="tt-num ml-auto">{format.formatTokens(total)}</span>
        <span className="tt-num w-12 text-right text-muted-foreground">
          {grandTotal > 0
            ? format.formatPercent(shareOf(total, grandTotal))
            : "0.0%"}
        </span>
      </div>
    </div>
  );
}
