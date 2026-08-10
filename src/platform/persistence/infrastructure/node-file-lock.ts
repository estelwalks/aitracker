import { open, rm } from "node:fs/promises";

import {
  PersistenceError,
  type FileLock,
  type FileLockLease,
} from "../contracts.ts";
import { nodeErrorCode } from "./node-file-system.ts";

/**
 * Advisory cross-process lock. It is intentionally non-stale-breaking: a
 * process that cannot prove ownership must surface a conflict instead of
 * deleting another process' lock.
 */
export class NodeFileLock implements FileLock {
  constructor(private readonly path: string) {}

  async acquire(): Promise<FileLockLease> {
    try {
      const handle = await open(this.path, "wx", 0o600);
      await handle.close();
    } catch (error) {
      if (nodeErrorCode(error) === "EEXIST") {
        throw new PersistenceError("lock-conflict", "lock", {
          cause: error,
          retryable: true,
        });
      }
      throw mapNodeError(error, "lock");
    }

    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        try {
          await rm(this.path, { force: true });
        } catch (error) {
          throw mapNodeError(error, "lock");
        }
      },
    };
  }
}

export function mapNodeError(
  error: unknown,
  operation: "read" | "write" | "lock" | "migration" | "backup",
  platform: NodeJS.Platform = process.platform,
): PersistenceError {
  if (error instanceof PersistenceError) return error;
  const code = nodeErrorCode(error);
  const persistenceCode =
    code === "ENOENT"
      ? "not-found"
      : code === "EEXIST"
        ? "already-exists"
        : code === "EBUSY" || (platform === "win32" && code === "EPERM")
          ? "target-busy"
          : code === "EACCES" || code === "EPERM"
            ? "access-denied"
            : "io-failure";
  return new PersistenceError(persistenceCode, operation, { cause: error });
}
