import { useState } from "react";
import { AlarmClock, ChevronDown, ChevronUp, Zap } from "lucide-react";
import { toast } from "sonner";

import { Segmented, TTButton } from "../../../components/tt";
import { Switch } from "../../../components/ui/switch";
import { useI18n } from "../../../lib/i18n/context";
import {
  useReportSchedule,
  type ReportScheduleConfig,
  type ReportScheduleSyncResult,
  type ScheduleGranularity,
} from "./report-schedule.ts";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

function summaryFor(
  t: ReturnType<typeof useI18n>["t"],
  schedule: ReportScheduleConfig,
): string {
  if (schedule.granularity === "weekly") {
    return `${t("reports.schedule.weekly")} · ${t(
      `reports.schedule.days.${WEEKDAY_KEYS[schedule.dayOfWeek] ?? "mon"}`,
    )} ${schedule.time}`;
  }
  if (schedule.granularity === "monthly") {
    return `${t("reports.schedule.monthly")} · ${schedule.dayOfMonth}日 ${schedule.time}`;
  }
  return `${t("reports.schedule.daily")} ${schedule.time}`;
}

/**
 * 自动定时生成 (ReportSchedule). When never configured it renders the first-run
 * guide card ("开启自动定时生成"); once saved it shows a status bar + switch +
 * cadence/time/weekday settings. Persistence is `tt.report.schedule` (Electron
 * SQLite application preferences) and every save/toggle syncs the
 * config into the task scheduler's `reports.generate` preference (Story B-200)
 * — see `report-schedule.ts`. A sync failure shows an error toast but never
 * blocks the local save.
 */
export function ReportSchedule() {
  const { t } = useI18n();
  const { schedule, save, setEnabled, loaded } = useReportSchedule();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ReportScheduleConfig>(schedule);

  if (!loaded) return null;

  const beginConfigure = () => {
    setDraft({ ...schedule, enabled: true });
    setEditing(true);
  };

  const showSyncToast = (
    result: ReportScheduleSyncResult,
    enabled: boolean,
  ) => {
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

  const handleSave = async () => {
    const result = await save(draft);
    setEditing(false);
    showSyncToast(result, draft.enabled);
  };

  const handleToggle = async (next: boolean) => {
    const result = await setEnabled(next);
    showSyncToast(result, next);
  };

  // First-run guide card.
  if (!schedule.configured && !editing) {
    return (
      <section className="tt-panel mt-3 flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <AlarmClock className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[13px] font-medium tracking-[0.025em]">
                {t("reports.schedule.title")}
              </h2>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {t("reports.schedule.desc")}
              </p>
            </div>
          </div>
          <TTButton variant="primary" onClick={beginConfigure}>
            <Zap className="size-3.5" />
            {t("reports.schedule.enable")}
          </TTButton>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <span className="rounded-full bg-surface-2 px-2.5 py-1">
            {t("reports.schedule.recommend")}
          </span>
          <span>{t("reports.schedule.editorNote")}</span>
        </div>
      </section>
    );
  }

  // Configured status bar (or active edit panel).
  return (
    <section className="tt-panel mt-3 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <AlarmClock className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-medium tracking-[0.025em]">
              {t("reports.schedule.title")}
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {schedule.enabled
                ? t("reports.schedule.enabledLabel")
                : t("reports.schedule.disabledLabel")}
              {schedule.configured ? ` · ${summaryFor(t, schedule)}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={schedule.enabled}
            onCheckedChange={(next) => void handleToggle(next)}
            aria-label={t("reports.schedule.enable")}
          />
          <TTButton
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(schedule);
              setEditing((value) => !value);
            }}
          >
            {editing ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
            {editing ? t("common.cancel") : t("reports.schedule.configure")}
          </TTButton>
        </div>
      </div>

      {editing && (
        <div className="border-t border-border px-5 py-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <span className="tt-label block text-[11px] text-muted-foreground">
                {t("reports.schedule.granularity")}
              </span>
              <Segmented<ScheduleGranularity>
                value={draft.granularity}
                onChange={(granularity) =>
                  setDraft((current) => ({ ...current, granularity }))
                }
                options={[
                  { value: "daily", label: t("reports.schedule.daily") },
                  { value: "weekly", label: t("reports.schedule.weekly") },
                  { value: "monthly", label: t("reports.schedule.monthly") },
                ]}
              />
            </div>

            <div className="space-y-1.5">
              <span className="tt-label block text-[11px] text-muted-foreground">
                {t("reports.schedule.time")}
              </span>
              <input
                type="time"
                value={draft.time}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    time: event.target.value,
                  }))
                }
                className="h-8 rounded-lg bg-surface-2/70 px-2 font-mono text-[12px] outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            {draft.granularity === "weekly" && (
              <div className="space-y-1.5">
                <span className="tt-label block text-[11px] text-muted-foreground">
                  {t("reports.schedule.weekday")}
                </span>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAY_KEYS.map((key, index) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          dayOfWeek: index,
                        }))
                      }
                      aria-pressed={draft.dayOfWeek === index}
                      className={`h-8 min-w-8 rounded-lg px-2 text-[12px] transition-colors ${
                        draft.dayOfWeek === index
                          ? "bg-foreground font-medium text-background"
                          : "bg-surface-2/70 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t(`reports.schedule.days.${key}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {draft.granularity === "monthly" && (
              <div className="space-y-1.5">
                <span className="tt-label block text-[11px] text-muted-foreground">
                  {t("reports.schedule.monthDay")}
                </span>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={draft.dayOfMonth}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      dayOfMonth: Math.min(
                        31,
                        Math.max(1, Number(event.target.value) || 1),
                      ),
                    }))
                  }
                  className="h-8 w-20 rounded-lg bg-surface-2/70 px-2 font-mono text-[12px] outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <TTButton variant="primary" onClick={() => void handleSave()}>
              {t("reports.schedule.save")}
            </TTButton>
            <span className="text-[11px] text-muted-foreground">
              {t("reports.schedule.editorNote")}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
