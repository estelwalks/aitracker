/**
 * Integrity checks and fault-group set-aside (Story S-03, T-03-02).
 *
 * Server-only. `checkIntegrity` reports the two health signals the platform
 * cares about — page-level `integrity_check` and `foreign_key_check` — while
 * `setAsideFaultGroup` moves a database and its `-wal`/`-shm` siblings (the
 * same fault group) out of the way **without deleting them**, so the host can
 * reopen a fresh database without silently destroying evidence.
 *
 * The set-aside reason is part of the directory name because it is what an
 * operator reads first: a database moved aside by a *successful restore* is not
 * corrupt, and naming it `.corrupt.*` would misreport a healthy file. Reasons
 * map to `.corrupt.<ts>/` and `.replaced.<ts>/`.
 */
import { existsSync, renameSync, rmdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { DatabaseError, type SqliteDatabasePort } from "./contracts.ts";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
} from "./file-permissions.server.ts";

export interface IntegrityCheckResult {
  /** True when every `integrity_check` row is exactly `ok`. */
  readonly integrityOk: boolean;
  /** Number of `foreign_key_check` rows; `0` means no violations. */
  readonly foreignKeyViolations: number;
  /** First non-`ok` integrity message when the check fails. */
  readonly integrityMessage?: string;
}

/**
 * Why a fault group was moved aside.
 *
 * - `corrupt` — the database failed to open or failed an integrity check.
 * - `replaced-by-restore` — the database was healthy or unusable, but a
 *   user-confirmed restore replaced it; it is kept for rollback and evidence.
 */
export type SetAsideReason = "corrupt" | "replaced-by-restore";

export interface SetAsideFaultGroupOptions {
  readonly reason: SetAsideReason;
  /** Injectable rename primitive for deterministic fault-injection tests. */
  readonly renameFile?: (source: string, target: string) => void;
}

/** Directory-name prefix per reason. */
const REASON_PREFIX: Readonly<Record<SetAsideReason, string>> = {
  corrupt: ".corrupt",
  "replaced-by-restore": ".replaced",
};

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
 * whichever exist — into a new `.corrupt.<YYYYMMDD-HHmmss>/` (reason `corrupt`)
 * or `.replaced.<YYYYMMDD-HHmmss>/` (reason `replaced-by-restore`) directory
 * under the same parent. The files are moved, never deleted, and the returned
 * path is that directory. All connections must already be closed by the caller;
 * if a rename fails because the file is still held open, the error is reported
 * as `target-busy` rather than `io-failure`.
 */
export function setAsideFaultGroup(
  databasePath: string,
  options: SetAsideFaultGroupOptions,
): string {
  const prefix = REASON_PREFIX[options.reason];
  if (prefix === undefined) {
    throw new DatabaseError("invalid-argument", "integrity", {
      retryable: false,
    });
  }
  const directory = dirname(databasePath);
  const setAsideDirectory = reserveSetAsideDirectory(directory, prefix);
  try {
    ensurePrivateDirectory(setAsideDirectory);
  } catch (error) {
    throw new DatabaseError("io-failure", "integrity", { cause: error });
  }

  const renameFile = options.renameFile ?? renameSync;
  const moved: { source: string; target: string }[] = [];
  for (const source of faultGroup(databasePath)) {
    if (!existsSync(source)) continue;
    const target = uniqueTarget(setAsideDirectory, basename(source));
    try {
      renameFile(source, target);
      ensurePrivateFile(target);
      moved.push({ source, target });
    } catch (error) {
      let rollbackError: unknown;
      for (const item of [...moved].reverse()) {
        try {
          if (!existsSync(item.source) && existsSync(item.target)) {
            renameFile(item.target, item.source);
          }
        } catch (candidate) {
          rollbackError ??= candidate;
        }
      }
      try {
        rmdirSync(setAsideDirectory);
      } catch {
        // A failed compensation leaves evidence in the reserved directory.
      }
      if (rollbackError !== undefined) throw classifyMoveError(rollbackError);
      throw classifyMoveError(error);
    }
  }
  return setAsideDirectory;
}

/**
 * Convenience wrapper for the corruption path: identical to
 * `setAsideFaultGroup(databasePath, { reason: "corrupt" })`.
 */
export function quarantineCorruptDatabase(databasePath: string): string {
  return setAsideFaultGroup(databasePath, { reason: "corrupt" });
}

/**
 * Compensating action for `setAsideFaultGroup`: moves the fault group back from
 * `setAsideDirectory` to `databasePath` and removes the directory when it ends
 * up empty. Used when a restore fails *after* the old database was moved aside,
 * so the failure leaves the original database exactly where it was.
 *
 * A file whose original name is occupied again is left in the set-aside
 * directory instead of overwriting the newer file — nothing is ever deleted.
 */
export function rollbackFaultGroup(
  setAsideDirectory: string,
  databasePath: string,
): void {
  const directory = dirname(databasePath);
  for (const original of faultGroup(databasePath)) {
    const name = basename(original);
    const source = join(setAsideDirectory, name);
    if (!existsSync(source)) continue;
    const target = join(directory, name);
    if (existsSync(target)) continue;
    try {
      renameSync(source, target);
    } catch (error) {
      throw classifyMoveError(error);
    }
  }
  try {
    rmdirSync(setAsideDirectory);
  } catch {
    // A non-empty or already-removed directory is fine: the contract is only
    // that nothing is deleted.
  }
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
export function faultGroup(databasePath: string): readonly string[] {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

/** True when at least one member of the fault group exists on disk. */
export function faultGroupExists(databasePath: string): boolean {
  return faultGroup(databasePath).some((path) => existsSync(path));
}

/** First `<prefix>.<timestamp>/` name in `directory` that does not exist yet. */
function reserveSetAsideDirectory(directory: string, prefix: string): string {
  const base = `${prefix}.${formatTimestamp(Date.now())}`;
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
 * A freshly created set-aside directory is empty, so collisions are only
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
