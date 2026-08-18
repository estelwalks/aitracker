import type {
  AtomicJsonStore,
  JsonSchema,
} from "../../../platform/persistence/contracts.ts";
import type { UsageSnapshotDto } from "../contracts.ts";
import type {
  SnapshotEnvelope,
  SnapshotHydrateResult,
  SnapshotRepository,
} from "../../../platform/snapshot-runtime/contracts.ts";

/**
 * P2-T2-05: Usage snapshot envelope repository.
 *
 * New snapshots are written to `usage-snapshot-envelope.v1.json` (a sibling of
 * the legacy `usage-snapshot.v1.json`, which is never overwritten). On first
 * read with no new file present, the repository copy-forwards the legacy
 * snapshot into the envelope so pages see the last-known-good without a scan.
 */

export const USAGE_ENVELOPE_FILE = "usage-snapshot-envelope.v1.json";

export interface UsageEnvelopeRepositoryOptions {
  /** New envelope store (sibling file). */
  readonly envelopeStore: AtomicJsonStore<SnapshotEnvelope<UsageSnapshotDto>>;
  /** Legacy store for copy-forward compatibility (read-only fallback). */
  readonly legacyStore: AtomicJsonStore<UsageSnapshotDto | null>;
  readonly schema?: JsonSchema<SnapshotEnvelope<UsageSnapshotDto>>;
}

export const usageEnvelopeSchema: JsonSchema<
  SnapshotEnvelope<UsageSnapshotDto>
> = {
  currentVersion: 1,
  parse(value) {
    const envelope = value as SnapshotEnvelope<UsageSnapshotDto>;
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      typeof envelope.revision !== "string" ||
      (envelope.data !== null && typeof envelope.data !== "object")
    ) {
      throw new TypeError("Invalid usage snapshot envelope");
    }
    return envelope;
  },
};

/** Adapts the legacy snapshot into an envelope (copy-forward source). */
export function envelopeFromLegacy(
  snapshot: UsageSnapshotDto,
  createdAt: string,
): SnapshotEnvelope<UsageSnapshotDto> {
  return {
    schemaVersion: 1,
    revision: `legacy:${snapshot.generatedAt}`,
    generatedAt: snapshot.generatedAt,
    sourceFingerprint: "legacy-v1",
    status: "stale",
    data: snapshot,
    diagnostics: {
      lastAttemptAt: createdAt,
      lastSuccessAt: snapshot.generatedAt,
      warningCodes: ["migrated-from-legacy"],
    },
  };
}

export function createUsageEnvelopeRepository(
  options: UsageEnvelopeRepositoryOptions,
): SnapshotRepository<UsageSnapshotDto> & {
  /** True when the current state came from the legacy file (copy-forward). */
  readonly fromLegacy: () => boolean;
} {
  let migratedFromLegacy = false;
  const repository: SnapshotRepository<UsageSnapshotDto> & {
    readonly fromLegacy: () => boolean;
  } = {
    fromLegacy: () => migratedFromLegacy,
    async load(): Promise<SnapshotHydrateResult<UsageSnapshotDto>> {
      const result = await options.envelopeStore.read();
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
      // No new envelope yet: copy-forward the legacy snapshot without touching
      // the old file.
      const legacy = await options.legacyStore.read();
      const snapshot = legacy.value ?? undefined;
      if (snapshot == null || snapshot.mode === "empty") {
        return {
          envelope: {
            schemaVersion: 1,
            revision: "empty",
            generatedAt: null,
            sourceFingerprint: null,
            status: "empty",
            data: null,
            diagnostics: {
              lastAttemptAt: null,
              lastSuccessAt: null,
              warningCodes: [],
            },
          },
          source: "default",
          schemaVersion: 1,
        };
      }
      const createdAt = new Date().toISOString();
      const envelope = envelopeFromLegacy(snapshot, createdAt);
      // Persist the copied envelope so subsequent reads do not re-read legacy.
      try {
        await options.envelopeStore.write(envelope);
        migratedFromLegacy = true;
      } catch {
        // Write failure keeps the legacy file readable on the next attempt.
      }
      return { envelope, source: "migrated", schemaVersion: 1 };
    },
    async save(envelope) {
      await options.envelopeStore.write(envelope);
      migratedFromLegacy = false;
    },
    async clear() {
      await options.envelopeStore.write({
        schemaVersion: 1,
        revision: "cleared",
        generatedAt: null,
        sourceFingerprint: null,
        status: "empty",
        data: null,
        diagnostics: {
          lastAttemptAt: null,
          lastSuccessAt: null,
          warningCodes: [],
        },
      } satisfies SnapshotEnvelope<UsageSnapshotDto>);
    },
  };
  return repository;
}
