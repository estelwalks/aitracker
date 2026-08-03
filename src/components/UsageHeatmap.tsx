import type { LocalUsageEvent } from "../lib/local-usage";

export interface UsageHeatmapCell {
  weekday: number;
  hour: number;
  events: number;
  totalTokens: number;
}

export interface BudgetIndicator {
  key: "daily" | "weekly" | "monthly";
  label: string;
  budgetCny: number;
  spentCny: number;
  percentage: number;
  state: "disabled" | "normal" | "warning" | "exceeded";
  message: string;
  hasUnknownCost: boolean;
}

interface BudgetInput {
  key: BudgetIndicator["key"];
  label: string;
  budgetCny: number;
  spentCny: number;
  unknownEvents?: number;
}

const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function aggregateUsageHeatmap(
  events: LocalUsageEvent[],
): UsageHeatmapCell[][] {
  const rows = Array.from({ length: 7 }, (_, weekday) =>
    Array.from({ length: 24 }, (_, hour) => ({
      weekday,
      hour,
      events: 0,
      totalTokens: 0,
    })),
  );

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
  }

  return rows;
}

function buildBudgetIndicators(
  inputs: BudgetInput[],
  alertThreshold: number,
): BudgetIndicator[] {
  const threshold = Math.min(100, Math.max(0, alertThreshold));
  return inputs.map((input) => {
    const budgetCny = Number.isFinite(input.budgetCny)
      ? Math.max(0, input.budgetCny)
      : 0;
    const spentCny = Number.isFinite(input.spentCny)
      ? Math.max(0, input.spentCny)
      : 0;
    const percentage = budgetCny > 0 ? (spentCny / budgetCny) * 100 : 0;
    const hasUnknownCost = (input.unknownEvents ?? 0) > 0;

    if (budgetCny === 0) {
      return {
        ...input,
        budgetCny,
        spentCny,
        percentage,
        state: "disabled",
        message: "未设置预算",
        hasUnknownCost,
      };
    }
    if (percentage >= 100) {
      return {
        ...input,
        budgetCny,
        spentCny,
        percentage,
        state: "exceeded",
        message:
          percentage > 100
            ? `已超出 ${formatPercentage(percentage - 100)}`
            : "已达到预算上限",
        hasUnknownCost,
      };
    }
    if (percentage >= threshold) {
      return {
        ...input,
        budgetCny,
        spentCny,
        percentage,
        state: "warning",
        message: `已达到 ${formatPercentage(percentage)}，接近预算上限`,
        hasUnknownCost,
      };
    }
    return {
      ...input,
      budgetCny,
      spentCny,
      percentage,
      state: "normal",
      message: `剩余 ${formatCny(budgetCny - spentCny)}`,
      hasUnknownCost,
    };
  });
}

function UsageHeatmapView({ events }: { events: LocalUsageEvent[] }) {
  const rows = aggregateUsageHeatmap(events);
  const maxTokens = Math.max(0, ...rows.flat().map((cell) => cell.totalTokens));
  const totalEvents = rows.flat().reduce((sum, cell) => sum + cell.events, 0);

  if (totalEvents === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 text-center text-xs text-muted-foreground">
        暂无可聚合的真实事件时间，热力图保持为空。
      </div>
    );
  }

  return (
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
            <HeatmapRow
              key={weekdayLabels[weekday]}
              label={weekdayLabels[weekday]}
              cells={row}
              maxTokens={maxTokens}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-muted-foreground">
          <span>低</span>
          {[0.12, 0.28, 0.48, 0.7, 1].map((opacity) => (
            <span
              key={opacity}
              className="size-3 rounded-[2px] bg-primary"
              style={{ opacity }}
            />
          ))}
          <span>高 · 按 Token 强度</span>
        </div>
      </div>
    </div>
  );
}

function HeatmapRow({
  label,
  cells,
  maxTokens,
}: {
  label: string;
  cells: UsageHeatmapCell[];
  maxTokens: number;
}) {
  return (
    <>
      <span className="flex items-center text-[10px] text-muted-foreground">
        {label}
      </span>
      {cells.map((cell) => {
        const intensity = maxTokens > 0 ? cell.totalTokens / maxTokens : 0;
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
            title={`${label} ${String(cell.hour).padStart(2, "0")}:00 · ${cell.events} 个事件 · ${cell.totalTokens.toLocaleString()} Token`}
            aria-label={`${label} ${cell.hour} 时，${cell.events} 个事件，${cell.totalTokens} Token`}
          />
        );
      })}
    </>
  );
}

function formatPercentage(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatCny(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}

export const UsageHeatmap = Object.assign(UsageHeatmapView, {
  aggregateUsageHeatmap,
  buildBudgetIndicators,
  formatCny,
});
