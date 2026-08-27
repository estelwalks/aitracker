import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { useI18n } from "../../../lib/i18n/context";
import {
  dayKeyOf,
  periodKeyOf,
  periodStartDate,
  type PeriodGranularity,
  type SessionDensity,
} from "../period.ts";

const DAY = 86400000;
const WEEK_HEAD = ["一", "二", "三", "四", "五", "六", "日"];

/** Compact pill label for the toggle button (mirrors the prototype's `short`). */
function shortLabel(granularity: PeriodGranularity, key: string): string {
  const start = periodStartDate(granularity, key);
  if (!start) return key;
  if (granularity === "day") {
    return `${start.getMonth() + 1}/${start.getDate()}`;
  }
  if (granularity === "week") {
    return `${start.getMonth() + 1}/${start.getDate()}周`;
  }
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
}

const densityOpacity = (n: number) =>
  n === 0 ? 0 : n <= 2 ? 0.35 : n <= 5 ? 0.6 : n <= 9 ? 0.8 : 1;

/**
 * 桌面端日历选择器（V3.0 原型对齐）：日 / 周 / 月三种粒度，带会话密度点。
 * 自包含：按钮（CalendarDays + 短标签）展开下拉，点选后回调 `onSelect`。
 * 密度全部来自 loader 的 `SessionDensity`（真实会话，绝不做假数据）。
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
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const initialMonth = useMemo(() => {
    const start = periodStartDate(granularity, selectedKey) ?? now;
    return new Date(start.getFullYear(), start.getMonth(), 1);
  }, [granularity, selectedKey, now]);
  const [cursor, setCursor] = useState(initialMonth);

  useEffect(() => setCursor(initialMonth), [initialMonth]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const todayKey = dayKeyOf(now);

  const cells = useMemo(() => {
    if (granularity === "month") return [];
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - lead);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index,
      );
      const key = dayKeyOf(date);
      return {
        key,
        day: date.getDate(),
        date,
        inMonth: date.getMonth() === month,
        future: key > todayKey,
        n: density.days[key]?.count ?? 0,
      };
    });
  }, [granularity, year, month, todayKey, density]);

  const weekRange = useMemo(() => {
    if (granularity !== "week") return null;
    const start = periodStartDate("week", selectedKey);
    if (!start) return null;
    const from = dayKeyOf(start);
    const to = dayKeyOf(new Date(start.getTime() + 6 * DAY));
    return { from, to };
  }, [granularity, selectedKey]);

  const shiftCursor = (delta: number) =>
    setCursor(new Date(year, month + delta, 1));

  const pick = (dayKey: string) => {
    onSelect(periodKeyOf(granularity, new Date(`${dayKey}T00:00:00`)));
    setOpen(false);
  };

  const monthLabel = `${year} 年 ${month + 1} 月`;
  const goTodayLabel =
    granularity === "day"
      ? t("reports.header.goToday")
      : granularity === "week"
        ? t("reports.header.goWeek")
        : t("reports.header.goMonth");

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={t("reports.calendar.toggle")}
        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[11.5px] transition-colors ${
          open
            ? "bg-surface-2 text-foreground"
            : "bg-surface-2/70 text-muted-foreground hover:text-foreground"
        }`}
      >
        <CalendarDays className="size-3.5" strokeWidth={1.8} />
        {shortLabel(granularity, selectedKey)}
      </button>

      {open && (
        <div className="absolute top-full left-0 z-40 mt-2 w-[268px] rounded-xl bg-card p-3 shadow-[0_18px_50px_-16px_rgba(0,0,0,0.65)] ring-1 ring-border/70 backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftCursor(-1)}
              className="rounded-full bg-surface-2 p-1 hover:opacity-80"
              aria-label="prev"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="aitracker-num font-mono text-[12px] tracking-tight">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => shiftCursor(1)}
              className="rounded-full bg-surface-2 p-1 hover:opacity-80"
              aria-label="next"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>

          {granularity === "month" ? (
            <div className="grid grid-cols-3 gap-1.5">
              {Array.from({ length: 12 }, (_, index) => {
                const key = `${year}-${String(index + 1).padStart(2, "0")}`;
                const active =
                  periodStartDate("month", selectedKey)?.getMonth() === index;
                const future =
                  `${year}-${String(index + 1).padStart(2, "0")}` >
                  todayKey.slice(0, 7);
                const inMonthCount = Object.entries(density.days).reduce(
                  (sum, [dayKey, metric]) =>
                    dayKey.startsWith(key) ? sum + metric.count : sum,
                  0,
                );
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={future}
                    onClick={() => pick(`${key}-01`)}
                    className={`flex flex-col items-center gap-1 rounded-lg py-2 font-mono text-[11.5px] transition-colors disabled:opacity-25 ${
                      active
                        ? "bg-primary font-medium text-primary-foreground"
                        : "bg-surface-2/60 hover:bg-surface-2"
                    }`}
                  >
                    <span>{index + 1} 月</span>
                    <span
                      className="size-1 rounded-full bg-primary"
                      style={{
                        opacity:
                          inMonthCount > 0 ? densityOpacity(inMonthCount) : 0,
                        visibility: inMonthCount > 0 ? "visible" : "hidden",
                      }}
                    />
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="mb-1 grid grid-cols-7 text-center font-mono text-[10px] text-muted-foreground/70">
                {WEEK_HEAD.map((weekday) => (
                  <span key={weekday} className="py-1">
                    {weekday}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-0.5">
                {cells.map((cell) => {
                  const inRange =
                    weekRange &&
                    cell.key >= weekRange.from &&
                    cell.key <= weekRange.to;
                  const isEdge =
                    weekRange &&
                    (cell.key === weekRange.from || cell.key === weekRange.to);
                  const selectedDay =
                    granularity === "day" && cell.key === selectedKey;
                  const isToday = cell.key === todayKey;
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      disabled={cell.future}
                      onClick={() => pick(cell.key)}
                      className={`relative flex h-8 flex-col items-center justify-center font-mono text-[11.5px] transition-colors disabled:opacity-20 ${
                        granularity === "week" && inRange ? "bg-surface-2" : ""
                      } ${granularity === "week" && cell.key === weekRange?.from ? "rounded-l-lg" : ""} ${
                        granularity === "week" && cell.key === weekRange?.to
                          ? "rounded-r-lg"
                          : ""
                      } ${!inRange ? "rounded-lg hover:bg-surface-2/60" : ""} ${
                        cell.inMonth ? "" : "text-muted-foreground/35"
                      }`}
                    >
                      <span
                        className={`flex size-6 items-center justify-center rounded-full ${
                          selectedDay
                            ? "bg-primary font-semibold text-primary-foreground"
                            : isToday
                              ? "ring-1 ring-primary/60"
                              : ""
                        }`}
                      >
                        {cell.day}
                      </span>
                      <span
                        className="mt-0.5 size-1 rounded-full bg-primary"
                        style={{ opacity: densityOpacity(cell.n) }}
                      />
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2">
            <span className="font-mono text-[10px] text-muted-foreground">
              {granularity === "week"
                ? t("reports.calendar.weekHint")
                : granularity === "month"
                  ? t("reports.calendar.monthHint")
                  : t("reports.calendar.dayHint")}
            </span>
            <button
              type="button"
              onClick={() => {
                onSelect(periodKeyOf(granularity, now));
                setOpen(false);
              }}
              className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] hover:opacity-80"
            >
              {goTodayLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
