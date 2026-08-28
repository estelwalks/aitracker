/** SQLite persistence for optional Insight enhancement state. Rule-generated
 * facts stay in Insight Core and never enter these tables. */
import {
  DatabaseError,
  type SqliteDatabasePort,
} from "../../../platform/database/contracts.ts";
import { bigintToSafeNumber } from "../../../platform/database/infrastructure/node-sqlite-database.server.ts";
import { assertInsightLineAnalysisSafe } from "../../../platform/database/privacy-guard.server.ts";
import {
  DEFAULT_INSIGHT_REFRESH_INTERVAL_MS,
  MAX_INSIGHT_REFRESH_INTERVAL_MS,
  MIN_INSIGHT_REFRESH_INTERVAL_MS,
} from "../page/contracts.ts";

const REFRESH_INTERVAL_PREFERENCE_KEY = "insight.refreshIntervalMs";
const REFRESH_GENERATION_PREFERENCE_KEY = "insight.refreshGeneration";
const ACTIVE_REFRESH_SLOT = "page-insights";

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

export type InsightRefreshRunStatus = "queued" | "running" | "completed";
export type InsightRefreshItemStatus =
  "queued" | "running" | "completed" | "failed" | "skipped";

export interface InsightRefreshRunView {
  readonly runId: string;
  readonly locale: string;
  readonly generation: number;
  readonly status: InsightRefreshRunStatus;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly createdAtMs: number;
  readonly startedAtMs: number | null;
  readonly finishedAtMs: number | null;
}

export interface InsightRefreshWorkItem {
  readonly surfaceId: string;
  readonly scopeJson: string;
}

/** `InsightRefreshWorkItem` plus persisted execution state (settings progress). */
export interface InsightRefreshItemView extends InsightRefreshWorkItem {
  readonly status: InsightRefreshItemStatus;
  readonly resultStatus: string | null;
  readonly resultDetail: string | null;
  readonly finishedAtMs: number | null;
}

export interface InsightGenerationReservation {
  readonly reservationKey: string;
  readonly generation: number;
  readonly timeBucket: number;
  readonly identity: InsightCacheIdentity;
  readonly ownerId: string;
  readonly status: "running" | "completed" | "failed";
  readonly resultStatus: string | null;
  readonly createdAtMs: number;
  readonly finishedAtMs: number | null;
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
  getRefreshIntervalMs(): number;
  setRefreshIntervalMs(value: number, updatedAtMs: number): void;
  setPreference(value: InsightPreference): void;
  findValid(
    identity: InsightCacheIdentity,
    nowMs: number,
  ): InsightEnhancementCache | undefined;
  /**
   * Returns the newest valid enhancement for the same page/scope/model
   * identity, even when the underlying evidence hash has changed. The
   * configured expiry is the freshness boundary for AI text; current rule
   * facts remain owned by the page read model.
   */
  findLatestValid?(
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
  /** Mark ready enhancements for one page surface stale. */
  invalidateSurface?(surfaceId: string): number;
  /** Mark every persisted enhancement stale after the active model changes. */
  invalidateAll?(): number;
  pruneExpired(nowMs: number): number;
  getRefreshGeneration?(): number;
  getRefreshGenerationStartedAtMs?(): number;
  hasActiveRefreshRun?(): boolean;
  startRefreshRun?(input: {
    readonly runId: string;
    readonly locale: string;
    readonly items: readonly InsightRefreshWorkItem[];
    readonly nowMs: number;
  }): { readonly created: boolean; readonly run: InsightRefreshRunView };
  getRefreshRun?(runId: string): InsightRefreshRunView | undefined;
  listRefreshItems?(runId: string): readonly InsightRefreshItemView[];
  startRefreshItem?(
    runId: string,
    item: InsightRefreshWorkItem,
    nowMs: number,
  ): boolean;
  finishRefreshItem?(input: {
    readonly runId: string;
    readonly item: InsightRefreshWorkItem;
    readonly status: Exclude<InsightRefreshItemStatus, "queued" | "running">;
    readonly resultStatus: string;
    /** Renderer-safe failure attribution of the final attempt, if any. */
    readonly resultDetail?: string | null;
    readonly nowMs: number;
  }): InsightRefreshRunView;
  /**
   * Crash recovery, safe to run once per process start: fails any run still
   * queued/running (re-queuing its in-flight items as failed) and fails any
   * reservation stuck in 'running'. Completed caches are preserved.
   */
  recoverStaleState?(nowMs: number): {
    readonly runs: number;
    readonly items: number;
    readonly reservations: number;
  };
  claimGeneration?(
    value: Omit<
      InsightGenerationReservation,
      "status" | "resultStatus" | "finishedAtMs"
    >,
  ): {
    readonly claimed: boolean;
    readonly reservation: InsightGenerationReservation;
  };
  finishGeneration?(input: {
    readonly reservationKey: string;
    readonly ownerId: string;
    readonly status: "completed" | "failed";
    readonly resultStatus: string;
    readonly nowMs: number;
  }): boolean;
}

function readRefreshRun(
  row: Readonly<Record<string, unknown>>,
): InsightRefreshRunView {
  return {
    runId: String(row.run_id),
    locale: String(row.locale),
    generation: safeNumber(row.generation),
    status: row.status as InsightRefreshRunStatus,
    total: safeNumber(row.total_items),
    completed: safeNumber(row.completed_items),
    failed: safeNumber(row.failed_items),
    skipped: safeNumber(row.skipped_items),
    createdAtMs: safeNumber(row.created_at_ms),
    startedAtMs: nullableNumber(row.started_at_ms),
    finishedAtMs: nullableNumber(row.finished_at_ms),
  };
}

const REFRESH_RUN_COLUMNS = `run_id, locale, generation, status, total_items,
  completed_items, failed_items, skipped_items, created_at_ms, started_at_ms,
  finished_at_ms`;

function readGenerationReservation(
  row: Readonly<Record<string, unknown>>,
): InsightGenerationReservation {
  return {
    reservationKey: String(row.reservation_key),
    generation: safeNumber(row.generation),
    timeBucket: safeNumber(row.time_bucket),
    identity: {
      surfaceId: String(row.surface_id),
      scopeHash: String(row.scope_hash),
      evidenceHash: String(row.evidence_hash),
      locale: String(row.locale),
      profileId: String(row.profile_id),
      promptVersionId: String(row.prompt_version_id),
      promptVersion: safeNumber(row.prompt_version),
    },
    ownerId: String(row.owner_id),
    status: row.status as InsightGenerationReservation["status"],
    resultStatus: row.result_status === null ? null : String(row.result_status),
    createdAtMs: safeNumber(row.created_at_ms),
    finishedAtMs: nullableNumber(row.finished_at_ms),
  };
}

export function createSqliteInsightRepository(
  database: SqliteDatabasePort,
): SqliteInsightRepository {
  function getRefreshIntervalMs(): number {
    const row = database
      .prepare(
        "SELECT value_json FROM app_preferences WHERE preference_key = ?",
      )
      .get(REFRESH_INTERVAL_PREFERENCE_KEY);
    if (!row || typeof row.value_json !== "string") {
      return DEFAULT_INSIGHT_REFRESH_INTERVAL_MS;
    }
    try {
      const value = JSON.parse(row.value_json);
      return Number.isSafeInteger(value) &&
        value >= MIN_INSIGHT_REFRESH_INTERVAL_MS &&
        value <= MAX_INSIGHT_REFRESH_INTERVAL_MS
        ? value
        : DEFAULT_INSIGHT_REFRESH_INTERVAL_MS;
    } catch {
      return DEFAULT_INSIGHT_REFRESH_INTERVAL_MS;
    }
  }

  function setRefreshIntervalMs(value: number, updatedAtMs: number): void {
    if (
      !Number.isSafeInteger(value) ||
      value < MIN_INSIGHT_REFRESH_INTERVAL_MS ||
      value > MAX_INSIGHT_REFRESH_INTERVAL_MS ||
      !Number.isSafeInteger(updatedAtMs) ||
      updatedAtMs < 0
    ) {
      throw new DatabaseError("invalid-argument", "write", {
        retryable: false,
      });
    }
    database
      .prepare(
        `INSERT INTO app_preferences (preference_key, value_json, value_type, updated_at_ms)
         VALUES (?, ?, 'number', ?)
         ON CONFLICT (preference_key) DO UPDATE SET
           value_json = excluded.value_json,
           value_type = excluded.value_type,
           updated_at_ms = excluded.updated_at_ms
         WHERE excluded.updated_at_ms > app_preferences.updated_at_ms
            OR (excluded.updated_at_ms = app_preferences.updated_at_ms
                AND excluded.value_json <> app_preferences.value_json)`,
      )
      .run(
        REFRESH_INTERVAL_PREFERENCE_KEY,
        JSON.stringify(value),
        BigInt(updatedAtMs),
      );
  }

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

  function getRefreshGeneration(): number {
    const row = database
      .prepare(
        "SELECT value_json FROM app_preferences WHERE preference_key = ?",
      )
      .get(REFRESH_GENERATION_PREFERENCE_KEY);
    if (!row || typeof row.value_json !== "string") return 0;
    try {
      const value = JSON.parse(row.value_json);
      return Number.isSafeInteger(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  function getRefreshGenerationStartedAtMs(): number {
    const row = database
      .prepare(
        "SELECT updated_at_ms FROM app_preferences WHERE preference_key = ?",
      )
      .get(REFRESH_GENERATION_PREFERENCE_KEY);
    return row ? safeNumber(row.updated_at_ms) : 0;
  }

  function hasActiveRefreshRun(): boolean {
    return (
      database
        .prepare(
          "SELECT run_id FROM insight_refresh_runs WHERE active_slot = ?",
        )
        .get(ACTIVE_REFRESH_SLOT) !== undefined
    );
  }

  function getRefreshRun(runId: string): InsightRefreshRunView | undefined {
    const row = database
      .prepare(
        `SELECT ${REFRESH_RUN_COLUMNS} FROM insight_refresh_runs WHERE run_id = ?`,
      )
      .get(runId);
    return row ? readRefreshRun(row) : undefined;
  }

  return {
    getPreference,
    getRefreshIntervalMs,
    setRefreshIntervalMs,
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
      // Preference writes must complete before the server function returns.
      // The renderer broadcasts a refresh immediately after saving; a
      // fire-and-forget write could make that refresh observe the old mode.
      writePreference(value);
    },
    getRefreshGeneration,
    getRefreshGenerationStartedAtMs,
    hasActiveRefreshRun,
    startRefreshRun(input) {
      assertEpoch(input.nowMs);
      if (!input.runId || !input.locale || input.items.length === 0) {
        throw new DatabaseError("invalid-argument", "write", {
          retryable: false,
        });
      }
      const transaction = database.transaction();
      transaction.begin();
      try {
        const active = database
          .prepare(
            `SELECT ${REFRESH_RUN_COLUMNS} FROM insight_refresh_runs WHERE active_slot = ?`,
          )
          .get(ACTIVE_REFRESH_SLOT);
        if (active) {
          transaction.commit();
          return { created: false, run: readRefreshRun(active) };
        }
        const generation = getRefreshGeneration() + 1;
        database
          .prepare(
            `INSERT INTO app_preferences
              (preference_key, value_json, value_type, updated_at_ms)
             VALUES (?, ?, 'number', ?)
             ON CONFLICT (preference_key) DO UPDATE SET
               value_json = excluded.value_json,
               value_type = excluded.value_type,
               updated_at_ms = excluded.updated_at_ms`,
          )
          .run(
            REFRESH_GENERATION_PREFERENCE_KEY,
            JSON.stringify(generation),
            BigInt(input.nowMs),
          );
        database
          .prepare(
            "UPDATE insight_enhancement_cache SET status = 'invalidated' WHERE status = 'ready'",
          )
          .run();
        database
          .prepare(
            `INSERT INTO insight_refresh_runs
              (run_id, active_slot, locale, generation, status, total_items,
               completed_items, failed_items, skipped_items, created_at_ms)
             VALUES (?, ?, ?, ?, 'queued', ?, 0, 0, 0, ?)`,
          )
          .run(
            input.runId,
            ACTIVE_REFRESH_SLOT,
            input.locale,
            BigInt(generation),
            BigInt(input.items.length),
            BigInt(input.nowMs),
          );
        const insertItem = database.prepare(
          `INSERT INTO insight_refresh_items
            (run_id, surface_id, scope_json, status)
           VALUES (?, ?, ?, 'queued')`,
        );
        for (const item of input.items) {
          insertItem.run(input.runId, item.surfaceId, item.scopeJson);
        }
        transaction.commit();
        return { created: true, run: getRefreshRun(input.runId)! };
      } catch (error) {
        try {
          transaction.rollback();
        } catch {
          /* preserve original */
        }
        throw error;
      }
    },
    getRefreshRun,
    listRefreshItems(runId) {
      return database
        .prepare(
          `SELECT surface_id, scope_json, status, result_status, result_detail,
                  finished_at_ms FROM insight_refresh_items
           WHERE run_id = ? ORDER BY rowid`,
        )
        .all(runId)
        .map((row) => ({
          surfaceId: String(row.surface_id),
          scopeJson: String(row.scope_json),
          status: row.status as InsightRefreshItemStatus,
          resultStatus:
            row.result_status === null ? null : String(row.result_status),
          resultDetail:
            row.result_detail === null ? null : String(row.result_detail),
          finishedAtMs: nullableNumber(row.finished_at_ms),
        }));
    },
    startRefreshItem(runId, item, nowMs) {
      assertEpoch(nowMs);
      const changed = database
        .prepare(
          `UPDATE insight_refresh_items SET status = 'running', started_at_ms = ?
           WHERE run_id = ? AND surface_id = ? AND scope_json = ? AND status = 'queued'`,
        )
        .run(BigInt(nowMs), runId, item.surfaceId, item.scopeJson).changes;
      if (Number(changed) === 0) return false;
      database
        .prepare(
          `UPDATE insight_refresh_runs
           SET status = 'running', started_at_ms = COALESCE(started_at_ms, ?)
           WHERE run_id = ? AND status = 'queued'`,
        )
        .run(BigInt(nowMs), runId);
      return true;
    },
    finishRefreshItem(input) {
      assertEpoch(input.nowMs);
      const transaction = database.transaction();
      transaction.begin();
      try {
        database
          .prepare(
            `UPDATE insight_refresh_items
             SET status = ?, result_status = ?, result_detail = ?, finished_at_ms = ?
             WHERE run_id = ? AND surface_id = ? AND scope_json = ?
               AND status = 'running'`,
          )
          .run(
            input.status,
            input.resultStatus,
            input.resultDetail ?? null,
            BigInt(input.nowMs),
            input.runId,
            input.item.surfaceId,
            input.item.scopeJson,
          );
        const counts = database
          .prepare(
            `SELECT
               COUNT(*) AS total,
               SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
               SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
               SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
               SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END) AS pending
             FROM insight_refresh_items WHERE run_id = ?`,
          )
          .get(input.runId)!;
        const pending = safeNumber(counts.pending);
        database
          .prepare(
            `UPDATE insight_refresh_runs SET
               status = ?, active_slot = ?, completed_items = ?, failed_items = ?,
               skipped_items = ?, finished_at_ms = ?
             WHERE run_id = ?`,
          )
          .run(
            pending === 0 ? "completed" : "running",
            pending === 0 ? null : ACTIVE_REFRESH_SLOT,
            BigInt(safeNumber(counts.completed)),
            BigInt(safeNumber(counts.failed)),
            BigInt(safeNumber(counts.skipped)),
            pending === 0 ? BigInt(input.nowMs) : null,
            input.runId,
          );
        transaction.commit();
        return getRefreshRun(input.runId)!;
      } catch (error) {
        try {
          transaction.rollback();
        } catch {
          /* preserve original */
        }
        throw error;
      }
    },
    recoverStaleState(nowMs) {
      assertEpoch(nowMs);
      const transaction = database.transaction();
      transaction.begin();
      try {
        const stale = database
          .prepare(
            "SELECT run_id FROM insight_refresh_runs WHERE status IN ('queued', 'running')",
          )
          .all();
        const runIds = stale.map((row) => String(row.run_id));
        let items = 0;
        if (runIds.length > 0) {
          const placeholders = runIds.map(() => "?").join(",");
          items = Number(
            database
              .prepare(
                `UPDATE insight_refresh_items
                 SET status = 'failed', result_status = 'recovered',
                     result_detail = 'recovered', finished_at_ms = ?
                 WHERE run_id IN (${placeholders})
                   AND status IN ('queued', 'running')`,
              )
              .run(BigInt(nowMs), ...runIds).changes,
          );
          database
            .prepare(
              `UPDATE insight_refresh_runs
               SET status = 'completed', active_slot = NULL, finished_at_ms = ?
               WHERE run_id IN (${placeholders})`,
            )
            .run(BigInt(nowMs), ...runIds);
        }
        const reservations = Number(
          database
            .prepare(
              `UPDATE insight_generation_reservations
               SET status = 'failed', result_status = 'recovered', finished_at_ms = ?
               WHERE status = 'running'`,
            )
            .run(BigInt(nowMs)).changes,
        );
        transaction.commit();
        return { runs: runIds.length, items, reservations };
      } catch (error) {
        try {
          transaction.rollback();
        } catch {
          /* preserve original */
        }
        throw error;
      }
    },
    claimGeneration(value) {
      assertEpoch(value.createdAtMs);
      assertIdentity(value.identity);
      // A failed reservation must not poison the whole refresh window: the
      // next caller for the same identity re-claims it. Running/completed
      // reservations keep their exclusivity (ON CONFLICT ... DO NOTHING).
      const result = database
        .prepare(
          `INSERT INTO insight_generation_reservations
            (reservation_key, generation, time_bucket, surface_id, scope_hash,
             evidence_hash, locale, profile_id, prompt_version_id, prompt_version,
             owner_id, status, created_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
           ON CONFLICT (reservation_key) DO UPDATE SET
             status = 'running',
             owner_id = excluded.owner_id,
             created_at_ms = excluded.created_at_ms
           WHERE insight_generation_reservations.status = 'failed'`,
        )
        .run(
          value.reservationKey,
          BigInt(value.generation),
          BigInt(value.timeBucket),
          value.identity.surfaceId,
          value.identity.scopeHash,
          value.identity.evidenceHash,
          value.identity.locale,
          value.identity.profileId ?? "",
          value.identity.promptVersionId ?? "",
          BigInt(value.identity.promptVersion ?? 0),
          value.ownerId,
          BigInt(value.createdAtMs),
        );
      const row = database
        .prepare(
          "SELECT * FROM insight_generation_reservations WHERE reservation_key = ?",
        )
        .get(value.reservationKey)!;
      return {
        claimed: Number(result.changes) > 0,
        reservation: readGenerationReservation(row),
      };
    },
    finishGeneration(input) {
      assertEpoch(input.nowMs);
      return (
        Number(
          database
            .prepare(
              `UPDATE insight_generation_reservations
               SET status = ?, result_status = ?, finished_at_ms = ?
               WHERE reservation_key = ? AND owner_id = ? AND status = 'running'`,
            )
            .run(
              input.status,
              input.resultStatus,
              BigInt(input.nowMs),
              input.reservationKey,
              input.ownerId,
            ).changes,
        ) > 0
      );
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
    findLatestValid(identity, nowMs) {
      assertIdentity(identity);
      assertEpoch(nowMs);
      const row = database
        .prepare(
          `SELECT ${CACHE_COLUMNS} FROM insight_enhancement_cache
        WHERE surface_id = ? AND scope_hash = ? AND locale = ?
          AND COALESCE(profile_id, '') = ? AND COALESCE(prompt_version_id, '') = ?
          AND COALESCE(prompt_version, 0) = ? AND status = 'ready' AND expires_at_ms > ?
        ORDER BY generated_at_ms DESC LIMIT 1`,
        )
        .get(
          identity.surfaceId,
          identity.scopeHash,
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
          WHERE surface_id = ? AND scope_hash = ? AND locale = ?
            AND COALESCE(profile_id, '') = ? AND COALESCE(prompt_version_id, '') = ?
            AND COALESCE(prompt_version, 0) = ?`,
          )
          .all(
            value.surfaceId,
            value.scopeHash,
            value.locale,
            value.profileId ?? "",
            value.promptVersionId ?? "",
            BigInt(value.promptVersion ?? 0),
          );
        for (const previous of prior) {
          database
            .prepare(
              "DELETE FROM insight_enhancement_cache WHERE cache_key = ?",
            )
            .run(String(previous.cache_key));
        }
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
    invalidateSurface(surfaceId) {
      if (!surfaceId) {
        throw new DatabaseError("invalid-argument", "write", {
          retryable: false,
        });
      }
      return Number(
        database
          .prepare(
            `UPDATE insight_enhancement_cache SET status = 'invalidated'
        WHERE surface_id = ? AND status = 'ready'`,
          )
          .run(surfaceId).changes,
      );
    },
    invalidateAll() {
      return Number(
        database
          .prepare(
            "UPDATE insight_enhancement_cache SET status = 'invalidated' WHERE status = 'ready'",
          )
          .run().changes,
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
