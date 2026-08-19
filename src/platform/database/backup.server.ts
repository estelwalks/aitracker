/**
 * Online backup (Story S-03, T-03-01).
 *
 * Server-only. Produces consistent backups with `node:sqlite.backup()` — never
 * by copying the open `.db`/`-wal`/`-shm` files — and verifies each one before
 * it is atomically renamed into place. A JSON `manifest.json` next to the
 * backups records every `BackupManifest` so later recovery can re-verify a
 * backup's SHA-256 against the record that produced it.
 *
 * Guarantees:
 * - The source is always a live `DatabaseSync`. Because `DatabaseHost` does not
 *   expose its connection, a second connection to the same file is opened
 *   through the strict adapter and narrowed back to `DatabaseSync` at the
 *   infrastructure boundary only.
 * - The destination is written to a `<name>.tmp` file, verified with a
 *   read-only `PRAGMA quick_check`, and only then atomically renamed to its
 *   final name. A colliding final name is never overwritten — it receives a
 *   `-2`, `-3`, … suffix.
 * - Every failure path removes the temporary file and never touches an
 *   existing backup or its manifest record.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import {
  DatabaseError,
  type Backup,
  type BackupManifest,
  type DatabaseErrorCode,
} from "./contracts.ts";
import type { DatabaseHost } from "./database-host.server.ts";
import {
  getUnderlyingDatabaseSync,
  mapSqliteError,
  NODE_SQLITE_CONNECTION_OPTIONS,
  NodeSqliteDatabase,
} from "./infrastructure/node-sqlite-database.server.ts";
import { readSchemaVersion } from "./migration-runner.server.ts";

export interface CreateOnlineBackupOptions {
  /** The open database to back up (already migrated, single writer). */
  readonly host: DatabaseHost;
  /** Directory that receives the `.db` file and `manifest.json`. */
  readonly backupsDirectory: string;
  /** Application version recorded in the manifest. */
  readonly appVersion: string;
  /** SQLite version recorded in the manifest. */
  readonly sqliteVersion: string;
  /** Injectable epoch-milliseconds source; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Name of the single JSON manifest next to the backup files. */
export const MANIFEST_FILE_NAME = "manifest.json";

/** Backups are named `trusttools-YYYYMMDD-HHmmss.db` (architecture §3.3). */
const BACKUP_PREFIX = "trusttools";

const READ_ONLY_OPTIONS = {
  ...NODE_SQLITE_CONNECTION_OPTIONS,
  readOnly: true,
} as const;

/**
 * Creates one verified online backup and records its manifest. Returns the
 * completed `Backup` (path + manifest). Throws a stable `DatabaseError` on any
 * failure; existing backups are never overwritten or removed.
 */
export async function createOnlineBackup(
  options: CreateOnlineBackupOptions,
): Promise<Backup> {
  const host = options.host;
  const now = options.now ?? Date.now;
  const createdAtMs = timestamp(now);
  assertValidAppVersion(options.appVersion);

  if (host.path === ":memory:") {
    throw new DatabaseError("invalid-argument", "backup", {
      retryable: false,
    });
  }
  if (!host.isOpen) {
    throw new DatabaseError("not-open", "backup", { retryable: false });
  }

  ensureDirectory(options.backupsDirectory);

  const finalPath = reserveBackupPath(options.backupsDirectory, createdAtMs);
  const finalName = basename(finalPath);
  const tmpPath = `${finalPath}.tmp`;

  // 1. Stream the database to the temporary file via the online backup API.
  const source = new NodeSqliteDatabase({ path: host.path });
  try {
    await backup(getUnderlyingDatabaseSync(source), tmpPath);
  } catch (error) {
    cleanupTemporary(tmpPath);
    throw mapBackupError(error);
  } finally {
    source.close();
  }

  // 2. Normalize the destination to a single-file rollback-journal database.
  //    `node:sqlite.backup()` preserves the source's WAL journal mode, so a
  //    read-only `quick_check` of the WAL-mode file would create stray
  //    `-wal`/`-shm` side files. Switching to the delete journal mode first
  //    checkpoints everything into one file and keeps backups self-contained.
  try {
    normalizeBackupJournalMode(tmpPath);
  } catch (error) {
    cleanupTemporary(tmpPath);
    throw mapBackupError(error);
  }

  // 3. Verify the temporary file before it is ever exposed as a backup.
  let sha256: string;
  let sizeBytes: number;
  try {
    quickCheckOrThrow(tmpPath);
    sha256 = sha256OfFile(tmpPath);
    sizeBytes = statSync(tmpPath).size;
  } catch (error) {
    cleanupTemporary(tmpPath);
    throw error instanceof DatabaseError ? error : mapBackupError(error);
  }

  // 4. Read the schema version straight from the live host connection.
  let schemaVersion: number;
  try {
    schemaVersion = readSchemaVersion(host);
  } catch (error) {
    cleanupTemporary(tmpPath);
    throw backupFailure(error);
  }

  const manifest: BackupManifest = {
    schemaVersion,
    appVersion: options.appVersion,
    sqliteVersion: options.sqliteVersion,
    sizeBytes,
    sha256,
    createdAtMs,
  };

  // 5. Atomically promote the verified temporary file to its final name. The
  //    final name was reserved above; if it has appeared meanwhile (another
  //    writer), fail rather than overwrite the other backup.
  try {
    if (existsSync(finalPath)) {
      throw new DatabaseError("target-busy", "backup", { retryable: true });
    }
    renameSync(tmpPath, finalPath);
  } catch (error) {
    cleanupTemporary(tmpPath);
    throw error instanceof DatabaseError ? error : mapBackupError(error);
  }

  // 6. Record the manifest. Written after the file is final so a failed write
  //    never leaves a manifest entry pointing at a file that was not promoted.
  try {
    writeManifestEntry(options.backupsDirectory, finalName, manifest);
  } catch (error) {
    removeBestEffort(finalPath);
    throw error instanceof DatabaseError ? error : mapBackupError(error);
  }

  return { path: finalPath, manifest };
}

/**
 * Scans the backups directory and returns every backup whose stored manifest
 * still matches its file: `quick_check` passes and the SHA-256 is unchanged.
 * Results are ordered newest-first. Files with no manifest record (including
 * stray or garbage `.db` files) are ignored, so a backup is only ever trusted
 * through the manifest that created it.
 */
export function listVerifiedBackups(backupsDirectory: string): Backup[] {
  const index = readBackupManifestIndex(backupsDirectory);
  const verified: Backup[] = [];
  for (const [fileName, manifest] of Object.entries(index)) {
    if (!isBackupManifest(manifest)) continue;
    const path = join(backupsDirectory, fileName);
    if (!existsSync(path) || !statSync(path).isFile()) continue;
    try {
      quickCheckOrThrow(path);
      if (sha256OfFile(path) !== manifest.sha256) continue;
    } catch {
      continue;
    }
    verified.push({ path, manifest });
  }
  return verified.sort(
    (a, b) => b.manifest.createdAtMs - a.manifest.createdAtMs,
  );
}

/**
 * Verifies a backup file with `PRAGMA quick_check`, throwing `corrupt` when the
 * file cannot be opened and `integrity-check-failed` when the check is not a
 * clean `ok`.
 */
export function verifyBackupIntegrity(path: string): void {
  quickCheckOrThrow(path);
}

/** SHA-256 (hex) of a file's contents. */
export function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The persisted `fileName → BackupManifest` index, or `{}` when absent. */
export function readBackupManifestIndex(
  backupsDirectory: string,
): Readonly<Record<string, BackupManifest>> {
  const path = join(backupsDirectory, MANIFEST_FILE_NAME);
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const index: Record<string, BackupManifest> = {};
  for (const [fileName, value] of Object.entries(parsed)) {
    if (isBackupManifest(value)) index[fileName] = value;
  }
  return index;
}

/** Structural guard for a persisted `BackupManifest` record. */
export function isBackupManifest(value: unknown): value is BackupManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.schemaVersion === "number" &&
    Number.isSafeInteger(candidate.schemaVersion) &&
    typeof candidate.appVersion === "string" &&
    typeof candidate.sqliteVersion === "string" &&
    typeof candidate.sizeBytes === "number" &&
    Number.isSafeInteger(candidate.sizeBytes) &&
    typeof candidate.sha256 === "string" &&
    typeof candidate.createdAtMs === "number" &&
    Number.isSafeInteger(candidate.createdAtMs)
  );
}

function ensureDirectory(directory: string): void {
  if (existsSync(directory) && !statSync(directory).isDirectory()) {
    throw new DatabaseError("io-failure", "backup", { retryable: false });
  }
  try {
    mkdirSync(directory, { recursive: true });
  } catch (error) {
    throw new DatabaseError("io-failure", "backup", { cause: error });
  }
}

/** First non-colliding `trusttools-YYYYMMDD-HHmmss.db` name in `directory`. */
function reserveBackupPath(directory: string, createdAtMs: number): string {
  const base = formatTimestamp(createdAtMs);
  let candidate = join(directory, `${BACKUP_PREFIX}-${base}.db`);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = join(directory, `${BACKUP_PREFIX}-${base}-${suffix}.db`);
    suffix += 1;
  }
  return candidate;
}

/** `YYYYMMDD-HHmmss` in local time, for human-readable backup names. */
function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function timestamp(clock: () => number): number {
  const value = clock();
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DatabaseError("invalid-argument", "backup", {
      retryable: false,
    });
  }
  return Math.max(0, Math.trunc(value));
}

function assertValidAppVersion(appVersion: string): void {
  if (typeof appVersion !== "string" || appVersion.trim() === "") {
    throw new DatabaseError("invalid-argument", "backup", {
      retryable: false,
    });
  }
}

/**
 * Converts a WAL-mode backup destination to the delete (rollback) journal mode
 * so it becomes a single self-contained file. This checkpoints any WAL frames
 * into the main file and removes `-wal`/`-shm` siblings that would otherwise
 * be recreated by every later read-only `quick_check`.
 */
function normalizeBackupJournalMode(path: string): void {
  const database = new DatabaseSync(path, NODE_SQLITE_CONNECTION_OPTIONS);
  try {
    database.exec("PRAGMA journal_mode=DELETE");
  } catch (error) {
    throw mapSqliteError(error, "backup");
  } finally {
    database.close();
  }
}

/** Runs `PRAGMA quick_check` on a read-only connection; throws on failure. */
function quickCheckOrThrow(path: string): void {
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(path, READ_ONLY_OPTIONS);
  } catch (error) {
    throw new DatabaseError("corrupt", "backup", { cause: error });
  }
  try {
    const rows = database.prepare("PRAGMA quick_check").all();
    const messages = rows.map(firstColumnValue);
    const ok =
      messages.length > 0 &&
      messages.every((value) => String(value).toLowerCase() === "ok");
    if (!ok) {
      throw new DatabaseError("integrity-check-failed", "backup", {
        retryable: false,
      });
    }
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError("corrupt", "backup", { cause: error });
  } finally {
    database.close();
  }
}

function writeManifestEntry(
  backupsDirectory: string,
  fileName: string,
  manifest: BackupManifest,
): void {
  const index = readBackupManifestIndex(backupsDirectory);
  writeManifestIndex(backupsDirectory, { ...index, [fileName]: manifest });
}

function writeManifestIndex(
  backupsDirectory: string,
  index: Record<string, BackupManifest>,
): void {
  const path = join(backupsDirectory, MANIFEST_FILE_NAME);
  const tmpPath = `${path}.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    renameSync(tmpPath, path);
  } catch (error) {
    removeBestEffort(tmpPath);
    throw error;
  }
}

/** Keeps adapter error codes stable while re-tagging the operation to backup. */
function mapBackupError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError && error.operation === "backup") {
    return error;
  }
  const base =
    error instanceof DatabaseError ? error : mapSqliteError(error, "backup");
  return new DatabaseError(backupErrorCode(base.code), "backup", {
    cause: base,
  });
}

function backupErrorCode(code: DatabaseErrorCode): DatabaseErrorCode {
  if (code === "busy") return "target-busy";
  if (code === "sql-error") return "backup-failed";
  return code;
}

/** Re-tags a non-backup `DatabaseError` (e.g. from the migration runner). */
function backupFailure(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) {
    return new DatabaseError(backupErrorCode(error.code), "backup", {
      cause: error,
    });
  }
  return new DatabaseError("backup-failed", "backup", { cause: error });
}

function firstColumnValue(row: unknown): unknown {
  if (typeof row !== "object" || row === null) return undefined;
  const values = Object.values(row);
  return values.length === 0 ? undefined : values[0];
}

/** Removes a temporary backup and any WAL/SHM siblings it may have acquired. */
function cleanupTemporary(path: string): void {
  removeBestEffort(path);
  removeBestEffort(`${path}-wal`);
  removeBestEffort(`${path}-shm`);
}

function removeBestEffort(path: string): void {
  try {
    rmSync(path, { force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Best effort; a surviving temporary file is harmless and never exposed
    // as a backup because its name carries the `.tmp` suffix.
  }
}
