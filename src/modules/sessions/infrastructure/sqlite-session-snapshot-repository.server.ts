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
import type { SessionStatus } from "../contracts.ts";
import type { SessionSnapshotData } from "./session-snapshot.contracts.ts";

export interface SqliteSessionSnapshotRepositoryOptions {
  readonly database: SqliteDatabasePort;
  readonly hmacKey: string | Uint8Array;
  readonly now?: () => number;
  readonly createId?: () => string;
}

const n = (value: unknown): number => Number(value ?? 0);
const b = (value: unknown): boolean => Number(value) === 1;
const micros = (value: number): number =>
  Math.max(0, Math.round(value * 1_000_000));

export function createSqliteSessionSnapshotRepository(
  options: SqliteSessionSnapshotRepositoryOptions,
): SnapshotRepository<SessionSnapshotData> {
  const { database } = options;
  return {
    async load() {
      return loadGeneration({
        database,
        domain: "sessions",
        readData(snapshotId, generation) {
          const sessions = database
            .prepare(
              "SELECT * FROM sessions WHERE snapshot_id=? ORDER BY started_at_ms DESC, source_id, session_id",
            )
            .all(snapshotId)
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
                unknownModels: database
                  .prepare(
                    "SELECT model_id FROM session_unknown_models WHERE snapshot_id=? AND source_id=? AND session_id=? ORDER BY model_id",
                  )
                  .all(
                    snapshotId,
                    String(row.source_id),
                    String(row.session_id),
                  )
                  .map((item) => String(item.model_id)),
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
              generation.source_fingerprint === "sessions-v3-stable-id"
                ? "sessions-v3-stable-id"
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
