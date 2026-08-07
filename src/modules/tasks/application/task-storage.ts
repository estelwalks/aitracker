import { z } from "zod";

import { JOB_DEFINITIONS } from "../definitions/job-catalog.generated.ts";
import type {
  AtomicJsonStore,
  Clock,
} from "../../../platform/persistence/contracts.ts";
import { createTaskId, isTaskId, type TaskId } from "../../../shared/ids.ts";

export const TASK_PREFERENCES_SCHEMA_VERSION = 2 as const;
export const TASK_RUNS_SCHEMA_VERSION = 1 as const;

export const ScheduleSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("interval"),
      minutes: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("daily"),
      localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("weekly"),
      weekday: z.number().int().min(1).max(7),
      localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    })
    .strict(),
]);
export type Schedule = z.infer<typeof ScheduleSchema>;

export const TaskPreferenceSchema = z
  .object({
    enabled: z.boolean(),
    schedule: ScheduleSchema.optional(),
  })
  .strict();
export type TaskPreference = z.infer<typeof TaskPreferenceSchema>;

export const TaskPreferencesFileSchema = z
  .object({
    schemaVersion: z.literal(TASK_PREFERENCES_SCHEMA_VERSION),
    updatedAt: z.string().datetime({ offset: true }),
    tasks: z.record(z.string(), TaskPreferenceSchema),
  })
  .strict();
export type TaskPreferencesFile = z.infer<typeof TaskPreferencesFileSchema>;

export type JobRunStatus =
  | "queued"
  | "running"
  | "waiting-approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped"
  | "abandoned";
export type JobRunTrigger =
  "manual" | "schedule" | "startup-recovery" | "event";

const opaqueId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const safeErrorCode = z.string().regex(/^errors\.[a-z0-9][a-z0-9._-]*$/);
export const TaskRunSummarySchema = z
  .object({
    scanned: z.number().int().nonnegative().optional(),
    changed: z.number().int().nonnegative().optional(),
    diagnosticCount: z.number().int().nonnegative().optional(),
    skippedReason: z
      .enum(["already-running", "queue-full", "not-stale", "disabled"])
      .optional(),
  })
  .strict();
export type TaskRunSummary = z.infer<typeof TaskRunSummarySchema>;

export const JobRunSchema = z
  .object({
    runId: opaqueId,
    taskId: z.string().regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
    trigger: z.enum(["manual", "schedule", "startup-recovery", "event"]),
    status: z.enum([
      "queued",
      "running",
      "waiting-approval",
      "succeeded",
      "failed",
      "cancelled",
      "skipped",
      "abandoned",
    ]),
    queuedAt: z.string().datetime({ offset: true }).optional(),
    startedAt: z.string().datetime({ offset: true }).optional(),
    finishedAt: z.string().datetime({ offset: true }).optional(),
    durationMs: z.number().int().nonnegative().optional(),
    attempt: z.number().int().min(1).max(100),
    correlationId: opaqueId,
    errorCode: safeErrorCode.optional(),
    retryable: z.boolean().optional(),
    inputFingerprint: opaqueId.optional(),
    outputRef: opaqueId.optional(),
    summary: TaskRunSummarySchema.optional(),
  })
  .strict();
export type JobRun = z.infer<typeof JobRunSchema>;
/** Migration-compatible name used by the first task-runtime design. */
export type TaskRun = JobRun;

export const TaskRunsFileSchema = z
  .object({
    schemaVersion: z.literal(TASK_RUNS_SCHEMA_VERSION),
    runs: z.array(JobRunSchema),
  })
  .strict();
export type TaskRunsFile = z.infer<typeof TaskRunsFileSchema>;

export interface TaskPreferenceRepository {
  read(): Promise<TaskPreferencesFile>;
  get(taskId: string): Promise<TaskPreference | undefined>;
  save(preferences: TaskPreferencesFile): Promise<void>;
  set(taskId: string, preference: TaskPreference): Promise<TaskPreferencesFile>;
}

export interface TaskRunRepository {
  append(run: JobRun): Promise<void>;
  list(options?: {
    taskId?: string;
    limit?: number;
  }): Promise<readonly JobRun[]>;
  recoverRunning(): Promise<readonly JobRun[]>;
  compact(): Promise<void>;
  rotate(): Promise<void>;
}

export interface TaskPreferenceRepositoryOptions {
  readonly store: AtomicJsonStore<TaskPreferencesFile>;
  readonly clock?: Clock;
}

export interface TaskRunRepositoryOptions {
  readonly store: AtomicJsonStore<TaskRunsFile>;
  readonly clock?: Clock;
  readonly maxEntries?: number;
}

export const DEFAULT_TASK_PREFERENCES: TaskPreferencesFile = {
  schemaVersion: TASK_PREFERENCES_SCHEMA_VERSION,
  updatedAt: "1970-01-01T00:00:00.000Z",
  tasks: {},
};
export const DEFAULT_TASK_RUNS: TaskRunsFile = {
  schemaVersion: TASK_RUNS_SCHEMA_VERSION,
  runs: [],
};

export function validateTaskId(taskId: string): TaskId {
  if (
    !isTaskId(taskId) ||
    !JOB_DEFINITIONS.some((definition) => definition.id === taskId)
  ) {
    throw new TypeError("Invalid task id");
  }
  return createTaskId(taskId);
}

export function validateSchedule(taskId: string, schedule: Schedule): Schedule {
  const id = validateTaskId(taskId);
  const definition = JOB_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!definition) throw new TypeError("Invalid task id");
  const parsed = ScheduleSchema.parse(schedule);
  if (
    parsed.kind === "interval" &&
    (parsed.minutes < definition.constraints.minMinutes ||
      parsed.minutes > definition.constraints.maxMinutes)
  ) {
    throw new TypeError("Schedule interval outside task constraints");
  }
  if (
    parsed.kind !== definition.defaultSchedule.kind &&
    parsed.kind === "weekly" &&
    definition.defaultSchedule.kind !== "weekly"
  ) {
    throw new TypeError("Schedule kind is not supported for task");
  }
  return parsed;
}

export function preferenceSchema(clock: Clock = { now: () => new Date() }) {
  return {
    currentVersion: TASK_PREFERENCES_SCHEMA_VERSION,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        migrate(value: unknown) {
          const legacy = value as { updatedAt?: unknown; tasks?: unknown };
          return {
            updatedAt:
              typeof legacy.updatedAt === "string"
                ? legacy.updatedAt
                : clock.now().toISOString(),
            tasks:
              legacy.tasks && typeof legacy.tasks === "object"
                ? legacy.tasks
                : {},
          };
        },
      },
    ],
    parse(value: unknown): TaskPreferencesFile {
      const file = TaskPreferencesFileSchema.parse({
        schemaVersion: TASK_PREFERENCES_SCHEMA_VERSION,
        ...(value as object),
      });
      for (const [taskId, preference] of Object.entries(file.tasks)) {
        validateTaskId(taskId);
        if (preference.schedule) validateSchedule(taskId, preference.schedule);
      }
      return file;
    },
  };
}

export function taskRunsSchema() {
  return {
    currentVersion: TASK_RUNS_SCHEMA_VERSION,
    parse(value: unknown): TaskRunsFile {
      const file = TaskRunsFileSchema.parse(value);
      for (const run of file.runs) validateTaskId(run.taskId);
      return file;
    },
  };
}
