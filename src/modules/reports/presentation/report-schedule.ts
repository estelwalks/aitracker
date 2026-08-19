import { useCallback, useEffect, useRef, useState } from "react";

import { syncReportScheduleToTasks } from "../server-fns.ts";
import {
  getPreference,
  setPreference,
} from "../../../lib/preferences/client.ts";

/**
 * ReportSchedule configuration persistence + scheduler sync.
 *
 * The config persists to SQLite `app_preferences` (key `tt.report.schedule`).
 * Browser and Electron renderers use the same server-owned preference client. Every save additionally
 * syncs the config into the task scheduler's `reports.generate` preference via
 * `syncReportScheduleToTasks` (Story B-200), so the persisted config actually
 * drives scheduled generation — a sync failure never blocks the local save.
 */
export type ScheduleGranularity = "daily" | "weekly" | "monthly";

export interface ReportScheduleConfig {
  /** False until the user has saved at least once ("configured"). */
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly granularity: ScheduleGranularity;
  /** 24h `HH:MM` (prototype recommends 18:30). */
  readonly time: string;
  /** 0 = Monday … 6 = Sunday; only used for weekly granularity. */
  readonly dayOfWeek: number;
  /** 1–31; only used for monthly granularity. */
  readonly dayOfMonth: number;
}

/** Outcome of syncing the config into the task scheduler. */
export interface ReportScheduleSyncResult {
  readonly ok: boolean;
  readonly errorCode?: string;
}

export const DEFAULT_REPORT_SCHEDULE: ReportScheduleConfig = {
  configured: false,
  enabled: false,
  granularity: "daily",
  time: "18:30",
  dayOfWeek: 1,
  dayOfMonth: 1,
};

const SCHEDULE_KEY = "tt.report.schedule";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isScheduleGranularity(value: unknown): value is ScheduleGranularity {
  return value === "daily" || value === "weekly" || value === "monthly";
}

export function parseReportSchedule(raw: string | null): ReportScheduleConfig {
  if (!raw) return DEFAULT_REPORT_SCHEDULE;
  try {
    const value = JSON.parse(raw) as Partial<ReportScheduleConfig>;
    const clampDayOfWeek = (n: unknown): number =>
      typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6
        ? n
        : DEFAULT_REPORT_SCHEDULE.dayOfWeek;
    const clampDayOfMonth = (n: unknown): number =>
      typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 31
        ? n
        : DEFAULT_REPORT_SCHEDULE.dayOfMonth;
    return {
      configured:
        typeof value.configured === "boolean"
          ? value.configured
          : DEFAULT_REPORT_SCHEDULE.configured,
      enabled:
        typeof value.enabled === "boolean"
          ? value.enabled
          : DEFAULT_REPORT_SCHEDULE.enabled,
      granularity: isScheduleGranularity(value.granularity)
        ? value.granularity
        : DEFAULT_REPORT_SCHEDULE.granularity,
      time:
        typeof value.time === "string" && TIME_RE.test(value.time)
          ? value.time
          : DEFAULT_REPORT_SCHEDULE.time,
      dayOfWeek: clampDayOfWeek(value.dayOfWeek),
      dayOfMonth: clampDayOfMonth(value.dayOfMonth),
    };
  } catch {
    return DEFAULT_REPORT_SCHEDULE;
  }
}

export function serializeReportSchedule(config: ReportScheduleConfig): string {
  return JSON.stringify(config);
}

async function loadFromPlatform(): Promise<string | null> {
  const value = await getPreference(SCHEDULE_KEY);
  return typeof value === "string" ? value : null;
}

async function saveToPlatform(serialized: string): Promise<void> {
  await setPreference(SCHEDULE_KEY, serialized);
}

/**
 * Push the current config into the task scheduler's `reports.generate`
 * preference. A transport/validation failure degrades to `{ ok: false }` and
 * never blocks the local save — the scheduler state simply stays as it was.
 */
async function syncScheduleToTasks(
  config: ReportScheduleConfig,
): Promise<ReportScheduleSyncResult> {
  try {
    const result = await syncReportScheduleToTasks({ data: config });
    return result.ok
      ? { ok: true }
      : { ok: false, errorCode: result.errorCode };
  } catch {
    return { ok: false };
  }
}

/**
 * Read the schedule once from SQLite and retain the latest value in memory for
 * toggle operations.
 */
export function useReportSchedule(): {
  schedule: ReportScheduleConfig;
  /** Persist a full config (marks it configured) and sync it to the task scheduler. */
  save: (next: ReportScheduleConfig) => Promise<ReportScheduleSyncResult>;
  /** Toggle enabled without flipping the "configured" flag; syncs to the scheduler. */
  setEnabled: (enabled: boolean) => Promise<ReportScheduleSyncResult>;
  loaded: boolean;
} {
  const [schedule, setSchedule] = useState<ReportScheduleConfig>(
    DEFAULT_REPORT_SCHEDULE,
  );
  const [loaded, setLoaded] = useState(false);
  const lastSavedRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const raw = await loadFromPlatform();
      if (cancelled) return;
      const parsed = parseReportSchedule(raw);
      setSchedule(parsed);
      lastSavedRef.current = serializeReportSchedule(parsed);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(
    async (next: ReportScheduleConfig): Promise<ReportScheduleSyncResult> => {
      const serialized = serializeReportSchedule(next);
      lastSavedRef.current = serialized;
      setSchedule(next);
      await saveToPlatform(serialized);
      return syncScheduleToTasks(next);
    },
    [],
  );

  const save = useCallback(
    async (next: ReportScheduleConfig) => {
      return persist({ ...next, configured: true });
    },
    [persist],
  );

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      const current =
        lastSavedRef.current.length > 0
          ? parseReportSchedule(lastSavedRef.current)
          : schedule;
      return persist({ ...current, enabled });
    },
    [persist, schedule],
  );

  return { schedule, save, setEnabled, loaded };
}
