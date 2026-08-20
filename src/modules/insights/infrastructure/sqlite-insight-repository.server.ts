/** SQLite persistence for optional Insight enhancement state. Rule-generated
 * facts stay in Insight Core and never enter these tables. */
import {
  DatabaseError,
  type SqliteDatabasePort,
} from "../../../platform/database/contracts.ts";
import { bigintToSafeNumber } from "../../../platform/database/infrastructure/node-sqlite-database.server.ts";
import { assertInsightLineAnalysisSafe } from "../../../platform/database/privacy-guard.server.ts";

export type InsightMode = "rules" | "enhanced-manual" | "enhanced-auto";

export interface InsightPreference {
  readonly scopeKey: string;
  readonly mode: InsightMode;
  readonly profileId: string | null;
  readonly consentVersion: string | null;
  readonly consentedAtMs: number | null;
  readonly dailyCallLimit: number | null;
  readonly updatedAtMs: number;
}

export interface InsightCacheIdentity {
  readonly surfaceId: string;
  readonly scopeHash: string;
  readonly evidenceHash: string;
  readonly locale: string;
  readonly profileId: string | null;
  readonly promptVersionId: string | null;
  readonly promptVersion: number | null;
}

export interface InsightEnhancementLine {
  readonly sequence: number;
  readonly candidateId: string | null;
  readonly analysis: string | null;
  readonly actionId: string | null;
}

export interface InsightEnhancementCache extends InsightCacheIdentity {
  readonly cacheKey: string;
  readonly modelLabel: string | null;
  readonly aiRequestId: string | null;
  readonly generatedAtMs: number;
  readonly expiresAtMs: number;
  readonly status: "ready" | "invalidated";
  readonly lines: readonly InsightEnhancementLine[];
}

function safeNumber(value: unknown): number {
  if (typeof value === "bigint") return bigintToSafeNumber(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new DatabaseError("integer-overflow", "read", { retryable: false });
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : safeNumber(value);
}

function assertEpoch(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
}

function assertIdentity(value: InsightCacheIdentity): void {
  if (
    !value.surfaceId ||
    !value.scopeHash ||
    !value.evidenceHash ||
    !value.locale
  ) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
  if (
    value.promptVersion !== null &&
    (!Number.isSafeInteger(value.promptVersion) || value.promptVersion < 0)
  ) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
}

function readPreference(
  row: Readonly<Record<string, unknown>>,
): InsightPreference {
  if (
    typeof row.scope_key !== "string" ||
    !["rules", "enhanced-manual", "enhanced-auto"].includes(String(row.mode))
  ) {
    throw new DatabaseError("corrupt", "read", { retryable: false });
  }
  return {
    scopeKey: row.scope_key,
    mode: row.mode as InsightMode,
    profileId: row.profile_id === null ? null : String(row.profile_id),
    consentVersion:
      row.consent_version === null ? null : String(row.consent_version),
    consentedAtMs: nullableNumber(row.consented_at_ms),
    dailyCallLimit: nullableNumber(row.daily_call_limit),
    updatedAtMs: safeNumber(row.updated_at_ms),
  };
}

const CACHE_COLUMNS = `cache_key, surface_id, scope_hash, evidence_hash, locale,
  profile_id, prompt_version_id, prompt_version, model_label, ai_request_id,
  generated_at_ms, expires_at_ms, status`;

function readCache(
  database: SqliteDatabasePort,
  row: Readonly<Record<string, unknown>>,
): InsightEnhancementCache {
  const cacheKey = String(row.cache_key);
  const lines = database
    .prepare(
      `SELECT sequence, candidate_id, analysis, action_id
    FROM insight_enhancement_lines WHERE cache_key = ? ORDER BY sequence`,
    )
    .all(cacheKey)
    .map((line) => ({
      sequence: safeNumber(line.sequence),
      candidateId:
        line.candidate_id === null ? null : String(line.candidate_id),
      analysis: line.analysis === null ? null : String(line.analysis),
      actionId: line.action_id === null ? null : String(line.action_id),
    }));
  return {
    cacheKey,
    surfaceId: String(row.surface_id),
    scopeHash: String(row.scope_hash),
    evidenceHash: String(row.evidence_hash),
    locale: String(row.locale),
    profileId: row.profile_id === null ? null : String(row.profile_id),
    promptVersionId:
      row.prompt_version_id === null ? null : String(row.prompt_version_id),
    promptVersion: nullableNumber(row.prompt_version),
    modelLabel: row.model_label === null ? null : String(row.model_label),
    aiRequestId: row.ai_request_id === null ? null : String(row.ai_request_id),
    generatedAtMs: safeNumber(row.generated_at_ms),
    expiresAtMs: safeNumber(row.expires_at_ms),
    status: row.status as "ready" | "invalidated",
    lines,
  };
}

export interface SqliteInsightRepository {
  getPreference(scopeKey: string): InsightPreference | undefined;
  /** Surface preference overrides global; missing preference defaults to LLM on. */
  getEffectivePreference(surfaceId: string): InsightPreference;
  setPreference(value: InsightPreference): void;
  findValid(
    identity: InsightCacheIdentity,
    nowMs: number,
  ): InsightEnhancementCache | undefined;
  /** Returns false in rules mode without writing either enhancement table. */
  saveEnhancement(input: {
    readonly mode: InsightMode;
    readonly value: InsightEnhancementCache;
    readonly forbiddenEntities?: readonly string[];
  }): boolean;
  invalidate(cacheKey: string): boolean;
  pruneExpired(nowMs: number): number;
}

export function createSqliteInsightRepository(
  database: SqliteDatabasePort,
): SqliteInsightRepository {
  function getPreference(scopeKey: string): InsightPreference | undefined {
    const row = database
      .prepare(
        `SELECT scope_key, mode, profile_id, consent_version,
      consented_at_ms, daily_call_limit, updated_at_ms FROM insight_preferences WHERE scope_key = ?`,
      )
      .get(scopeKey);
    return row ? readPreference(row) : undefined;
  }

  function writePreference(value: InsightPreference): number {
    assertEpoch(value.updatedAtMs);
    assertEpoch(value.consentedAtMs);
    if (
      value.dailyCallLimit !== null &&
      (!Number.isSafeInteger(value.dailyCallLimit) || value.dailyCallLimit < 0)
    ) {
      throw new DatabaseError("invalid-argument", "write", {
        retryable: false,
      });
    }
    const result = database
      .prepare(
        `INSERT INTO insight_preferences
      (scope_key, mode, profile_id, consent_version, consented_at_ms, daily_call_limit, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (scope_key) DO UPDATE SET mode=excluded.mode, profile_id=excluded.profile_id,
        consent_version=excluded.consent_version, consented_at_ms=excluded.consented_at_ms,
        daily_call_limit=excluded.daily_call_limit, updated_at_ms=excluded.updated_at_ms
      WHERE excluded.updated_at_ms > insight_preferences.updated_at_ms`,
      )
      .run(
        value.scopeKey,
        value.mode,
        value.profileId,
        value.consentVersion,
        value.consentedAtMs === null ? null : BigInt(value.consentedAtMs),
        value.dailyCallLimit === null ? null : BigInt(value.dailyCallLimit),
        BigInt(value.updatedAtMs),
      );
    return Number(result.changes);
  }

  return {
    getPreference,
    getEffectivePreference(surfaceId) {
      return (
        getPreference(`surface:${surfaceId}`) ??
        getPreference("global") ?? {
          scopeKey: "global",
          mode: "enhanced-auto",
          profileId: null,
          consentVersion: "1",
          consentedAtMs: 0,
          dailyCallLimit: null,
          updatedAtMs: 0,
        }
      );
    },
    setPreference(value) {
      void writePreference(value);
    },
    findValid(identity, nowMs) {
      assertIdentity(identity);
      assertEpoch(nowMs);
      const row = database
        .prepare(
          `SELECT ${CACHE_COLUMNS} FROM insight_enhancement_cache
        WHERE surface_id = ? AND scope_hash = ? AND evidence_hash = ? AND locale = ?
          AND COALESCE(profile_id, '') = ? AND COALESCE(prompt_version_id, '') = ?
          AND COALESCE(prompt_version, 0) = ? AND status = 'ready' AND expires_at_ms > ?
        LIMIT 1`,
        )
        .get(
          identity.surfaceId,
          identity.scopeHash,
          identity.evidenceHash,
          identity.locale,
          identity.profileId ?? "",
          identity.promptVersionId ?? "",
          BigInt(identity.promptVersion ?? 0),
          BigInt(nowMs),
        );
      return row ? readCache(database, row) : undefined;
    },
    saveEnhancement(input) {
      if (input.mode === "rules") return false;
      const value = input.value;
      assertIdentity(value);
      assertEpoch(value.generatedAtMs);
      assertEpoch(value.expiresAtMs);
      if (
        value.expiresAtMs <= value.generatedAtMs ||
        value.status !== "ready"
      ) {
        throw new DatabaseError("invalid-argument", "write", {
          retryable: false,
        });
      }
      const sequences = new Set<number>();
      for (const line of value.lines) {
        if (
          !Number.isSafeInteger(line.sequence) ||
          line.sequence < 0 ||
          sequences.has(line.sequence)
        ) {
          throw new DatabaseError("invalid-argument", "write", {
            retryable: false,
          });
        }
        sequences.add(line.sequence);
        if (line.analysis !== null) {
          assertInsightLineAnalysisSafe(line.analysis, {
            forbiddenEntities: input.forbiddenEntities,
          });
        }
      }
      const transaction = database.transaction();
      transaction.begin();
      try {
        const prior = database
          .prepare(
            `SELECT cache_key FROM insight_enhancement_cache
          WHERE surface_id = ? AND scope_hash = ? AND evidence_hash = ? AND locale = ?
            AND COALESCE(profile_id, '') = ? AND COALESCE(prompt_version_id, '') = ?
            AND COALESCE(prompt_version, 0) = ?`,
          )
          .get(
            value.surfaceId,
            value.scopeHash,
            value.evidenceHash,
            value.locale,
            value.profileId ?? "",
            value.promptVersionId ?? "",
            BigInt(value.promptVersion ?? 0),
          );
        if (prior)
          database
            .prepare(
              "DELETE FROM insight_enhancement_cache WHERE cache_key = ?",
            )
            .run(String(prior.cache_key));
        database
          .prepare(
            `INSERT INTO insight_enhancement_cache
          (cache_key, surface_id, scope_hash, evidence_hash, locale, profile_id,
           prompt_version_id, prompt_version, model_label, ai_request_id,
           generated_at_ms, expires_at_ms, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`,
          )
          .run(
            value.cacheKey,
            value.surfaceId,
            value.scopeHash,
            value.evidenceHash,
            value.locale,
            value.profileId,
            value.promptVersionId,
            value.promptVersion === null ? null : BigInt(value.promptVersion),
            value.modelLabel,
            value.aiRequestId,
            BigInt(value.generatedAtMs),
            BigInt(value.expiresAtMs),
          );
        const statement =
          database.prepare(`INSERT INTO insight_enhancement_lines
          (cache_key, sequence, candidate_id, analysis, action_id) VALUES (?, ?, ?, ?, ?)`);
        for (const line of value.lines) {
          statement.run(
            value.cacheKey,
            BigInt(line.sequence),
            line.candidateId,
            line.analysis,
            line.actionId,
          );
        }
        transaction.commit();
        return true;
      } catch (error) {
        try {
          transaction.rollback();
        } catch {
          /* preserve original */
        }
        throw error;
      }
    },
    invalidate(cacheKey) {
      return (
        Number(
          database
            .prepare(
              `UPDATE insight_enhancement_cache SET status = 'invalidated'
        WHERE cache_key = ? AND status = 'ready'`,
            )
            .run(cacheKey).changes,
        ) > 0
      );
    },
    pruneExpired(nowMs) {
      assertEpoch(nowMs);
      return Number(
        database
          .prepare(
            "DELETE FROM insight_enhancement_cache WHERE expires_at_ms <= ?",
          )
          .run(BigInt(nowMs)).changes,
      );
    },
  };
}
