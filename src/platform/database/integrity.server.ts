/**
 * Integrity checks and corruption quarantine (Story S-03, T-03-02).
 *
 * Server-only. `checkIntegrity` reports the two health signals the platform
 * cares about — page-level `integrity_check` and `foreign_key_check` — while
 * `quarantineCorruptDatabase` moves a failed database and its `-wal`/`-shm`
 * siblings (the same fault group) out of the way **without deleting them**, so
 * the host can reopen a fresh database without silently destroying evidence.
 */
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { DatabaseError, type SqliteDatabasePort } from "./contracts.ts";

export interface IntegrityCheckResult {
  /** True when every `integrity_check` row is exactly `ok`. */
  readonly integrityOk: boolean;
  /** Number of `foreign_key_check` rows; `0` means no violations. */
  readonly foreignKeyViolations: number;
  /** First non-`ok` integrity message when the check fails. */
  readonly integrityMessage?: string;
}

/**
 * Runs `PRAGMA integrity_check` and `PRAGMA foreign_key_check`. A clean
 * database yields `integrityOk: true` and `foreignKeyViolations: 0`.
 */
export function checkIntegrity(port: SqliteDatabasePort): IntegrityCheckResult {
  const integrity = readIntegrity(port);
  const foreignKeyViolations = countForeignKeyViolations(port);
  return {
    integrityOk: integrity.ok,
    foreignKeyViolations,
    integrityMessage: integrity.ok ? undefined : integrity.message,
  };
}

/**
 * Moves `databasePath`, `databasePath + "-wal"` and `databasePath + "-shm"` —
 * whichever exist — into a new `.corrupt.<YYYYMMDD-HHmmss>/` directory under
 * the same parent. The files are moved, never deleted, and the returned path
 * is the quarantine directory. All connections must already be closed by the
 * caller; if a rename fails because the file is still held open, the error is
 * reported as `target-busy` rather than `io-failure`.
 */
export function quarantineCorruptDatabase(databasePath: string): string {
  const directory = dirname(databasePath);
  const quarantineDirectory = reserveQuarantineDirectory(directory);
  try {
    mkdirSync(quarantineDirectory, { recursive: true });
  } catch (error) {
    throw new DatabaseError("io-failure", "integrity", { cause: error });
  }

  for (const source of faultGroup(databasePath)) {
    if (!existsSync(source)) continue;
    const target = uniqueTarget(quarantineDirectory, basename(source));
    try {
      renameSync(source, target);
    } catch (error) {
      throw classifyMoveError(error);
    }
  }
  return quarantineDirectory;
}

function readIntegrity(port: SqliteDatabasePort): {
  ok: boolean;
  message?: string;
} {
  let rows: readonly unknown[];
  try {
    rows = port.prepare("PRAGMA integrity_check").all();
  } catch (error) {
    throw integrityFailure(error);
  }
  const messages = rows.map(firstColumnValue).map((value) => String(value));
  const ok =
    messages.length > 0 &&
    messages.every((value) => value.toLowerCase() === "ok");
  if (ok) return { ok: true };
  const message =
    messages.find((value) => value.toLowerCase() !== "ok") ??
    "integrity check failed";
  return { ok: false, message };
}

function countForeignKeyViolations(port: SqliteDatabasePort): number {
  try {
    return port.prepare("PRAGMA foreign_key_check").all().length;
  } catch (error) {
    throw integrityFailure(error);
  }
}

function integrityFailure(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) {
    return new DatabaseError(error.code, "integrity", { cause: error });
  }
  return new DatabaseError("corrupt", "integrity", { cause: error });
}

/** The database plus its WAL/SHM siblings move together as one fault group. */
function faultGroup(databasePath: string): readonly string[] {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

/** First `.corrupt.<timestamp>/` name in `directory` that does not exist yet. */
function reserveQuarantineDirectory(directory: string): string {
  const base = `.corrupt.${formatTimestamp(Date.now())}`;
  let candidate = join(directory, base);
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = join(directory, `${base}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}

/** `YYYYMMDD-HHmmss` in local time, mirroring the backup naming scheme. */
function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * A freshly created quarantine directory is empty, so collisions are only
 * defensive; the suffix loop keeps a same-named file from ever being replaced.
 */
function uniqueTarget(directory: string, name: string): string {
  const candidate = join(directory, name);
  if (!existsSync(candidate)) return candidate;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let suffix = 2;
  for (;;) {
    const next = join(directory, `${stem}-${suffix}${extension}`);
    if (!existsSync(next)) return next;
    suffix += 1;
  }
}

/**
 * A rename that fails because the file is still held open (Windows reports
 * `EPERM`/`EACCES`, POSIX may report `EBUSY`) is a `target-busy` condition;
 * anything else is an `io-failure`.
 */
function classifyMoveError(error: unknown): DatabaseError {
  const cause = error instanceof Error ? error : new Error(String(error));
  const code = (error as { code?: unknown }).code;
  if (
    typeof code === "string" &&
    (code === "EPERM" || code === "EACCES" || code === "EBUSY")
  ) {
    return new DatabaseError("target-busy", "integrity", { cause });
  }
  return new DatabaseError("io-failure", "integrity", { cause });
}

function firstColumnValue(row: unknown): unknown {
  if (typeof row !== "object" || row === null) return undefined;
  const values = Object.values(row);
  return values.length === 0 ? undefined : values[0];
}
