import { z } from "zod";

import type {
  AtomicJsonStore,
  Clock,
} from "../platform/persistence/contracts.ts";

/**
 * Monotonic performance rollout (P0-T0-08).
 *
 * Every page/query adapter resolves its read path through
 * `resolvePerformanceRolloutStage`, with the priority:
 *
 *   1. emergency kill switch (`forceLegacyReadPath`, env or persisted flag)
 *   2. local rollout state (`performance-rollout.v1.json`)
 *   3. public runtime policy default (`runtime-policy.source.json` -> rollout)
 *
 * The stage sequence is monotonic: a stage can only advance to a later stage
 * or roll back to `legacy`. Jumping between non-adjacent forward stages is
 * rejected by `isLegalRolloutMigration` so the UI can never skip a gate.
 * The persisted state is intentionally NOT a second policy source — it only
 * selects among stages whose budgets live in the runtime policy.
 */

export const PERFORMANCE_ROLLOUT_STAGES = [
  "legacy",
  "shadow",
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
  legacy: 0,
  shadow: 1,
  "compact-read-model": 2,
  "snapshot-read": 3,
  "unified-refresh": 4,
  "new-default": 5,
};

/** Repository file version; bump only with a migration. */
export const PERFORMANCE_ROLLOUT_SCHEMA_VERSION = 1 as const;
export const PERFORMANCE_ROLLOUT_FILE = "performance-rollout.v1.json";

/** Env var name for the single emergency kill switch. */
export const FORCE_LEGACY_ENV = "TRUSTTOOLS_FORCE_LEGACY_READ_PATH";

export interface PerformanceRolloutState {
  readonly schemaVersion: typeof PERFORMANCE_ROLLOUT_SCHEMA_VERSION;
  readonly stage: PerformanceRolloutStage;
  /** Emergency kill switch persisted in the local repository. */
  readonly forceLegacyReadPath: boolean;
  readonly updatedAt: string | null;
}

export const DEFAULT_PERFORMANCE_ROLLOUT_STATE: PerformanceRolloutState = {
  schemaVersion: PERFORMANCE_ROLLOUT_SCHEMA_VERSION,
  stage: "legacy",
  forceLegacyReadPath: false,
  updatedAt: null,
};

export const performanceRolloutSchema = z
  .object({
    schemaVersion: z.literal(PERFORMANCE_ROLLOUT_SCHEMA_VERSION),
    stage: z.enum(PERFORMANCE_ROLLOUT_STAGES),
    forceLegacyReadPath: z.boolean(),
    updatedAt: z.string().nullable(),
  })
  .strict();

/**
 * Legal transitions are monotonic: forward (to any later stage) or rollback
 * to `legacy`. Anything else (backwards to a non-legacy stage, or sideways)
 * is rejected so a gate can never be skipped or silently undone.
 */
export function isLegalRolloutMigration(
  from: PerformanceRolloutStage,
  to: PerformanceRolloutStage,
): boolean {
  if (to === "legacy") return true;
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
  /** `TRUSTTOOLS_FORCE_LEGACY_READ_PATH` env value (or null/undefined). */
  readonly envForceLegacy?: string | null;
  /** Local persisted state (or undefined when unreadable/missing). */
  readonly state?: PerformanceRolloutState | undefined;
  /** Public policy default stage (usually "legacy"). */
  readonly defaultStage: PerformanceRolloutStage;
}

/**
 * Resolves the authoritative stage for a read path. The emergency switch wins
 * over everything; a corrupt/missing local state falls back to the policy
 * default rather than crashing page loads.
 */
export function resolvePerformanceRolloutStage(
  input: ResolveRolloutInput,
): PerformanceRolloutStage {
  const envForce = input.envForceLegacy?.trim().toLowerCase();
  if (envForce === "1" || envForce === "true") return "legacy";
  if (input.state?.forceLegacyReadPath === true) return "legacy";
  const stage = parseRolloutStage(input.state?.stage);
  return stage ?? input.defaultStage;
}

export interface PerformanceRolloutRepository {
  read(): Promise<PerformanceRolloutState>;
  /** Advances (or rolls back to legacy) the persisted stage. */
  setStage(stage: PerformanceRolloutStage): Promise<PerformanceRolloutState>;
  /** Persists the emergency kill switch. */
  setForceLegacyReadPath(flag: boolean): Promise<PerformanceRolloutState>;
}

export interface PerformanceRolloutRepositoryOptions {
  readonly store: AtomicJsonStore<PerformanceRolloutState>;
  readonly clock?: Clock;
}

export function createPerformanceRolloutRepository(
  options: PerformanceRolloutRepositoryOptions,
): PerformanceRolloutRepository {
  const clock = options.clock ?? { now: () => new Date() };
  const stamp = () => clock.now().toISOString();

  return {
    async read() {
      const result = await options.store.read();
      const value = result.value;
      if (value == null) return DEFAULT_PERFORMANCE_ROLLOUT_STATE;
      const parsed = performanceRolloutSchema.safeParse(value);
      // Corrupt/invalid state safely falls back to legacy defaults; the raw
      // value is preserved by the store (last-known-good untouched).
      return parsed.success ? parsed.data : DEFAULT_PERFORMANCE_ROLLOUT_STATE;
    },
    async setStage(stage) {
      const current = await this.read();
      if (!isLegalRolloutMigration(current.stage, stage))
        throw new TypeError("Illegal rollout migration");
      const next: PerformanceRolloutState = {
        ...current,
        stage,
        updatedAt: stamp(),
      };
      await options.store.write(next);
      return next;
    },
    async setForceLegacyReadPath(flag) {
      const current = await this.read();
      const next: PerformanceRolloutState = {
        ...current,
        forceLegacyReadPath: flag,
        updatedAt: stamp(),
      };
      await options.store.write(next);
      return next;
    },
  };
}
