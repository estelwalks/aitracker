import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  sqliteInteger,
  sqliteText,
} from "../../../platform/database/sqlite-values.server.ts";
import {
  distillDailyQuotaLimit,
  type DistillQuota,
  type DistillQuotaPort,
} from "../quota.ts";

const PROFILE_KEY = "distillation-default";

export function createSqliteDistillQuotaStore(
  database: SqliteDatabasePort,
  options: { readonly limit?: number; readonly today?: () => string } = {},
): DistillQuotaPort {
  const limit = options.limit ?? distillDailyQuotaLimit();
  const today = options.today ?? (() => new Date().toISOString().slice(0, 10));
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
  };
}
