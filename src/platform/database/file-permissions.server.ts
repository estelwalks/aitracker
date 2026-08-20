/** Best-effort private permissions for local database artifacts on POSIX. */
import { chmodSync, mkdirSync } from "node:fs";

/** Creates a directory and narrows it to the current user on POSIX. */
export function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodPrivate(path, 0o700);
}

/** Narrows an existing database, backup, lock, or manifest file on POSIX. */
export function ensurePrivateFile(path: string): void {
  chmodPrivate(path, 0o600);
}

function chmodPrivate(path: string, mode: number): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(path, mode);
  } catch {
    // Best effort: creation/open errors remain authoritative. Some filesystems
    // (for example FAT or enterprise network mounts) do not expose POSIX mode
    // bits even though SQLite itself works correctly on them.
  }
}
