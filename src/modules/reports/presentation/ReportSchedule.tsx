import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "../../../lib/i18n/context";
import {
  ScheduleChip,
  ScheduleField,
  ScheduleSectionHeading,
  ScheduleToggle,
} from "../../../shared/ui/schedule-config";
import {
  useReportSchedule,
  type ReportScheduleConfig,
  type ReportScheduleSyncResult,
  type ScheduleGranularity,
} from "./report-schedule.ts";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const CYCLE_OPTIONS: readonly ScheduleGranularity[] = [
  "daily",
  "weekly",
  "monthly",
];

function lastRunText(
  t: ReturnType<typeof useI18n>["t"],
  format: ReturnType<typeof useI18n>["format"],
  status: ReturnType<typeof useReportSchedule>["status"],
): string {
  if (!status?.lastRun) return t("reports.schedule.neverRun");
  return t("reports.schedule.runSummary", {
    time: format.formatDateTime(
      status.lastRun.finishedAt ??
        status.lastRun.startedAt ??
        new Date(0).toISOString(),
      false,
    ),
    result: t(`reports.schedule.runStatus.${status.lastRun.status}`),
  });
}

function cadenceText(
  t: ReturnType<typeof useI18n>["t"],
  schedule: ReportScheduleConfig,
): string {
  if (schedule.granularity === "weekly") {
    return `${t("reports.schedule.weekly")} · ${t(
      `reports.schedule.days.${WEEKDAY_KEYS[schedule.dayOfWeek] ?? "mon"}`,
    )}`;
  }
  if (schedule.granularity === "monthly") {
    return `${t("reports.schedule.monthly")} · ${schedule.dayOfMonth}${t(
      "reports.schedule.monthDaySuffix",
    )}`;
  }
  return t("reports.schedule.daily");
}

/**
 * Report schedule editor. The reports page uses the same collapsed ScheduleBar
 * interaction as Security; Settings keeps the full always-expanded editor.
 */
export function ReportSchedule({
  variant = "card",
}: {
  variant?: "card" | "settings";
}) {
  const { t, format } = useI18n();
  const { schedule, save, loaded, status, statusError, reload } =
    useReportSchedule();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [timeDraft, setTimeDraft] = useState(schedule.time);
  const [monthDayDraft, setMonthDayDraft] = useState(
    String(schedule.dayOfMonth),
  );

  useEffect(() => setTimeDraft(schedule.time), [schedule.time]);
  useEffect(
    () => setMonthDayDraft(String(schedule.dayOfMonth)),
    [schedule.dayOfMonth],
  );

  const showToast = (result: ReportScheduleSyncResult, enabled: boolean) => {
    if (result.ok) {
      toast.success(
        enabled
          ? t("reports.schedule.enabled")
          : t("reports.schedule.disabled"),
      );
    } else {
      toast.error(t("reports.schedule.syncFailed"));
    }
  };

  const saveSchedule = async (next: ReportScheduleConfig) => {
    setSaving(true);
    try {
      const result = await save(next);
      showToast(result, next.enabled);
    } catch {
      toast.error(t("reports.schedule.syncFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (variant === "card") {
    const enabled = loaded && !statusError && schedule.enabled;
    const summary = !loaded
      ? t("common.loading")
      : statusError
        ? t("reports.schedule.loadFailed")
        : enabled
          ? `${cadenceText(t, schedule)} ${schedule.time} · ${t(
              "reports.schedule.enabledLabel",
            )}`
          : t("reports.schedule.disabledLabel");
    const nextRunDetail = !enabled
      ? t("reports.schedule.disabledStatus")
      : status?.pending
        ? t("reports.schedule.pending")
        : status?.nextRunAt
          ? format.formatDateTime(status.nextRunAt, false)
          : t("common.loading");

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
            {t("reports.schedule.title")}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {summary}
          </span>

          <button
            type="button"
            onClick={() =>
              void saveSchedule({
                ...schedule,
                enabled: !schedule.enabled,
                configured: true,
              })
            }
            disabled={!loaded || statusError || saving}
            aria-label={t("reports.schedule.title")}
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
            disabled={!loaded || statusError}
            aria-expanded={open}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("reports.schedule.configure")}
            <ChevronDown
              className={`size-3.5 transition-transform ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        </header>

        {open && loaded && !statusError && (
          <div className="mt-3 divide-y divide-border/40">
            <CompactScheduleRow label={t("reports.schedule.granularity")}>
              {CYCLE_OPTIONS.map((granularity) => (
                <CompactScheduleChip
                  key={granularity}
                  active={schedule.granularity === granularity}
                  disabled={saving}
                  onClick={() =>
                    void saveSchedule({
                      ...schedule,
                      granularity,
                      configured: true,
                    })
                  }
                >
                  {schedule.granularity === granularity && (
                    <Check
                      className="size-3.5"
                      style={{ color: "var(--chart-1)" }}
                    />
                  )}
                  {t(`reports.schedule.${granularity}`)}
                </CompactScheduleChip>
              ))}
            </CompactScheduleRow>

            <CompactScheduleRow label={t("reports.schedule.time")}>
              <span className="inline-flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
                <Clock className="size-3.5 text-muted-foreground" />
                <input
                  type="time"
                  value={timeDraft}
                  disabled={saving}
                  onChange={(event) => setTimeDraft(event.target.value)}
                  onBlur={(event) => {
                    const time = event.currentTarget.value;
                    if (!/^\d{2}:\d{2}$/.test(time)) {
                      setTimeDraft(schedule.time);
                    } else if (time !== schedule.time) {
                      void saveSchedule({
                        ...schedule,
                        time,
                        configured: true,
                      });
                    }
                  }}
                  className="bg-transparent font-mono text-[11.5px] outline-none disabled:opacity-40"
                />
              </span>
              <span className="min-w-0 flex-1 font-mono text-[11px] text-muted-foreground">
                {t("reports.schedule.nextRun")}：{nextRunDetail}
                <Link
                  to="/settings"
                  search={{ section: "reports" }}
                  className="ml-2 underline underline-offset-2 hover:text-foreground"
                >
                  {t("reports.schedule.configure")}
                </Link>
              </span>
            </CompactScheduleRow>
          </div>
        )}
      </section>
    );
  }

  let content: ReactNode;
  if (!loaded) {
    content = (
      <ScheduleField label={t("reports.schedule.title")}>
        <span className="aitracker-text-body text-muted-foreground">
          {t("common.loading")}
        </span>
      </ScheduleField>
    );
  } else if (statusError) {
    content = (
      <div className="aitracker-text-body-sm flex items-start gap-2 rounded-xl bg-warn/10 px-3.5 py-3 text-warn">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium">{t("reports.schedule.loadFailed")}</p>
          <button
            type="button"
            onClick={reload}
            className="aitracker-text-caption mt-1 inline-flex items-center gap-1 hover:opacity-80"
          >
            <RefreshCw className="size-3" />
            {t("common.retry")}
          </button>
        </div>
      </div>
    );
  } else {
    const nextRunDetail = !schedule.enabled
      ? t("reports.schedule.disabledStatus")
      : status?.pending
        ? t("reports.schedule.pending")
        : status?.nextRunAt
          ? format.formatDateTime(status.nextRunAt, false)
          : t("common.loading");
    content = (
      <div>
        <ScheduleField
          label={t("reports.schedule.enable")}
          hint={t("reports.schedule.desc")}
        >
          <ScheduleToggle
            value={schedule.enabled}
            disabled={saving}
            ariaLabel={t("reports.schedule.enable")}
            onChange={(enabled) =>
              void saveSchedule({ ...schedule, enabled, configured: true })
            }
          />
        </ScheduleField>

        <ScheduleField label={t("reports.schedule.granularity")}>
          <div className="flex flex-wrap gap-1.5">
            {CYCLE_OPTIONS.map((granularity) => (
              <ScheduleChip
                key={granularity}
                active={schedule.granularity === granularity}
                disabled={saving}
                onClick={() =>
                  void saveSchedule({
                    ...schedule,
                    granularity,
                    configured: true,
                  })
                }
              >
                {t(`reports.schedule.${granularity}`)}
              </ScheduleChip>
            ))}
          </div>
        </ScheduleField>

        <ScheduleField label={t("reports.schedule.time")}>
          <input
            type="time"
            value={timeDraft}
            onChange={(event) => setTimeDraft(event.target.value)}
            onBlur={(event) => {
              const time = event.currentTarget.value;
              if (!/^\d{2}:\d{2}$/.test(time)) {
                setTimeDraft(schedule.time);
              } else if (time !== schedule.time) {
                void saveSchedule({ ...schedule, time, configured: true });
              }
            }}
            disabled={saving}
            className="security-config-input max-w-[9rem]"
          />
        </ScheduleField>

        {schedule.granularity === "weekly" && (
          <ScheduleField label={t("reports.schedule.weekday")}>
            <div className="flex flex-wrap justify-end gap-1.5">
              {WEEKDAY_KEYS.map((key, index) => (
                <ScheduleChip
                  key={key}
                  active={schedule.dayOfWeek === index}
                  disabled={saving}
                  onClick={() =>
                    void saveSchedule({
                      ...schedule,
                      dayOfWeek: index,
                      configured: true,
                    })
                  }
                >
                  {t(`reports.schedule.days.${key}`)}
                </ScheduleChip>
              ))}
            </div>
          </ScheduleField>
        )}

        {schedule.granularity === "monthly" && (
          <ScheduleField label={t("reports.schedule.monthDay")}>
            <input
              type="number"
              min={1}
              max={31}
              value={monthDayDraft}
              onChange={(event) => setMonthDayDraft(event.target.value)}
              onBlur={(event) => {
                const dayOfMonth = Math.min(
                  31,
                  Math.max(1, Number(event.currentTarget.value) || 1),
                );
                setMonthDayDraft(String(dayOfMonth));
                if (dayOfMonth !== schedule.dayOfMonth) {
                  void saveSchedule({
                    ...schedule,
                    dayOfMonth,
                    configured: true,
                  });
                }
              }}
              disabled={saving}
              className="security-config-input w-20"
            />
          </ScheduleField>
        )}

        <ScheduleField label={t("reports.schedule.lastRun")}>
          <span className="aitracker-text-caption text-right font-mono text-muted-foreground">
            {lastRunText(t, format, status)}
          </span>
        </ScheduleField>

        <ScheduleField
          label={t("reports.schedule.nextRun")}
          hint={t("reports.schedule.processRequiredHint")}
        >
          <span className="aitracker-text-caption text-right font-mono text-muted-foreground">
            {nextRunDetail}
          </span>
        </ScheduleField>
      </div>
    );
  }

  return (
    <div>
      <ScheduleSectionHeading icon={<CalendarClock className="size-3.5" />}>
        {t("reports.schedule.title")}
      </ScheduleSectionHeading>
      {content}
    </div>
  );
}

function CompactScheduleRow({
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

function CompactScheduleChip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-surface-2 text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
