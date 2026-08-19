import type { JsonSchema } from "./json-schema.ts";
import type {
  SnapshotEnvelope,
  SnapshotHydrateResult,
  SnapshotRepository,
} from "../platform/snapshot-runtime/contracts.ts";

/**
 * Test-only helper; production runtimes use domain SQLite repositories.
 *
 * Reusable snapshot envelope repository over an injected snapshot document
 * port. This adapter exists solely to exercise snapshot runtime contracts in
 * unit tests; every production runtime validates and persists snapshots at its
 * own SQLite boundary.
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
