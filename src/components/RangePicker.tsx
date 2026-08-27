import { useEffect, useRef, useState } from "react";
import { CalendarRange, Check } from "lucide-react";

import { useI18n } from "../lib/i18n/context";
import { cn } from "../lib/utils";

export type RangeKey = "today" | "7d" | "30d" | "all";

export type RangeValue =
  | { kind: "preset"; key: RangeKey }
  | { kind: "custom"; from: string; to: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** 时间范围选择：预设 + 自定义区间（原型 RangePicker 的受控移植）。 */
export function RangePicker({
  value,
  onChange,
}: {
  value: RangeValue;
  onChange: (v: RangeValue) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 6 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const isCustom = value.kind === "custom";
  const presets: { key: RangeKey; label: string }[] = [
    { key: "today", label: t("skills.agentOverview.range.today") },
    { key: "7d", label: t("skills.agentOverview.range.d7") },
    { key: "30d", label: t("skills.agentOverview.range.d30") },
    { key: "all", label: t("skills.agentOverview.range.all") },
  ];

  return (
    <div
      ref={ref}
      className="relative inline-flex items-center gap-1 rounded-xl bg-surface p-1"
    >
      {presets.map((r) => {
        const active = value.kind === "preset" && value.key === r.key;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => {
              setOpen(false);
              onChange({ kind: "preset", key: r.key });
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
              active
                ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r.label}
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
          isCustom
            ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <CalendarRange className="size-3.5" strokeWidth={1.8} />
        {isCustom ? (
          <span className="aitracker-num font-mono text-[11px]">
            {value.from.slice(5)} → {value.to.slice(5)}
          </span>
        ) : (
          t("skills.agentOverview.range.custom")
        )}
      </button>

      {open && (
        <div className="absolute top-[calc(100%+8px)] right-0 z-30 w-[280px] rounded-xl bg-card p-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block text-[10.5px] uppercase tracking-wide text-muted-foreground">
                {t("skills.agentOverview.range.start")}
              </span>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-lg bg-surface px-2 py-1.5 font-mono text-[11.5px] outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[10.5px] uppercase tracking-wide text-muted-foreground">
                {t("skills.agentOverview.range.end")}
              </span>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-lg bg-surface px-2 py-1.5 font-mono text-[11.5px] outline-none"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => {
              onChange({ kind: "custom", from, to });
              setOpen(false);
            }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-foreground py-1.5 text-[12px] font-semibold text-background"
          >
            <Check className="size-3.5" strokeWidth={2.2} />
            {t("skills.agentOverview.range.apply")}
          </button>
        </div>
      )}
    </div>
  );
}
