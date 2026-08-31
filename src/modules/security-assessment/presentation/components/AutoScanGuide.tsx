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
import {
  resolveNextScheduledScanAt,
  type SecurityScanCycle,
  type SecurityScanScheduleView,
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
 * Automatic security-scan schedule card aligned with the reference design.
 *
 * The header is "Status Line + Switch + Settings". After expansion, there are only two lines (cycle/time).
 * There are no further steps below. Read and write the real scan schedule (getScanSchedule/setScanSchedule),
 * "Adjustment range" jumps to the /settings full scan configuration page.
 * SSR security - the client is parsed and the plan is read only after the client is mounted, and the neutral loading state is rendered before it is ready.
 */
export function AutoScanGuide({
  onNextScanAtChange,
}: {
  onNextScanAtChange?: (nextScanAt: string | null) => void;
}) {
  const { t } = useI18n();
  const [client, setClient] = useState<SecurityClient | null>(null);
  const [schedule, setSchedule] = useState<SecurityScanScheduleView | null>(
    null,
  );
  const [unavailable, setUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);

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
        const nextStatus = await resolved
          .getScanScheduleStatus()
          .catch(() => null);
        if (disposed) return;
        setSchedule(nextSchedule);
        setTimeDraft(nextSchedule.time);
        onNextScanAtChange?.(
          resolveNextScheduledScanAt(nextSchedule, nextStatus),
        );
      } catch {
        if (!disposed) setUnavailable(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [onNextScanAtChange]);

  const save = useCallback(
    async (patch: Partial<SecurityScanScheduleView>) => {
      if (client == null || schedule == null) return;
      const previous = schedule;
      // Always expand the complete schedule before writing a single field, and never reconstruct partial objects.
      const next = { ...schedule, ...patch };
      setSchedule(next);
      setSaving(true);
      try {
        const saved = await client.setScanSchedule(next);
        setSchedule(saved);
        if (patch.time !== undefined) setTimeDraft(saved.time);
        const status = await client.getScanScheduleStatus().catch(() => null);
        onNextScanAtChange?.(resolveNextScheduledScanAt(saved, status));
      } catch {
        setSchedule(previous);
        if (patch.time !== undefined) setTimeDraft(previous.time);
        toast.error(t("security.center.autoScan.saveFailed"));
      } finally {
        setSaving(false);
      }
    },
    [client, onNextScanAtChange, schedule, t],
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
                value={timeDraft ?? schedule.time}
                disabled={schedule.cycle === "hourly" || saving}
                onChange={(event) => setTimeDraft(event.target.value)}
                onBlur={(event) => {
                  const time = event.currentTarget.value;
                  if (!/^\d{2}:\d{2}$/.test(time)) {
                    setTimeDraft(schedule.time);
                  } else if (time !== schedule.time) {
                    void save({ time });
                  }
                }}
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
