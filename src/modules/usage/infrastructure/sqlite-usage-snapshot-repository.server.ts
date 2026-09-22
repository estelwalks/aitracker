import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  clearGenerations,
  commitGeneration,
  currentSnapshotRow,
  disambiguateProjectLabels,
  hashSensitiveRef,
  isoToMs,
  loadGeneration,
  msToIso,
  quickConversationProjectLabel,
  safeProjectLabel,
} from "../../../platform/database/snapshot-generation.server.ts";
import type {
  SnapshotHydrateResult,
  SnapshotRepository,
} from "../../../platform/snapshot-runtime/contracts.ts";
import type {
  LocalUsageSource,
  LocalUsageSourceSummary,
  LocalUsageToolCategory,
} from "../../../lib/local-usage/types.ts";
import {
  buildUsageSnapshotFromProjection,
  compactUsageSnapshot,
} from "../application/aggregate-projection.ts";
import type {
  UsageAggregateBucket,
  UsageProjectKind,
  UsageSnapshotDto,
  UsageTrackerBucket,
} from "../contracts.ts";

export interface SqliteUsageSnapshotRepositoryOptions {
  readonly database: SqliteDatabasePort;
  /** Installation-scoped secret; never stored in SQLite. */
  readonly hmacKey: string | Uint8Array;
  readonly now?: () => number;
  readonly createId?: () => string;
}

const n = (value: unknown): number => Number(value ?? 0);
const b = (value: unknown): boolean => Number(value) === 1;

interface PersistedProjectIdentity {
  readonly refHash: string;
  readonly label: string;
  readonly kind: UsageProjectKind;
}

const USAGE_PROJECT_LABEL_PROJECTION_PREFIX = "usage-project-label-v2:";

function hasCurrentProjectLabelProjection(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(USAGE_PROJECT_LABEL_PROJECTION_PREFIX)
  );
}

function currentProjectLabelFingerprint(value: string | null): string {
  if (
    typeof value === "string" &&
    value.startsWith(USAGE_PROJECT_LABEL_PROJECTION_PREFIX)
  ) {
    return value;
  }
  return `${USAGE_PROJECT_LABEL_PROJECTION_PREFIX}${value ?? "none"}`;
}

function isOpaqueProjectIdentity(value: unknown): value is string {
  // SHA-256 base64url without padding, as emitted by hashSensitiveRef().
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function persistedProjectIdentity(input: {
  readonly refHash: unknown;
  readonly label: string | undefined;
  readonly kind: UsageProjectKind | undefined;
}): PersistedProjectIdentity | null {
  if (
    !isOpaqueProjectIdentity(input.refHash) ||
    input.label == null ||
    input.kind == null
  ) {
    return null;
  }
  return {
    refHash: input.refHash,
    label:
      input.kind === "quick-conversation"
        ? quickConversationProjectLabel(input.label)
        : safeProjectLabel(input.label),
    kind: input.kind,
  };
}

function emptyHydration(): SnapshotHydrateResult<UsageSnapshotDto> {
  return {
    source: "default",
    schemaVersion: 1,
    envelope: {
      schemaVersion: 1,
      revision: "empty",
      generatedAt: null,
      sourceFingerprint: null,
      status: "empty",
      data: null,
      diagnostics: {
        lastAttemptAt: null,
        lastSuccessAt: null,
        warningCodes: [],
      },
    },
  };
}

function bucketIdentity(
  bucket: UsageAggregateBucket,
  sequence: number,
): string {
  return [
    bucket.date,
    bucket.source,
    bucket.model,
    bucket.project,
    bucket.measurement,
    Number(bucket.evidence.textResponses),
    Number(bucket.evidence.toolCalls),
    Number(bucket.evidence.skillCalls),
    Number(bucket.evidence.toolOutputCalls),
    Number(bucket.evidence.reasoningTokens),
    Number(bucket.evidence.systemPromptTokens),
    sequence,
  ].join("\0");
}

/**
 * The aggregate projection is the sole persisted Usage read path. Legacy
 * usage_events tables are intentionally neither read nor written here.
 */
export function createSqliteUsageSnapshotRepository(
  options: SqliteUsageSnapshotRepositoryOptions,
): SnapshotRepository<UsageSnapshotDto> {
  const { database } = options;
  const resolveProjectIdentity = (
    projectRef: string,
  ): PersistedProjectIdentity => {
    const refHash = hashSensitiveRef(options.hmacKey, "project", projectRef);
    const row = database
      .prepare(
        "SELECT kind, label FROM project_classifications WHERE ref_hash = ?",
      )
      .get(refHash);
    const kind = row == null ? "unknown" : String(row.kind);
    return {
      refHash,
      // AiPy standalone tasks use their title as the project key. The
      // classifier quite correctly marks a title as non-workspace, but its
      // generic `unknown` label would discard that useful display value when
      // the aggregate is persisted. Keep the safe final segment for all
      // unknown classifications while preserving the classification kind.
      //
      // Quick conversations hit the same problem: the classifier labels every
      // marker-less directory with the same literal, so the breakdown merges
      // unrelated directories. Derive a basename-only label from the ref and
      // disambiguate collisions with the opaque ref HMAC. Only this display
      // value changes; the classification kind (and therefore the
      // mtime-fingerprinted cache) stays untouched.
      label:
        kind === "quick-conversation"
          ? quickConversationProjectLabel(projectRef)
          : kind === "unknown"
            ? safeProjectLabel(projectRef)
            : String(row?.label ?? "unknown"),
      kind: kind as PersistedProjectIdentity["kind"],
    };
  };
  return {
    async load() {
      const current = currentSnapshotRow(database, "usage");
      if (current == null) return emptyHydration();
      const snapshotId = String(current.snapshot_id);
      const projection = database
        .prepare(
          "SELECT generated_at_ms FROM usage_aggregate_snapshots WHERE snapshot_id = ?",
        )
        .get(snapshotId);
      // Databases upgraded from the event-level schema deliberately start
      // empty. The runtime requests a background refresh; there is no dual
      // read or migration-time backfill.
      if (projection == null) return emptyHydration();

      return loadGeneration({
        database,
        domain: "usage",
        readData(id, generation) {
          const diagnosticsBySource = new Map<
            string,
            NonNullable<LocalUsageSourceSummary["diagnostics"]>
          >();
          for (const row of database
            .prepare(
              `SELECT source_id, code, count, message_key
               FROM usage_aggregate_source_diagnostics
               WHERE snapshot_id = ? ORDER BY source_id, sequence`,
            )
            .all(id)) {
            const source = String(row.source_id) as LocalUsageSource;
            const diagnostics = diagnosticsBySource.get(source) ?? [];
            diagnostics.push({
              code: String(row.code) as NonNullable<
                LocalUsageSourceSummary["diagnostics"]
              >[number]["code"],
              source,
              count: n(row.count),
              message: String(row.message_key),
            });
            diagnosticsBySource.set(source, diagnostics);
          }
          const sources: LocalUsageSourceSummary[] = database
            .prepare(
              `SELECT * FROM usage_aggregate_sources
               WHERE snapshot_id = ? ORDER BY source_id`,
            )
            .all(id)
            .map((row) => {
              const source = String(row.source_id) as LocalUsageSource;
              const diagnostics = diagnosticsBySource.get(source) ?? [];
              return {
                source,
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

          const toolsByBucket = new Map<
            string,
            Array<{
              name: string;
              category: LocalUsageToolCategory;
              calls: number;
            }>
          >();
          for (const row of database
            .prepare(
              `SELECT bucket_id, name, category, calls
               FROM usage_aggregate_bucket_tools
               WHERE snapshot_id = ? ORDER BY bucket_id, name, category`,
            )
            .all(id)) {
            const bucketId = String(row.bucket_id);
            const tools = toolsByBucket.get(bucketId) ?? [];
            tools.push({
              name: String(row.name),
              category: String(row.category) as LocalUsageToolCategory,
              calls: n(row.calls),
            });
            toolsByBucket.set(bucketId, tools);
          }
          const bucketRows = database
            .prepare(
              `SELECT * FROM usage_aggregate_buckets
               WHERE snapshot_id = ?
               ORDER BY date_key, source_id, model_id, project_label, bucket_id`,
            )
            .all(id);
          const legacyProjectLabelProjection =
            !hasCurrentProjectLabelProjection(generation.source_fingerprint);
          const requiresProjectLabelRefresh = bucketRows.some((row) => {
            if (String(row.project_kind) !== "quick-conversation") return false;
            const label = String(row.project_label || "unknown");
            return (
              label !== quickConversationProjectLabel(label) ||
              (legacyProjectLabelProjection && label === "quick-conversation")
            );
          });
          const loadedProjectLabels = disambiguateProjectLabels(
            bucketRows.map((row) => {
              const kind = String(row.project_kind) as UsageProjectKind;
              const label = String(row.project_label || "unknown");
              return {
                identity: String(row.project_ref_hash || "unknown"),
                label:
                  kind === "quick-conversation"
                    ? quickConversationProjectLabel(label)
                    : label,
              };
            }),
          );
          const buckets: UsageAggregateBucket[] = bucketRows.map((row) => {
            const projectRefHash = String(row.project_ref_hash || "unknown");
            return {
              date: String(row.date_key),
              latestTimestamp:
                msToIso(row.latest_at_ms) ?? new Date(0).toISOString(),
              source: String(row.source_id) as LocalUsageSource,
              model: String(row.model_id),
              project: projectRefHash,
              projectRefHash,
              projectLabel:
                loadedProjectLabels.get(projectRefHash) ?? "unknown",
              projectKind: String(row.project_kind) as UsageProjectKind,
              measurement: String(row.measurement) as "observed" | "estimated",
              events: n(row.event_count),
              inputTokens: n(row.input_tokens),
              cachedInputTokens: n(row.cached_input_tokens),
              cacheCreationInputTokens: n(row.cache_creation_input_tokens),
              outputTokens: n(row.output_tokens),
              reasoningOutputTokens: n(row.reasoning_output_tokens),
              totalTokens: n(row.total_tokens),
              context: {
                textResponses: n(row.text_responses),
                toolCalls: n(row.tool_calls),
                tools: toolsByBucket.get(String(row.bucket_id)) ?? [],
                skillCalls: n(row.skill_calls),
                toolOutputCalls: n(row.tool_output_calls),
              },
              evidence: {
                textResponses: b(row.evidence_text_responses),
                toolCalls: b(row.evidence_tool_calls),
                skillCalls: b(row.evidence_skill_calls),
                toolOutputCalls: b(row.evidence_tool_output_calls),
                reasoningTokens: b(row.evidence_reasoning_tokens),
                systemPromptTokens: b(row.evidence_system_prompt_tokens),
              },
            };
          });
          const trackerRows = database
            .prepare(
              `SELECT * FROM usage_tracker_buckets
               WHERE snapshot_id = ?
               ORDER BY dimension, date_key, entity_key, source_id`,
            )
            .all(id);
          const loadedTrackerProjectLabels = disambiguateProjectLabels(
            trackerRows
              .filter((row) => String(row.dimension) === "project")
              .map((row) => {
                const kind = String(row.project_kind) as UsageProjectKind;
                const label = String(row.entity_label || "unknown");
                return {
                  identity: String(row.entity_key),
                  label:
                    kind === "quick-conversation"
                      ? quickConversationProjectLabel(label)
                      : label,
                };
              }),
          );
          const trackerBuckets: UsageTrackerBucket[] = trackerRows.map(
            (row) => ({
              dimension: String(
                row.dimension,
              ) as UsageTrackerBucket["dimension"],
              date: String(row.date_key),
              source: String(row.source_id) as LocalUsageSource,
              identity: String(row.entity_key),
              label:
                String(row.dimension) === "project"
                  ? (loadedTrackerProjectLabels.get(String(row.entity_key)) ??
                    "unknown")
                  : String(row.entity_label),
              ...(row.project_kind == null
                ? {}
                : {
                    projectKind: String(row.project_kind) as UsageProjectKind,
                  }),
              events: n(row.event_count),
              calls: n(row.calls),
              inputTokens: n(row.input_tokens),
              cachedInputTokens: n(row.cached_input_tokens),
              cacheCreationInputTokens: n(row.cache_creation_input_tokens),
              outputTokens: n(row.output_tokens),
              reasoningOutputTokens: n(row.reasoning_output_tokens),
              totalTokens: n(row.total_tokens),
            }),
          );
          const snapshot = buildUsageSnapshotFromProjection({
            generatedAt:
              msToIso(generation.generated_at_ms) ?? new Date(0).toISOString(),
            sources,
            buckets,
            trackerBuckets,
          });
          return requiresProjectLabelRefresh
            ? { ...snapshot, requiresProjectLabelRefresh: true }
            : snapshot;
        },
      });
    },

    async save(envelope) {
      if (envelope.data == null) throw new TypeError("snapshot data required");
      const compact = compactUsageSnapshot(envelope.data);
      const aggregateProjects = new Map<
        UsageAggregateBucket,
        PersistedProjectIdentity
      >();
      const trackerProjects = new Map<
        UsageTrackerBucket,
        PersistedProjectIdentity
      >();
      const resolvedProjects: PersistedProjectIdentity[] = [];
      for (const bucket of compact.aggregateBuckets ?? []) {
        const project =
          persistedProjectIdentity({
            refHash: bucket.projectRefHash,
            label: bucket.projectLabel,
            kind: bucket.projectKind,
          }) ?? resolveProjectIdentity(bucket.project);
        aggregateProjects.set(bucket, project);
        resolvedProjects.push(project);
      }
      for (const bucket of compact.trackerBuckets ?? []) {
        if (bucket.dimension !== "project") continue;
        const project =
          persistedProjectIdentity({
            refHash: bucket.identity,
            label: bucket.label,
            kind: bucket.projectKind,
          }) ?? resolveProjectIdentity(bucket.identity);
        trackerProjects.set(bucket, project);
        resolvedProjects.push(project);
      }
      const projectLabels = disambiguateProjectLabels(
        resolvedProjects.map((project) => ({
          identity: project.refHash,
          label: project.label,
        })),
      );
      const projectForWrite = (
        project: PersistedProjectIdentity,
      ): PersistedProjectIdentity => {
        return {
          ...project,
          label: projectLabels.get(project.refHash) ?? project.label,
        };
      };
      const sourceFingerprint =
        compact.requiresProjectLabelRefresh === true
          ? envelope.sourceFingerprint
          : currentProjectLabelFingerprint(envelope.sourceFingerprint);
      commitGeneration({
        database,
        domain: "usage",
        envelope: { ...envelope, sourceFingerprint, data: compact },
        now: options.now,
        createId: options.createId,
        writeData(snapshotId, data) {
          const buckets = data.aggregateBuckets ?? [];
          database
            .prepare("INSERT INTO usage_aggregate_snapshots VALUES (?, ?, ?)")
            .run(
              snapshotId,
              isoToMs(data.generatedAt) ?? 0,
              buckets.reduce((sum, bucket) => sum + bucket.events, 0),
            );

          const summaries = new Map(
            data.sources.map((source) => [source.source, source]),
          );
          const sourceCounts = new Map<LocalUsageSource, number>();
          for (const bucket of buckets) {
            sourceCounts.set(
              bucket.source,
              (sourceCounts.get(bucket.source) ?? 0) + bucket.events,
            );
            if (!summaries.has(bucket.source)) {
              summaries.set(bucket.source, {
                source: bucket.source,
                available: true,
                filesConsidered: 0,
                filesRead: 0,
                filesReused: 0,
                filesParsed: 0,
                malformedLines: 0,
                events: 0,
              });
            }
          }
          for (const source of summaries.values()) {
            database
              .prepare(
                `INSERT INTO usage_aggregate_sources VALUES
                 (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                source.events || sourceCounts.get(source.source) || 0,
              );
            source.diagnostics?.forEach((diagnostic, sequence) => {
              database
                .prepare(
                  `INSERT INTO usage_aggregate_source_diagnostics
                   VALUES (?, ?, ?, ?, ?, ?)`,
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

          buckets.forEach((bucket, sequence) => {
            const project = projectForWrite(aggregateProjects.get(bucket)!);
            const bucketId = hashSensitiveRef(
              options.hmacKey,
              "usage-aggregate-bucket",
              bucketIdentity(bucket, sequence),
            );
            database
              .prepare(
                `INSERT INTO usage_aggregate_buckets (
                   snapshot_id, bucket_id, date_key, latest_at_ms, source_id,
                   model_id, project_ref_hash, project_label, measurement,
                   event_count, input_tokens, cached_input_tokens,
                   cache_creation_input_tokens, output_tokens,
                   reasoning_output_tokens, total_tokens, text_responses,
                   tool_calls, skill_calls, tool_output_calls,
                   evidence_text_responses, evidence_tool_calls,
                   evidence_skill_calls, evidence_tool_output_calls,
                   evidence_reasoning_tokens, evidence_system_prompt_tokens,
                   project_kind
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                snapshotId,
                bucketId,
                bucket.date,
                isoToMs(bucket.latestTimestamp) ?? 0,
                bucket.source,
                bucket.model,
                project.refHash,
                project.label,
                bucket.measurement,
                bucket.events,
                bucket.inputTokens,
                bucket.cachedInputTokens,
                bucket.cacheCreationInputTokens,
                bucket.outputTokens,
                bucket.reasoningOutputTokens,
                bucket.totalTokens,
                bucket.context.textResponses,
                bucket.context.toolCalls,
                bucket.context.skillCalls,
                bucket.context.toolOutputCalls,
                bucket.evidence.textResponses ? 1 : 0,
                bucket.evidence.toolCalls ? 1 : 0,
                bucket.evidence.skillCalls ? 1 : 0,
                bucket.evidence.toolOutputCalls ? 1 : 0,
                bucket.evidence.reasoningTokens ? 1 : 0,
                bucket.evidence.systemPromptTokens ? 1 : 0,
                project.kind,
              );
            for (const tool of bucket.context.tools) {
              database
                .prepare(
                  "INSERT INTO usage_aggregate_bucket_tools VALUES (?, ?, ?, ?, ?)",
                )
                .run(
                  snapshotId,
                  bucketId,
                  tool.name,
                  tool.category,
                  tool.calls,
                );
            }
          });

          for (const bucket of data.trackerBuckets ?? []) {
            let entityKey = bucket.identity;
            let entityLabel = bucket.label;
            let projectKind: UsageProjectKind | null = null;
            if (bucket.dimension === "project") {
              const project = projectForWrite(trackerProjects.get(bucket)!);
              entityKey = project.refHash;
              entityLabel = project.label;
              projectKind = project.kind;
            } else if (bucket.dimension === "session") {
              entityKey =
                isOpaqueProjectIdentity(bucket.identity) &&
                // Fresh session tracker rows use the raw session id as both
                // identity and label. Hydration replaces only identity with
                // its HMAC, so this comparison is a per-row replay marker and
                // remains correct when retained and freshly scanned sources
                // are mixed in one snapshot.
                bucket.identity !== bucket.label
                  ? bucket.identity
                  : hashSensitiveRef(
                      options.hmacKey,
                      "usage-tracker-session",
                      `${bucket.source}\0${bucket.identity}`,
                    );
            } else {
              entityKey =
                // Fresh Skill identities are `${source}\0${name}` and cannot
                // match the opaque-HMAC shape; hydrated rows can therefore be
                // recognized independently of every other source/bucket.
                isOpaqueProjectIdentity(bucket.identity)
                  ? bucket.identity
                  : hashSensitiveRef(
                      options.hmacKey,
                      "usage-tracker-skill",
                      bucket.identity,
                    );
            }
            database
              .prepare(
                `INSERT INTO usage_tracker_buckets (
                   snapshot_id, dimension, entity_key, entity_label,
                   project_kind, source_id, date_key, event_count, calls,
                   input_tokens, cached_input_tokens,
                   cache_creation_input_tokens, output_tokens,
                   reasoning_output_tokens, total_tokens
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                snapshotId,
                bucket.dimension,
                entityKey,
                entityLabel,
                projectKind,
                bucket.source,
                bucket.date,
                bucket.events,
                bucket.calls,
                bucket.inputTokens,
                bucket.cachedInputTokens,
                bucket.cacheCreationInputTokens,
                bucket.outputTokens,
                bucket.reasoningOutputTokens,
                bucket.totalTokens,
              );
          }
        },
      });
    },

    async clear() {
      clearGenerations(database, "usage");
    },
  };
}
