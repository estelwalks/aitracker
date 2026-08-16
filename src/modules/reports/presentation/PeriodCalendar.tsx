import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useI18n } from "../../../lib/i18n/context";
import {
  dayKeyOf,
  monthKeyOf,
  periodKeyOf,
  periodStartDate,
  sumPeriodDensity,
  type PeriodGranularity,
  type SessionDensity,
} from "../period.ts";

const WEEKDAY_LABELS = [1, 2, 3, 4, 5, 6, 0]; // Mon-first; 0 = Sunday

/**
 * PeriodCalendar — a lightweight day/week/month picker for the report header.
 * Every date cell shows a real session-density dot (scaled by count) from the
 * loader's `SessionDensity`; clicking a day/week/month selects the report
 * period. The month view sweeps the last 12 months ending at the displayed
 * month; the day/week views render the displayed month with a Mon-first grid.
 */
export function PeriodCalendar({
  granularity,
  selectedKey,
  density,
  now,
  onSelect,
}: {
  granularity: PeriodGranularity;
  selectedKey: string;
  density: SessionDensity;
  now: Date;
  onSelect: (key: string) => void;
}) {
  const { t, format } = useI18n();
  const initialMonth = useMemo(() => {
    const start = periodStartDate(granularity, selectedKey) ?? now;
    return new Date(start.getFullYear(), start.getMonth(), 1);
  }, [granularity, selectedKey, now]);
  const [viewMonth, setViewMonth] = useState<Date>(initialMonth);

  const densityByDay = density.days;
  const selectedToday = periodKeyOf(granularity, now);

  const dayCells = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate() - mondayOffset,
    );
    const cells: Array<{ date: Date; key: string; count: number }> = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index,
      );
      cells.push({
        date,
        key: dayKeyOf(date),
        count: densityByDay[dayKeyOf(date)]?.count ?? 0,
      });
    }
    return cells;
  }, [viewMonth, densityByDay]);

  const weekRows = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const mondayOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate() - mondayOffset,
    );
    const rows: Array<{ key: string; start: Date; end: Date; count: number }> =
      [];
    for (let index = 0; index < 6; index += 1) {
      const start = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index * 7,
      );
      const end = new Date(
        start.getFullYear(),
        start.getMonth(),
        start.getDate() + 6,
      );
      rows.push({
        key: dayKeyOf(start),
        start,
        end,
        count: sumPeriodDensity(density, "week", dayKeyOf(start)).count,
      });
    }
    return rows;
  }, [viewMonth, density]);

  const monthCells = useMemo(() => {
    const cells: Array<{ key: string; date: Date; count: number }> = [];
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(
        viewMonth.getFullYear(),
        viewMonth.getMonth() - offset,
        1,
      );
      cells.push({
        key: monthKeyOf(date),
        date,
        count: sumPeriodDensity(density, "month", monthKeyOf(date)).count,
      });
    }
    return cells;
  }, [viewMonth, density]);

  const monthLabel = format.formatDate(viewMonth, {
    year: "numeric",
    month: "long",
  });
  const shiftMonth = (delta: number) =>
    setViewMonth(
      new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1),
    );

  const todayKey = dayKeyOf(now);

  return (
    <div className="w-[300px] rounded-xl bg-card p-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="prev"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <span className="text-[12px] font-medium">{monthLabel}</span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="next"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      {granularity === "day" && (
        <>
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] text-muted-foreground">
            {WEEKDAY_LABELS.map((day) => (
              <span key={day}>
                {day === 0 ? "日" : `周${"一二三四五六"[day - 1]}`}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {dayCells.map((cell) => {
              const inMonth = cell.date.getMonth() === viewMonth.getMonth();
              const selected = cell.key === selectedKey;
              const today = cell.key === todayKey;
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => onSelect(cell.key)}
                  className={`flex h-9 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] transition-colors ${
                    selected
                      ? "bg-primary text-primary-foreground"
                      : inMonth
                        ? "hover:bg-surface-2"
                        : "text-muted-foreground/50 hover:bg-surface-2"
                  }`}
                >
                  <span
                    className={
                      today && !selected ? "font-semibold text-primary" : ""
                    }
                  >
                    {cell.date.getDate()}
                  </span>
                  <span className="flex h-1 items-center justify-center">
                    {cell.count > 0 && (
                      <span
                        className="size-1 rounded-full"
                        style={{
                          backgroundColor: selected
                            ? "currentColor"
                            : "var(--color-ok)",
                          opacity: Math.min(1, 0.35 + cell.count * 0.12),
                        }}
                        title={t("reports.calendar.density", {
                          count: cell.count,
                        })}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {granularity === "week" && (
        <div className="space-y-1">
          {weekRows.map((row) => {
            const selected = row.key === selectedKey;
            return (
              <button
                key={row.key}
                type="button"
                onClick={() => onSelect(row.key)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] transition-colors ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-surface-2"
                }`}
              >
                <span className="tt-num font-mono">
                  {format.formatDate(row.start, {
                    month: "2-digit",
                    day: "2-digit",
                  })}
                  {" – "}
                  {format.formatDate(row.end, {
                    month: "2-digit",
                    day: "2-digit",
                  })}
                </span>
                <span className="flex items-center gap-1.5">
                  {row.count > 0 && (
                    <span
                      className="size-1.5 rounded-full"
                      style={{
                        backgroundColor: selected
                          ? "currentColor"
                          : "var(--color-ok)",
                      }}
                    />
                  )}
                  <span className="tt-num opacity-80">
                    {row.count > 0
                      ? t("reports.calendar.density", { count: row.count })
                      : t("reports.calendar.empty")}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {granularity === "month" && (
        <div className="grid grid-cols-3 gap-1.5">
          {monthCells.map((cell) => {
            const selected = cell.key === selectedKey;
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => onSelect(cell.key)}
                className={`flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] transition-colors ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-surface-2"
                }`}
              >
                <span className="font-medium">
                  {format.formatDate(cell.date, {
                    year: "2-digit",
                    month: "short",
                  })}
                </span>
                <span className="flex items-center gap-1">
                  {cell.count > 0 && (
                    <span
                      className="size-1 rounded-full"
                      style={{
                        backgroundColor: selected
                          ? "currentColor"
                          : "var(--color-ok)",
                      }}
                    />
                  )}
                  <span className="tt-num opacity-80">
                    {cell.count > 0 ? cell.count : "·"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
        <span>{t("reports.calendar.dotHint")}</span>
        <button
          type="button"
          onClick={() => {
            if (selectedToday) onSelect(selectedToday);
            setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
          }}
          className="rounded-md px-1.5 py-0.5 hover:bg-surface-2 hover:text-foreground"
        >
          {t("reports.calendar.today")}
        </button>
      </div>
    </div>
  );
}
