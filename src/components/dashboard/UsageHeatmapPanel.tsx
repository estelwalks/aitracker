import { useMemo, useState } from "react";
import { UsageHeatmap, type UsageHeatmapCell } from "../UsageHeatmap";
import { estimateEventCost, formatMoney } from "../../lib/pricing";
import type { LocalUsageEvent } from "../../lib/local-usage";

const aggregateUsageHeatmap = UsageHeatmap.aggregateUsageHeatmap;

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/**
 * FR-006 — 7 × 24 consumption heatmap with week-offset navigation. Cells show
 * token intensity, and hover tooltips surface weekday + timeslot, token count,
 * cost, session count and the dominant model for that hour. Navigation arrows
 * walk back through prior weeks; the future-week arrow is disabled.
 */
export interface UsageHeatmapPanelProps {
  events: LocalUsageEvent[];
}

interface CellExtra {
  events: number;
  totalTokens: number;
  costUsd: number;
  sessions: number;
  topModel: string;
}

export function UsageHeatmapPanel({ events }: UsageHeatmapPanelProps) {
  const [weekOffset, setWeekOffset] = useState(0);

  const { weekStart, weekEnd, weekLabel, canGoForward } = useMemo(() => {
    const now = new Date();
    const startOfCurrentWeek = new Date(now);
    // Align to Monday: getDay() is 0 (Sun) .. 6 (Sat). Monday = 1.
    const day = now.getDay();
    startOfCurrentWeek.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    startOfCurrentWeek.setHours(0, 0, 0, 0);
    const start = new Date(startOfCurrentWeek);
    start.setDate(start.getDate() + weekOffset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const fmt = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;
    return {
      weekStart: start,
      weekEnd: end,
      weekLabel: `${fmt(start)} – ${fmt(end)}`,
      canGoForward: weekOffset < 0,
    };
  }, [weekOffset]);

  const weekEvents = useMemo(
    () =>
      events.filter((event) => {
        const timestamp = new Date(event.timestamp);
        if (Number.isNaN(timestamp.getTime())) return false;
        return timestamp >= weekStart && timestamp <= weekEnd;
      }),
    [events, weekStart, weekEnd],
  );

  const rows = useMemo(() => aggregateUsageHeatmap(weekEvents), [weekEvents]);
  const extras = useMemo(() => buildCellExtras(weekEvents), [weekEvents]);
  const maxTokens = Math.max(0, ...rows.flat().map((cell) => cell.totalTokens));
  const totalEvents = rows.flat().reduce((sum, cell) => sum + cell.events, 0);

  if (totalEvents === 0) {
    return (
      <div className="flex flex-col gap-3">
        <HeatmapHeader
          weekLabel={weekLabel}
          weekOffset={weekOffset}
          canGoForward={canGoForward}
          onPrev={() => setWeekOffset((value) => value - 1)}
          onNext={() => setWeekOffset((value) => value + 1)}
        />
        <div className="flex min-h-44 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 text-center text-xs text-muted-foreground">
          当前周无可用事件，热力图保持为空。
        </div>
        <GradientLegend />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <HeatmapHeader
        weekLabel={weekLabel}
        weekOffset={weekOffset}
        canGoForward={canGoForward}
        onPrev={() => setWeekOffset((value) => value - 1)}
        onNext={() => setWeekOffset((value) => value + 1)}
      />
      <div className="tt-xscroll pb-1">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[44px_repeat(24,minmax(22px,1fr))] gap-1">
            <span />
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                className="tt-num text-center text-[9px] text-muted-foreground"
              >
                {hour % 3 === 0 ? hour : ""}
              </span>
            ))}
            {rows.map((row, weekday) => (
              <HeatmapPanelRow
                key={weekdayLabels[weekday]}
                label={weekdayLabels[weekday]}
                cells={row}
                extras={extras[weekday]}
                maxTokens={maxTokens}
              />
            ))}
          </div>
        </div>
      </div>
      <GradientLegend />
    </div>
  );
}

function HeatmapHeader({
  weekLabel,
  weekOffset,
  canGoForward,
  onPrev,
  onNext,
}: {
  weekLabel: string;
  weekOffset: number;
  canGoForward: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
      <span className="tt-num">{weekLabel}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          className="inline-flex size-6 items-center justify-center rounded-sm border border-border bg-surface-2 transition-colors hover:border-border-strong"
          aria-label="上一周"
        >
          ‹
        </button>
        <span className="tt-num w-12 text-center">
          {weekOffset === 0 ? "本周" : `-${weekOffset}周`}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={!canGoForward}
          className="inline-flex size-6 items-center justify-center rounded-sm border border-border bg-surface-2 transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="下一周"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function HeatmapPanelRow({
  label,
  cells,
  extras,
  maxTokens,
}: {
  label: string;
  cells: UsageHeatmapCell[];
  extras: CellExtra[];
  maxTokens: number;
}) {
  return (
    <>
      <span className="flex items-center text-[10px] text-muted-foreground">
        {label}
      </span>
      {cells.map((cell) => {
        const intensity = maxTokens > 0 ? cell.totalTokens / maxTokens : 0;
        const extra = extras[cell.hour];
        return (
          <div
            key={`${cell.weekday}-${cell.hour}`}
            className="aspect-square min-h-5 rounded-[2px] border border-border/60 bg-surface-2"
            style={
              cell.totalTokens > 0
                ? {
                    backgroundColor: "var(--color-primary)",
                    opacity: Math.max(0.12, intensity),
                  }
                : undefined
            }
            title={`${label} ${String(cell.hour).padStart(2, "0")}:00 · ${cell.events} 个事件 · ${cell.totalTokens.toLocaleString()} Token · ${formatMoney(
              extra.costUsd,
              "CNY",
            )} · ${extra.sessions} 个会话 · 主力 ${extra.topModel || "—"}`}
            aria-label={`${label} ${cell.hour} 时，${cell.events} 个事件，${cell.totalTokens} Token`}
          />
        );
      })}
    </>
  );
}

function GradientLegend() {
  return (
    <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
      <span>少</span>
      {[0.12, 0.28, 0.48, 0.7, 1].map((opacity) => (
        <span
          key={opacity}
          className="size-3 rounded-[2px] bg-primary"
          style={{ opacity }}
        />
      ))}
      <span>多 · 按 Token 强度</span>
    </div>
  );
}

function buildCellExtras(events: LocalUsageEvent[]): CellExtra[][] {
  const rows: CellExtra[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({
      events: 0,
      totalTokens: 0,
      costUsd: 0,
      sessions: 0,
      topModel: "",
    })),
  );
  // Bucket events per cell to derive session count + dominant model + cost.
  const modelsPerCell: Map<number, Map<string, number>> = new Map();
  const sessionSetsPerCell: Map<number, Set<string>> = new Map();

  for (const event of events) {
    const timestamp = new Date(event.timestamp);
    if (Number.isNaN(timestamp.getTime())) continue;
    const weekday = (timestamp.getDay() + 6) % 7;
    const hour = timestamp.getHours();
    const cell = rows[weekday]?.[hour];
    if (!cell) continue;
    cell.events += 1;
    cell.totalTokens += Number.isFinite(event.totalTokens)
      ? Math.max(0, event.totalTokens)
      : 0;
    cell.costUsd += estimateEventCost(event).knownUsd;
    const cellKey = weekday * 24 + hour;
    const session =
      event.sessionId && event.sessionId.trim().length > 0
        ? event.sessionId
        : null;
    if (session) {
      const set = sessionSetsPerCell.get(cellKey) ?? new Set<string>();
      set.add(session);
      sessionSetsPerCell.set(cellKey, set);
    }
    if (event.model) {
      const modelMap = modelsPerCell.get(cellKey) ?? new Map<string, number>();
      modelMap.set(
        event.model,
        (modelMap.get(event.model) ?? 0) + event.totalTokens,
      );
      modelsPerCell.set(cellKey, modelMap);
    }
  }

  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const cell = rows[weekday]![hour]!;
      const cellKey = weekday * 24 + hour;
      cell.sessions = sessionSetsPerCell.get(cellKey)?.size ?? 0;
      const modelMap = modelsPerCell.get(cellKey);
      if (modelMap && modelMap.size > 0) {
        const top = [...modelMap.entries()].sort(
          (left, right) => right[1] - left[1],
        )[0];
        cell.topModel = top?.[0] ?? "";
      }
    }
  }
  return rows;
}
