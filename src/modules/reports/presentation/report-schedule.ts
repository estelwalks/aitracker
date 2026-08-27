import { useCallback, useEffect, useRef, useState } from "react";

import {
  getReportScheduleStatus,
  syncReportScheduleToTasks,
  type ReportScheduleStatuses,
} from "../server-fns.ts";
import {
  getPreference,
  setPreference,
} from "../../../lib/preferences/client.ts";
import {
  DEFAULT_REPORT_SCHEDULES,
  parseReportSchedulesWithMigration,
  REPORT_SCHEDULE_KEY,
  serializeReportSchedules,
  type ReportSchedulesConfig,
} from "../schedule.ts";

export interface ReportScheduleSyncResult {
  readonly ok: boolean;
  readonly errorCode?: string;
}

export {
  DEFAULT_REPORT_SCHEDULES,
  parseReportSchedulesWithMigration,
  serializeReportSchedules,
};
export type { ReportSchedulesConfig };

async function loadFromPlatform(): Promise<unknown> {
  return getPreference(REPORT_SCHEDULE_KEY);
}

async function saveToPlatform(config: ReportSchedulesConfig): Promise<void> {
  await setPreference(REPORT_SCHEDULE_KEY, config);
}

async function syncScheduleToTasks(
  config: ReportSchedulesConfig,
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

export function useReportSchedule(): {
  schedule: ReportSchedulesConfig;
  save: (next: ReportSchedulesConfig) => Promise<ReportScheduleSyncResult>;
  loaded: boolean;
  status: ReportScheduleStatuses | null;
  statusError: boolean;
  reload: () => void;
} {
  const [schedule, setSchedule] = useState<ReportSchedulesConfig>(
    DEFAULT_REPORT_SCHEDULES,
  );
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<ReportScheduleStatuses | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const lastSavedRef = useRef("");

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
      const raw = await loadFromPlatform();
      const parsed = parseReportSchedulesWithMigration(raw);
      // Browser/dev startup may race server composition. Persisting the v2
      // value here makes migration deterministic in either environment.
      if (parsed.migratedFromLegacy) {
        await saveToPlatform(parsed.config);
        await syncScheduleToTasks(parsed.config);
      }
      const nextStatus = await getReportScheduleStatus();
      if (cancelled) return;
      setSchedule(parsed.config);
      lastSavedRef.current = serializeReportSchedules(parsed.config);
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

  const save = useCallback(
    async (next: ReportSchedulesConfig): Promise<ReportScheduleSyncResult> => {
      const configured = { ...next, configured: true } as const;
      const serialized = serializeReportSchedules(configured);
      const previousSerialized = lastSavedRef.current;
      const previous = previousSerialized
        ? parseReportSchedulesWithMigration(previousSerialized).config
        : schedule;
      lastSavedRef.current = serialized;
      setSchedule(configured);
      try {
        await saveToPlatform(configured);
        const result = await syncScheduleToTasks(configured);
        await refreshStatus();
        return result;
      } catch {
        lastSavedRef.current = serializeReportSchedules(previous);
        setSchedule(previous);
        return { ok: false };
      }
    },
    [refreshStatus, schedule],
  );

  return {
    schedule,
    save,
    loaded,
    status,
    statusError,
    reload: () => setReloadTick((value) => value + 1),
  };
}
