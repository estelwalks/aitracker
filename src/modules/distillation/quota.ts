import { z } from "zod";

import { ENV } from "../../lib/app-config.ts";
import type { JsonSchema } from "../../test-support/json-schema.ts";

/**
 * Story B-600 — server-side daily quota for real-model distillation calls.
 *
 * Only genuine model calls (a saved S-500 model profile) consume quota,
 * because only they can incur real provider cost. Offline distillation is
 * deterministic and free, so it is never counted.
 *
 * The ledger is authoritative on the server: SQLite stores `{ date, used }`
 * and the renderer only reads the `{ used, limit, remaining }` projection.
 *
 * Failure policy mirrors the rest of the module: a missing or failing quota
 * port degrades to unlimited (distillation must never be blocked by quota
 * bookkeeping itself).
 */

/** Default daily ceiling for real-model distillation calls. */
export const DISTILL_DAILY_QUOTA = 20;

/** Local calendar-day key (`YYYY-MM-DD`); a new day resets the counter. */
export function localDateKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Read the configured daily limit. Prefers a positive integer from
 * `TRUSTTOOLS_DISTILL_DAILY_QUOTA` (see `ENV.DISTILL_DAILY_QUOTA`), falling
 * back to `DISTILL_DAILY_QUOTA` for unset/invalid values.
 */
export function distillDailyQuotaLimit(
  getEnv: () => Record<string, string | undefined> = () => process.env,
): number {
  const raw = getEnv()[ENV.DISTILL_DAILY_QUOTA];
  if (raw == null || raw.trim() === "") return DISTILL_DAILY_QUOTA;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DISTILL_DAILY_QUOTA;
}

/** Read-only quota state exposed to the application and read model. */
export interface DistillQuota {
  /** Local `YYYY-MM-DD` key the counter currently belongs to. */
  readonly date: string;
  /** Number of real-model distillation calls recorded for `date`. */
  readonly used: number;
  /** Daily ceiling (`DISTILL_DAILY_QUOTA` or the env override). */
  readonly limit: number;
}

/** Server-side quota ledger port. Never exposed to the renderer. */
export interface DistillQuotaPort {
  /** Current quota state (today's row or an empty row for a fresh day). */
  read(): Promise<DistillQuota>;
  /**
   * Record one real-model call against `date`. Same-date calls accumulate;
   * a different date resets the counter to 1.
   */
  increment(date: string): Promise<DistillQuota>;
}

/** Persisted quota row shape — deliberately limit-free. */
export interface DistillQuotaFile {
  readonly date: string;
  readonly used: number;
}

export const DISTILL_QUOTA_SCHEMA_VERSION = 1 as const;

const DistillQuotaFileSchema = z
  .object({
    date: z.string(),
    used: z.number().int().min(0),
  })
  .strict();

export type PersistedDistillQuotaFile = z.infer<typeof DistillQuotaFileSchema>;

export const DEFAULT_DISTILL_QUOTA_FILE: DistillQuotaFile = {
  date: "",
  used: 0,
};

/** Validation schema for the persisted quota state. */
export function distillQuotaStoreSchema(): JsonSchema<DistillQuotaFile> {
  return {
    currentVersion: DISTILL_QUOTA_SCHEMA_VERSION,
    parse(value: unknown): DistillQuotaFile {
      return DistillQuotaFileSchema.parse(value);
    },
  };
}

export interface AtomicDistillQuotaStoreOptions {
  /** Injectable document port retained for focused unit tests. */
  readonly store: {
    read(): Promise<{ readonly value: DistillQuotaFile }>;
    write(value: DistillQuotaFile): Promise<void>;
  };
  /** Overrides the daily limit; defaults to `distillDailyQuotaLimit()`. */
  readonly limit?: number;
}

/**
 * Test adapter over an injected quota document port. Production uses the
 * SQLite quota repository.
 */
export function createAtomicDistillQuotaStore(
  options: AtomicDistillQuotaStoreOptions,
): DistillQuotaPort {
  const limit = options.limit ?? distillDailyQuotaLimit();
  return {
    async read(): Promise<DistillQuota> {
      const { value } = await options.store.read();
      return { date: value.date, used: value.used, limit };
    },
    async increment(date: string): Promise<DistillQuota> {
      const { value } = await options.store.read();
      const used = value.date === date ? value.used + 1 : 1;
      const next: DistillQuotaFile = { date, used };
      await options.store.write(next);
      return { date: next.date, used: next.used, limit };
    },
  };
}
