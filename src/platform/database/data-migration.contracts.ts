/**
 * `data_migration_runs` state-machine contract (Story S-02, T-02-04).
 *
 * Browser-safe: only `zod` is imported — no `node:` modules, no filesystem and
 * no SQL. This module is the shared vocabulary for the M2+ JSON→SQLite import
 * work (atomic JSON stores, Electron preferences, security history, HTTP
 * caches); **no import logic lives here on purpose**.
 *
 * Field names mirror the `data_migration_runs` table from architecture §5.1
 * one-to-one (snake_case columns ⇄ camelCase properties), and the idempotency
 * key mirrors the table's unique index
 * `(source_kind, source_path_hash, source_fingerprint)` (§8.3).
 */
import { z } from "zod";

/** Lifecycle of one import attempt. */
export const DATA_MIGRATION_RUN_STATUSES = [
  "running",
  "succeeded",
  "failed",
  "skipped",
] as const;

export type DataMigrationRunStatus =
  (typeof DATA_MIGRATION_RUN_STATUSES)[number];

/** Legacy on-disk shapes the importers read from. */
export const DATA_MIGRATION_SOURCE_KINDS = [
  "atomic-json",
  "electron-prefs",
  "security-json",
  "cache-json",
] as const;

export type DataMigrationSourceKind =
  (typeof DATA_MIGRATION_SOURCE_KINDS)[number];

/** Statuses no further transition may leave. */
export const TERMINAL_DATA_MIGRATION_RUN_STATUSES = [
  "succeeded",
  "failed",
  "skipped",
] as const;

/**
 * Allowed transitions. A run is created as `running` and settles exactly once;
 * `skipped` is reachable directly because an idempotency hit is decided before
 * any row is read.
 */
export const DATA_MIGRATION_RUN_TRANSITIONS: Readonly<
  Record<DataMigrationRunStatus, readonly DataMigrationRunStatus[]>
> = {
  running: ["succeeded", "failed", "skipped"],
  succeeded: [],
  failed: [],
  skipped: [],
};

/** One `data_migration_runs` row. */
export interface DataMigrationRun {
  /** `run_id` — opaque ID of a single import attempt. */
  readonly runId: string;
  /** `source_kind` — legacy source family. */
  readonly sourceKind: DataMigrationSourceKind;
  /** `source_path_hash` — irreversible path hash; never an absolute path. */
  readonly sourcePathHash: string;
  /** `source_schema_version` — legacy schema version, `null` when unknown. */
  readonly sourceSchemaVersion: number | null;
  /** `status` — current state-machine position. */
  readonly status: DataMigrationRunStatus;
  /** `started_at_ms` — epoch milliseconds. */
  readonly startedAtMs: number | null;
  /** `finished_at_ms` — epoch milliseconds; `null` while running. */
  readonly finishedAtMs: number | null;
  /** `rows_read` — reconciliation counter. */
  readonly rowsRead: number;
  /** `rows_written` — reconciliation counter. */
  readonly rowsWritten: number;
  /** `rows_skipped` — reconciliation counter. */
  readonly rowsSkipped: number;
  /** `error_code` — stable error code, never a raw message. */
  readonly errorCode: string | null;
  /** `source_fingerprint` — second half of the idempotency key. */
  readonly sourceFingerprint: string;
}

/** The three columns that form the run's idempotency key (§8.3). */
export interface DataMigrationIdempotencyKeyParts {
  readonly sourceKind: DataMigrationSourceKind;
  readonly sourcePathHash: string;
  readonly sourceFingerprint: string;
}

export const dataMigrationRunStatusSchema = z.enum(DATA_MIGRATION_RUN_STATUSES);

export const dataMigrationSourceKindSchema = z.enum(
  DATA_MIGRATION_SOURCE_KINDS,
);

const identifierSchema = z.string().min(1).max(256);

const hashSchema = z.string().min(1).max(256);

const epochMsSchema = z.number().int().nonnegative();

const counterSchema = z.number().int().nonnegative();

export const dataMigrationIdempotencyKeyPartsSchema = z
  .object({
    sourceKind: dataMigrationSourceKindSchema,
    sourcePathHash: hashSchema,
    sourceFingerprint: hashSchema,
  })
  .strict();

export const dataMigrationRunSchema = z
  .object({
    runId: identifierSchema,
    sourceKind: dataMigrationSourceKindSchema,
    sourcePathHash: hashSchema,
    sourceSchemaVersion: z.number().int().nonnegative().nullable(),
    status: dataMigrationRunStatusSchema,
    startedAtMs: epochMsSchema.nullable(),
    finishedAtMs: epochMsSchema.nullable(),
    rowsRead: counterSchema,
    rowsWritten: counterSchema,
    rowsSkipped: counterSchema,
    errorCode: z.string().min(1).max(128).nullable(),
    sourceFingerprint: hashSchema,
  })
  .strict();

/** Structurally validated run; identical in shape to `DataMigrationRun`. */
export type DataMigrationRunInput = z.infer<typeof dataMigrationRunSchema>;

/** Throws a `ZodError` when the row does not match the table contract. */
export function parseDataMigrationRun(value: unknown): DataMigrationRun {
  return dataMigrationRunSchema.parse(value);
}

/** Non-throwing variant for boundary code that reports its own errors. */
export function safeParseDataMigrationRun(
  value: unknown,
): z.SafeParseReturnType<unknown, DataMigrationRunInput> {
  return dataMigrationRunSchema.safeParse(value);
}

export function isDataMigrationRunStatus(
  value: unknown,
): value is DataMigrationRunStatus {
  return dataMigrationRunStatusSchema.safeParse(value).success;
}

export function isDataMigrationSourceKind(
  value: unknown,
): value is DataMigrationSourceKind {
  return dataMigrationSourceKindSchema.safeParse(value).success;
}

export function isTerminalDataMigrationRunStatus(
  status: DataMigrationRunStatus,
): boolean {
  return (TERMINAL_DATA_MIGRATION_RUN_STATUSES as readonly string[]).includes(
    status,
  );
}

/** True when `from → to` is a legal state-machine step. */
export function canTransitionDataMigrationRun(
  from: DataMigrationRunStatus,
  to: DataMigrationRunStatus,
): boolean {
  return DATA_MIGRATION_RUN_TRANSITIONS[from].includes(to);
}

/**
 * Deterministic idempotency key for one source artefact. The parts are hashes
 * and a fixed enum, so a `\u0000` separator cannot collide with their content.
 * Callers use it as the lookup key for the table's unique index; it is not a
 * substitute for that index.
 */
export function dataMigrationIdempotencyKey(
  parts: DataMigrationIdempotencyKeyParts,
): string {
  const validated = dataMigrationIdempotencyKeyPartsSchema.parse(parts);
  return [
    validated.sourceKind,
    validated.sourcePathHash,
    validated.sourceFingerprint,
  ].join("\u0000");
}

/** The same key parts, ready to bind to the table's unique-index columns. */
export function dataMigrationIdempotencyColumns(
  parts: DataMigrationIdempotencyKeyParts,
): {
  readonly source_kind: DataMigrationSourceKind;
  readonly source_path_hash: string;
  readonly source_fingerprint: string;
} {
  const validated = dataMigrationIdempotencyKeyPartsSchema.parse(parts);
  return {
    source_kind: validated.sourceKind,
    source_path_hash: validated.sourcePathHash,
    source_fingerprint: validated.sourceFingerprint,
  };
}
