import { Link } from "@tanstack/react-router";
import {
  AlarmClock,
  ArrowRight,
  BellRing,
  CalendarClock,
  Power,
  ShieldOff,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import {
  getDesktopSecurityClient,
  type SecurityClient,
} from "../../query/desktop-client";
import { getBrowserSecurityClient } from "../../query/browser-client";
import type {
  SecurityModelConfigView,
  SecurityScanCycle,
  SecurityScanScheduleView,
} from "../security-view";

const CYCLE_KEYS: Record<SecurityScanCycle, MessageKey> = {
  hourly: "security.center.autoScan.cycle.hourly",
  daily: "security.center.autoScan.cycle.daily",
  weekly: "security.center.autoScan.cycle.weekly",
};

/**
 * 安全页自动扫描引导：读取真实扫描计划（getScanSchedule）与模型配置，
 * 提供开启/暂停开关、周期 + 深度/快速描述与「配置周期」入口。
 * SSR 安全 —— 客户端挂载后才解析 client 并读取计划，未就绪前渲染中性加载态。
 */
export function AutoScanGuide() {
  const { t } = useI18n();
  const [client, setClient] = useState<SecurityClient | null>(null);
  const [schedule, setSchedule] = useState<SecurityScanScheduleView | null>(
    null,
  );
  const [modelConfig, setModelConfig] =
    useState<SecurityModelConfigView | null>(null);
  const [unavailable, setUnavailable] = useState(false);

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
        const [nextSchedule, nextModel] = await Promise.all([
          resolved.getScanSchedule(),
          resolved.getModelConfig(),
        ]);
        if (disposed) return;
        setSchedule(nextSchedule);
        setModelConfig(nextModel);
      } catch {
        if (!disposed) setUnavailable(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (client == null || schedule == null) return;
    try {
      const next = await client.setScanSchedule({
        enabled: !schedule.enabled,
        cycle: schedule.cycle,
      });
      setSchedule(next);
    } catch {
      // 保持当前状态；失败不打断页面
    }
  }, [client, schedule]);

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
  const modelNote = modelConfig?.configured
    ? t("security.center.autoScan.modelFull")
    : t("security.center.autoScan.modelQuick");

  return (
    <section className="rounded-2xl bg-card p-4 shadow-[var(--elev-1)]">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl ${
            enabled ? "bg-ok/15 text-ok" : "bg-surface-2 text-muted-foreground"
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
            {schedule == null
              ? t("security.center.autoScan.loading")
              : enabled
                ? t("security.center.autoScan.scheduleDesc", {
                    cycle: cycleLabel,
                    scope: t("security.center.autoScan.scopeAll"),
                    modelNote,
                  })
                : t("security.center.autoScan.offDesc")}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={schedule == null}
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
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-[11.5px] hover:opacity-80"
          >
            {t("security.center.autoScan.settings")}{" "}
            <ArrowRight className="size-3.5" />
          </Link>
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
  );
}
