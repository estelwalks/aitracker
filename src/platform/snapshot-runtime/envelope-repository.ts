import type { AtomicJsonStore, JsonSchema } from "../persistence/contracts.ts";
import type {
  SnapshotEnvelope,
  SnapshotHydrateResult,
  SnapshotRepository,
} from "./contracts.ts";

/**
 * P3-T3-01/02/03: reusable snapshot envelope repository.
 *
 * Stores the domain snapshot in its own versioned file with a strict schema.
 * Reads never trigger a refresh; corrupt files fall back to the empty
 * envelope without touching last-known-good. `legacy` migration (copy-forward
 * from an older file) is optional per domain.
 */

export interface SnapshotEnvelopeRepositoryOptions<T> {
  readonly store: AtomicJsonStore<SnapshotEnvelope<T>>;
  readonly schema: JsonSchema<SnapshotEnvelope<T>>;
  /** Optional legacy store to copy-forward on first read. */
  readonly legacyStore?: AtomicJsonStore<unknown>;
  /** Maps a legacy document to the envelope (required with legacyStore). */
  readonly fromLegacy?: (
    value: unknown,
    createdAt: string,
  ) => SnapshotEnvelope<T>;
  readonly emptyEnvelope: SnapshotEnvelope<T>;
}

export function createSnapshotEnvelopeRepository<T>(
  options: SnapshotEnvelopeRepositoryOptions<T>,
): SnapshotRepository<T> & {
  /** True when the current state came from the legacy file (copy-forward). */
  readonly fromLegacy: () => boolean;
} {
  let migratedFromLegacy = false;

  const emptyEnvelope = (): SnapshotEnvelope<T> => ({
    ...options.emptyEnvelope,
    revision: "empty",
  });

  const repository: SnapshotRepository<T> & {
    readonly fromLegacy: () => boolean;
  } = {
    fromLegacy: () => migratedFromLegacy,
    async load(): Promise<SnapshotHydrateResult<T>> {
      const result = await options.store.read();
      if (result.source !== "default") {
        return {
          envelope: result.value,
          source: result.source,
          schemaVersion: result.schemaVersion,
          ...(result.corruptBackupCreated
            ? { corruptBackupCreated: true }
            : {}),
        };
      }
      if (options.legacyStore && options.fromLegacy) {
        const legacy = await options.legacyStore.read();
        if (legacy.value != null) {
          const envelope = options.fromLegacy(
            legacy.value,
            new Date().toISOString(),
          );
          try {
            await options.store.write(envelope);
            migratedFromLegacy = true;
          } catch {
            // Write failure keeps the legacy file readable next time.
          }
          return { envelope, source: "migrated", schemaVersion: 1 };
        }
      }
      return {
        envelope: emptyEnvelope(),
        source: "default",
        schemaVersion: 1,
      };
    },
    async save(envelope: SnapshotEnvelope<T>) {
      await options.store.write(envelope);
      migratedFromLegacy = false;
    },
    async clear() {
      await options.store.write(emptyEnvelope());
    },
  };
  return repository;
}
