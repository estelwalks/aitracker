import { JOB_EXECUTOR_KEYS } from "../../definitions/contracts.ts";
import type { JobExecutorKey } from "../../definitions/contracts.ts";
import type {
  TaskExecutionContext,
  TaskExecutionResult,
  TaskExecutor,
} from "../scheduler.ts";
import type { UsageApplication } from "../../../usage/index.ts";
import type { ReportsApplication } from "../../../reports/contracts.ts";

/**
 * Application ports used by task executors. The registry deliberately accepts
 * ports rather than scanners, server functions, or filesystem paths.
 */
export interface RefreshSessionsPort {
  refresh(request: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface RefreshSkillsPort {
  refresh(request: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface ApplyRetentionPort {
  apply(request: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface ExecutorRegistryOptions {
  readonly usage?: UsageApplication;
  readonly sessions?: RefreshSessionsPort;
  readonly skills?: RefreshSkillsPort;
  readonly retention?: ApplyRetentionPort;
  readonly reports?: ReportsApplication;
}

export interface ExecutorRegistry {
  /** Every catalog key has a statically bound function; no dynamic import. */
  readonly executors: Readonly<Record<JobExecutorKey, TaskExecutor>>;
  /** Resolves only keys from the validated catalog. Unknown keys fail safely. */
  resolve(executorKey: string): TaskExecutor;
}

export const EXECUTOR_ERROR_CODES = {
  unknown: "errors.tasks.executor-unknown",
  unavailable: "errors.tasks.executor-unavailable",
  failed: "errors.tasks.executor-failed",
} as const;

class ControlledExecutorError extends Error {
  readonly code: string;
  readonly retryable = false;

  constructor(code: string) {
    super(code);
    this.name = "ControlledExecutorError";
    this.code = code;
  }
}

function summaryFromUsage(
  value: Awaited<ReturnType<UsageApplication["refreshUsage"]>>,
): TaskExecutionResult {
  if (!value.ok) throw new ControlledExecutorError(value.error.code);
  const snapshot = value.value.snapshot;
  return {
    summary: {
      ...(snapshot == null ? {} : { scanned: snapshot.events }),
      diagnosticCount: snapshot?.sources.reduce(
        (count, source) => count + (source.diagnostics?.length ?? 0),
        0,
      ),
    },
  };
}

function unavailable(): never {
  throw new ControlledExecutorError(EXECUTOR_ERROR_CODES.unavailable);
}

function bindUsage(usage: UsageApplication | undefined): TaskExecutor {
  return async (context) => {
    if (!usage) return unavailable();
    return summaryFromUsage(
      await usage.refreshUsage({ signal: context.signal }),
    );
  };
}

function bindPort(
  port:
    RefreshSessionsPort | RefreshSkillsPort | ApplyRetentionPort | undefined,
): TaskExecutor {
  return async (context) => {
    if (!port) return unavailable();
    try {
      if ("apply" in port) await port.apply({ signal: context.signal });
      else await port.refresh({ signal: context.signal });
      return {};
    } catch {
      throw new ControlledExecutorError(EXECUTOR_ERROR_CODES.failed);
    }
  };
}

/**
 * Reports executor. The task scheduler only carries opaque task/run ids, so
 * the executor derives the report definition from the reports application's
 * built-in catalog. The catalog exposes a `reports.generate` task that maps
 * to the daily brief; weekly review is produced by its own scheduled run of
 * the same use case (the application's `generate` accepts a `definitionId`).
 *
 * For now the executor picks the first enabled definition with kind
 * `"daily"`; if the catalog shape grows, this stays deterministic. When no
 * reports application is injected the executor fails safe (`unavailable`),
 * matching the other adapters.
 */
function bindReports(app: ReportsApplication | undefined): TaskExecutor {
  return async () => {
    if (!app) return unavailable();
    const definition = app.definitions.find(
      (item) => item.kind === "daily" && item.enabled,
    );
    if (!definition) return unavailable();
    const result = await app.generate({
      definitionId: definition.definitionId,
      trigger: "schedule",
    });
    if (!result.ok)
      throw new ControlledExecutorError(EXECUTOR_ERROR_CODES.failed);
    // Reports have no `scanned`/`changed`/`diagnosticCount` semantics; an
    // empty summary keeps the run record minimal and schema-valid.
    return {};
  };
}

/**
 * Builds the complete static registry. The key list is the generated catalog
 * allowlist; adding a catalog key without adding a binding is a type/build
 * failure. Runtime input is still checked because scheduler data is persisted.
 */
export function createExecutorRegistry(
  options: ExecutorRegistryOptions = {},
): ExecutorRegistry {
  const executors: Record<JobExecutorKey, TaskExecutor> = {
    "refresh-usage-v1": bindUsage(options.usage),
    "refresh-skills-v1": bindPort(options.skills),
    "refresh-sessions-v1": bindPort(options.sessions),
    "apply-retention-v1": bindPort(options.retention),
    "generate-report-v1": bindReports(options.reports),
  };
  const allowed = new Set<string>(JOB_EXECUTOR_KEYS);
  return Object.freeze({
    executors: Object.freeze(executors),
    resolve(executorKey: string) {
      if (!allowed.has(executorKey))
        throw new ControlledExecutorError(EXECUTOR_ERROR_CODES.unknown);
      return executors[executorKey as JobExecutorKey];
    },
  });
}

export type { JobExecutorKey };
export type { TaskExecutionContext, TaskExecutionResult, TaskExecutor };
