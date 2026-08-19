import { z } from "zod";

/**
 * SQLite-backed performance rollout state. File-backed and dual-read rollout
 * phases were removed when SQLite became the only application data store.
 */

export const PERFORMANCE_ROLLOUT_STAGES = [
  "compact-read-model",
  "snapshot-read",
  "unified-refresh",
  "new-default",
] as const;
export type PerformanceRolloutStage =
  (typeof PERFORMANCE_ROLLOUT_STAGES)[number];

export const ROLLOUT_STAGE_ORDER: Readonly<
  Record<PerformanceRolloutStage, number>
> = {
  "compact-read-model": 0,
  "snapshot-read": 1,
  "unified-refresh": 2,
  "new-default": 3,
};

export const PERFORMANCE_ROLLOUT_SCHEMA_VERSION = 1 as const;

export interface PerformanceRolloutState {
  readonly schemaVersion: typeof PERFORMANCE_ROLLOUT_SCHEMA_VERSION;
  readonly stage: PerformanceRolloutStage;
  readonly updatedAt: string | null;
}

export const DEFAULT_PERFORMANCE_ROLLOUT_STATE: PerformanceRolloutState = {
  schemaVersion: PERFORMANCE_ROLLOUT_SCHEMA_VERSION,
  stage: "new-default",
  updatedAt: null,
};

export const performanceRolloutSchema = z
  .object({
    schemaVersion: z.literal(PERFORMANCE_ROLLOUT_SCHEMA_VERSION),
    stage: z.enum(PERFORMANCE_ROLLOUT_STAGES),
    updatedAt: z.string().nullable(),
  })
  .strict();

/**
 * Legal transitions are monotonic. Rollback into a removed file-backed phase
 * is intentionally impossible.
 */
export function isLegalRolloutMigration(
  from: PerformanceRolloutStage,
  to: PerformanceRolloutStage,
): boolean {
  return ROLLOUT_STAGE_ORDER[to] > ROLLOUT_STAGE_ORDER[from];
}

export function parseRolloutStage(
  value: unknown,
): PerformanceRolloutStage | undefined {
  if (typeof value !== "string") return undefined;
  return (PERFORMANCE_ROLLOUT_STAGES as readonly string[]).includes(value)
    ? (value as PerformanceRolloutStage)
    : undefined;
}

export interface ResolveRolloutInput {
  /** Local SQLite state (or undefined before the first persisted update). */
  readonly state?: PerformanceRolloutState | undefined;
  /** Public policy default stage (from the runtime policy source). */
  readonly defaultStage: PerformanceRolloutStage;
}

/**
 * Resolves the authoritative SQLite stage for a read path.
 */
export function resolvePerformanceRolloutStage(
  input: ResolveRolloutInput,
): PerformanceRolloutStage {
  const stage = parseRolloutStage(input.state?.stage);
  return stage ?? input.defaultStage;
}

export interface PerformanceRolloutRepository {
  read(): Promise<PerformanceRolloutState>;
  /** Advances the persisted stage. */
  setStage(stage: PerformanceRolloutStage): Promise<PerformanceRolloutState>;
}
