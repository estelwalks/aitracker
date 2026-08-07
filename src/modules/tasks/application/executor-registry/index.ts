import { JOB_EXECUTOR_KEYS } from "../../definitions/contracts.ts";
import type { JobExecutorKey } from "../../definitions/contracts.ts";
import type {
  TaskExecutionContext,
  TaskExecutionResult,
  TaskExecutor,
} from "../scheduler.ts";
import type { UsageApplication } from "../../../usage/application/index.ts";

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

function bindNotImplemented(): TaskExecutor {
  return async () => unavailable();
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
    "generate-report-v1": bindNotImplemented(),
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
