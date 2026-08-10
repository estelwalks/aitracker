import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export interface NodeFileSystem {
  ensureDirectory(path: string): Promise<void>;
  readText(path: string): Promise<string>;
  writeTextExclusiveAndSync(path: string, value: string): Promise<void>;
  rename(path: string, destination: string): Promise<void>;
  remove(path: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}

/** Node-only implementation; callers outside infrastructure use its contract. */
export function createNodeFileSystem(): NodeFileSystem {
  return {
    async ensureDirectory(path) {
      await mkdir(path, { recursive: true, mode: 0o700 });
    },
    readText(path) {
      return readFile(path, "utf8");
    },
    async writeTextExclusiveAndSync(path, value) {
      const handle = await open(path, "wx", 0o600);
      try {
        await handle.writeFile(value, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    rename,
    async remove(path) {
      await rm(path, { force: true });
    },
    async syncDirectory(path) {
      // Directory fsync improves crash durability on APFS/ext4. Windows does
      // not consistently permit opening directories, so it is best-effort.
      try {
        const handle = await open(dirname(path), "r");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (error) {
        const code = nodeErrorCode(error);
        if (code !== "EISDIR" && code !== "EPERM" && code !== "EINVAL") {
          throw error;
        }
      }
    },
  };
}

export function nodeErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}
