/**
 * Reports mutation/read server functions. Kept separate from `query.ts`
 * because `query.ts` re-exports the page component; importing these from the
 * page directly (rather than via `query`) avoids a query → page → query import
 * cycle that the architecture verifier blocks. The heavy server work lives in
 * `api.server.ts` / the composition root and is dynamically imported so it
 * never reaches the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { ReportContent, ReportPeriod } from "./contracts.ts";
import type { Schedule } from "../tasks/application/task-storage.ts";
import {
  nextReportScheduleAt,
  parseReportSchedule,
  REPORT_SCHEDULE_KEY,
} from "./schedule.ts";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Resolve an optional `{ granularity, periodKey }` from the renderer into a
 * `ReportPeriod`. Day/week keys are local `YYYY-MM-DD`, month keys `YYYY-MM`;
 * anything else (or a missing granularity) resolves to undefined, so the
 * request falls back to the current period instead of erroring.
 */
export function buildReportPeriod(
  granularity?: "day" | "week" | "month",
  periodKey?: string,
): ReportPeriod | undefined {
  if (!granularity || !periodKey) return undefined;
  if (granularity === "month") {
    return /^\d{4}-\d{2}$/.test(periodKey)
      ? { granularity, key: periodKey }
      : undefined;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(periodKey)
    ? { granularity, key: periodKey }
    : undefined;
}

export interface GenerateReportNowResult {
  readonly triggered: boolean;
  /** The newly persisted draft, returned so the renderer can show it immediately. */
  readonly reportId?: string;
  readonly errorCode?: string;
}

/**
 * Trigger a manual report generation for a builtin definition. Honest gate:
 * when no LLM is configured the transport returns `{ triggered: false }` and
 * the UI keeps the button disabled with a hint — generation is never faked.
 * Unknown definition ids degrade to `{ triggered: false }` (the page only ever
 * sends `reports.daily`/`reports.weekly`).
 */
export const generateReportNow = createServerFn({ method: "POST" })
  .validator(
    (
      input: unknown,
    ): {
      definitionId?: string;
      granularity?: "day" | "week" | "month";
      periodKey?: string;
    } => {
      if (input != null && typeof input === "object") {
        const candidate = input as {
          definitionId?: unknown;
          granularity?: unknown;
          periodKey?: unknown;
        };
        const granularity =
          candidate.granularity === "day" ||
          candidate.granularity === "week" ||
          candidate.granularity === "month"
            ? candidate.granularity
            : undefined;
        return {
          ...(typeof candidate.definitionId === "string"
            ? { definitionId: candidate.definitionId }
            : {}),
          ...(granularity ? { granularity } : {}),
          ...(typeof candidate.periodKey === "string"
            ? { periodKey: candidate.periodKey }
            : {}),
        };
      }
      return {};
    },
  )
  .handler(async ({ data }): Promise<GenerateReportNowResult> => {
    if (
      data.definitionId !== "reports.daily" &&
      data.definitionId !== "reports.weekly"
    ) {
      return { triggered: false };
    }
    const period = buildReportPeriod(data.granularity, data.periodKey);
    const { generateReport } = await import("./api.server.ts");
    return generateReport(data.definitionId, period);
  });

/**
 * Read a report's redacted generated body for the inline preview/editor. Only
 * the body of a persisted report is returned; unknown/malformed ids resolve to
 * null (the renderer then shows an empty draft state).
 */
export const getReportBody = createServerFn({ method: "GET" })
  .validator((input: unknown): { reportId?: string } => {
    if (input != null && typeof input === "object") {
      const candidate = (input as { reportId?: unknown }).reportId;
      if (typeof candidate === "string") return { reportId: candidate };
    }
    return {};
  })
  .handler(async ({ data }): Promise<ReportContent | null> => {
    if (!data.reportId || !OPAQUE_ID.test(data.reportId)) return null;
    const { getReportBody: read } = await import("./api.server.ts");
    return read(data.reportId);
  });

export interface SaveReportBodyResult {
  readonly saved: boolean;
  readonly content?: ReportContent;
  readonly errorCode?: string;
}

/** Atomically replace the Markdown file belonging to an existing report. */
export const saveReportBody = createServerFn({ method: "POST" })
  .validator((input: unknown): { reportId?: string; body?: string } => {
    if (input == null || typeof input !== "object") return {};
    const candidate = input as { reportId?: unknown; body?: unknown };
    return {
      ...(typeof candidate.reportId === "string"
        ? { reportId: candidate.reportId }
        : {}),
      ...(typeof candidate.body === "string" ? { body: candidate.body } : {}),
    };
  })
  .handler(async ({ data }): Promise<SaveReportBodyResult> => {
    if (
      !data.reportId ||
      !OPAQUE_ID.test(data.reportId) ||
      data.body === undefined ||
      data.body.includes("\0") ||
      new TextEncoder().encode(data.body).byteLength > 2 * 1024 * 1024
    ) {
      return { saved: false, errorCode: "errors.reports.invalidContent" };
    }
    const { saveReportBody: save } = await import("./api.server.ts");
    return save(data.reportId, data.body);
  });

/**
 * Report schedule sync (Story B-200). Bridges the persisted `tt.report.schedule`
 * config (see `presentation/report-schedule.ts`) into the task scheduler's
 * `reports.generate` preference, so the config actually drives scheduled
 * generation instead of only persisting. The heavy composition root is
 * dynamically imported so it never reaches the browser bundle; the mapping and
 * request-shaping helpers below are pure and unit-tested.
 */
export const reportScheduleInputSchema = z
  .object({
    configured: z.boolean(),
    enabled: z.boolean(),
    granularity: z.enum(["daily", "weekly", "monthly"]),
    /** 24h `HH:MM`. */
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    /** 0 = Monday … 6 = Sunday; used for weekly granularity. */
    dayOfWeek: z.number().int().min(0).max(6),
    /** 1–31; used for monthly granularity. */
    dayOfMonth: z.number().int().min(1).max(31),
  })
  .strict();
export type ReportScheduleInput = z.infer<typeof reportScheduleInputSchema>;

export interface SyncReportScheduleResult {
  readonly ok: boolean;
  /** Stable error code (e.g. `errors.tasks.persistenceFailed`) when `ok` is false. */
  readonly errorCode?: string;
}

export interface ReportScheduleStatus {
  readonly lastRun: {
    readonly status:
      | "queued"
      | "running"
      | "succeeded"
      | "failed"
      | "cancelled"
      | "skipped"
      | "abandoned";
    readonly startedAt?: string;
    readonly finishedAt?: string;
  } | null;
  readonly nextRunAt: string | null;
  readonly pending: boolean;
}

/**
 * Maps a persisted report schedule config to the task scheduler's `Schedule`.
 * The report config numbers weekdays 0=Monday…6=Sunday while the task schedule
 * uses 1=Monday…7=Sunday, so weekly shifts by one. Monthly maps to the
 * scheduler's `monthly` kind (dayOfMonth 1–31; short months clamp to their last
 * day in `nextRunAt`).
 */
export function reportScheduleToTaskSchedule(
  config: ReportScheduleInput,
): Schedule {
  switch (config.granularity) {
    case "daily":
      return { kind: "daily", localTime: config.time };
    case "weekly":
      return {
        kind: "weekly",
        weekday: config.dayOfWeek + 1,
        localTime: config.time,
      };
    case "monthly":
      return {
        kind: "monthly",
        dayOfMonth: config.dayOfMonth,
        localTime: config.time,
      };
  }
}

/**
 * Builds the exact `updatePreference` request for the `reports.generate` task.
 * A disabled config carries no schedule (the preference store then keeps the
 * catalog default, but `enabled: false` means the scheduler never fires it).
 */
export function reportScheduleToPreferenceRequest(
  config: ReportScheduleInput,
): {
  taskId: "reports.generate";
  enabled: boolean;
  schedule?: Schedule;
} {
  return {
    taskId: "reports.generate",
    enabled: config.enabled,
    ...(config.enabled
      ? { schedule: reportScheduleToTaskSchedule(config) }
      : {}),
  };
}

/**
 * Testable core of `syncReportScheduleToTasks`: applies the mapped preference
 * through the wired composition root. Extracted so tests can exercise the real
 * repository → task-api path without a Start runtime context.
 */
export async function syncReportScheduleToTaskPreference(
  config: ReportScheduleInput,
): Promise<SyncReportScheduleResult> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const result = await root.taskApi.updatePreference(
    reportScheduleToPreferenceRequest(config),
  );
  return result.ok ? { ok: true } : { ok: false, errorCode: result.error.code };
}

/**
 * Persist a report schedule config into the task scheduler's `reports.generate`
 * preference. The client sends the full saved config; this server fn re-parses
 * and validates it so nothing unvalidated crosses the transport.
 */
export const syncReportScheduleToTasks = createServerFn({ method: "POST" })
  .validator((input: unknown): ReportScheduleInput =>
    reportScheduleInputSchema.parse(input),
  )
  .handler(async ({ data }): Promise<SyncReportScheduleResult> =>
    syncReportScheduleToTaskPreference(data),
  );

/** Renderer-safe evidence for the same persisted schedule used by the task runtime. */
export const getReportScheduleStatus = createServerFn({
  method: "GET",
}).handler(async (): Promise<ReportScheduleStatus> => {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const stored =
    root.database.features.appPreferences.get(REPORT_SCHEDULE_KEY)?.value;
  const config =
    typeof stored === "string" ? parseReportSchedule(stored) : undefined;
  const runs = await root.taskApi.listRuns({
    taskId: "reports.generate",
    limit: 20,
  });
  const scheduledRuns = runs.ok
    ? runs.value.filter((run) => run.trigger === "schedule")
    : [];
  const lastRun = scheduledRuns[0];
  const pending = scheduledRuns.some(
    (run) =>
      run.status === "queued" ||
      run.status === "running" ||
      run.status === "waiting-approval",
  );
  return {
    lastRun: lastRun
      ? {
          status:
            lastRun.status === "waiting-approval" ? "queued" : lastRun.status,
          ...(lastRun.startedAt ? { startedAt: lastRun.startedAt } : {}),
          ...(lastRun.finishedAt ? { finishedAt: lastRun.finishedAt } : {}),
        }
      : null,
    nextRunAt:
      config?.enabled && config.configured
        ? nextReportScheduleAt(config, new Date()).toISOString()
        : null,
    pending,
  };
});
