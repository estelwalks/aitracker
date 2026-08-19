/** Privacy-safe SQLite audit and daily-budget adapter for AI execution. */
import {
  DatabaseError,
  type SqliteDatabasePort,
} from "../../../platform/database/contracts.ts";
import type {
  AIExecutionSummary,
  AIExecutionStatus,
  TokenUsage,
} from "../contracts.ts";

export type AICapability =
  "distillation" | "report" | "security" | "page-insight";
export type InsightExecutionMode =
  "rules" | "enhanced-manual" | "enhanced-auto";
type PersistedStatus =
  | "completed"
  | "offline"
  | "fallback"
  | "budget"
  | "timeout"
  | "cancelled"
  | "failed";

export interface AIExecutionPersistenceInput {
  readonly capability: AICapability;
  readonly profileId?: string;
  readonly summary: AIExecutionSummary;
  /** SHA-256/opaque digest only. Provider input and prompt text are forbidden. */
  readonly inputFingerprint?: string;
  readonly usage?: Pick<TokenUsage, "inputTokens" | "outputTokens">;
  readonly costMicrousd?: bigint;
  readonly startedAtMs?: number;
  readonly finishedAtMs?: number;
  readonly durationMs?: number;
}

export interface AIDailyUsageKey {
  readonly dateKey: string;
  readonly capability: AICapability;
  readonly profileKey: string;
}

export interface AIDailyUsage extends AIDailyUsageKey {
  readonly calls: bigint;
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly costMicrousd: bigint;
  readonly updatedAtMs: number;
}

export interface AIExecutionAuditView {
  readonly requestId: string;
  readonly capability: AICapability;
  readonly profileId: string | null;
  readonly providerId: string | null;
  readonly modelId: string | null;
  readonly promptVersionId: string;
  readonly promptVersion: bigint;
  readonly status: PersistedStatus;
  readonly usedFallback: boolean;
  readonly inputTokens: bigint | null;
  readonly outputTokens: bigint | null;
  readonly costMicrousd: bigint | null;
  readonly errorCode: string | null;
  readonly startedAtMs: number | null;
  readonly finishedAtMs: number | null;
  readonly durationMs: number | null;
}

export type BudgetedExecutionResult =
  | { readonly outcome: "rules"; readonly recorded: false }
  | {
      readonly outcome: "budget-exceeded";
      readonly recorded: true;
      readonly usage: AIDailyUsage;
    }
  | {
      readonly outcome: "recorded";
      readonly recorded: true;
      readonly usage: AIDailyUsage;
    };

function toBigInt(value: unknown, nullable = false): bigint | null {
  if (value === null && nullable) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
  throw new DatabaseError("integer-overflow", "read", { retryable: false });
}

function toOptionalEpoch(value: unknown): number | null {
  if (value === null) return null;
  const integer = toBigInt(value);
  if (integer! > BigInt(Number.MAX_SAFE_INTEGER) || integer! < 0n) {
    throw new DatabaseError("integer-overflow", "read", { retryable: false });
  }
  return Number(integer);
}

function assertNonNegative(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
}

function validate(input: AIExecutionPersistenceInput): void {
  assertNonNegative(input.usage?.inputTokens);
  assertNonNegative(input.usage?.outputTokens);
  assertNonNegative(input.startedAtMs);
  assertNonNegative(input.finishedAtMs);
  assertNonNegative(input.durationMs);
  if (input.costMicrousd !== undefined && input.costMicrousd < 0n) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
  if (
    input.inputFingerprint !== undefined &&
    !/^[a-f0-9]{64}$/iu.test(input.inputFingerprint)
  ) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
}

function persistedStatus(status: AIExecutionStatus): PersistedStatus {
  return status === "budget-exceeded" ? "budget" : status;
}

function insertExecution(
  database: SqliteDatabasePort,
  input: AIExecutionPersistenceInput,
  statusOverride?: PersistedStatus,
): boolean {
  validate(input);
  const costConfidence = input.summary.cost.confidence;
  const result = database
    .prepare(
      `INSERT INTO ai_executions
    (request_id, capability, profile_id, provider_id, model_id, prompt_version_id,
     prompt_version, input_fingerprint, status, used_fallback, input_tokens,
     output_tokens, cost_microusd, cost_confidence, error_code, started_at_ms,
     finished_at_ms, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (request_id) DO NOTHING`,
    )
    .run(
      input.summary.requestId,
      input.capability,
      input.profileId ?? null,
      input.summary.providerId ?? null,
      input.summary.modelId,
      input.summary.promptVersionId,
      BigInt(input.summary.promptVersion),
      input.inputFingerprint ?? null,
      statusOverride ?? persistedStatus(input.summary.status),
      input.summary.usedFallback ? 1n : 0n,
      input.usage ? BigInt(input.usage.inputTokens) : null,
      input.usage ? BigInt(input.usage.outputTokens) : null,
      input.costMicrousd ?? null,
      costConfidence,
      statusOverride === "budget"
        ? "ai.budget-exceeded"
        : (input.summary.errorCode ?? null),
      input.startedAtMs === undefined ? null : BigInt(input.startedAtMs),
      input.finishedAtMs === undefined ? null : BigInt(input.finishedAtMs),
      input.durationMs === undefined ? null : BigInt(input.durationMs),
    );
  return Number(result.changes) > 0;
}

function readUsage(row: Readonly<Record<string, unknown>>): AIDailyUsage {
  if (
    typeof row.date_key !== "string" ||
    typeof row.capability !== "string" ||
    typeof row.profile_key !== "string"
  ) {
    throw new DatabaseError("corrupt", "read", { retryable: false });
  }
  return {
    dateKey: row.date_key,
    capability: row.capability as AICapability,
    profileKey: row.profile_key,
    calls: toBigInt(row.calls)!,
    inputTokens: toBigInt(row.input_tokens)!,
    outputTokens: toBigInt(row.output_tokens)!,
    costMicrousd: toBigInt(row.cost_microusd)!,
    updatedAtMs: toOptionalEpoch(row.updated_at_ms)!,
  };
}

function assertUsageKey(key: AIDailyUsageKey): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(key.dateKey) ||
    key.profileKey.trim() === ""
  ) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
}

export interface SqliteAIExecutionRepository {
  getUsage(key: AIDailyUsageKey): AIDailyUsage;
  listRecent(limit?: number): AIExecutionAuditView[];
  /** Rules mode returns without touching either AI table. Enhanced modes atomically
   * check/increment the daily budget and insert the execution audit row. */
  recordWithBudget(input: {
    readonly mode: InsightExecutionMode;
    readonly key: AIDailyUsageKey;
    readonly dailyCallLimit: number | null;
    readonly execution: AIExecutionPersistenceInput;
    readonly nowMs: number;
  }): BudgetedExecutionResult;
  /** Idempotent import of legacy daily quota aggregates. */
  importLegacyUsage(rows: readonly AIDailyUsage[]): {
    insertedOrUpdated: number;
  };
}

export function createSqliteAIExecutionRepository(
  database: SqliteDatabasePort,
): SqliteAIExecutionRepository {
  const selectUsage = `SELECT date_key, capability, profile_key, calls, input_tokens,
    output_tokens, cost_microusd, updated_at_ms FROM ai_daily_usage
    WHERE date_key = ? AND capability = ? AND profile_key = ?`;

  function getUsage(key: AIDailyUsageKey): AIDailyUsage {
    assertUsageKey(key);
    const row = database
      .prepare(selectUsage)
      .get(key.dateKey, key.capability, key.profileKey);
    return row
      ? readUsage(row)
      : {
          ...key,
          calls: 0n,
          inputTokens: 0n,
          outputTokens: 0n,
          costMicrousd: 0n,
          updatedAtMs: 0,
        };
  }

  return {
    getUsage,
    listRecent(limit = 100) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
        throw new DatabaseError("invalid-argument", "read", {
          retryable: false,
        });
      }
      return database
        .prepare(
          `SELECT request_id, capability, profile_id, provider_id, model_id,
        prompt_version_id, prompt_version, status, used_fallback, input_tokens,
        output_tokens, cost_microusd, error_code, started_at_ms, finished_at_ms, duration_ms
        FROM ai_executions ORDER BY COALESCE(started_at_ms, 0) DESC, request_id DESC LIMIT ?`,
        )
        .all(BigInt(limit))
        .map((row) => ({
          requestId: String(row.request_id),
          capability: row.capability as AICapability,
          profileId: row.profile_id === null ? null : String(row.profile_id),
          providerId: row.provider_id === null ? null : String(row.provider_id),
          modelId: row.model_id === null ? null : String(row.model_id),
          promptVersionId: String(row.prompt_version_id),
          promptVersion: toBigInt(row.prompt_version)!,
          status: row.status as PersistedStatus,
          usedFallback: toBigInt(row.used_fallback)! === 1n,
          inputTokens: toBigInt(row.input_tokens, true),
          outputTokens: toBigInt(row.output_tokens, true),
          costMicrousd: toBigInt(row.cost_microusd, true),
          errorCode: row.error_code === null ? null : String(row.error_code),
          startedAtMs: toOptionalEpoch(row.started_at_ms),
          finishedAtMs: toOptionalEpoch(row.finished_at_ms),
          durationMs: toOptionalEpoch(row.duration_ms),
        }));
    },
    recordWithBudget(input) {
      if (input.mode === "rules") return { outcome: "rules", recorded: false };
      assertUsageKey(input.key);
      assertNonNegative(input.nowMs);
      if (
        input.dailyCallLimit !== null &&
        (!Number.isSafeInteger(input.dailyCallLimit) ||
          input.dailyCallLimit < 0)
      ) {
        throw new DatabaseError("invalid-argument", "write", {
          retryable: false,
        });
      }
      const transaction = database.transaction();
      transaction.begin();
      try {
        const current = getUsage(input.key);
        if (
          input.dailyCallLimit !== null &&
          current.calls >= BigInt(input.dailyCallLimit)
        ) {
          insertExecution(database, input.execution, "budget");
          transaction.commit();
          return { outcome: "budget-exceeded", recorded: true, usage: current };
        }
        const inserted = insertExecution(database, input.execution);
        if (!inserted) {
          transaction.commit();
          return { outcome: "recorded", recorded: true, usage: current };
        }
        database
          .prepare(
            `INSERT INTO ai_daily_usage
          (date_key, capability, profile_key, calls, input_tokens, output_tokens, cost_microusd, updated_at_ms)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?)
          ON CONFLICT (date_key, capability, profile_key) DO UPDATE SET
            calls = ai_daily_usage.calls + 1,
            input_tokens = ai_daily_usage.input_tokens + excluded.input_tokens,
            output_tokens = ai_daily_usage.output_tokens + excluded.output_tokens,
            cost_microusd = ai_daily_usage.cost_microusd + excluded.cost_microusd,
            updated_at_ms = excluded.updated_at_ms`,
          )
          .run(
            input.key.dateKey,
            input.key.capability,
            input.key.profileKey,
            BigInt(input.execution.usage?.inputTokens ?? 0),
            BigInt(input.execution.usage?.outputTokens ?? 0),
            input.execution.costMicrousd ?? 0n,
            BigInt(input.nowMs),
          );
        const usage = getUsage(input.key);
        transaction.commit();
        return { outcome: "recorded", recorded: true, usage };
      } catch (error) {
        try {
          transaction.rollback();
        } catch {
          /* keep original */
        }
        throw error;
      }
    },
    importLegacyUsage(rows) {
      const transaction = database.transaction();
      transaction.begin();
      try {
        let insertedOrUpdated = 0;
        for (const row of rows) {
          assertUsageKey(row);
          assertNonNegative(row.updatedAtMs);
          if (
            row.calls < 0n ||
            row.inputTokens < 0n ||
            row.outputTokens < 0n ||
            row.costMicrousd < 0n
          ) {
            throw new DatabaseError("invalid-argument", "write", {
              retryable: false,
            });
          }
          const result = database
            .prepare(
              `INSERT INTO ai_daily_usage
            (date_key, capability, profile_key, calls, input_tokens, output_tokens, cost_microusd, updated_at_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (date_key, capability, profile_key) DO UPDATE SET calls=excluded.calls,
              input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
              cost_microusd=excluded.cost_microusd, updated_at_ms=excluded.updated_at_ms
            WHERE excluded.updated_at_ms > ai_daily_usage.updated_at_ms`,
            )
            .run(
              row.dateKey,
              row.capability,
              row.profileKey,
              row.calls,
              row.inputTokens,
              row.outputTokens,
              row.costMicrousd,
              BigInt(row.updatedAtMs),
            );
          insertedOrUpdated += Number(result.changes);
        }
        transaction.commit();
        return { insertedOrUpdated };
      } catch (error) {
        try {
          transaction.rollback();
        } catch {
          /* keep original */
        }
        throw error;
      }
    },
  };
}
