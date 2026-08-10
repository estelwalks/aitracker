import type { CorrelationId, RunId, TaskId } from "../../shared/ids.ts";

/** Framework-neutral correlation fields carried by a single operation. */
export interface CorrelationContextValue {
  readonly correlationId: CorrelationId;
  readonly module?: string;
  readonly taskId?: TaskId;
  readonly runId?: RunId;
}

/**
 * The application layer depends on this port rather than Node async hooks.
 * Implementations must restore the previous value when `run` completes.
 */
export interface CorrelationContext {
  current(): CorrelationContextValue | undefined;
  run<T>(value: CorrelationContextValue, operation: () => T): T;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogOutcome = "success" | "failure" | "skipped" | "cancelled";

/** Scalar diagnostics only; raw inputs, commands and bodies are not log data. */
export type LogAttributes = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

export interface ObservationInput {
  readonly level: LogLevel;
  /** A stable dotted identifier, not a human-readable message. */
  readonly event: string;
  readonly module: string;
  readonly taskId?: TaskId;
  readonly runId?: RunId;
  readonly correlationId?: CorrelationId;
  readonly durationMs?: number;
  readonly outcome: LogOutcome;
  readonly errorCode?: `errors.${string}`;
  readonly attributes?: LogAttributes;
}

/** The complete JSONL record shape. It intentionally has no message/body field. */
export interface ObservationLogEntry extends Omit<
  ObservationInput,
  "taskId" | "runId" | "correlationId"
> {
  readonly timestamp: string;
  /** Null makes the JSONL schema stable for operations not owned by a Job. */
  readonly taskId: TaskId | null;
  readonly runId: RunId | null;
  readonly correlationId: CorrelationId | null;
  readonly attributes?: Readonly<
    Record<string, string | number | boolean | null>
  >;
}

export interface ObservationLogger {
  write(input: ObservationInput): Promise<void>;
}

export type MetricKind = "counter" | "duration";

export interface MetricSnapshot {
  readonly name: string;
  readonly kind: MetricKind;
  readonly count: number;
  readonly sum: number;
  readonly min?: number;
  readonly max?: number;
}

export interface MetricSink {
  increment(name: string, amount?: number): void;
  observeDuration(name: string, durationMs: number): void;
  snapshot(): readonly MetricSnapshot[];
}
