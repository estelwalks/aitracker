/** Nominal ID brands prevent unrelated string identifiers from being mixed. */
declare const idBrand: unique symbol;

type BrandedId<TBrand extends string> = string & {
  readonly [idBrand]: TBrand;
};

export type TaskId = BrandedId<"TaskId">;
export type RunId = BrandedId<"RunId">;
export type CorrelationId = BrandedId<"CorrelationId">;

const TASK_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function requireId<TBrand extends string>(
  value: string,
  pattern: RegExp,
  kind: string,
): BrandedId<TBrand> {
  if (!pattern.test(value)) {
    throw new TypeError(`Invalid ${kind}`);
  }
  return value as BrandedId<TBrand>;
}

export function isTaskId(value: unknown): value is TaskId {
  return typeof value === "string" && TASK_ID_PATTERN.test(value);
}

export function isRunId(value: unknown): value is RunId {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

export function isCorrelationId(value: unknown): value is CorrelationId {
  return typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
}

export function createTaskId(value: string): TaskId {
  return requireId<"TaskId">(value, TASK_ID_PATTERN, "TaskId");
}

export function createRunId(value: string): RunId {
  return requireId<"RunId">(value, OPAQUE_ID_PATTERN, "RunId");
}

export function createCorrelationId(value: string): CorrelationId {
  return requireId<"CorrelationId">(value, OPAQUE_ID_PATTERN, "CorrelationId");
}
