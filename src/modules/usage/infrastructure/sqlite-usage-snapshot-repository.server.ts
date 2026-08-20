import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  clearGenerations,
  commitGeneration,
  hashSensitiveRef,
  isoToMs,
  loadGeneration,
  msToIso,
  safeProjectLabel,
} from "../../../platform/database/snapshot-generation.server.ts";
import type { SnapshotRepository } from "../../../platform/snapshot-runtime/contracts.ts";
import { buildLocalUsageSnapshot } from "../../../lib/local-usage/aggregate.ts";
import type {
  LocalUsageEvent,
  LocalUsageSource,
  LocalUsageSourceSummary,
} from "../../../lib/local-usage/types.ts";
import type { UsageSnapshotDto } from "../contracts.ts";

export interface SqliteUsageSnapshotRepositoryOptions {
  readonly database: SqliteDatabasePort;
  /** Installation-scoped secret; never stored in SQLite. */
  readonly hmacKey: string | Uint8Array;
  readonly now?: () => number;
  readonly createId?: () => string;
}

const n = (value: unknown): number => Number(value ?? 0);
const b = (value: unknown): boolean => Number(value) === 1;

function eventIdentity(event: LocalUsageEvent, sequence: number): string {
  return [
    event.source,
    event.timestamp,
    event.model,
    event.project,
    event.sessionId ?? "",
    event.totalTokens,
    sequence,
  ].join("\0");
}

/** Normalized SQLite adapter; collectors remain outside the transaction. */
export function createSqliteUsageSnapshotRepository(
  options: SqliteUsageSnapshotRepositoryOptions,
): SnapshotRepository<UsageSnapshotDto> {
  const { database } = options;
  return {
    async load() {
      return loadGeneration({
        database,
        domain: "usage",
        readData(snapshotId, generation) {
          const sources: LocalUsageSourceSummary[] = database
            .prepare(
              "SELECT * FROM usage_sources WHERE snapshot_id = ? ORDER BY source_id",
            )
            .all(snapshotId)
            .map((row) => {
              const diagnostics = database
                .prepare(
                  "SELECT code, count, message_key FROM usage_source_diagnostics WHERE snapshot_id = ? AND source_id = ? ORDER BY sequence",
                )
                .all(snapshotId, String(row.source_id))
                .map((diagnostic) => ({
                  code: String(diagnostic.code) as NonNullable<
                    LocalUsageSourceSummary["diagnostics"]
                  >[number]["code"],
                  source: String(row.source_id) as LocalUsageSource,
                  count: n(diagnostic.count),
                  message: String(diagnostic.message_key),
                }));
              return {
                source: String(row.source_id) as LocalUsageSource,
                available: b(row.available),
                ...(row.detected == null ? {} : { detected: b(row.detected) }),
                filesConsidered: n(row.files_considered),
                filesRead: n(row.files_read),
                filesReused: n(row.files_reused),
                filesParsed: n(row.files_parsed),
                malformedLines: n(row.malformed_lines),
                events: n(row.event_count),
                ...(diagnostics.length === 0 ? {} : { diagnostics }),
              };
            });
          const events: LocalUsageEvent[] = database
            .prepare(
              "SELECT * FROM usage_events WHERE snapshot_id = ? ORDER BY occurred_at_ms DESC, event_id",
            )
            .all(snapshotId)
            .map((row) => {
              const eventId = String(row.event_id);
              const tools = database
                .prepare(
                  "SELECT name, category, calls FROM usage_event_tool_calls WHERE snapshot_id=? AND event_id=? ORDER BY name, category",
                )
                .all(snapshotId, eventId)
                .map((item) => ({
                  name: String(item.name),
                  category: String(item.category) as NonNullable<
                    LocalUsageEvent["context"]
                  >["tools"] extends readonly (infer T)[] | undefined
                    ? T extends { category: infer C }
                      ? C
                      : never
                    : never,
                  calls: n(item.calls),
                }));
              const skills = database
                .prepare(
                  "SELECT skill_name, calls FROM usage_event_skill_calls WHERE snapshot_id=? AND event_id=? ORDER BY skill_name",
                )
                .all(snapshotId, eventId)
                .map((item) => ({
                  name: String(item.skill_name),
                  calls: n(item.calls),
                }));
              const commands = database
                .prepare(
                  "SELECT * FROM usage_event_command_stats WHERE snapshot_id=? AND event_id=? ORDER BY safe_signature",
                )
                .all(snapshotId, eventId)
                .map((item) => ({
                  kind: "exec_command" as const,
                  executable: String(item.executable_label),
                  safeSignature: String(item.safe_signature),
                  duration: String(item.duration_bucket) as
                    "under-1s" | "1s-10s" | "10s-60s" | "over-60s" | "unknown",
                  outputSize: String(item.output_size_bucket) as
                    "empty" | "under-1k" | "1k-10k" | "over-10k" | "unknown",
                  exitStatus: String(item.exit_status) as
                    "success" | "failure" | "interrupted" | "unknown",
                  calls: n(item.calls),
                }));
              const output = database
                .prepare(
                  "SELECT * FROM usage_event_output_summaries WHERE snapshot_id=? AND event_id=?",
                )
                .get(snapshotId, eventId);
              const context =
                row.has_text_response == null &&
                tools.length === 0 &&
                skills.length === 0 &&
                commands.length === 0 &&
                output == null
                  ? undefined
                  : {
                      ...(row.has_text_response == null
                        ? {}
                        : { textResponse: b(row.has_text_response) }),
                      ...(tools.length === 0 ? {} : { tools }),
                      ...(skills.length === 0 ? {} : { skills }),
                      ...(commands.length === 0 ? {} : { commands }),
                      ...(output == null
                        ? {}
                        : {
                            toolOutputs: {
                              characters: n(output.characters),
                              lines: n(output.lines),
                              completed: b(output.completed),
                              calls: n(output.calls),
                            },
                          }),
                    };
              return {
                source: String(row.source_id) as LocalUsageSource,
                timestamp: msToIso(row.occurred_at_ms)!,
                model: String(row.model_id),
                project: String(row.project_label ?? "unknown"),
                ...(row.session_ref == null
                  ? {}
                  : { sessionId: String(row.session_ref) }),
                measurement: String(row.measurement) as
                  "observed" | "estimated",
                inputTokens: n(row.input_tokens),
                cachedInputTokens: n(row.cached_input_tokens),
                cacheCreationInputTokens: n(row.cache_creation_input_tokens),
                outputTokens: n(row.output_tokens),
                reasoningOutputTokens: n(row.reasoning_output_tokens),
                totalTokens: n(row.total_tokens),
                ...(context == null ? {} : { context }),
              };
            });
          const generatedAt =
            msToIso(generation.generated_at_ms) ?? new Date(0).toISOString();
          return buildLocalUsageSnapshot(
            events,
            sources,
            new Date(generatedAt),
          );
        },
      });
    },
    async save(envelope) {
      commitGeneration({
        database,
        domain: "usage",
        envelope,
        now: options.now,
        createId: options.createId,
        writeData(snapshotId, data) {
          const summaries = new Map(
            data.sources.map((source) => [source.source, source]),
          );
          for (const event of data.details) {
            if (!summaries.has(event.source)) {
              summaries.set(event.source, {
                source: event.source,
                available: true,
                filesConsidered: 0,
                filesRead: 0,
                filesReused: 0,
                filesParsed: 0,
                malformedLines: 0,
                events: data.details.filter(
                  (item) => item.source === event.source,
                ).length,
              });
            }
          }
          for (const source of summaries.values()) {
            database
              .prepare(
                `INSERT INTO usage_sources VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                snapshotId,
                source.source,
                source.available ? 1 : 0,
                source.detected == null ? null : source.detected ? 1 : 0,
                source.filesConsidered,
                source.filesRead,
                source.filesReused,
                source.filesParsed,
                source.malformedLines,
                source.events,
              );
            source.diagnostics?.forEach((diagnostic, sequence) => {
              database
                .prepare(
                  "INSERT INTO usage_source_diagnostics VALUES (?, ?, ?, ?, ?, ?)",
                )
                .run(
                  snapshotId,
                  source.source,
                  sequence,
                  diagnostic.code,
                  diagnostic.count,
                  `usage.${diagnostic.code}`,
                );
            });
          }
          const recent = new Set(
            data.recent.map((event, sequence) =>
              eventIdentity(event, sequence),
            ),
          );
          data.details.forEach((event, sequence) => {
            const eventId = hashSensitiveRef(
              options.hmacKey,
              "usage-event",
              eventIdentity(event, sequence),
            );
            const projectHash = event.project
              ? hashSensitiveRef(options.hmacKey, "project", event.project)
              : null;
            const sessionRef = event.sessionId
              ? hashSensitiveRef(options.hmacKey, "session", event.sessionId)
              : null;
            database
              .prepare(
                `INSERT INTO usage_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                snapshotId,
                eventId,
                event.source,
                isoToMs(event.timestamp) ?? 0,
                event.model,
                projectHash,
                safeProjectLabel(event.project),
                sessionRef,
                event.measurement ?? "observed",
                event.inputTokens,
                event.cachedInputTokens,
                event.cacheCreationInputTokens,
                event.outputTokens,
                event.reasoningOutputTokens,
                event.totalTokens,
                event.context?.textResponse == null
                  ? null
                  : event.context.textResponse
                    ? 1
                    : 0,
                recent.has(eventIdentity(event, sequence))
                  ? 1
                  : sequence < 50
                    ? 1
                    : 0,
              );
            event.context?.tools?.forEach((item) =>
              database
                .prepare(
                  "INSERT INTO usage_event_tool_calls VALUES (?, ?, ?, ?, ?)",
                )
                .run(snapshotId, eventId, item.name, item.category, item.calls),
            );
            event.context?.skills?.forEach((item) =>
              database
                .prepare(
                  "INSERT INTO usage_event_skill_calls VALUES (?, ?, ?, ?)",
                )
                .run(snapshotId, eventId, item.name, item.calls),
            );
            event.context?.commands?.forEach((item) =>
              database
                .prepare(
                  "INSERT INTO usage_event_command_stats VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .run(
                  snapshotId,
                  eventId,
                  item.safeSignature,
                  safeProjectLabel(item.executable),
                  item.duration,
                  item.outputSize,
                  item.exitStatus,
                  item.calls,
                ),
            );
            const output = event.context?.toolOutputs;
            if (output)
              database
                .prepare(
                  "INSERT INTO usage_event_output_summaries VALUES (?, ?, ?, ?, ?, ?)",
                )
                .run(
                  snapshotId,
                  eventId,
                  output.characters,
                  output.lines,
                  output.completed ? 1 : 0,
                  output.calls,
                );
          });
          for (const day of data.daily) {
            for (const [source, counts] of Object.entries(day.bySource)) {
              const events = data.details.filter(
                (event) =>
                  event.timestamp.slice(0, 10) === day.date &&
                  event.source === source,
              ).length;
              if (events === 0 && counts.totalTokens === 0) continue;
              database
                .prepare(
                  "INSERT INTO usage_daily_aggregates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .run(
                  snapshotId,
                  day.date,
                  source,
                  events,
                  counts.inputTokens,
                  counts.cachedInputTokens,
                  counts.cacheCreationInputTokens,
                  counts.outputTokens,
                  counts.reasoningOutputTokens,
                  counts.totalTokens,
                );
            }
          }
        },
      });
    },
    async clear() {
      clearGenerations(database, "usage");
    },
  };
}
