import { Link } from "@tanstack/react-router";
import {
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  ShieldOff,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import {
  getDesktopSecurityClient,
  type SecurityClient,
} from "../../query/desktop-client";
import { getBrowserSecurityClient } from "../../query/browser-client";
import type {
  SecurityScanCycle,
  SecurityScanScheduleView,
} from "../security-view";

const CYCLE_KEYS: Record<SecurityScanCycle, MessageKey> = {
  hourly: "security.center.autoScan.cycle.hourly",
  daily: "security.center.autoScan.cycle.daily",
  weekly: "security.center.autoScan.cycle.weekly",
};

const CYCLE_OPTIONS: readonly SecurityScanCycle[] = [
  "hourly",
  "daily",
  "weekly",
];

/**
 * 安全页自动扫描定时：与 V3.0 原型 ScheduleBar 对齐的卡片。
 *
 * 头部为「状态行 + 开关 + 设置」，展开后仅两行（周期 / 时间），
 * 下方不再有说明步骤。读写真实扫描计划（getScanSchedule/setScanSchedule），
 * 「调整范围」跳转 /settings 全量扫描配置页。
 * SSR 安全 —— 客户端挂载后才解析 client 并读取计划，未就绪前渲染中性加载态。
 */
export function AutoScanGuide() {
  const { t } = useI18n();
  const [client, setClient] = useState<SecurityClient | null>(null);
  const [schedule, setSchedule] = useState<SecurityScanScheduleView | null>(
    null,
  );
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const resolved =
        getDesktopSecurityClient() ?? (await getBrowserSecurityClient());
      if (disposed) return;
      if (resolved == null) {
        setUnavailable(true);
        return;
      }
      setClient(resolved);
      try {
        const nextSchedule = await resolved.getScanSchedule();
        if (disposed) return;
        setSchedule(nextSchedule);
      } catch {
        if (!disposed) setUnavailable(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  const save = useCallback(
    async (patch: Partial<SecurityScanScheduleView>) => {
      if (client == null || schedule == null) return;
      const previous = schedule;
      // 永远展开完整 schedule 再写单个字段，绝不重构部分对象。
      const next = { ...schedule, ...patch };
      setSchedule(next);
      setSaving(true);
      try {
        const saved = await client.setScanSchedule(next);
        setSchedule(saved);
      } catch {
        setSchedule(previous);
        toast.error(t("security.center.autoScan.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [client, schedule, t],
  );

  const toggle = useCallback(() => {
    if (schedule == null) return;
    void save({ enabled: !schedule.enabled });
  }, [save, schedule]);

  if (unavailable) {
    return (
      <section className="rounded-xl bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
            <ShieldOff className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold tracking-tight">
                {t("security.center.autoScan.title")}
              </h3>
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                {t("security.center.autoScan.unavailable")}
              </span>
            </div>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">
              {t("security.center.autoScan.unavailableDesc")}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const enabled = schedule?.enabled ?? false;
  const cycleLabel = schedule
    ? schedule.cycle === "hourly"
      ? t(CYCLE_KEYS[schedule.cycle])
      : `${t(CYCLE_KEYS[schedule.cycle])} ${schedule.time}`
    : "";
  const scopeLabel = schedule
    ? schedule.scope === "agent"
      ? t("security.center.autoScan.scopeAgent")
      : schedule.scope === "dir"
        ? t("security.center.autoScan.scopeDir", {
            dir: schedule.dir ?? "",
          })
        : t("security.center.autoScan.scopeAll")
    : "";
  const status =
    schedule == null
      ? t("security.center.autoScan.loading")
      : enabled
        ? t("security.center.autoScan.triggered", {
            cycle: cycleLabel,
            scope: scopeLabel,
          })
        : t("security.center.autoScan.offDesc");

  return (
    <section className="rounded-xl bg-card px-4 py-3">
      <header className="flex flex-wrap items-center gap-3">
        <CalendarClock
          className="size-4 shrink-0"
          style={{
            color: enabled ? "var(--chart-1)" : "var(--muted-foreground)",
          }}
        />
        <span className="text-[12.5px] font-semibold tracking-tight">
          {t("security.center.autoScan.title")}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {status}
        </span>

        <button
          type="button"
          onClick={() => void toggle()}
          disabled={schedule == null || saving}
          aria-label={t("security.center.autoScan.title")}
          className="relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            background: enabled ? "var(--chart-1)" : "var(--surface-2, #333)",
          }}
        >
          <span
            className="absolute top-0.5 size-4 rounded-full bg-white transition-all"
            style={{ left: enabled ? 18 : 2 }}
          />
        </button>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("security.center.autoScan.settings")}
          <ChevronDown
            className={`size-3.5 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
      </header>

      {open && schedule != null && (
        <div className="mt-3 divide-y divide-border/40">
          <ScheduleRow label={t("security.center.autoScan.cycleLabel")}>
            {CYCLE_OPTIONS.map((cycle) => (
              <ScheduleChip
                key={cycle}
                active={schedule.cycle === cycle}
                onClick={() => void save({ cycle })}
              >
                {schedule.cycle === cycle && (
                  <Check
                    className="size-3.5"
                    style={{ color: "var(--chart-1)" }}
                  />
                )}
                {t(CYCLE_KEYS[cycle])}
              </ScheduleChip>
            ))}
          </ScheduleRow>

          <ScheduleRow label={t("security.center.autoScan.time")}>
            <span className="inline-flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
              <Clock className="size-3.5 text-muted-foreground" />
              <input
                type="time"
                value={schedule.time}
                disabled={schedule.cycle === "hourly" || saving}
                onChange={(event) => void save({ time: event.target.value })}
                className="bg-transparent font-mono text-[11.5px] outline-none disabled:opacity-40"
              />
            </span>
            <span className="min-w-0 flex-1 font-mono text-[11px] text-muted-foreground">
              {t("security.center.autoScan.scope")}：{scopeLabel}
              <Link
                to="/settings"
                search={{ section: "scan" }}
                className="ml-2 underline underline-offset-2 hover:text-foreground"
              >
                {t("security.center.autoScan.timeRange")}
              </Link>
            </span>
          </ScheduleRow>
        </div>
      )}
    </section>
  );
}

function ScheduleRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3 last:pb-0">
      <span className="w-[64px] shrink-0 font-mono text-[11px] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function ScheduleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? "bg-surface-2 text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
