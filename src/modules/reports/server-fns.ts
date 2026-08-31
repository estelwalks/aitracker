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
import { normalizeLocale, type Locale } from "../../lib/i18n/locale";

import type { ReportContent, ReportPeriod } from "./contracts.ts";
import {
  nextReportScheduleAt,
  REPORT_SCHEDULE_KINDS,
  parseReportSchedules,
  REPORT_SCHEDULE_KEY,
  REPORT_TASK_IDS,
  reportSchedulePreferenceRequests,
  type ReportScheduleKind,
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
 * Report bodies are deterministic renderings of collected aggregates, so they
 * can be generated without an LLM. Unknown definition ids degrade to
 * `{ triggered: false }` (the page only ever sends `reports.daily`/`reports.weekly`).
 */
export const generateReportNow = createServerFn({ method: "POST" })
  .validator(
    (
      input: unknown,
    ): {
      definitionId?: string;
      locale?: Locale;
      granularity?: "day" | "week" | "month";
      periodKey?: string;
    } => {
      if (input != null && typeof input === "object") {
        const candidate = input as {
          definitionId?: unknown;
          locale?: unknown;
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
          ...(normalizeLocale(
            typeof candidate.locale === "string" ? candidate.locale : null,
          )
            ? {
                locale: normalizeLocale(
                  typeof candidate.locale === "string"
                    ? candidate.locale
                    : null,
                )!,
              }
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
    try {
      if (
        data.definitionId !== "reports.daily" &&
        data.definitionId !== "reports.weekly" &&
        data.definitionId !== "reports.monthly"
      ) {
        return { triggered: false };
      }
      const period = buildReportPeriod(data.granularity, data.periodKey);
      const { generateReport } = await import("./api.server.ts");
      // Monthly reports reuse the weekly definition in persisted storage, but
      // accept the explicit id too so stale clients cannot reject the request.
      return await generateReport(
        data.definitionId === "reports.monthly"
          ? "reports.weekly"
          : data.definitionId,
        data.definitionId === "reports.monthly" &&
          period?.granularity !== "month"
          ? { granularity: "month", key: data.periodKey ?? "" }
          : period,
        data.locale,
      );
    } catch {
      // Keep the server-function contract stable even if module loading or a
      // framework boundary fails before the API adapter can handle it.
      return {
        triggered: false,
        errorCode: "errors.reports.generationFailed",
      };
    }
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
  /**
   * True when the submitted body exceeded the durable storage boundary
   * (60,000 chars) and was truncated on save. The renderer must surface this
   * (P1-10) instead of the save appearing lossless.
   */
  readonly truncated?: boolean;
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
    const result = await save(data.reportId, data.body);
    return {
      ...result,
      ...(result.saved && result.content?.truncated === true
        ? { truncated: true }
        : {}),
    };
  });

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const reportScheduleInputSchema = z
  .object({
    version: z.literal(2),
    configured: z.boolean(),
    daily: z.object({ enabled: z.boolean(), time: timeSchema }).strict(),
    weekly: z
      .object({
        enabled: z.boolean(),
        time: timeSchema,
        /** 0 = Monday … 6 = Sunday. */
        dayOfWeek: z.number().int().min(0).max(6),
      })
      .strict(),
    monthly: z
      .object({
        enabled: z.boolean(),
        time: timeSchema,
        dayOfMonth: z.number().int().min(1).max(31),
      })
      .strict(),
  })
  .strict();
export type ReportScheduleInput = z.infer<typeof reportScheduleInputSchema>;

export interface SyncReportScheduleResult {
  readonly ok: boolean;
  /** Stable error code (e.g. `errors.tasks.persistenceFailed`) when `ok` is false. */
  readonly errorCode?: string;
}

export const REPORT_SCHEDULE_MODEL_REQUIRED_ERROR =
  "errors.reports.modelRequired" as const;

export function hasEnabledReportSchedule(
  config: Pick<ReportScheduleInput, (typeof REPORT_SCHEDULE_KINDS)[number]>,
): boolean {
  return REPORT_SCHEDULE_KINDS.some((kind) => config[kind].enabled);
}

async function enablesReportSchedule(
  root: {
    readonly preferences: {
      get(key: string): Promise<{ readonly enabled?: boolean } | undefined>;
    };
  },
  config: ReportScheduleInput,
): Promise<boolean> {
  const current = await Promise.all(
    REPORT_SCHEDULE_KINDS.map(async (kind) => ({
      kind,
      preference: await root.preferences.get(REPORT_TASK_IDS[kind]),
    })),
  );
  return current.some(
    ({ kind, preference }) =>
      config[kind].enabled && preference?.enabled !== true,
  );
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
export type ReportScheduleStatuses = Readonly<{
  /**
   * Whether the background task scheduler is actually armed in this runtime.
   * The per-kind next-run times below are computed from the stored config and
   * do NOT imply the scheduler is running; renderers must surface this flag
   * when it is false (e.g. unsupported platforms) instead of showing a fake
   * next-run countdown.
   */
  readonly schedulerRunning: boolean;
  readonly daily: ReportScheduleStatus;
  readonly weekly: ReportScheduleStatus;
  readonly monthly: ReportScheduleStatus;
}>;

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
  if (
    hasEnabledReportSchedule(config) &&
    (await enablesReportSchedule(root, config))
  ) {
    try {
      const activeView = await root.modelProfiles.getActiveView();
      const activeProfile = activeView
        ? await root.modelProfiles.getProfileForExecution(activeView.id)
        : undefined;
      if (!activeProfile?.apiKey?.trim() || !activeProfile.model?.trim()) {
        return {
          ok: false,
          errorCode: REPORT_SCHEDULE_MODEL_REQUIRED_ERROR,
        };
      }
    } catch {
      return {
        ok: false,
        errorCode: REPORT_SCHEDULE_MODEL_REQUIRED_ERROR,
      };
    }
  }
  for (const request of reportSchedulePreferenceRequests(config)) {
    const result = await root.taskApi.updatePreference(request);
    if (!result.ok) return { ok: false, errorCode: result.error.code };
  }
  return { ok: true };
}

/**
 * Persist all three independent schedules, then disable the legacy single task.
 * Each TaskApi update re-arms the running scheduler after its durable write.
 */
export const syncReportScheduleToTasks = createServerFn({ method: "POST" })
  .validator((input: unknown): ReportScheduleInput =>
    reportScheduleInputSchema.parse(input),
  )
  .handler(async ({ data }): Promise<SyncReportScheduleResult> =>
    syncReportScheduleToTaskPreference(data),
  );

interface ReportScheduleRunView {
  readonly trigger: "manual" | "schedule" | "startup-recovery" | "event";
  readonly status:
    | "queued"
    | "running"
    | "waiting-approval"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "skipped"
    | "abandoned";
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export async function reportScheduleStatusFor(options: {
  readonly kind: ReportScheduleKind;
  readonly config: ReportScheduleInput;
  readonly now: Date;
  readonly listRuns: (request: {
    taskId: string;
    limit: number;
  }) => Promise<
    | { readonly ok: true; readonly value: readonly ReportScheduleRunView[] }
    | { readonly ok: false }
  >;
}): Promise<ReportScheduleStatus> {
  const { kind, config } = options;
  const runs = await options.listRuns({
    taskId: REPORT_TASK_IDS[kind],
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
  const plan = config[kind];
  const schedule = reportSchedulePreferenceRequests(config).find(
    (request) => request.taskId === REPORT_TASK_IDS[kind],
  )?.schedule;
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
      config.configured && plan.enabled && schedule
        ? nextReportScheduleAt(schedule, options.now).toISOString()
        : null,
    pending,
  };
}

/** Renderer-safe status evidence, independently keyed by report cadence. */
export const getReportScheduleStatus = createServerFn({
  method: "GET",
}).handler(async (): Promise<ReportScheduleStatuses> => {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const stored =
    root.database.features.appPreferences.get(REPORT_SCHEDULE_KEY)?.value;
  const config = parseReportSchedules(stored);
  const [daily, weekly, monthly] = await Promise.all([
    reportScheduleStatusFor({
      kind: "daily",
      config,
      now: new Date(),
      listRuns: (request) => root.taskApi.listRuns(request),
    }),
    reportScheduleStatusFor({
      kind: "weekly",
      config,
      now: new Date(),
      listRuns: (request) => root.taskApi.listRuns(request),
    }),
    reportScheduleStatusFor({
      kind: "monthly",
      config,
      now: new Date(),
      listRuns: (request) => root.taskApi.listRuns(request),
    }),
  ]);
  return {
    schedulerRunning: root.scheduler.isRunning(),
    daily,
    weekly,
    monthly,
  };
});
