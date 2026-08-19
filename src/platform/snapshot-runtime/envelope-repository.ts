import type { JsonSchema } from "../../test-support/json-schema.ts";
import type {
  SnapshotEnvelope,
  SnapshotHydrateResult,
  SnapshotRepository,
} from "./contracts.ts";

/**
 * P3-T3-01/02/03: reusable snapshot envelope repository.
 *
 * Test/embedded adapter over an injected snapshot document port. Production
 * runtimes use their domain-specific SQLite repositories.
 */

export interface SnapshotDocumentPort<T> {
  read(): Promise<{
    readonly value: SnapshotEnvelope<T>;
    readonly source: string;
    readonly schemaVersion: number;
    readonly corruptBackupCreated?: boolean;
  }>;
  write(value: SnapshotEnvelope<T>): Promise<void>;
}

export interface SnapshotEnvelopeRepositoryOptions<T> {
  readonly store: SnapshotDocumentPort<T>;
  /** Test adapter validation metadata; SQLite validates at its own boundary. */
  readonly schema?: JsonSchema<SnapshotEnvelope<T>>;
  readonly emptyEnvelope: SnapshotEnvelope<T>;
}

export function createSnapshotEnvelopeRepository<T>(
  options: SnapshotEnvelopeRepositoryOptions<T>,
): SnapshotRepository<T> {
  const emptyEnvelope = (): SnapshotEnvelope<T> => ({
    ...options.emptyEnvelope,
    revision: "empty",
  });

  const repository: SnapshotRepository<T> = {
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
      return {
        envelope: emptyEnvelope(),
        source: "default",
        schemaVersion: 1,
      };
    },
    async save(envelope: SnapshotEnvelope<T>) {
      await options.store.write(envelope);
    },
    async clear() {
      await options.store.write(emptyEnvelope());
    },
  };
  return repository;
}
