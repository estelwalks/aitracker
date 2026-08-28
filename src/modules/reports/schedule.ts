import type { Schedule } from "../tasks/application/task-storage.ts";
import type { PreferenceValue } from "../../lib/preferences/client.ts";

export type ReportScheduleKind = "daily" | "weekly" | "monthly";
export type ScheduleGranularity = ReportScheduleKind;
export const REPORT_SCHEDULE_KINDS = ["daily", "weekly", "monthly"] as const;

export interface DailyReportSchedule {
  readonly enabled: boolean;
  readonly time: string;
}

export interface WeeklyReportSchedule extends DailyReportSchedule {
  /** 0 = Monday … 6 = Sunday. */
  readonly dayOfWeek: number;
}

export interface MonthlyReportSchedule extends DailyReportSchedule {
  /** 1–31; short months clamp to their last day. */
  readonly dayOfMonth: number;
}

export interface ReportSchedulesConfig {
  readonly version: 2;
  readonly configured: boolean;
  readonly daily: DailyReportSchedule;
  readonly weekly: WeeklyReportSchedule;
  readonly monthly: MonthlyReportSchedule;
}

/** Legacy v1 shape kept only for lossless migration of `tt.report.schedule`. */
export interface LegacyReportScheduleConfig {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly granularity: ReportScheduleKind;
  readonly time: string;
  readonly dayOfWeek: number;
  readonly dayOfMonth: number;
}

export type ReportScheduleConfig = LegacyReportScheduleConfig;

export const REPORT_SCHEDULE_KEY = "tt.report.schedule";
export const LEGACY_REPORT_TASK_ID = "reports.generate" as const;
export const REPORT_TASK_IDS = {
  daily: "reports.generate.daily",
  weekly: "reports.generate.weekly",
  monthly: "reports.generate.monthly",
} as const;

export const DEFAULT_REPORT_SCHEDULES: ReportSchedulesConfig = {
  version: 2,
  configured: false,
  daily: { enabled: false, time: "18:00" },
  weekly: { enabled: false, dayOfWeek: 4, time: "18:00" },
  monthly: { enabled: false, dayOfMonth: 31, time: "18:00" },
};

export const DEFAULT_REPORT_SCHEDULE: LegacyReportScheduleConfig = {
  configured: false,
  enabled: false,
  granularity: "daily",
  time: DEFAULT_REPORT_SCHEDULES.daily.time,
  dayOfWeek: DEFAULT_REPORT_SCHEDULES.weekly.dayOfWeek,
  dayOfMonth: DEFAULT_REPORT_SCHEDULES.monthly.dayOfMonth,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validTime(value: unknown, fallback: string): string {
  return typeof value === "string" && TIME_RE.test(value) ? value : fallback;
}

function validWeekday(value: unknown, fallback: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 6
    ? value
    : fallback;
}

function validMonthDay(value: unknown, fallback: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 31
    ? value
    : fallback;
}

function isReportScheduleKind(value: unknown): value is ReportScheduleKind {
  return value === "daily" || value === "weekly" || value === "monthly";
}

function parseLegacyValue(value: unknown): LegacyReportScheduleConfig | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LegacyReportScheduleConfig>;
  if (!isReportScheduleKind(candidate.granularity)) return null;
  return {
    configured:
      typeof candidate.configured === "boolean"
        ? candidate.configured
        : DEFAULT_REPORT_SCHEDULE.configured,
    enabled:
      typeof candidate.enabled === "boolean"
        ? candidate.enabled
        : DEFAULT_REPORT_SCHEDULE.enabled,
    granularity: candidate.granularity,
    time: validTime(candidate.time, DEFAULT_REPORT_SCHEDULE.time),
    dayOfWeek: validWeekday(
      candidate.dayOfWeek,
      DEFAULT_REPORT_SCHEDULE.dayOfWeek,
    ),
    dayOfMonth: validMonthDay(
      candidate.dayOfMonth,
      DEFAULT_REPORT_SCHEDULE.dayOfMonth,
    ),
  };
}

function migrateLegacySchedule(
  legacy: LegacyReportScheduleConfig,
): ReportSchedulesConfig {
  return {
    ...DEFAULT_REPORT_SCHEDULES,
    configured: legacy.configured,
    daily: {
      ...DEFAULT_REPORT_SCHEDULES.daily,
      enabled: legacy.granularity === "daily" && legacy.enabled,
      ...(legacy.granularity === "daily" ? { time: legacy.time } : {}),
    },
    weekly: {
      ...DEFAULT_REPORT_SCHEDULES.weekly,
      enabled: legacy.granularity === "weekly" && legacy.enabled,
      ...(legacy.granularity === "weekly"
        ? { time: legacy.time, dayOfWeek: legacy.dayOfWeek }
        : {}),
    },
    monthly: {
      ...DEFAULT_REPORT_SCHEDULES.monthly,
      enabled: legacy.granularity === "monthly" && legacy.enabled,
      ...(legacy.granularity === "monthly"
        ? { time: legacy.time, dayOfMonth: legacy.dayOfMonth }
        : {}),
    },
  };
}

export interface ParsedReportSchedules {
  readonly config: ReportSchedulesConfig;
  readonly migratedFromLegacy: boolean;
}

/** Parses v2 and migrates the old single-cadence value without losing it. */
export function parseReportSchedulesWithMigration(
  raw: unknown,
): ParsedReportSchedules {
  if (!raw)
    return { config: DEFAULT_REPORT_SCHEDULES, migratedFromLegacy: false };
  try {
    const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
    if (value && typeof value === "object") {
      const candidate = value as Partial<ReportSchedulesConfig>;
      if (candidate.version === 2) {
        const daily =
          candidate.daily && typeof candidate.daily === "object"
            ? candidate.daily
            : DEFAULT_REPORT_SCHEDULES.daily;
        const weekly =
          candidate.weekly && typeof candidate.weekly === "object"
            ? candidate.weekly
            : DEFAULT_REPORT_SCHEDULES.weekly;
        const monthly =
          candidate.monthly && typeof candidate.monthly === "object"
            ? candidate.monthly
            : DEFAULT_REPORT_SCHEDULES.monthly;
        return {
          migratedFromLegacy: false,
          config: {
            version: 2,
            configured:
              typeof candidate.configured === "boolean"
                ? candidate.configured
                : DEFAULT_REPORT_SCHEDULES.configured,
            daily: {
              enabled:
                typeof daily.enabled === "boolean"
                  ? daily.enabled
                  : DEFAULT_REPORT_SCHEDULES.daily.enabled,
              time: validTime(daily.time, DEFAULT_REPORT_SCHEDULES.daily.time),
            },
            weekly: {
              enabled:
                typeof weekly.enabled === "boolean"
                  ? weekly.enabled
                  : DEFAULT_REPORT_SCHEDULES.weekly.enabled,
              time: validTime(
                weekly.time,
                DEFAULT_REPORT_SCHEDULES.weekly.time,
              ),
              dayOfWeek: validWeekday(
                weekly.dayOfWeek,
                DEFAULT_REPORT_SCHEDULES.weekly.dayOfWeek,
              ),
            },
            monthly: {
              enabled:
                typeof monthly.enabled === "boolean"
                  ? monthly.enabled
                  : DEFAULT_REPORT_SCHEDULES.monthly.enabled,
              time: validTime(
                monthly.time,
                DEFAULT_REPORT_SCHEDULES.monthly.time,
              ),
              dayOfMonth: validMonthDay(
                monthly.dayOfMonth,
                DEFAULT_REPORT_SCHEDULES.monthly.dayOfMonth,
              ),
            },
          },
        };
      }
    }
    const legacy = parseLegacyValue(value);
    return legacy
      ? { config: migrateLegacySchedule(legacy), migratedFromLegacy: true }
      : { config: DEFAULT_REPORT_SCHEDULES, migratedFromLegacy: false };
  } catch {
    return { config: DEFAULT_REPORT_SCHEDULES, migratedFromLegacy: false };
  }
}

export function parseReportSchedules(raw: unknown): ReportSchedulesConfig {
  return parseReportSchedulesWithMigration(raw).config;
}

/** Compatibility parser for callers/tests that still need the v1 contract. */
export function parseReportSchedule(
  raw: string | null,
): LegacyReportScheduleConfig {
  if (!raw) return DEFAULT_REPORT_SCHEDULE;
  try {
    return parseLegacyValue(JSON.parse(raw)) ?? DEFAULT_REPORT_SCHEDULE;
  } catch {
    return DEFAULT_REPORT_SCHEDULE;
  }
}

export function serializeReportSchedules(
  config: ReportSchedulesConfig,
): string {
  return JSON.stringify(config);
}

/**
 * Produces the explicit JSON-safe projection accepted by app_preferences.
 * A named config interface intentionally has no string index signature, so
 * callers use this boundary function instead of unsafe structural casts.
 */
export function reportSchedulesPreferenceValue(
  config: ReportSchedulesConfig,
): PreferenceValue {
  return {
    version: config.version,
    configured: config.configured,
    daily: {
      enabled: config.daily.enabled,
      time: config.daily.time,
    },
    weekly: {
      enabled: config.weekly.enabled,
      time: config.weekly.time,
      dayOfWeek: config.weekly.dayOfWeek,
    },
    monthly: {
      enabled: config.monthly.enabled,
      time: config.monthly.time,
      dayOfMonth: config.monthly.dayOfMonth,
    },
  };
}

export function serializeReportSchedule(
  config: LegacyReportScheduleConfig,
): string {
  return JSON.stringify(config);
}

function scheduleFor(
  config: ReportSchedulesConfig,
  kind: ReportScheduleKind,
): Schedule {
  if (kind === "daily") {
    return { kind: "daily", localTime: config.daily.time };
  }
  if (kind === "weekly") {
    return {
      kind: "weekly",
      weekday: config.weekly.dayOfWeek + 1,
      localTime: config.weekly.time,
    };
  }
  return {
    kind: "monthly",
    dayOfMonth: config.monthly.dayOfMonth,
    localTime: config.monthly.time,
  };
}

export interface ReportTaskPreferenceRequest {
  readonly taskId:
    (typeof REPORT_TASK_IDS)[ReportScheduleKind] | typeof LEGACY_REPORT_TASK_ID;
  readonly enabled: boolean;
  readonly schedule?: Schedule;
}

/** Four writes: three independent plans plus a hard-disable for the v1 task. */
export function reportSchedulePreferenceRequests(
  config: ReportSchedulesConfig,
): readonly ReportTaskPreferenceRequest[] {
  return (["daily", "weekly", "monthly"] as const)
    .map((kind): ReportTaskPreferenceRequest => {
      const plan = config[kind];
      return {
        taskId: REPORT_TASK_IDS[kind],
        enabled: plan.enabled,
        ...(plan.enabled ? { schedule: scheduleFor(config, kind) } : {}),
      };
    })
    .concat({ taskId: LEGACY_REPORT_TASK_ID, enabled: false });
}

/** Computes the next configured local occurrence strictly after `base`. */
export function nextReportScheduleAt(schedule: Schedule, base: Date): Date {
  if (schedule.kind === "interval") {
    return new Date(base.getTime() + schedule.minutes * 60_000);
  }
  const [hour, minute] = schedule.localTime.split(":").map(Number);
  const next = new Date(base);
  next.setHours(hour!, minute!, 0, 0);

  if (schedule.kind === "daily") {
    if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }
  if (schedule.kind === "weekly") {
    const current = next.getDay() === 0 ? 7 : next.getDay();
    let delta = (schedule.weekday - current + 7) % 7;
    if (delta === 0 && next.getTime() <= base.getTime()) delta = 7;
    next.setDate(next.getDate() + delta);
    return next;
  }

  const clamp = (year: number, monthIndex: number) =>
    Math.min(schedule.dayOfMonth, new Date(year, monthIndex + 1, 0).getDate());
  next.setDate(clamp(next.getFullYear(), next.getMonth()));
  if (next.getTime() <= base.getTime()) {
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    next.setDate(clamp(next.getFullYear(), next.getMonth()));
  }
  return next;
}

export function reportDefinitionIdForSchedule(
  granularity: ReportScheduleKind,
): "reports.daily" | "reports.weekly" {
  return granularity === "daily" ? "reports.daily" : "reports.weekly";
}
