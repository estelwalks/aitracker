/** Shared report schedule contract used by the renderer and background task. */
export type ScheduleGranularity = "daily" | "weekly" | "monthly";

export interface ReportScheduleConfig {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly granularity: ScheduleGranularity;
  readonly time: string;
  /** 0 = Monday … 6 = Sunday. */
  readonly dayOfWeek: number;
  /** 1–31; short months clamp to their last day. */
  readonly dayOfMonth: number;
}

export const REPORT_SCHEDULE_KEY = "tt.report.schedule";

export const DEFAULT_REPORT_SCHEDULE: ReportScheduleConfig = {
  configured: false,
  enabled: false,
  granularity: "daily",
  time: "18:30",
  dayOfWeek: 1,
  dayOfMonth: 1,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isScheduleGranularity(value: unknown): value is ScheduleGranularity {
  return value === "daily" || value === "weekly" || value === "monthly";
}

export function parseReportSchedule(raw: string | null): ReportScheduleConfig {
  if (!raw) return DEFAULT_REPORT_SCHEDULE;
  try {
    const value = JSON.parse(raw) as Partial<ReportScheduleConfig>;
    const dayOfWeek =
      typeof value.dayOfWeek === "number" &&
      Number.isInteger(value.dayOfWeek) &&
      value.dayOfWeek >= 0 &&
      value.dayOfWeek <= 6
        ? value.dayOfWeek
        : DEFAULT_REPORT_SCHEDULE.dayOfWeek;
    const dayOfMonth =
      typeof value.dayOfMonth === "number" &&
      Number.isInteger(value.dayOfMonth) &&
      value.dayOfMonth >= 1 &&
      value.dayOfMonth <= 31
        ? value.dayOfMonth
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
      dayOfWeek,
      dayOfMonth,
    };
  } catch {
    return DEFAULT_REPORT_SCHEDULE;
  }
}

export function serializeReportSchedule(config: ReportScheduleConfig): string {
  return JSON.stringify(config);
}

/** Computes the next configured local occurrence strictly after `base`. */
export function nextReportScheduleAt(
  schedule: ReportScheduleConfig,
  base: Date,
): Date {
  const [hour, minute] = schedule.time.split(":").map(Number);
  const next = new Date(base);
  next.setHours(hour!, minute!, 0, 0);

  if (schedule.granularity === "daily") {
    if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }

  if (schedule.granularity === "weekly") {
    const current = next.getDay() === 0 ? 6 : next.getDay() - 1;
    let delta = (schedule.dayOfWeek - current + 7) % 7;
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
  granularity: ScheduleGranularity,
): "reports.daily" | "reports.weekly" {
  return granularity === "daily" ? "reports.daily" : "reports.weekly";
}
