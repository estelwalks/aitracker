/**
 * Online backup (Story S-03, T-03-01).
 *
 * Server-only. Produces consistent backups with `node:sqlite.backup()` — never
 * by copying the open `.db`/`-wal`/`-shm` files — and verifies each one before
 * it is recorded. A JSON `manifest.json` next to the backups records every
 * `BackupManifest` so later recovery can re-verify a backup's SHA-256 against
 * the record that produced it.
 *
 * Guarantees:
 * - The source is the **Host's own** live connection, borrowed through
 *   `DatabaseHost.withUnderlyingConnection`. Opening a second writable
 *   connection to the same file would break the single-writer contract
 *   (architecture §3.2), so the driver handle is borrowed, never re-opened.
 * - Backups of one process are serialized through an in-process mutex: name
 *   reservation and the manifest read-modify-write are one critical section, so
 *   two concurrent calls cannot reserve the same file name or lose each other's
 *   manifest entry.
 * - The destination name is reserved atomically with `openSync(candidate,
 *   "wx")` and the backup is written **directly into that placeholder** (the
 *   online backup API overwrites the empty file). There is no
 *   `existsSync`-then-`rename` window in which a concurrent writer's finished
 *   backup could be silently overwritten (review finding P2-5). A colliding
 *   name receives a `-2`, `-3`, … suffix.
 * - The destination is then normalized to the delete (rollback) journal mode
 *   (single self-contained file), and verified with a read-only
 *   `PRAGMA quick_check` plus a streaming SHA-256.
 * - Every failure path removes the reserved file and any `-wal`/`-shm`
 *   siblings, and never touches an existing backup or its manifest record.
 * - `manifest.json` is the single source of trust. An unparseable manifest is
 *   reported as `corrupt` instead of being silently treated as "no backups",
 *   and files without a usable record are surfaced as *unverified* by
 *   `listBackupFiles` rather than dropped.
 * - No `node:sqlite` import lives here: the online backup call and every
 *   read-only verification connection go through the narrow helpers in
 *   `infrastructure/sqlite-runtime.server.ts` (gate rule
 *   `platform-node-sqlite-outside-infrastructure`).
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

import {
  DatabaseError,
  type Backup,
  type BackupKind,
  type BackupManifest,
  type DatabaseErrorCode,
} from "./contracts.ts";
import type { DatabaseHost } from "./database-host.server.ts";
import {
  bigintToSafeNumber,
  mapSqliteError,
} from "./infrastructure/node-sqlite-database.server.ts";
import {
  openReadOnlySqlite,
  runOnlineBackup,
  setJournalModeDelete,
} from "./infrastructure/sqlite-runtime.server.ts";
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
  /**
   * Backup purpose; `pre-migration` backups are retained longer. Defaults to
   * `daily`.
   */
  readonly kind?: BackupKind;
  /** Injectable epoch-milliseconds source; defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Why a backup file present on disk is not trustworthy. */
export type UnverifiedBackupReason =
  /** No usable `manifest.json` record — a stray or foreign file. */
  | "no-manifest-record"
  /** Recorded, but the file cannot be opened / fails `quick_check`. */
  | "quick-check-failed"
  /** Recorded, but the bytes no longer match the recorded SHA-256/size. */
  | "checksum-mismatch"
  /** Recorded, but the file is gone. */
  | "missing-file";

export interface UnverifiedBackup {
  readonly path: string;
  readonly reason: UnverifiedBackupReason;
}

/**
 * Complete inventory of a backups directory. `unverified` exists so a user can
 * be told that a backup-looking file was rejected and why, instead of a stray
 * or damaged file disappearing from the UI without a trace.
 */
export interface BackupInventory {
  readonly verified: readonly Backup[];
  readonly unverified: readonly UnverifiedBackup[];
}

/** Read-only schema identity of a backup file, used before a restore. */
export interface BackupSchemaSnapshot {
  /** `PRAGMA application_id`; `0` when the database was never stamped. */
  readonly applicationId: number;
  /** `schema_migrations` rows, or `undefined` when the table does not exist. */
  readonly migrations:
    readonly { version: number; name: string; checksum: string }[] | undefined;
}

/** Name of the single JSON manifest next to the backup files. */
export const MANIFEST_FILE_NAME = "manifest.json";

/** Backups are named `trusttools-YYYYMMDD-HHmmss.db` (architecture §3.3). */
const BACKUP_PREFIX = "trusttools";

const LEDGER_TABLE = "schema_migrations";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * In-process backup mutex. Every backup runs to completion before the next one
 * starts, which is what makes name reservation and the manifest
 * read-modify-write safe under concurrent callers.
 */
let backupQueue: Promise<unknown> = Promise.resolve();

/**
 * Creates one verified online backup and records its manifest. Returns the
 * completed `Backup` (path + manifest). Throws a stable `DatabaseError` on any
 * failure; existing backups are never overwritten or removed. Concurrent calls
 * are serialized in the order they were issued.
 */
export function createOnlineBackup(
  options: CreateOnlineBackupOptions,
): Promise<Backup> {
  const run = backupQueue.then(
    () => performOnlineBackup(options),
    () => performOnlineBackup(options),
  );
  // The queue itself must never reject, otherwise one failed backup would
  // reject every backup queued behind it.
  backupQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Convenience wrapper for the mandatory pre-migration backup (architecture
 * §10.2): identical to `createOnlineBackup` with `kind: "pre-migration"`.
 */
export function createPreMigrationBackup(
  options: CreateOnlineBackupOptions,
): Promise<Backup> {
  return createOnlineBackup({ ...options, kind: "pre-migration" });
}

async function performOnlineBackup(
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

  // 1. Stream the database directly into the atomically-reserved placeholder.
  try {
    await host.withUnderlyingConnection((database) =>
      runOnlineBackup(database, finalPath),
    );
  } catch (error) {
    cleanupReservedFile(finalPath);
    throw mapBackupError(error);
  }

  // 2. Normalize the destination to a single-file rollback-journal database.
  //    `node:sqlite.backup()` preserves the source's WAL journal mode, so a
  //    read-only `quick_check` of the WAL-mode file would create stray
  //    `-wal`/`-shm` side files. Switching to the delete journal mode first
  //    checkpoints everything into one file; the mode is read back and
  //    asserted (review finding P2-6), and any surviving siblings are removed.
  try {
    normalizeBackupJournalMode(finalPath);
    cleanupReservedSiblings(finalPath);
  } catch (error) {
    cleanupReservedFile(finalPath);
    throw mapBackupError(error);
  }

  // 3. Verify the reserved file before it is ever recorded as a backup.
  let sha256: string;
  let sizeBytes: number;
  try {
    quickCheckOrThrow(finalPath);
    sha256 = await sha256OfFile(finalPath);
    sizeBytes = statSync(finalPath).size;
  } catch (error) {
    cleanupReservedFile(finalPath);
    throw error instanceof DatabaseError ? error : mapBackupError(error);
  }

  // 4. Read the schema version straight from the live host connection.
  let schemaVersion: number;
  try {
    schemaVersion = readSchemaVersion(host);
  } catch (error) {
    cleanupReservedFile(finalPath);
    throw backupFailure(error);
  }

  const manifest: BackupManifest = {
    kind: options.kind ?? "daily",
    schemaVersion,
    appVersion: options.appVersion,
    sqliteVersion: options.sqliteVersion,
    sizeBytes,
    sha256,
    createdAtMs,
  };

  // 5. Record the manifest. Written after the file is complete and verified so
  //    a failed write never leaves a manifest entry pointing at a partial file.
  try {
    writeManifestEntry(options.backupsDirectory, finalName, manifest);
  } catch (error) {
    removeBestEffort(finalPath);
    throw error instanceof DatabaseError ? error : mapBackupError(error);
  }

  return { path: finalPath, manifest };
}

/**
 * Full inventory of a backups directory: every backup whose stored manifest
 * still matches its file as `verified`, newest-first, plus every backup-looking
 * file that could not be trusted as `unverified` with the reason why. Throws
 * `corrupt` when `manifest.json` exists but cannot be parsed.
 *
 * `verify` selects the fidelity of the match:
 * - `"sha256"` (default) compares the full streaming SHA-256.
 * - `"size-only"` compares only `sizeBytes` — a fast filter for the recovery
 *   planning path, where the eventual restore re-verifies the full SHA-256.
 */
export async function listBackupFiles(
  backupsDirectory: string,
  index?: Readonly<Record<string, BackupManifest>>,
  options?: { readonly verify?: "size-only" | "sha256" },
): Promise<BackupInventory> {
  const verify = options?.verify ?? "sha256";
  const manifests = index ?? readBackupManifestIndex(backupsDirectory);
  const verified: Backup[] = [];
  const unverified: UnverifiedBackup[] = [];

  for (const [fileName, manifest] of Object.entries(manifests)) {
    const path = join(backupsDirectory, fileName);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(path);
    } catch {
      unverified.push({ path, reason: "missing-file" });
      continue;
    }
    if (!stat.isFile()) {
      unverified.push({ path, reason: "missing-file" });
      continue;
    }
    try {
      quickCheckOrThrow(path);
    } catch {
      unverified.push({ path, reason: "quick-check-failed" });
      continue;
    }
    if (verify === "sha256") {
      if ((await sha256OfFile(path)) !== manifest.sha256) {
        unverified.push({ path, reason: "checksum-mismatch" });
        continue;
      }
    } else if (stat.size !== manifest.sizeBytes) {
      unverified.push({ path, reason: "checksum-mismatch" });
      continue;
    }
    verified.push({ path, manifest });
  }

  for (const fileName of listBackupCandidateNames(backupsDirectory)) {
    if (manifests[fileName] !== undefined) continue;
    unverified.push({
      path: join(backupsDirectory, fileName),
      reason: "no-manifest-record",
    });
  }

  return {
    verified: verified.sort(
      (a, b) => b.manifest.createdAtMs - a.manifest.createdAtMs,
    ),
    unverified,
  };
}

/**
 * Scans the backups directory and returns every backup whose stored manifest
 * still matches its file (full SHA-256). Results are ordered newest-first.
 * Files with no manifest record are *not* returned here — a backup is only ever
 * trusted through the manifest that created it — but they are reported by
 * `listBackupFiles` as `unverified`.
 */
export async function listVerifiedBackups(
  backupsDirectory: string,
  index?: Readonly<Record<string, BackupManifest>>,
): Promise<Backup[]> {
  return [...(await listBackupFiles(backupsDirectory, index)).verified];
}

export interface PruneBackupsOptions {
  /** Directory holding `manifest.json` and the backup files. */
  readonly backupsDirectory: string;
  /** Daily backups older than this many days are expired. */
  readonly keepDays: number;
  /**
   * When `true` (default), `pre-migration` backups are exempt from daily
   * expiry and only the oldest one is dropped once it is older than
   * `keepDays * 4` while a later pre-migration backup exists.
   */
  readonly keepPreMigration?: boolean;
  /** Injectable epoch-milliseconds source; defaults to `Date.now`. */
  readonly now?: () => number;
}

export interface PruneBackupsResult {
  /** Manifest file names that were deleted (and removed from the manifest). */
  readonly deleted: readonly string[];
  /** Manifest file names that remain after pruning. */
  readonly kept: readonly string[];
}

/**
 * Retention pruning (architecture §10.1/§10.2, review finding P1-11).
 *
 * Deletes expired `daily` backups and — when `keepPreMigration` is false —
 * expired `pre-migration` backups. A file is only ever deleted when it has a
 * manifest record, still passes `quick_check`, and is expired by **both** its
 * manifest `createdAtMs` and the timestamp encoded in its file name. The newest
 * successful backup is never deleted, files without a manifest record are never
 * touched, and the manifest is rewritten to drop the deleted entries.
 */
export function pruneBackups(options: PruneBackupsOptions): PruneBackupsResult {
  const backupsDirectory = options.backupsDirectory;
  const keepDays = assertPositiveKeepDays(options.keepDays);
  const keepPreMigration = options.keepPreMigration ?? true;
  const nowMs = timestamp(options.now ?? Date.now);
  const dailyCutoffMs = nowMs - keepDays * DAY_MS;
  const preMigrationCutoffMs = nowMs - keepDays * 4 * DAY_MS;

  const index = readBackupManifestIndex(backupsDirectory);
  const entries = Object.entries(index).map(([fileName, manifest]) => ({
    fileName,
    manifest,
    path: join(backupsDirectory, fileName),
  }));

  // A file is a deletion *candidate* only when it has a manifest record AND is
  // still present and quick_check-clean. Stray/corrupt files are never removed.
  const candidates = entries.filter((entry) => {
    try {
      if (!statSync(entry.path).isFile()) return false;
      quickCheckOrThrow(entry.path);
      return true;
    } catch {
      return false;
    }
  });
  if (candidates.length === 0) {
    return { deleted: [], kept: Object.keys(index).sort() };
  }

  const newest = candidates.reduce((a, b) =>
    b.manifest.createdAtMs > a.manifest.createdAtMs ? b : a,
  );

  const toDelete = new Set<string>();
  for (const entry of candidates) {
    if (entry.fileName === newest.fileName) continue;
    if (entry.manifest.kind === "pre-migration" && keepPreMigration) continue;
    if (
      entry.manifest.createdAtMs < dailyCutoffMs &&
      expiredByFilename(entry.fileName, dailyCutoffMs)
    ) {
      toDelete.add(entry.fileName);
    }
  }

  if (keepPreMigration) {
    // Pre-migration backups are always kept, except the single oldest one is
    // dropped once it is older than `keepDays * 4` while a later pre-migration
    // backup exists (bounds unbounded growth without ever losing the newest).
    const preMigration = candidates
      .filter((entry) => entry.manifest.kind === "pre-migration")
      .sort((a, b) => a.manifest.createdAtMs - b.manifest.createdAtMs);
    if (preMigration.length >= 2) {
      const oldest = preMigration[0];
      if (
        oldest.fileName !== newest.fileName &&
        oldest.manifest.createdAtMs < preMigrationCutoffMs
      ) {
        toDelete.add(oldest.fileName);
      }
    }
  }

  for (const fileName of toDelete) {
    removeBestEffort(join(backupsDirectory, fileName));
  }

  const remaining: Record<string, BackupManifest> = {};
  for (const [fileName, manifest] of Object.entries(index)) {
    if (!toDelete.has(fileName)) remaining[fileName] = manifest;
  }
  writeManifestIndex(backupsDirectory, remaining);

  return {
    deleted: [...toDelete].sort(),
    kept: Object.keys(remaining).sort(),
  };
}

/** `.db` files in the directory (never `manifest.json` or `*.tmp` leftovers). */
function listBackupCandidateNames(backupsDirectory: string): readonly string[] {
  let entries: readonly string[];
  try {
    entries = readdirSync(backupsDirectory);
  } catch {
    return [];
  }
  return entries.filter((name) => name.toLowerCase().endsWith(".db"));
}

/**
 * Verifies a backup file with `PRAGMA quick_check`, throwing `corrupt` when the
 * file cannot be opened and `integrity-check-failed` when the check is not a
 * clean `ok`.
 */
export function verifyBackupIntegrity(path: string): void {
  quickCheckOrThrow(path);
}

/**
 * Reads the schema identity a restore has to validate: `PRAGMA application_id`
 * and the `schema_migrations` ledger, both from a single read-only connection.
 * `migrations` is `undefined` when the table does not exist at all, which means
 * the file is not a migrated AITracker database.
 */
export function readBackupSchemaSnapshot(path: string): BackupSchemaSnapshot {
  let session: ReturnType<typeof openReadOnlySqlite>;
  try {
    session = openReadOnlySqlite(path);
  } catch (error) {
    throw new DatabaseError("corrupt", "backup", { cause: error });
  }
  try {
    const applicationId = integerValue(
      session.queryFirstColumn("PRAGMA application_id"),
    );
    const hasLedger =
      session.queryFirstColumn(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${LEDGER_TABLE}'`,
      ) !== undefined;
    if (!hasLedger) return { applicationId, migrations: undefined };
    const migrations = session
      .queryRows(
        `SELECT version, name, checksum FROM ${LEDGER_TABLE} ORDER BY version ASC`,
      )
      .map((row) => ({
        version: integerValue(row.version),
        name: textValue(row.name),
        checksum: textValue(row.checksum),
      }));
    return { applicationId, migrations };
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError("corrupt", "backup", { cause: error });
  } finally {
    session.close();
  }
}

/**
 * SHA-256 (hex) of a file's contents, computed by streaming so a whole backup
 * is never buffered in memory (review finding P2-7).
 */
export function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * The persisted `fileName → BackupManifest` index, or `{}` when the manifest
 * file does not exist yet. Manifests written before the `kind` field existed
 * are normalized to `kind: "daily"`.
 *
 * An existing but unreadable/unparseable manifest throws `corrupt`: silently
 * returning `{}` would turn one damaged JSON file into "there are no backups",
 * which is exactly the state that makes a recovery flow create an empty
 * database while intact backups sit next to it.
 */
export function readBackupManifestIndex(
  backupsDirectory: string,
): Readonly<Record<string, BackupManifest>> {
  const path = join(backupsDirectory, MANIFEST_FILE_NAME);
  if (!existsSync(path)) return {};
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new DatabaseError("io-failure", "backup", { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DatabaseError("corrupt", "backup", {
      cause: error,
      retryable: false,
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DatabaseError("corrupt", "backup", { retryable: false });
  }
  const index: Record<string, BackupManifest> = {};
  for (const [fileName, value] of Object.entries(parsed)) {
    // A single unusable record does not condemn the whole manifest; its file is
    // reported as `no-manifest-record` by `listBackupFiles` instead.
    if (isBackupManifest(value)) {
      index[fileName] = { ...value, kind: value.kind ?? "daily" };
    }
  }
  return index;
}

/**
 * `readBackupManifestIndex` that reports a damaged manifest as `undefined`
 * instead of throwing, so a caller can distinguish "manifest corrupt" from
 * "no backups" and tell the user which one it is.
 */
export function tryReadBackupManifestIndex(
  backupsDirectory: string,
): Readonly<Record<string, BackupManifest>> | undefined {
  try {
    return readBackupManifestIndex(backupsDirectory);
  } catch {
    return undefined;
  }
}

/** Structural guard for a persisted `BackupManifest` record. */
export function isBackupManifest(value: unknown): value is BackupManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const kindOk =
    candidate.kind === undefined ||
    candidate.kind === "daily" ||
    candidate.kind === "pre-migration";
  return (
    kindOk &&
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

/**
 * Atomically reserves the first non-colliding `trusttools-YYYYMMDD-HHmmss.db`
 * name in `directory` by creating it with `openSync(..., "wx")` (fail-exclusive)
 * and closing the descriptor. The empty placeholder is the destination the
 * backup writes directly into. A collision retries with a `-2`, `-3`, …
 * suffix; any other failure is an `io-failure`.
 */
function reserveBackupPath(directory: string, createdAtMs: number): string {
  const base = formatTimestamp(createdAtMs);
  let candidate = join(directory, `${BACKUP_PREFIX}-${base}.db`);
  let suffix = 2;
  for (;;) {
    try {
      const descriptor = openSync(candidate, "wx");
      closeSync(descriptor);
      return candidate;
    } catch (error) {
      if ((error as { code?: unknown }).code === "EEXIST") {
        candidate = join(directory, `${BACKUP_PREFIX}-${base}-${suffix}.db`);
        suffix += 1;
        continue;
      }
      throw new DatabaseError("io-failure", "backup", { cause: error });
    }
  }
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

/**
 * Local epoch-ms of the timestamp encoded in a backup file name, or `undefined`
 * when the name does not parse. Used as the second, independent expiry check in
 * `pruneBackups` (a forged or stale `createdAtMs` cannot by itself delete a
 * recent file).
 */
function parseBackupFilenameTimestamp(fileName: string): number | undefined {
  const match =
    /^trusttools-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?\.db$/.exec(
      fileName,
    );
  if (match === null) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const ms = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function expiredByFilename(fileName: string, cutoffMs: number): boolean {
  const fileNameMs = parseBackupFilenameTimestamp(fileName);
  // Unparseable names are never treated as expired (fail-safe).
  return fileNameMs !== undefined && fileNameMs < cutoffMs;
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

function assertPositiveKeepDays(days: number): number {
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) {
    throw new DatabaseError("invalid-argument", "backup", {
      retryable: false,
    });
  }
  return days;
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
 * be recreated by every later read-only `quick_check`. The mode is read back
 * and asserted to be `delete`.
 */
function normalizeBackupJournalMode(path: string): void {
  try {
    setJournalModeDelete(path);
  } catch (error) {
    throw mapSqliteError(error, "backup");
  }
}

/** Runs `PRAGMA quick_check` on a read-only connection; throws on failure. */
function quickCheckOrThrow(path: string): void {
  let session: ReturnType<typeof openReadOnlySqlite>;
  try {
    session = openReadOnlySqlite(path);
  } catch (error) {
    throw new DatabaseError("corrupt", "backup", { cause: error });
  }
  try {
    const messages = session.queryFirstColumnAll("PRAGMA quick_check");
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
    session.close();
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

/** Read-only integer column (`readBigInts` makes SQLite integers BigInt). */
function integerValue(value: unknown): number {
  if (typeof value === "bigint") return bigintToSafeNumber(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new DatabaseError("corrupt", "backup", { retryable: false });
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  throw new DatabaseError("corrupt", "backup", { retryable: false });
}

/** Removes a reserved backup file and any WAL/SHM siblings it acquired. */
function cleanupReservedFile(path: string): void {
  removeBestEffort(path);
  cleanupReservedSiblings(path);
}

/** Removes the `-wal`/`-shm` siblings of a reserved backup file, if present. */
function cleanupReservedSiblings(path: string): void {
  removeBestEffort(`${path}-wal`);
  removeBestEffort(`${path}-shm`);
}

function removeBestEffort(path: string): void {
  try {
    rmSync(path, { force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // Best effort; a surviving file is never exposed as a backup once its
    // manifest entry is absent.
  }
}
