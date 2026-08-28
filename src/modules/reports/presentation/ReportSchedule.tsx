import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
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
import type { ReportScheduleStatus } from "../server-fns.ts";
import type { ReportScheduleKind, ReportSchedulesConfig } from "../schedule.ts";
import {
  compactDisabledScheduleKinds,
  compactScheduleSummaryItems,
} from "./compact-schedule-summary.ts";
import {
  useReportSchedule,
  type ReportScheduleSyncResult,
} from "./report-schedule.ts";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const SCHEDULE_KINDS = ["daily", "weekly", "monthly"] as const;
const COMPACT_CONTROL_CLASS =
  "security-config-input h-8 w-[9rem] py-0 text-[11px]";

function lastRunText(
  t: ReturnType<typeof useI18n>["t"],
  format: ReturnType<typeof useI18n>["format"],
  status: ReportScheduleStatus | undefined,
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

export function ReportSchedule({
  variant = "card",
}: {
  variant?: "card" | "settings";
}) {
  const { t, format } = useI18n();
  const { schedule, save, loaded, status, statusError, reload } =
    useReportSchedule();
  const [open, setOpen] = useState(false);
  const [savingKind, setSavingKind] = useState<ReportScheduleKind | null>(null);

  const saveSchedule = async (
    kind: ReportScheduleKind,
    next: ReportSchedulesConfig,
  ) => {
    setSavingKind(kind);
    try {
      const result = await save(next);
      showToast(result, next[kind].enabled, kind);
    } catch {
      toast.error(t("reports.schedule.syncFailed"));
    } finally {
      setSavingKind(null);
    }
  };

  const showToast = (
    result: ReportScheduleSyncResult,
    enabled: boolean,
    kind: ReportScheduleKind,
  ) => {
    if (!result.ok) {
      toast.error(t("reports.schedule.syncFailed"));
      return;
    }
    toast.success(
      t(
        enabled
          ? "reports.schedule.planEnabled"
          : "reports.schedule.planDisabled",
        {
          kind: t(`reports.schedule.kinds.${kind}`),
        },
      ),
    );
  };

  if (variant === "card") {
    const enabledCount = SCHEDULE_KINDS.filter(
      (kind) => schedule[kind].enabled,
    ).length;
    const summaryItems = compactScheduleSummaryItems(schedule, status);
    const disabledKinds = compactDisabledScheduleKinds(schedule);
    let summary: ReactNode;
    if (!loaded) {
      summary = <span>{t("common.loading")}</span>;
    } else if (statusError) {
      summary = <span>{t("reports.schedule.loadFailed")}</span>;
    } else if (summaryItems.length === 0) {
      summary = <span>{t("reports.schedule.allDisabled")}</span>;
    } else {
      summary = (
        <>
          {summaryItems.map((item) => {
            const kind = t(`reports.schedule.kinds.${item.kind}`);
            let detail: string;
            if (item.state === "pending") {
              detail = t("reports.schedule.pending");
            } else if (item.state === "scheduled") {
              detail = format.formatDateTime(item.nextRunAt, false);
            } else {
              detail = t("common.loading");
            }
            return (
              <span key={item.kind} className="whitespace-nowrap">
                {kind} · {detail}
              </span>
            );
          })}
          {disabledKinds.length > 0 && (
            <span className="whitespace-nowrap">
              {t("reports.schedule.disabledKinds", {
                kinds: disabledKinds
                  .map((kind) => t(`reports.schedule.kinds.${kind}`))
                  .join(t("reports.schedule.kindSeparator")),
              })}
            </span>
          )}
        </>
      );
    }

    return (
      <section className="rounded-xl bg-card px-4 py-3">
        <header className="flex flex-wrap items-center gap-3">
          <CalendarClock
            className="size-4 shrink-0"
            style={{
              color:
                enabledCount > 0 ? "var(--chart-1)" : "var(--muted-foreground)",
            }}
          />
          <span className="text-[12.5px] font-semibold tracking-tight">
            {t("reports.schedule.title")}
          </span>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
            {summary}
          </div>
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
            {SCHEDULE_KINDS.map((kind) => (
              <CompactPlanEditor
                key={kind}
                kind={kind}
                schedule={schedule}
                status={status?.[kind]}
                saving={savingKind !== null}
                onSave={(next) => void saveSchedule(kind, next)}
              />
            ))}
            <div className="flex justify-end pt-3">
              <Link
                to="/settings"
                search={{ section: "reports" }}
                className="font-mono text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {t("reports.schedule.openSettings")}
              </Link>
            </div>
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
    content = (
      <div className="space-y-3">
        {SCHEDULE_KINDS.map((kind) => (
          <SettingsPlanEditor
            key={kind}
            kind={kind}
            schedule={schedule}
            status={status?.[kind]}
            saving={savingKind !== null}
            onSave={(next) => void saveSchedule(kind, next)}
            lastRun={lastRunText(t, format, status?.[kind])}
          />
        ))}
        <p className="aitracker-text-caption text-muted-foreground">
          {t("reports.schedule.processRequiredHint")}
        </p>
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

function CompactPlanEditor({
  kind,
  schedule,
  status,
  saving,
  onSave,
}: {
  kind: ReportScheduleKind;
  schedule: ReportSchedulesConfig;
  status: ReportScheduleStatus | undefined;
  saving: boolean;
  onSave: (next: ReportSchedulesConfig) => void;
}) {
  const { t, format } = useI18n();
  const plan = schedule[kind];
  return (
    <div className="py-3 last:pb-0">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium">
          {t(`reports.schedule.kinds.${kind}`)}
        </span>
        <ScheduleToggle
          value={plan.enabled}
          disabled={saving}
          ariaLabel={t("reports.schedule.toggleKind", {
            kind: t(`reports.schedule.kinds.${kind}`),
          })}
          onChange={(enabled) =>
            onSave({ ...schedule, [kind]: { ...plan, enabled } })
          }
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {kind === "weekly" && (
          <WeekdayPicker
            value={schedule.weekly.dayOfWeek}
            disabled={saving}
            compact
            onChange={(dayOfWeek) =>
              onSave({
                ...schedule,
                weekly: { ...schedule.weekly, dayOfWeek },
              })
            }
          />
        )}
        {kind === "monthly" && (
          <MonthDayInput
            value={schedule.monthly.dayOfMonth}
            disabled={saving}
            compact
            onCommit={(dayOfMonth) =>
              onSave({
                ...schedule,
                monthly: { ...schedule.monthly, dayOfMonth },
              })
            }
          />
        )}
        <TimeInput
          value={plan.time}
          disabled={saving}
          compact
          onCommit={(time) =>
            onSave({ ...schedule, [kind]: { ...plan, time } })
          }
        />
        {plan.enabled && (
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {status?.pending
              ? t("reports.schedule.pending")
              : status?.nextRunAt
                ? `${t("reports.schedule.nextRun")} ${format.formatDateTime(
                    status.nextRunAt,
                    false,
                  )}`
                : t("common.loading")}
          </span>
        )}
      </div>
    </div>
  );
}

function SettingsPlanEditor({
  kind,
  schedule,
  status,
  saving,
  onSave,
  lastRun,
}: {
  kind: ReportScheduleKind;
  schedule: ReportSchedulesConfig;
  status: ReportScheduleStatus | undefined;
  saving: boolean;
  onSave: (next: ReportSchedulesConfig) => void;
  lastRun: string;
}) {
  const { t, format } = useI18n();
  const plan = schedule[kind];
  return (
    <section className="rounded-xl bg-surface-1 px-3.5 py-2.5">
      <ScheduleField
        label={t(`reports.schedule.kinds.${kind}`)}
        hint={t(`reports.schedule.kindHints.${kind}`)}
      >
        <ScheduleToggle
          value={plan.enabled}
          disabled={saving}
          ariaLabel={t("reports.schedule.toggleKind", {
            kind: t(`reports.schedule.kinds.${kind}`),
          })}
          onChange={(enabled) =>
            onSave({ ...schedule, [kind]: { ...plan, enabled } })
          }
        />
      </ScheduleField>
      {kind === "weekly" && (
        <ScheduleField label={t("reports.schedule.weekday")}>
          <WeekdayPicker
            value={schedule.weekly.dayOfWeek}
            disabled={saving}
            onChange={(dayOfWeek) =>
              onSave({
                ...schedule,
                weekly: { ...schedule.weekly, dayOfWeek },
              })
            }
          />
        </ScheduleField>
      )}
      {kind === "monthly" && (
        <ScheduleField
          label={t("reports.schedule.monthDay")}
          hint={t("reports.schedule.monthDayHint")}
        >
          <MonthDayInput
            value={schedule.monthly.dayOfMonth}
            disabled={saving}
            onCommit={(dayOfMonth) =>
              onSave({
                ...schedule,
                monthly: { ...schedule.monthly, dayOfMonth },
              })
            }
          />
        </ScheduleField>
      )}
      <ScheduleField label={t("reports.schedule.time")}>
        <TimeInput
          value={plan.time}
          disabled={saving}
          onCommit={(time) =>
            onSave({ ...schedule, [kind]: { ...plan, time } })
          }
        />
      </ScheduleField>
      <ScheduleField label={t("reports.schedule.lastRun")}>
        <span className="aitracker-text-caption text-right font-mono text-muted-foreground">
          {lastRun}
        </span>
      </ScheduleField>
      <ScheduleField label={t("reports.schedule.nextRun")}>
        <span className="aitracker-text-caption text-right font-mono text-muted-foreground">
          {!plan.enabled
            ? t("reports.schedule.disabledStatus")
            : status?.pending
              ? t("reports.schedule.pending")
              : status?.nextRunAt
                ? format.formatDateTime(status.nextRunAt, false)
                : t("common.loading")}
        </span>
      </ScheduleField>
    </section>
  );
}

function TimeInput({
  value,
  disabled,
  compact = false,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  compact?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <span
      className={
        compact
          ? `${COMPACT_CONTROL_CLASS} inline-flex items-center gap-2`
          : "inline-flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5"
      }
      style={compact ? { width: "9rem", height: "2rem" } : undefined}
    >
      <Clock className="size-3.5 text-muted-foreground" />
      <input
        type="time"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          const time = event.currentTarget.value;
          if (!/^\d{2}:\d{2}$/.test(time)) setDraft(value);
          else if (time !== value) onCommit(time);
        }}
        className={`min-w-0 flex-1 bg-transparent font-mono outline-none disabled:opacity-40 ${
          compact ? "text-[11px]" : "text-[11.5px]"
        }`}
      />
    </span>
  );
}

function WeekdayPicker({
  value,
  disabled,
  compact = false,
  onChange,
}: {
  value: number;
  disabled: boolean;
  compact?: boolean;
  onChange: (value: number) => void;
}) {
  const { t } = useI18n();
  if (compact) {
    return (
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className={COMPACT_CONTROL_CLASS}
        style={{ width: "9rem", height: "2rem" }}
      >
        {WEEKDAY_KEYS.map((key, index) => (
          <option key={key} value={index}>
            {t(`reports.schedule.days.${key}`)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {WEEKDAY_KEYS.map((key, index) => (
        <ScheduleChip
          key={key}
          active={value === index}
          disabled={disabled}
          onClick={() => onChange(index)}
        >
          {t(`reports.schedule.days.${key}`)}
        </ScheduleChip>
      ))}
    </div>
  );
}

function MonthDayInput({
  value,
  disabled,
  compact = false,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  compact?: boolean;
  onCommit: (value: number) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <span
      className={
        compact
          ? `${COMPACT_CONTROL_CLASS} inline-flex items-center gap-1.5`
          : "inline-flex items-center gap-1.5"
      }
      style={compact ? { width: "9rem", height: "2rem" } : undefined}
    >
      <input
        type="number"
        min={1}
        max={31}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          const day = Math.min(
            31,
            Math.max(1, Number(event.currentTarget.value) || 1),
          );
          setDraft(String(day));
          if (day !== value) onCommit(day);
        }}
        disabled={disabled}
        className={
          compact
            ? "min-w-0 flex-1 bg-transparent font-mono outline-none"
            : "security-config-input h-8 w-16 py-0 text-[11px]"
        }
        style={compact ? undefined : { width: "4rem", height: "2rem" }}
      />
      <span className="font-mono text-[11px] text-muted-foreground">
        {t("reports.schedule.monthDaySuffix")}
      </span>
    </span>
  );
}
