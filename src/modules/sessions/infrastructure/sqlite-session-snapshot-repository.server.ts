import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  clearGenerations,
  commitGeneration,
  hashSensitiveRef,
  isoToMs,
  loadGeneration,
  msToIso,
} from "../../../platform/database/snapshot-generation.server.ts";
import type { SnapshotRepository } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SnapshotHydrateResult } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SessionStatus } from "../contracts.ts";
import type { SessionSnapshotData } from "./session-snapshot.contracts.ts";

export interface SqliteSessionSnapshotRepositoryOptions {
  readonly database: SqliteDatabasePort;
  readonly hmacKey: string | Uint8Array;
  readonly now?: () => number;
  readonly createId?: () => string;
}

/** Optional paging for a direct snapshot read (P1-11). When omitted the full
 * snapshot is loaded — the coordinator's default and the only mode the
 * in-memory snapshot runtime uses. */
export interface SessionSnapshotPage {
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Concrete repository surface: `load` additionally accepts optional SQL-level
 * paging, which the generic `SnapshotRepository` contract does not declare.
 */
export interface SqliteSessionSnapshotRepository
  extends SnapshotRepository<SessionSnapshotData> {
  load(
    page?: SessionSnapshotPage,
  ): Promise<SnapshotHydrateResult<SessionSnapshotData>>;
}

const n = (value: unknown): number => Number(value ?? 0);
const b = (value: unknown): boolean => Number(value) === 1;
const micros = (value: number): number =>
  Math.max(0, Math.round(value * 1_000_000));

export function createSqliteSessionSnapshotRepository(
  options: SqliteSessionSnapshotRepositoryOptions,
): SqliteSessionSnapshotRepository {
  const { database } = options;
  return {
    async load(page?: SessionSnapshotPage) {
      return loadGeneration({
        database,
        domain: "sessions",
        readData(snapshotId, generation) {
          // P1-11: read every unknown-model row for this snapshot in ONE
          // batch query, then group in memory — replaces the per-session
          // `session_unknown_models` lookup (N+1).
          const unknownModelsBySession = new Map<string, string[]>();
          for (const row of database
            .prepare(
              "SELECT source_id, session_id, model_id FROM session_unknown_models WHERE snapshot_id=? ORDER BY model_id",
            )
            .all(snapshotId)) {
            const key = `${String(row.source_id)}\u0000${String(row.session_id)}`;
            const models = unknownModelsBySession.get(key);
            if (models) models.push(String(row.model_id));
            else unknownModelsBySession.set(key, [String(row.model_id)]);
          }
          // Optional SQL-level paging (default: full snapshot, compatible
          // with every existing caller). SQLite accepts `LIMIT -1` for
          // "all rows" when only an offset is supplied.
          const limit =
            page?.limit == null
              ? page?.offset == null
                ? null
                : -1
              : Math.max(1, Math.trunc(page.limit));
          const offset =
            page?.offset == null ? null : Math.max(0, Math.trunc(page.offset));
          let sessionsSql =
            "SELECT * FROM sessions WHERE snapshot_id=? ORDER BY started_at_ms DESC, source_id, session_id";
          const sessionsParams: (number | string)[] = [snapshotId];
          if (limit != null) {
            sessionsSql += " LIMIT ?";
            sessionsParams.push(limit);
            if (offset != null) {
              sessionsSql += " OFFSET ?";
              sessionsParams.push(offset);
            }
          }
          const sessions = database
            .prepare(sessionsSql)
            .all(...sessionsParams)
            .map((row) => ({
              sessionId: String(row.session_id),
              source: String(row.source_id),
              title: String(row.title),
              projectKey: String(row.project_key),
              model: row.model_id == null ? null : String(row.model_id),
              startedAt: msToIso(row.started_at_ms)!,
              endedAt: msToIso(row.ended_at_ms)!,
              durationMs: n(row.duration_ms),
              turns: n(row.turns),
              editTurns: n(row.edit_turns),
              retryTurns: n(row.retry_turns),
              totals: {
                inputTokens: n(row.input_tokens),
                cachedInputTokens: n(row.cached_input_tokens),
                cacheCreationInputTokens: n(row.cache_creation_input_tokens),
                outputTokens: n(row.output_tokens),
                reasoningOutputTokens: n(row.reasoning_output_tokens),
                totalTokens: n(row.total_tokens),
              },
              cost: {
                knownUsd: n(row.known_microusd) / 1_000_000,
                estimatedUsd: n(row.estimated_microusd) / 1_000_000,
                cacheSavingsUsd: n(row.cache_savings_microusd) / 1_000_000,
                pricedEvents: n(row.priced_events),
                estimatedEvents: n(row.estimated_events),
                unknownEvents: n(row.unknown_events),
                unknownModels:
                  unknownModelsBySession.get(
                    `${String(row.source_id)}\u0000${String(row.session_id)}`,
                  ) ?? [],
                complete: b(row.cost_complete),
              },
              subagentCalls: n(row.subagent_calls),
              status: String(row.status) as SessionStatus,
              statusReason:
                row.status_reason_code == null
                  ? null
                  : String(row.status_reason_code),
              resumeAvailable: b(row.resume_available),
            }));
          const density = database
            .prepare(
              "SELECT * FROM session_daily_density WHERE snapshot_id=? ORDER BY date_key, source_id",
            )
            .all(snapshotId)
            .map((row) => ({
              source: String(row.source_id),
              date: String(row.date_key),
              count: n(row.session_count),
              turns: n(row.turns),
              editTurns: n(row.edit_turns),
              subagentCalls: n(row.subagent_calls),
              totalTokens: n(row.total_tokens),
              knownUsd: n(row.known_microusd) / 1_000_000,
            }));
          return {
            collectorVersion:
              typeof generation.source_fingerprint === "string" &&
              generation.source_fingerprint.startsWith("sessions-v")
                ? generation.source_fingerprint
                : undefined,
            generatedAt:
              msToIso(generation.generated_at_ms) ?? new Date(0).toISOString(),
            sessions,
            density,
          };
        },
      });
    },
    async save(envelope) {
      commitGeneration({
        database,
        domain: "sessions",
        envelope,
        now: options.now,
        createId: options.createId,
        writeData(snapshotId, data) {
          for (const session of data.sessions) {
            // Session ids are opaque local client identifiers, not paths or
            // conversation content. They must remain stable because the same
            // id is the join key used by transcript readers and CLI resume.
            // Hashing it here made the persisted snapshot impossible to join
            // back to Claude Code/Codex logs after an app restart.
            const sessionId = session.sessionId;
            database
              .prepare(
                `INSERT INTO sessions VALUES (${Array.from({ length: 30 }, () => "?").join(",")})`,
              )
              .run(
                snapshotId,
                session.source,
                sessionId,
                session.title.slice(0, 512),
                session.projectKey.slice(0, 128),
                session.projectRef
                  ? hashSensitiveRef(
                      options.hmacKey,
                      "project",
                      session.projectRef,
                    )
                  : null,
                session.model,
                isoToMs(session.startedAt) ?? 0,
                isoToMs(session.endedAt) ?? 0,
                session.durationMs,
                session.turns,
                session.editTurns,
                session.retryTurns,
                session.subagentCalls,
                session.totals.inputTokens,
                session.totals.cachedInputTokens,
                session.totals.cacheCreationInputTokens,
                session.totals.outputTokens,
                session.totals.reasoningOutputTokens,
                session.totals.totalTokens,
                micros(session.cost.knownUsd),
                micros(session.cost.estimatedUsd),
                micros(session.cost.cacheSavingsUsd),
                session.cost.pricedEvents,
                session.cost.estimatedEvents,
                session.cost.unknownEvents,
                session.cost.complete ? 1 : 0,
                session.status,
                session.statusReason,
                session.resumeAvailable ? 1 : 0,
              );
            for (const model of session.cost.unknownModels) {
              database
                .prepare(
                  "INSERT INTO session_unknown_models VALUES (?, ?, ?, ?)",
                )
                .run(snapshotId, session.source, sessionId, model);
            }
          }
          for (const row of data.density) {
            database
              .prepare(
                "INSERT INTO session_daily_density VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
              )
              .run(
                snapshotId,
                row.date,
                row.source,
                row.count,
                row.turns,
                row.editTurns,
                row.subagentCalls,
                row.totalTokens,
                micros(row.knownUsd),
              );
          }
        },
      });
    },
    async clear() {
      clearGenerations(database, "sessions");
    },
  };
}
