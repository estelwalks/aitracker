import { useCallback, useEffect, useRef, useState } from "react";

import {
  getReportScheduleStatus,
  syncReportScheduleToTasks,
  type ReportScheduleStatus,
} from "../server-fns.ts";
import {
  getPreference,
  setPreference,
} from "../../../lib/preferences/client.ts";
import {
  DEFAULT_REPORT_SCHEDULE,
  parseReportSchedule,
  nextReportScheduleAt,
  REPORT_SCHEDULE_KEY,
  serializeReportSchedule,
  type ReportScheduleConfig,
  type ScheduleGranularity,
} from "../schedule.ts";

/**
 * ReportSchedule configuration persistence + scheduler sync.
 *
 * The config persists to SQLite `app_preferences` (key `tt.report.schedule`).
 * Browser and Electron renderers use the same server-owned preference client. Every save additionally
 * syncs the config into the task scheduler's `reports.generate` preference via
 * `syncReportScheduleToTasks` (Story B-200), so the persisted config actually
 * drives scheduled generation — a sync failure never blocks the local save.
 */
/** Outcome of syncing the config into the task scheduler. */
export interface ReportScheduleSyncResult {
  readonly ok: boolean;
  readonly errorCode?: string;
}

export {
  DEFAULT_REPORT_SCHEDULE,
  parseReportSchedule,
  serializeReportSchedule,
};
export { nextReportScheduleAt };
export type { ReportScheduleConfig, ScheduleGranularity };

async function loadFromPlatform(): Promise<string | null> {
  const value = await getPreference(REPORT_SCHEDULE_KEY);
  return typeof value === "string" ? value : null;
}

async function saveToPlatform(serialized: string): Promise<void> {
  await setPreference(REPORT_SCHEDULE_KEY, serialized);
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
  status: ReportScheduleStatus | null;
  statusError: boolean;
  reload: () => void;
} {
  const [schedule, setSchedule] = useState<ReportScheduleConfig>(
    DEFAULT_REPORT_SCHEDULE,
  );
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<ReportScheduleStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const lastSavedRef = useRef<string>("");

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getReportScheduleStatus());
      setStatusError(false);
    } catch {
      setStatusError(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatusError(false);
    void (async () => {
      const [raw, nextStatus] = await Promise.all([
        loadFromPlatform(),
        getReportScheduleStatus(),
      ]);
      if (cancelled) return;
      const parsed = parseReportSchedule(raw);
      setSchedule(parsed);
      lastSavedRef.current = serializeReportSchedule(parsed);
      setStatus(nextStatus);
      setLoaded(true);
    })().catch(() => {
      if (!cancelled) {
        setStatusError(true);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  useEffect(() => {
    if (!loaded) return;
    const timer = window.setInterval(() => void refreshStatus(), 5_000);
    return () => window.clearInterval(timer);
  }, [loaded, refreshStatus]);

  const persist = useCallback(
    async (next: ReportScheduleConfig): Promise<ReportScheduleSyncResult> => {
      const serialized = serializeReportSchedule(next);
      const previousSerialized = lastSavedRef.current;
      const previous =
        previousSerialized.length > 0
          ? parseReportSchedule(previousSerialized)
          : schedule;
      lastSavedRef.current = serialized;
      setSchedule(next);
      try {
        await saveToPlatform(serialized);
        const result = await syncScheduleToTasks(next);
        await refreshStatus();
        return result;
      } catch {
        lastSavedRef.current = serializeReportSchedule(previous);
        setSchedule(previous);
        return { ok: false };
      }
    },
    [refreshStatus, schedule],
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

  return {
    schedule,
    save,
    setEnabled,
    loaded,
    status,
    statusError,
    reload: () => setReloadTick((value) => value + 1),
  };
}
