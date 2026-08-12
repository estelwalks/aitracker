import { Link } from "@tanstack/react-router";
import {
  AlarmClock,
  ArrowRight,
  BellRing,
  CalendarClock,
  Power,
  Settings2,
  ShieldOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Segmented } from "../../../../components/tt";
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

/** 卡片内小号开关（与设置页 Toggle 视觉一致）。 */
function InlineToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
        value ? "bg-primary" : "border border-border bg-surface-2"
      } disabled:cursor-not-allowed disabled:opacity-50`}
      aria-pressed={value}
    >
      <span
        className="block size-4 rounded-full bg-background transition-transform"
        style={{ transform: value ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

/**
 * 安全页自动扫描引导：读取真实扫描计划（getScanSchedule），提供开启/暂停开关与
 * 「设置」内联快速设置弹层（定时扫描/扫描周期/扫描时间/告警通知），全部就地编辑。
 * 只有扫描时间行的「调整范围」会跳转到 /settings 全量扫描配置页。
 * SSR 安全 —— 客户端挂载后才解析 client 并读取计划，未就绪前渲染中性加载态。
 */
export function AutoScanGuide() {
  const { t } = useI18n();
  const [client, setClient] = useState<SecurityClient | null>(null);
  const [schedule, setSchedule] = useState<SecurityScanScheduleView | null>(
    null,
  );
  const [unavailable, setUnavailable] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
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
      <section className="rounded-2xl bg-card p-4 shadow-[var(--elev-1)]">
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
  const cycleLabel = schedule ? t(CYCLE_KEYS[schedule.cycle]) : "—";

  const scheduleLine =
    schedule == null
      ? t("security.center.autoScan.loading")
      : enabled
        ? [
            cycleLabel,
            schedule.cycle === "hourly"
              ? null
              : `${t("security.center.autoScan.time")}：${schedule.time}`,
            `${t("security.center.autoScan.scope")}：${t(
              "security.center.autoScan.scopeAll",
            )}`,
            `${t("security.center.autoScan.notify")}：${
              schedule.notify
                ? t("security.center.autoScan.notifyOn")
                : t("security.center.autoScan.notifyOff")
            }`,
          ]
            .filter(Boolean)
            .join(" · ")
        : t("security.center.autoScan.offDesc");

  return (
    <div className="space-y-2">
      <section className="rounded-2xl bg-card p-4 shadow-[var(--elev-1)]">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`grid size-9 shrink-0 place-items-center rounded-xl ${
              enabled
                ? "bg-ok/15 text-ok"
                : "bg-surface-2 text-muted-foreground"
            }`}
          >
            <CalendarClock className="size-4" strokeWidth={2} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold tracking-tight">
                {t("security.center.autoScan.title")}
              </h3>
              <span
                className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                  enabled
                    ? "bg-ok/15 text-ok"
                    : "bg-surface-2 text-muted-foreground"
                }`}
              >
                {enabled
                  ? t("security.center.autoScan.enabled")
                  : t("security.center.autoScan.disabled")}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
              {scheduleLine}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={schedule == null || saving}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 ${
                enabled ? "bg-surface-2 text-foreground" : "text-white"
              }`}
              style={enabled ? undefined : { background: "var(--chart-1)" }}
            >
              <Power className="size-3.5" strokeWidth={2} />
              {enabled
                ? t("security.center.autoScan.pause")
                : t("security.center.autoScan.enable")}
            </button>
            <button
              type="button"
              onClick={() => setPopoverOpen((open) => !open)}
              aria-expanded={popoverOpen}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] transition-opacity hover:opacity-80 ${
                popoverOpen
                  ? "bg-foreground text-background"
                  : "bg-surface-2 text-foreground"
              }`}
            >
              {t("security.center.autoScan.settings")}
              <Settings2 className="size-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>

        <ol className="mt-3 grid gap-2 sm:grid-cols-3">
          {[
            {
              icon: Power,
              title: t("security.center.autoScan.stepSchedule"),
              desc: t("security.center.autoScan.stepScheduleDesc"),
            },
            {
              icon: AlarmClock,
              title: t("security.center.autoScan.stepCycle"),
              desc:
                schedule == null
                  ? t("security.center.autoScan.loading")
                  : t("security.center.autoScan.stepCycleDesc", {
                      cycle: cycleLabel,
                    }),
            },
            {
              icon: BellRing,
              title: t("security.center.autoScan.stepAlert"),
              desc: t("security.center.autoScan.stepAlertDesc"),
            },
          ].map((step) => (
            <li
              key={step.title}
              className="flex items-start gap-2 rounded-xl bg-surface px-3 py-2.5"
            >
              <step.icon
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                strokeWidth={2}
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">
                  {step.title}
                </span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                  {step.desc}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {popoverOpen && schedule != null && (
        <section className="rounded-2xl bg-card p-4 shadow-[var(--elev-1)] ring-1 ring-border/60">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold tracking-tight">
              {t("security.center.autoScan.settingsTitle")}
            </h3>
            <button
              type="button"
              onClick={() => setPopoverOpen(false)}
              aria-label={t("security.center.autoScan.close")}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          </div>

          <div className={saving ? "pointer-events-none opacity-60" : ""}>
            <div className="flex items-center justify-between gap-3 border-b border-border py-2.5">
              <span className="text-[13px]">
                {t("security.center.autoScan.enabledLabel")}
              </span>
              <InlineToggle
                value={schedule.enabled}
                onChange={(enabled) => void save({ enabled })}
                disabled={saving}
              />
            </div>

            <div className="border-b border-border py-2.5">
              <div className="mb-1.5 text-[13px]">
                {t("security.center.autoScan.cycleLabel")}
              </div>
              <Segmented
                value={schedule.cycle}
                onChange={(cycle) => void save({ cycle })}
                options={CYCLE_OPTIONS.map((cycle) => ({
                  value: cycle,
                  label: t(CYCLE_KEYS[cycle]),
                }))}
              />
            </div>

            <div className="border-b border-border py-2.5">
              <div className="mb-1.5 text-[13px]">
                {t("security.center.autoScan.time")}
              </div>
              <div className="flex items-center justify-between gap-3">
                <input
                  type="time"
                  value={schedule.time}
                  onChange={(event) => void save({ time: event.target.value })}
                  disabled={saving}
                  className="security-config-input max-w-[9rem]"
                />
                <Link
                  to="/settings"
                  onClick={() => setPopoverOpen(false)}
                  className="inline-flex items-center gap-1 text-[11.5px] text-primary hover:opacity-80"
                >
                  {t("security.center.autoScan.timeRange")}
                  <ArrowRight className="size-3.5" strokeWidth={2} />
                </Link>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2.5">
              <span className="text-[13px]">
                {t("security.center.autoScan.notify")}
              </span>
              <InlineToggle
                value={schedule.notify}
                onChange={(notify) => void save({ notify })}
                disabled={saving}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
