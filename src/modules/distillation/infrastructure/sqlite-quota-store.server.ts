import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  sqliteInteger,
  sqliteText,
} from "../../../platform/database/sqlite-values.server.ts";
import {
  distillDailyQuotaLimit,
  localDateKey,
  type DistillQuota,
  type DistillQuotaPort,
} from "../quota.ts";

const PROFILE_KEY = "distillation-default";

export function createSqliteDistillQuotaStore(
  database: SqliteDatabasePort,
  options: { readonly limit?: number; readonly today?: () => string } = {},
): DistillQuotaPort {
  const limit = options.limit ?? distillDailyQuotaLimit();
  // The default clock is the *local* calendar day, matching `quota.localDateKey`
  // so `read()` and `increment()` always agree on the same key even when the
  // UTC day (new Date().toISOString()) differs across a midnight boundary.
  const today = options.today ?? (() => localDateKey(new Date()));
  const readDate = (date: string): DistillQuota => {
    const row = database
      .prepare(
        "SELECT date_key, calls FROM ai_daily_usage WHERE date_key = ? AND capability = 'distillation' AND profile_key = ?",
      )
      .get(date, PROFILE_KEY);
    return row
      ? {
          date: sqliteText(row.date_key),
          used: sqliteInteger(row.calls),
          limit,
        }
      : { date, used: 0, limit };
  };
  return {
    async read() {
      return readDate(today());
    },
    async increment(date) {
      database
        .prepare(
          `INSERT INTO ai_daily_usage
        (date_key, capability, profile_key, calls, input_tokens, output_tokens, cost_microusd, updated_at_ms)
        VALUES (?, 'distillation', ?, 1, 0, 0, 0, ?)
        ON CONFLICT (date_key, capability, profile_key) DO UPDATE SET
          calls = ai_daily_usage.calls + 1, updated_at_ms = excluded.updated_at_ms`,
        )
        .run(date, PROFILE_KEY, Date.now());
      return readDate(date);
    },
    // P2-10: atomic reserve. The read + increment happen inside one
    // synchronous transaction on the single-writer connection, so two
    // concurrent reservations can never both pass the limit check.
    async reserve(date) {
      const transaction = database.transaction();
      transaction.begin();
      try {
        const row = database
          .prepare(
            "SELECT calls FROM ai_daily_usage WHERE date_key = ? AND capability = 'distillation' AND profile_key = ?",
          )
          .get(date, PROFILE_KEY);
        if (row) {
          if (sqliteInteger(row.calls) >= limit) {
            transaction.rollback();
            return false;
          }
          database
            .prepare(
              `UPDATE ai_daily_usage SET calls = calls + 1, updated_at_ms = ?
               WHERE date_key = ? AND capability = 'distillation' AND profile_key = ?`,
            )
            .run(Date.now(), date, PROFILE_KEY);
        } else {
          if (limit <= 0) {
            transaction.rollback();
            return false;
          }
          database
            .prepare(
              `INSERT INTO ai_daily_usage
              (date_key, capability, profile_key, calls, input_tokens, output_tokens, cost_microusd, updated_at_ms)
              VALUES (?, 'distillation', ?, 1, 0, 0, 0, ?)`,
            )
            .run(date, PROFILE_KEY, Date.now());
        }
        transaction.commit();
        return true;
      } catch (error) {
        try {
          transaction.rollback();
        } catch {
          // Preserve the original failure.
        }
        throw error;
      }
    },
  };
}
