import { ENV } from "../../lib/app-config.ts";

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
 * `AITRACKER_DISTILL_DAILY_QUOTA` (see `ENV.DISTILL_DAILY_QUOTA`), falling
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
  /**
   * Atomically reserve one real-model call against `date` (P2-10). The check
   * and the increment happen in one ledger write, so concurrent reservations
   * can never overshoot the daily limit. Returns `true` when the call was
   * counted, `false` when the day's limit is already exhausted. A successful
   * reservation counts even if the model run later fails — the quota is an
   * upper-bound control, not an exact billing counter.
   */
  reserve(date: string): Promise<boolean>;
}
