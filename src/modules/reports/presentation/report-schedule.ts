import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ReportSchedule configuration persistence.
 *
 * Honest boundary: there is no background scheduler in the browser SSR runtime
 * (that is an Electron follow-up), so this config is persisted only — the
 * "定时" behavior stays a manual "立即生成" until the desktop main process wires
 * a scheduler. Persistence mirrors `src/lib/settings/store.ts`'s pattern: write
 * to the Electron preference store when `window.desktopApi` is present (key
 * `tt.report.schedule`, matching the prototype), and always mirror to
 * localStorage so browser dev mode behaves the same.
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
  const api = window.desktopApi;
  if (api) {
    try {
      const prefs = await api.getPreferences();
      return typeof prefs[SCHEDULE_KEY] === "string"
        ? (prefs[SCHEDULE_KEY] as string)
        : null;
    } catch {
      // IPC unavailable; fall through to localStorage
    }
  }
  return null;
}

async function saveToPlatform(serialized: string): Promise<void> {
  const api = window.desktopApi;
  if (api) {
    try {
      await api.setPreference(SCHEDULE_KEY, serialized);
    } catch {
      // IPC unavailable; fall through to localStorage mirror
    }
  }
}

/**
 * Read the schedule once (Electron prefs first, then localStorage) and keep a
 * latest-saved mirror so prefs/localStorage stay in sync across runtimes.
 */
export function useReportSchedule(): {
  schedule: ReportScheduleConfig;
  /** Persist a full config (marks it configured). */
  save: (next: ReportScheduleConfig) => Promise<void>;
  /** Toggle enabled without flipping the "configured" flag. */
  setEnabled: (enabled: boolean) => Promise<void>;
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
      let raw: string | null = null;
      try {
        raw = await loadFromPlatform();
      } catch {
        raw = null;
      }
      if (raw === null) {
        try {
          raw = window.localStorage.getItem(SCHEDULE_KEY);
        } catch {
          raw = null;
        }
      }
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

  const persist = useCallback(async (next: ReportScheduleConfig) => {
    const serialized = serializeReportSchedule(next);
    lastSavedRef.current = serialized;
    setSchedule(next);
    void saveToPlatform(serialized);
    try {
      window.localStorage.setItem(SCHEDULE_KEY, serialized);
    } catch {
      // localStorage unavailable — best-effort
    }
  }, []);

  const save = useCallback(
    async (next: ReportScheduleConfig) => {
      await persist({ ...next, configured: true });
    },
    [persist],
  );

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      const current =
        lastSavedRef.current.length > 0
          ? parseReportSchedule(lastSavedRef.current)
          : schedule;
      await persist({ ...current, enabled });
    },
    [persist, schedule],
  );

  return { schedule, save, setEnabled, loaded };
}
