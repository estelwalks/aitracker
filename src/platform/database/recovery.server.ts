/**
 * Recovery orchestration (Story S-03, T-03-04).
 *
 * Server-only. Implements the corruption-recovery flow of architecture §10.3:
 *
 * ```text
 * open / quick_check fails
 *   → close every connection, set the db/-wal/-shm fault group aside
 *   → find the newest backup that passes checksum + quick_check
 *   → restore only after explicit user confirmation (L2 data is never dropped)
 *   → with no usable backup, create an empty DB and mark it as recovered
 * ```
 *
 * Three properties are load-bearing here:
 *
 * 1. **`planRecovery` is read-only.** It never touches a single file, and it
 *    distinguishes "the manifest is damaged" from "there are no backups" —
 *    those two need opposite user prompts.
 * 2. **`restoreFromBackup` validates before it destroys.** The backup is copied
 *    to `<target>.restore.tmp` first and every check then runs against *that
 *    copy* (no TOCTOU window between "checked" and "installed"): manifest
 *    record, SHA-256, `quick_check`, `application_id` and the
 *    `schema_migrations` ledger. Only after all of them pass is the existing
 *    database moved aside, and only then is the temporary file renamed into
 *    place.
 * 3. **Every failure compensates.** The temporary copy is removed and a
 *    database that was already moved aside is moved back, so a failed restore
 *    leaves the original database exactly where it was. Nothing is ever
 *    deleted — the set-aside directory is kept as evidence.
 */
import {
  copyFileSync,
  existsSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

import {
  DatabaseError,
  TRUSTTOOLS_APPLICATION_ID,
  type Backup,
  type BackupManifest,
} from "./contracts.ts";
import {
  listBackupFiles,
  readBackupManifestIndex,
  readBackupSchemaSnapshot,
  sha256OfFile,
  tryReadBackupManifestIndex,
  verifyBackupIntegrity,
  type UnverifiedBackup,
} from "./backup.server.ts";
import type { RuntimeVersionsProvider } from "./capability-probe.server.ts";
import { DatabaseHost } from "./database-host.server.ts";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
} from "./file-permissions.server.ts";
import {
  faultGroupExists,
  rollbackFaultGroup,
  setAsideFaultGroup,
} from "./integrity.server.ts";
import {
  migrationChecksum,
  runMigrations,
  type MigrationDefinition,
} from "./migration-runner.server.ts";
import { MIGRATIONS } from "./migrations/index.ts";

/** Why no backup can be restored. Drives the wording the user sees. */
export type NoBackupReason =
  /** The backups directory does not exist — most likely a first run. */
  | "no-backups-directory"
  /** The directory exists but holds no backup file at all. */
  | "no-backup-files"
  /** Backup files exist, but none of them passes checksum + quick_check. */
  | "no-verified-backup";

export type RecoveryPlan =
  | {
      readonly kind: "backup-available";
      readonly backup: Backup;
      /** Backup files that were rejected; surfaced, never silently dropped. */
      readonly unverified: readonly UnverifiedBackup[];
    }
  | {
      readonly kind: "no-backup";
      readonly reason: NoBackupReason;
      readonly unverified: readonly UnverifiedBackup[];
    }
  /**
   * `manifest.json` exists but cannot be parsed. Backup *files* may well be
   * intact, so the user must be told the index is damaged instead of being
   * offered a fresh empty database.
   */
  | {
      readonly kind: "manifest-corrupt";
      readonly backupsDirectory: string;
    };

export interface PlanRecoveryOptions {
  /** Directory whose verified backups are the recovery candidates. */
  readonly backupsDirectory: string;
}

export interface RestoreFromBackupOptions {
  /** Absolute or relative path the recovered database is installed at. */
  readonly databasePath: string;
  /**
   * Backup file to restore from; it is copied, never moved. Must be a direct
   * child of `backupsDirectory`.
   */
  readonly backupPath: string;
  /** Directory holding `manifest.json`, used to re-verify the backup. */
  readonly backupsDirectory: string;
  /**
   * Must be exactly `true`. A restore overwrites live L2 data, so architecture
   * §10.3 requires explicit user confirmation; the flag makes that consent an
   * unavoidable part of the call rather than a caller-side convention.
   */
  readonly confirmedByUser: boolean;
  /** Migration definitions the backup's ledger is validated against. */
  readonly definitions?: readonly MigrationDefinition[];
}

export interface RestoreResult {
  /** Resolved path the restored database now lives at. */
  readonly databasePath: string;
  /**
   * `.replaced.<timestamp>/` directory holding the database that was replaced,
   * or `undefined` when there was nothing to replace.
   */
  readonly setAsideDirectory?: string;
}

/** `runtime_flags` key that marks a database as created by recovery. */
export const RECOVERY_MARKER_FLAG_KEY = "recovery.marker";

/** Why an empty database had to be created. */
export type RecoveryMarkerReason =
  NoBackupReason | "manifest-corrupt" | "restore-failed";

const RECOVERY_MARKER_REASONS: readonly RecoveryMarkerReason[] = [
  "no-backups-directory",
  "no-backup-files",
  "no-verified-backup",
  "manifest-corrupt",
  "restore-failed",
];

/**
 * Marker row written into `runtime_flags`. Deliberately path-free: it records
 * *what* was lost, never *where* it lived (architecture §9-3).
 */
export interface RecoveryMarker {
  readonly createdAtMs: number;
  readonly reason: RecoveryMarkerReason;
  /** Domain names whose data could not be recovered, e.g. `["reports"]`. */
  readonly domains: readonly string[];
}

export interface CreateEmptyDatabaseWithMarkerOptions {
  /** Path the empty database is created at. */
  readonly databasePath: string;
  /** Application version recorded by the migration runner. */
  readonly appVersion: string;
  /** Runtime version source handed to `DatabaseHost.open`. */
  readonly versionsProvider: RuntimeVersionsProvider;
  /** Why recovery gave up on restoring; stored in the marker. */
  readonly reason: RecoveryMarkerReason;
  /** Domains the user must be told about; each a bare name, never a path. */
  readonly domains?: readonly string[];
  /** Defaults to the bundled `MIGRATIONS`; injectable for tests. */
  readonly definitions?: readonly MigrationDefinition[];
  /** Epoch-milliseconds source; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Forwarded to `DatabaseHost.open` for the WAL probe. */
  readonly probeDirectory?: string;
}

export interface CreateEmptyDatabaseResult {
  readonly databasePath: string;
  /** Schema version of the freshly migrated database. */
  readonly schemaVersion: number;
  readonly marker: RecoveryMarker;
  /** Where a pre-existing (corrupt) fault group was moved, when there was one. */
  readonly setAsideDirectory?: string;
}

/** Upsert so the call is idempotent even on a database that already has one. */
const MARKER_UPSERT_SQL = `INSERT INTO runtime_flags (flag_key, value_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT (flag_key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms`;

/** Bare domain names only: no separators, no drive letters, no paths. */
const DOMAIN_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

const MAX_MARKER_DOMAINS = 32;

/**
 * Picks the newest verified backup without modifying the filesystem. Returns
 * `backup-available` with that backup, `no-backup` plus the reason when there is
 * nothing to restore, or `manifest-corrupt` when the manifest index itself is
 * unreadable.
 */
/**
 * Picks the newest verified backup without modifying the filesystem. Returns
 * `backup-available` with that backup, `no-backup` plus the reason when there is
 * nothing to restore, or `manifest-corrupt` when the manifest index itself is
 * unreadable.
 *
 * The candidate scan uses the `size-only` verification: the planning path must
 * not buffer every backup for a full SHA-256 (review finding P2-7). The chosen
 * backup is fully re-verified by `restoreFromBackup`.
 */
export async function planRecovery(
  options: PlanRecoveryOptions,
): Promise<RecoveryPlan> {
  const backupsDirectory = options.backupsDirectory;
  const index = tryReadBackupManifestIndex(backupsDirectory);
  if (index === undefined) {
    return { kind: "manifest-corrupt", backupsDirectory };
  }
  if (!existsSync(backupsDirectory)) {
    return {
      kind: "no-backup",
      reason: "no-backups-directory",
      unverified: [],
    };
  }
  const inventory = await listBackupFiles(backupsDirectory, index, {
    verify: "size-only",
  });
  if (inventory.verified.length > 0) {
    return {
      kind: "backup-available",
      backup: inventory.verified[0],
      unverified: inventory.unverified,
    };
  }
  return {
    kind: "no-backup",
    reason:
      inventory.unverified.length === 0
        ? "no-backup-files"
        : "no-verified-backup",
    unverified: inventory.unverified,
  };
}

/**
 * Restores `databasePath` from `backupPath` after the user confirmed it.
 *
 * Preconditions, all mandatory: `confirmedByUser === true`, the backup is a
 * direct child of `backupsDirectory` (no `..`/absolute-path escape), and
 * `manifest.json` holds a record for it. The backup is then copied to
 * `<target>.restore.tmp`, and that copy — not the original — is validated
 * against the manifest SHA-256, `quick_check`, `application_id` and the
 * `schema_migrations` ledger. Only afterwards is the current database moved
 * aside as `replaced-by-restore` and the copy renamed into place.
 *
 * Any failure removes the temporary copy, moves a set-aside database back, and
 * throws a stable `DatabaseError`. The original backup is never modified.
 */
export async function restoreFromBackup(
  options: RestoreFromBackupOptions,
): Promise<RestoreResult> {
  if (options.confirmedByUser !== true) {
    throw invalidRestoreArgument();
  }

  const backupsDirectory = resolve(options.backupsDirectory);
  const backupFile = resolve(options.backupPath);
  const target = resolve(options.databasePath);

  // Containment: the backup must live *directly* in the backups directory, so
  // neither `../../etc/passwd` nor an unrelated absolute path can be restored.
  if (!samePath(dirname(backupFile), backupsDirectory)) {
    throw invalidRestoreArgument();
  }
  // Restoring a backup onto itself would move the backup into the set-aside
  // directory and then rename a copy over it.
  if (samePath(backupFile, target)) {
    throw invalidRestoreArgument();
  }

  // The manifest record is a precondition, not an optional cross-check: without
  // it there is no trusted SHA-256 to compare against, so the file is simply
  // not a restorable backup.
  const manifest =
    readBackupManifestIndex(backupsDirectory)[basename(backupFile)];
  if (manifest === undefined) {
    throw new DatabaseError("not-found", "backup", { retryable: false });
  }
  if (!existsSync(backupFile) || !statSync(backupFile).isFile()) {
    throw new DatabaseError("not-found", "backup", { retryable: false });
  }

  ensureDirectory(dirname(target));
  const temporaryPath = `${target}.restore.tmp`;
  cleanupTemporary(temporaryPath);
  try {
    copyFileSync(backupFile, temporaryPath);
    ensurePrivateFile(temporaryPath);
  } catch (error) {
    cleanupTemporary(temporaryPath);
    throw restoreFailure(error);
  }

  let setAsideDirectory: string | undefined;
  try {
    await verifyRestoreCandidate(
      temporaryPath,
      manifest,
      options.definitions ?? MIGRATIONS,
    );
    if (faultGroupExists(target)) {
      setAsideDirectory = setAsideFaultGroup(target, {
        reason: "replaced-by-restore",
      });
    }
    renameSync(temporaryPath, target);
    ensurePrivateFile(target);
  } catch (error) {
    cleanupTemporary(temporaryPath);
    if (setAsideDirectory !== undefined) {
      rollbackBestEffort(setAsideDirectory, target);
    }
    throw restoreFailure(error);
  }

  return { databasePath: target, setAsideDirectory };
}

/**
 * Last resort of architecture §10.3: no backup can be restored, so a fresh
 * empty database is created *and marked*, never silently rebuilt.
 *
 * An existing fault group at `databasePath` is moved aside as `corrupt` first
 * (nothing is deleted), the empty database is then created through the normal
 * `DatabaseHost` + migration-runner path — no hand-rolled DDL — and a
 * `runtime_flags` row (`recovery.marker`) records when, why and which domains
 * were lost so the UI can tell the user instead of showing a plausible-looking
 * empty dashboard.
 *
 * The Host is closed again before returning: the caller owns the connection it
 * wants to keep and re-opens the path normally.
 */
export function createEmptyDatabaseWithMarker(
  options: CreateEmptyDatabaseWithMarkerOptions,
): CreateEmptyDatabaseResult {
  const target = resolve(options.databasePath);
  const reason = assertMarkerReason(options.reason);
  const domains = assertMarkerDomains(options.domains ?? []);
  const createdAtMs = markerTimestamp(options.now ?? Date.now);

  const setAsideDirectory = faultGroupExists(target)
    ? setAsideFaultGroup(target, { reason: "corrupt" })
    : undefined;

  const host = DatabaseHost.open({
    path: target,
    versionsProvider: options.versionsProvider,
    probeDirectory: options.probeDirectory,
  });
  try {
    const result = runMigrations({
      database: host,
      appVersion: options.appVersion,
      definitions: options.definitions,
    });
    const marker: RecoveryMarker = { createdAtMs, reason, domains };
    host
      .prepare(MARKER_UPSERT_SQL)
      .run(
        RECOVERY_MARKER_FLAG_KEY,
        JSON.stringify(marker),
        marker.createdAtMs,
      );
    return {
      databasePath: target,
      schemaVersion: result.currentVersion,
      marker,
      setAsideDirectory,
    };
  } finally {
    host.close();
  }
}

/**
 * Validates the *copy* that is about to be installed. Running every check
 * against the destination temporary file — rather than against the backup in the
 * backups directory — closes the TOCTOU window in which a verified backup could
 * be swapped between the check and the copy.
 */
async function verifyRestoreCandidate(
  candidatePath: string,
  manifest: BackupManifest,
  definitions: readonly MigrationDefinition[],
): Promise<void> {
  verifyBackupIntegrity(candidatePath);
  if ((await sha256OfFile(candidatePath)) !== manifest.sha256) {
    throw new DatabaseError("integrity-check-failed", "backup", {
      retryable: false,
    });
  }
  const snapshot = readBackupSchemaSnapshot(candidatePath);
  assertAcceptableApplicationId(snapshot.applicationId);
  assertLedgerMatchesDefinitions(
    snapshot.migrations,
    snapshot.userVersion,
    manifest.schemaVersion,
    definitions,
  );
}

/**
 * `application_id` identifies the file as ours (architecture §9-6). Migration
 * A restorable backup must be a migrated TrustTools database. Unstamped files
 * are never accepted, even when they happen to contain a ledger-shaped table.
 */
function assertAcceptableApplicationId(applicationId: number): void {
  if (applicationId !== TRUSTTOOLS_APPLICATION_ID)
    throw invalidRestoreArgument();
}

/**
 * The backup's ledger must be a prefix of the migration lineage this build
 * knows: a missing `schema_migrations` table means the file is not a migrated
 * TrustTools database, an unknown version means a foreign lineage, and a
 * differing name/checksum means the same version was built from different SQL.
 */
function assertLedgerMatchesDefinitions(
  rows:
    readonly { version: number; name: string; checksum: string }[] | undefined,
  userVersion: number,
  manifestVersion: number,
  definitions: readonly MigrationDefinition[],
): void {
  if (rows === undefined || rows.length === 0) throw invalidRestoreArgument();
  const definedByVersion = new Map<number, MigrationDefinition>();
  for (const definition of definitions) {
    definedByVersion.set(definition.version, definition);
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.version !== index + 1) {
      throw new DatabaseError("migration-reverted", "backup", {
        retryable: false,
      });
    }
    const definition = definedByVersion.get(row.version);
    if (definition === undefined) {
      throw new DatabaseError("migration-reverted", "backup", {
        retryable: false,
      });
    }
    if (
      definition.name !== row.name ||
      migrationChecksum(definition.sql) !== row.checksum
    ) {
      throw new DatabaseError("migration-checksum", "backup", {
        retryable: false,
      });
    }
  }
  const latest = rows[rows.length - 1].version;
  if (userVersion !== latest || manifestVersion !== latest) {
    throw new DatabaseError("migration-reverted", "backup", {
      retryable: false,
    });
  }
}

function assertMarkerReason(
  reason: RecoveryMarkerReason,
): RecoveryMarkerReason {
  if (!RECOVERY_MARKER_REASONS.includes(reason)) {
    throw new DatabaseError("invalid-argument", "integrity", {
      retryable: false,
    });
  }
  return reason;
}

/**
 * Domain names are bare identifiers (`usage`, `reports`, …). The pattern is
 * what keeps a caller from smuggling a filesystem path into the marker row.
 */
function assertMarkerDomains(domains: readonly string[]): readonly string[] {
  if (!Array.isArray(domains) || domains.length > MAX_MARKER_DOMAINS) {
    throw new DatabaseError("invalid-argument", "integrity", {
      retryable: false,
    });
  }
  for (const domain of domains) {
    if (typeof domain !== "string" || !DOMAIN_PATTERN.test(domain)) {
      throw new DatabaseError("invalid-argument", "integrity", {
        retryable: false,
      });
    }
  }
  return [...domains];
}

function markerTimestamp(clock: () => number): number {
  const value = clock();
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DatabaseError("invalid-argument", "integrity", {
      retryable: false,
    });
  }
  return Math.max(0, Math.trunc(value));
}

/** Windows compares paths case-insensitively; POSIX does not. */
function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function invalidRestoreArgument(): DatabaseError {
  return new DatabaseError("invalid-argument", "backup", { retryable: false });
}

/**
 * Keeps stable codes from the backup/integrity layers and maps raw filesystem
 * failures; a rename refused because the file is still open is `target-busy`.
 */
function restoreFailure(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) return error;
  const code = (error as { code?: unknown }).code;
  if (
    typeof code === "string" &&
    (code === "EPERM" || code === "EACCES" || code === "EBUSY")
  ) {
    return new DatabaseError("target-busy", "backup", { cause: error });
  }
  return new DatabaseError("io-failure", "backup", { cause: error });
}

/**
 * The original failure is the one worth reporting. A rollback that cannot move
 * the files back leaves them in the set-aside directory, where nothing has been
 * deleted and the user can still recover them by hand.
 */
function rollbackBestEffort(
  setAsideDirectory: string,
  databasePath: string,
): void {
  try {
    rollbackFaultGroup(setAsideDirectory, databasePath);
  } catch {
    // Intentionally swallowed; see the comment above.
  }
}

function ensureDirectory(directory: string): void {
  if (existsSync(directory) && !isDirectory(directory)) {
    throw new DatabaseError("io-failure", "backup", { retryable: false });
  }
  try {
    ensurePrivateDirectory(directory);
  } catch (error) {
    throw new DatabaseError("io-failure", "backup", { cause: error });
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Removes the restore temporary file and any WAL/SHM siblings it acquired. */
function cleanupTemporary(path: string): void {
  for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      rmSync(candidate, { force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // Best effort; a surviving `.restore.tmp` file is never installed and is
      // removed by the next restore attempt.
    }
  }
}
