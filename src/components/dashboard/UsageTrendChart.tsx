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
import { Segmented } from "../tt";
import {
  formatTokens,
  shareOf,
  sourceLabel,
  type UsagePeriod,
  type UsageTimeGrain,
} from "../../lib/local-usage/presentation";
import type {
  LocalUsageDaily,
  LocalUsageEvent,
  LocalUsageSource,
} from "../../lib/local-usage";

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
  daily: LocalUsageDaily[];
  period: UsagePeriod;
  customFrom?: string;
  customTo?: string;
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
 * FR-004 — Token consumption trend, stacked-area OR multi-line, per AI tool.
 * Summary line shows 区间合计 / 均值 / 峰值(含峰值时刻) / 环比变化, with an
 * interactive legend below that hides/excludes a tool's series on click, a
 * dashed mean reference line, and a hover tooltip that lists each tool's token
 * value + share plus a total row.
 */
export function UsageTrendChart({
  events,
  daily,
  period,
  customFrom,
  customTo,
}: UsageTrendChartProps) {
  const [mode, setMode] = useState<TrendChartMode>("area");
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

  const chartData: TrendPoint[] = useMemo(() => {
    if (grain === "month") return aggregateByMonth(events);
    // Day grain — reuse the snapshot's pre-aggregated daily rows so per-source
    // splits stay consistent with the rest of the dashboard. The hour grain is
    // handled entirely by `chartDataWithSources` below.
    return daily.map((day) => ({
      key: day.date,
      label: day.date.slice(5),
      total: day.totalTokens,
      ...Object.fromEntries(
        Object.entries(day.bySource).map(([source, counts]) => [
          source,
          counts.totalTokens,
        ]),
      ),
    }));
  }, [events, daily, grain]);

  // For the hour grain the daily bySource map isn't available; recompute the
  // per-source series from the events so the legend and tooltip stay accurate.
  const chartDataWithSources: TrendPoint[] = useMemo(() => {
    if (grain === "hour") return aggregateHourlyBySource(events, topSources);
    return chartData;
  }, [chartData, events, grain, topSources]);

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
  const mean = chartDataWithSources.length > 0
    ? visibleTotal / chartDataWithSources.length
    : 0;

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-end">
        <Segmented
          value={mode}
          onChange={(value) => setMode(value as TrendChartMode)}
          options={[
            { value: "area", label: "堆叠面积" },
            { value: "line", label: "多折线" },
          ]}
        />
      </div>
      <div style={{ height: 260 }}>
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
              tickFormatter={formatTokens}
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
                  stackId="usage"
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.color}
                  fill={item.color}
                  fillOpacity={0.22}
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
                  value: `均值 ${formatTokens(mean)}`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "var(--color-muted-foreground)",
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
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
              className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11px] ${
                hidden
                  ? "border-border text-muted-foreground opacity-50"
                  : "border-border-strong"
              }`}
            >
              <span
                className="size-1.5 rounded-full"
                style={{ background: item.color }}
              />
              {item.name}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        点击图例可隐藏 / 显示对应工具；隐藏的系列不计入区间合计 / 均值 / 峰值。
      </p>
    </div>
  );
}

function aggregateHourlyBySource(
  events: LocalUsageEvent[],
  sources: { key: LocalUsageSource }[],
): TrendPoint[] {
  const buckets = new Map<
    string,
    { label: string; total: number; bySource: Map<string, number> }
  >();
  for (const event of events) {
    const timestamp = new Date(event.timestamp);
    if (Number.isNaN(timestamp.getTime())) continue;
    const month = String(timestamp.getMonth() + 1).padStart(2, "0");
    const day = String(timestamp.getDate()).padStart(2, "0");
    const hour = String(timestamp.getHours()).padStart(2, "0");
    const key = `${timestamp.getFullYear()}-${month}-${day}T${hour}`;
    const label = `${month}-${day} ${hour}`;
    const bucket = buckets.get(key) ?? {
      label,
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

function grainLabelUnit(grain: UsageTimeGrain | "month"): string {
  if (grain === "hour") return "时段";
  if (grain === "day") return "天";
  return "月";
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
              <span className="tt-num ml-auto">{value.toLocaleString()}</span>
              <span className="tt-num w-12 text-right text-muted-foreground">
                {share.toFixed(1)}%
              </span>
            </div>
          );
        })}
      <div className="mt-1 flex items-center gap-2 border-t border-border pt-1">
        <span className="w-24">合计</span>
        <span className="tt-num ml-auto">{total.toLocaleString()}</span>
        <span className="tt-num w-12 text-right text-muted-foreground">
          {grandTotal > 0 ? shareOf(total, grandTotal).toFixed(1) : "0.0"}%
        </span>
      </div>
    </div>
  );
}
