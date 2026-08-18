import { err, ok, type Result } from "../../../shared/result.ts";
import {
  createRunId,
  createTaskId,
  isRunId,
  type RunId,
  type TaskId,
} from "../../../shared/ids.ts";
import {
  JobRunSchema,
  ScheduleSchema,
  TaskPreferenceSchema,
  TaskRunSummarySchema,
  type JobRun,
  type Schedule,
  type TaskPreference,
  type TaskPreferenceRepository,
  type TaskRunRepository,
} from "./task-storage.ts";
import { JOB_DEFINITIONS } from "../definitions/job-catalog.generated.ts";
import type { JobTypeDefinition } from "../definitions/contracts.ts";
import type { TaskScheduler } from "./scheduler.ts";
import { z } from "zod";

export type TaskApiErrorCode =
  | "errors.tasks.invalidInput"
  | "errors.tasks.unknownTask"
  | "errors.tasks.invalidSchedule"
  | "errors.tasks.invalidRunId"
  | "errors.tasks.persistenceFailed"
  | "errors.tasks.executionFailed";

export interface TaskDefinitionPublic {
  readonly id: string;
  readonly category: JobTypeDefinition["category"];
  readonly defaultSchedule: Schedule;
  readonly constraints: JobTypeDefinition["constraints"];
  readonly startupPolicy: JobTypeDefinition["startupPolicy"];
  readonly queue: JobTypeDefinition["queue"];
  readonly network: JobTypeDefinition["network"];
  readonly requiresApproval: boolean;
  readonly settingsVisible: boolean;
  readonly i18nKey: JobTypeDefinition["ui"]["i18nKey"];
}

export interface TaskPreferencePublic {
  readonly taskId: string;
  readonly enabled: boolean;
  readonly schedule?: Schedule;
}

export interface TaskRunSummaryPublic {
  readonly runId: string;
  readonly taskId: string;
  readonly trigger: JobRun["trigger"];
  readonly status: JobRun["status"];
  readonly queuedAt?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly attempt: number;
  readonly errorCode?: `errors.${string}`;
  readonly retryable?: boolean;
  readonly summary?: JobRun["summary"];
}

export interface TaskApi {
  listDefinitions(): Promise<
    Result<readonly TaskDefinitionPublic[], TaskApiErrorCode>
  >;
  listPreferences(): Promise<
    Result<readonly TaskPreferencePublic[], TaskApiErrorCode>
  >;
  listRuns(
    request?: unknown,
  ): Promise<Result<readonly TaskRunSummaryPublic[], TaskApiErrorCode>>;
  runNow(
    request: unknown,
  ): Promise<Result<TaskRunSummaryPublic, TaskApiErrorCode>>;
  /**
   * P3-T3-11: waits (bounded polling) until the given run reaches a terminal
   * state — used by manual refresh commands that must return the refreshed
   * result, while still going through the unified task runtime (single-flight,
   * budget, run records). Times out with `errors.tasks.executionFailed`.
   */
  awaitRun(
    request: unknown,
  ): Promise<Result<TaskRunSummaryPublic, TaskApiErrorCode>>;
  cancel(
    request: unknown,
  ): Promise<Result<{ runId: string }, TaskApiErrorCode>>;
  updatePreference(
    request: unknown,
  ): Promise<Result<TaskPreferencePublic, TaskApiErrorCode>>;
}

export interface CreateTaskApiOptions {
  readonly scheduler: Pick<TaskScheduler, "runNow" | "cancel">;
  readonly preferences: TaskPreferenceRepository;
  readonly runs: TaskRunRepository;
  readonly catalog?: readonly JobTypeDefinition[];
}

const listRunsRequestSchema = z
  .object({
    taskId: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const taskIdRequestSchema = z.object({ taskId: z.string() }).strict();
const runNowRequestSchema = z.object({ taskId: z.string() }).strict();
const awaitRunRequestSchema = z
  .object({
    runId: z.string(),
    timeoutMs: z.number().int().min(1000).max(300_000).optional(),
  })
  .strict();
const updatePreferenceRequestSchema = z
  .object({
    taskId: z.string(),
    enabled: z.boolean(),
    schedule: ScheduleSchema.optional(),
  })
  .strict();

/** Terminal run states (mirrors scheduler.ts; kept local to avoid coupling). */
const TERMINAL_RUN_STATUSES = new Set<JobRun["status"]>([
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
  "abandoned",
]);

function publicDefinition(definition: JobTypeDefinition): TaskDefinitionPublic {
  return {
    id: definition.id,
    category: definition.category,
    defaultSchedule: definition.defaultSchedule as Schedule,
    constraints: definition.constraints,
    startupPolicy: definition.startupPolicy,
    queue: definition.queue,
    network: definition.network,
    requiresApproval: definition.requiresApproval,
    settingsVisible: definition.ui.settingsVisible,
    i18nKey: definition.ui.i18nKey,
  };
}

function publicPreference(
  taskId: string,
  value: TaskPreference,
): TaskPreferencePublic {
  return {
    taskId,
    enabled: value.enabled,
    ...(value.schedule ? { schedule: value.schedule } : {}),
  };
}

/** Removes correlation/input/output references and all executor-owned fields. */
function publicRun(value: JobRun): TaskRunSummaryPublic {
  const parsed = JobRunSchema.parse(value);
  return {
    runId: parsed.runId,
    taskId: parsed.taskId,
    trigger: parsed.trigger,
    status: parsed.status,
    ...(parsed.queuedAt ? { queuedAt: parsed.queuedAt } : {}),
    ...(parsed.startedAt ? { startedAt: parsed.startedAt } : {}),
    ...(parsed.finishedAt ? { finishedAt: parsed.finishedAt } : {}),
    ...(parsed.durationMs === undefined
      ? {}
      : { durationMs: parsed.durationMs }),
    attempt: parsed.attempt,
    ...(parsed.errorCode && parsed.errorCode.startsWith("errors.")
      ? { errorCode: parsed.errorCode as `errors.${string}` }
      : {}),
    ...(parsed.retryable === undefined ? {} : { retryable: parsed.retryable }),
    ...(parsed.summary
      ? { summary: TaskRunSummarySchema.parse(parsed.summary) }
      : {}),
  };
}

function inputFailure(): Result<never, TaskApiErrorCode> {
  return err("errors.tasks.invalidInput");
}

export function createTaskApi(options: CreateTaskApiOptions): TaskApi {
  const catalog = options.catalog ?? JOB_DEFINITIONS;
  const definitionFor = (taskId: string) =>
    catalog.find((item) => item.id === taskId);
  const checkedTaskId = (value: unknown): Result<TaskId, TaskApiErrorCode> => {
    if (typeof value !== "string") return err("errors.tasks.invalidInput");
    const definition = definitionFor(value);
    if (!definition) return err("errors.tasks.unknownTask");
    try {
      return ok(createTaskId(value));
    } catch {
      return err("errors.tasks.invalidInput");
    }
  };
  const checkedSchedule = (
    taskId: string,
    value: unknown,
  ): Result<Schedule, TaskApiErrorCode> => {
    const definition = definitionFor(taskId);
    if (!definition || value === undefined)
      return value === undefined
        ? ok(definition?.defaultSchedule as Schedule)
        : err("errors.tasks.unknownTask");
    const parsed = ScheduleSchema.safeParse(value);
    if (!parsed.success) return err("errors.tasks.invalidSchedule");
    if (
      parsed.data.kind === "interval" &&
      (parsed.data.minutes < definition.constraints.minMinutes ||
        parsed.data.minutes > definition.constraints.maxMinutes)
    )
      return err("errors.tasks.invalidSchedule");
    if (
      parsed.data.kind !== definition.defaultSchedule.kind &&
      parsed.data.kind === "weekly" &&
      definition.defaultSchedule.kind !== "weekly"
    )
      return err("errors.tasks.invalidSchedule");
    return ok(parsed.data);
  };

  return {
    async listDefinitions() {
      return ok(catalog.map(publicDefinition));
    },
    async listPreferences() {
      try {
        const value = await options.preferences.read();
        return ok(
          catalog
            .filter((item) => item.ui.settingsVisible)
            .map((item) =>
              publicPreference(
                item.id,
                value.tasks[item.id] ?? { enabled: false },
              ),
            ),
        );
      } catch {
        return err("errors.tasks.persistenceFailed");
      }
    },
    async listRuns(request = {}) {
      const parsed = listRunsRequestSchema.safeParse(request);
      if (!parsed.success) return inputFailure();
      if (
        parsed.data.taskId !== undefined &&
        !definitionFor(parsed.data.taskId)
      )
        return err("errors.tasks.unknownTask");
      try {
        return ok((await options.runs.list(parsed.data)).map(publicRun));
      } catch {
        return err("errors.tasks.persistenceFailed");
      }
    },
    async runNow(request) {
      const parsed = runNowRequestSchema.safeParse(request);
      if (!parsed.success) return inputFailure();
      const taskId = checkedTaskId(parsed.data.taskId);
      if (!taskId.ok) return taskId;
      try {
        return ok(
          publicRun(
            await options.scheduler.runNow({
              taskId: taskId.value,
              reason: "manual",
            }),
          ),
        );
      } catch {
        return err("errors.tasks.executionFailed");
      }
    },
    async awaitRun(request) {
      const parsed = awaitRunRequestSchema.safeParse(request);
      if (!parsed.success || !isRunId(parsed.data.runId))
        return err("errors.tasks.invalidRunId");
      const timeoutMs = parsed.data.timeoutMs ?? 60_000;
      const deadline = Date.now() + timeoutMs;
      try {
        for (;;) {
          const runs = await options.runs.list({});
          const run = runs.find((item) => item.runId === parsed.data.runId);
          if (run && TERMINAL_RUN_STATUSES.has(run.status))
            return ok(publicRun(run));
          if (Date.now() >= deadline)
            return err("errors.tasks.executionFailed");
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } catch {
        return err("errors.tasks.persistenceFailed");
      }
    },
    async cancel(request) {
      const parsed = taskIdRequestSchema
        .extend({ runId: z.string() })
        .omit({ taskId: true })
        .safeParse(request);
      if (!parsed.success || !isRunId(parsed.data.runId))
        return err("errors.tasks.invalidRunId");
      try {
        await options.scheduler.cancel(createRunId(parsed.data.runId));
        return ok({ runId: parsed.data.runId });
      } catch {
        return err("errors.tasks.executionFailed");
      }
    },
    async updatePreference(request) {
      const parsed = updatePreferenceRequestSchema.safeParse(request);
      if (!parsed.success) return inputFailure();
      const taskId = checkedTaskId(parsed.data.taskId);
      if (!taskId.ok) return taskId;
      const schedule = checkedSchedule(
        parsed.data.taskId,
        parsed.data.schedule,
      );
      if (!schedule.ok) return schedule;
      const preference: TaskPreference = {
        enabled: parsed.data.enabled,
        ...(parsed.data.schedule ? { schedule: schedule.value } : {}),
      };
      try {
        await options.preferences.set(taskId.value, preference);
        return ok(publicPreference(parsed.data.taskId, preference));
      } catch {
        return err("errors.tasks.persistenceFailed");
      }
    },
  };
}
