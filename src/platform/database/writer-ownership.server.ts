/** Cross-process single-writer ownership for file-backed databases. */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

import { DatabaseError } from "./contracts.ts";
import { ensurePrivateFile } from "./file-permissions.server.ts";

interface LockRecord {
  readonly pid: number;
  readonly token: string;
  readonly createdAtMs: number;
}

export interface WriterOwnership {
  readonly path: string;
  readonly token: string;
  release(): void;
}

const HELD_LOCKS = new Map<string, string>();
let exitHookInstalled = false;

/**
 * Atomically acquires `<database>.writer.lock`. A lock is reclaimed only when
 * its recorded process is provably absent (`kill(pid, 0)` reports ESRCH).
 * Malformed or permission-indeterminate locks fail closed.
 */
export function acquireWriterOwnership(databasePath: string): WriterOwnership {
  const lockPath = `${databasePath}.writer.lock`;
  const token = randomUUID();
  const record: LockRecord = {
    pid: process.pid,
    token,
    createdAtMs: Date.now(),
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      publishCompleteLock(lockPath, record);
      HELD_LOCKS.set(lockPath, token);
      installExitHook();
      return {
        path: lockPath,
        token,
        release: () => releaseOwnedLock(lockPath, token),
      };
    } catch (error) {
      if ((error as { code?: unknown }).code !== "EEXIST") {
        throw new DatabaseError("io-failure", "open", { cause: error });
      }
    }

    const existing = readLockRecord(lockPath);
    if (existing === undefined || isProcessAlive(existing.pid)) {
      throw new DatabaseError("already-open", "open", { retryable: false });
    }

    // Atomic rename means only one contender can claim this particular stale
    // record. A losing contender retries against the new current lock.
    const stalePath = `${lockPath}.stale.${token}`;
    try {
      renameSync(lockPath, stalePath);
      try {
        unlinkSync(stalePath);
      } catch {
        // It is outside the active lock name and cannot grant a second writer.
      }
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === "ENOENT" || code === "EEXIST") continue;
      throw new DatabaseError("io-failure", "open", { cause: error });
    }
  }
  throw new DatabaseError("already-open", "open", { retryable: false });
}

/**
 * Publishes only a fully written record. Hard-linking a private candidate into
 * the active name is fail-exclusive (`EEXIST`) and avoids an empty/partial
 * active lock if the process crashes while writing metadata.
 */
function publishCompleteLock(path: string, record: LockRecord): void {
  const candidate = `${path}.candidate.${record.token}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(candidate, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
    closeSync(descriptor);
    descriptor = undefined;
    ensurePrivateFile(candidate);
    linkSync(candidate, path);
    ensurePrivateFile(path);
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Cleanup below is still attempted.
      }
    }
    try {
      unlinkSync(candidate);
    } catch {
      // Candidate names never grant ownership and are safe to leave behind.
    }
  }
}

function readLockRecord(path: string): LockRecord | undefined {
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<LockRecord>;
    if (
      Number.isSafeInteger(parsed.pid) &&
      Number(parsed.pid) > 0 &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0 &&
      typeof parsed.createdAtMs === "number" &&
      Number.isFinite(parsed.createdAtMs)
    ) {
      return parsed as LockRecord;
    }
  } catch {
    // Fail closed: an unreadable lock must never be interpreted as stale.
  }
  return undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: unknown }).code !== "ESRCH";
  }
}

function releaseOwnedLock(path: string, token: string): void {
  const current = readLockRecord(path);
  if (current?.token !== token || current.pid !== process.pid) return;
  try {
    unlinkSync(path);
    HELD_LOCKS.delete(path);
  } catch {
    // A surviving lock is safe: a later process only reclaims it after this
    // process is provably gone.
  }
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("exit", () => {
    for (const [path, token] of HELD_LOCKS) releaseOwnedLock(path, token);
  });
}
