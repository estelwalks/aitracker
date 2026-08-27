import type { LocalUsageEvent } from "../lib/local-usage";
import { useI18n } from "../lib/i18n/context";
import {
  createBoundFormatters,
  formatMoney,
  type BoundFormatters,
} from "../lib/i18n/format";
import type { Locale } from "../lib/i18n/locale";
import { zh } from "../lib/i18n/locales/zh-CN";
import {
  getMessage,
  type MessageKey,
  type MessageParams,
} from "../lib/i18n/messages";

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

type BudgetT = <K extends MessageKey>(
  key: K,
  params?: MessageParams<K>,
) => string;

/** zh fallback so callers without a live `t` (e.g. tests) still get text. */
const zhBudgetT: BudgetT = (key, params) =>
  getMessage(zh, key, params as Record<string, string | number> | undefined);

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
  t: BudgetT = zhBudgetT,
  format: BoundFormatters = createBoundFormatters("zh-CN"),
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
        message: t("dashboard.heatmap.budgetUnset"),
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
            ? t("dashboard.heatmap.budgetExceeded", {
                pct: formatPercentage(format, percentage - 100),
              })
            : t("dashboard.heatmap.budgetAtLimit"),
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
        message: t("dashboard.heatmap.budgetWarning", {
          pct: formatPercentage(format, percentage),
        }),
        hasUnknownCost,
      };
    }
    return {
      ...input,
      budgetCny,
      spentCny,
      percentage,
      state: "normal",
      message: t("dashboard.heatmap.budgetLeft", {
        amount: format.formatMoney(budgetCny - spentCny, "CNY"),
      }),
      hasUnknownCost,
    };
  });
}

function UsageHeatmapView({ events }: { events: LocalUsageEvent[] }) {
  const { t, format } = useI18n();
  const weekdayLabels = [
    t("dashboard.heatmap.monday"),
    t("dashboard.heatmap.tuesday"),
    t("dashboard.heatmap.wednesday"),
    t("dashboard.heatmap.thursday"),
    t("dashboard.heatmap.friday"),
    t("dashboard.heatmap.saturday"),
    t("dashboard.heatmap.sunday"),
  ];
  const rows = aggregateUsageHeatmap(events);
  const maxTokens = Math.max(0, ...rows.flat().map((cell) => cell.totalTokens));
  const totalEvents = rows.flat().reduce((sum, cell) => sum + cell.events, 0);

  if (totalEvents === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 text-center text-xs text-muted-foreground">
        {t("dashboard.heatmap.empty")}
      </div>
    );
  }

  return (
    <div className="aitracker-xscroll pb-1">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-[44px_repeat(24,minmax(22px,1fr))] gap-1">
          <span />
          {Array.from({ length: 24 }, (_, hour) => (
            <span
              key={hour}
              className="aitracker-num text-center text-[9px] text-muted-foreground"
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
          <span>{t("dashboard.heatmap.lowLevel")}</span>
          {[0.12, 0.28, 0.48, 0.7, 1].map((opacity) => (
            <span
              key={opacity}
              className="size-3 rounded-[2px] bg-primary"
              style={{ opacity }}
            />
          ))}
          <span>{t("dashboard.heatmap.highLevel")}</span>
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
  const { t, format } = useI18n();
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
            title={t("dashboard.heatmap.cellTitleBasic", {
              weekday: label,
              hour: String(cell.hour).padStart(2, "0"),
              events: cell.events,
              tokens: format.formatNumber(cell.totalTokens),
            })}
            aria-label={t("dashboard.heatmap.cellAria", {
              weekday: label,
              hour: cell.hour,
              events: cell.events,
              tokens: cell.totalTokens,
            })}
          />
        );
      })}
    </>
  );
}

function formatPercentage(format: BoundFormatters, value: number): string {
  return `${format.formatNumber(value, {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  })}%`;
}

function formatCny(locale: Locale, value: number): string {
  return formatMoney(locale, value, "CNY");
}

export const UsageHeatmap = Object.assign(UsageHeatmapView, {
  aggregateUsageHeatmap,
  buildBudgetIndicators,
  formatCny,
});
