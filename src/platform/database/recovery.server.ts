/**
 * Recovery orchestration (Story S-03, T-03-04).
 *
 * Server-only. `planRecovery` is read-only: it locates the newest verified
 * backup without touching a single file. `restoreFromBackup` is the
 * user-confirmed execution path: it re-verifies the chosen backup against its
 * manifest, quarantines the current database (never deletes it), and copies —
 * never moves — the backup into place so the original backup remains intact.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { DatabaseError, type Backup } from "./contracts.ts";
import {
  listVerifiedBackups,
  readBackupManifestIndex,
  sha256OfFile,
  verifyBackupIntegrity,
} from "./backup.server.ts";
import { quarantineCorruptDatabase } from "./integrity.server.ts";

export type RecoveryPlan =
  | { readonly kind: "backup-available"; readonly backup: Backup }
  | { readonly kind: "no-backup" };

export interface PlanRecoveryOptions {
  /** Path of the database to recover; reserved for future no-backup handling. */
  readonly databasePath: string;
  /** Directory whose verified backups are the recovery candidates. */
  readonly backupsDirectory: string;
  /** Reserved for the future "create empty DB + mark" no-backup path. */
  readonly appVersion: string;
  /** Reserved for the future "create empty DB + mark" no-backup path. */
  readonly sqliteVersion: string;
}

export interface RestoreFromBackupOptions {
  /** Absolute or relative path the recovered database is copied to. */
  readonly databasePath: string;
  /** Verified backup file to restore from (is copied, never moved). */
  readonly backupPath: string;
  /** Directory holding `manifest.json`, used to re-verify the backup. */
  readonly backupsDirectory: string;
}

/**
 * Picks the newest verified backup without modifying the filesystem. Returns
 * `backup-available` with that backup, or `no-backup` when no verified backup
 * exists.
 */
export function planRecovery(options: PlanRecoveryOptions): RecoveryPlan {
  const backups = listVerifiedBackups(options.backupsDirectory);
  if (backups.length === 0) return { kind: "no-backup" };
  return { kind: "backup-available", backup: backups[0] };
}

/**
 * Restores `databasePath` from `backupPath`. The backup is re-verified
 * (`quick_check` plus SHA-256 against its manifest record), the existing
 * database (if any) is quarantined as a fault group, and the backup is then
 * copied into place. Returns the resolved database path. Any failure leaves
 * both the backup and any quarantined files untouched.
 */
export function restoreFromBackup(options: RestoreFromBackupOptions): string {
  const target = resolve(options.databasePath);

  verifyBackupForRestore(options.backupPath, options.backupsDirectory);

  quarantineIfPresent(target);

  ensureDirectory(dirname(target));
  try {
    copyFileSync(options.backupPath, target);
  } catch (error) {
    throw new DatabaseError("io-failure", "backup", { cause: error });
  }

  return target;
}

function verifyBackupForRestore(
  backupPath: string,
  backupsDirectory: string,
): void {
  verifyBackupIntegrity(backupPath);
  const manifest =
    readBackupManifestIndex(backupsDirectory)[basename(backupPath)];
  if (manifest !== undefined && sha256OfFile(backupPath) !== manifest.sha256) {
    throw new DatabaseError("integrity-check-failed", "backup", {
      retryable: false,
    });
  }
}

/** Quarantines the current database only when at least one file exists. */
function quarantineIfPresent(databasePath: string): void {
  const present = [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ].some((path) => existsSync(path));
  if (present) quarantineCorruptDatabase(databasePath);
}

function ensureDirectory(directory: string): void {
  if (existsSync(directory) && !isDirectory(directory)) {
    throw new DatabaseError("io-failure", "backup", { retryable: false });
  }
  try {
    mkdirSync(directory, { recursive: true });
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
