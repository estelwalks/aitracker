import type { AtomicJsonStore } from "../contracts.ts";

export interface ShadowAtomicJsonStoreOptions<T> {
  readonly sqlite: AtomicJsonStore<T>;
  readonly legacy: AtomicJsonStore<T>;
  readonly readFromSqlite: () => boolean;
  readonly onLegacyWriteError?: (error: unknown) => void;
  readonly onSqliteReadError?: (error: unknown) => void;
}

/** SQLite is the authoritative write. Legacy is a best-effort compatibility mirror. */
export function createShadowAtomicJsonStore<T>(
  options: ShadowAtomicJsonStoreOptions<T>,
): AtomicJsonStore<T> {
  return {
    async read() {
      if (!options.readFromSqlite()) return options.legacy.read();
      try {
        return await options.sqlite.read();
      } catch (error) {
        options.onSqliteReadError?.(error);
        return options.legacy.read();
      }
    },
    async write(value) {
      await options.sqlite.write(value);
      try {
        await options.legacy.write(value);
      } catch (error) {
        options.onLegacyWriteError?.(error);
      }
    },
  };
}
