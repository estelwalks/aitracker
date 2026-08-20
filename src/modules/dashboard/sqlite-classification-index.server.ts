import type { SqliteDatabasePort } from "../../platform/database/contracts.ts";
import { hashSensitiveRef } from "../../platform/database/snapshot-generation.server.ts";
import type {
  ClassificationIndex,
  ClassificationIndexEntry,
  ClassificationIndexRepository,
} from "./classification-index.server.ts";

export interface SqliteClassificationIndexOptions {
  readonly database: SqliteDatabasePort;
  readonly hmacKey: string | Uint8Array;
}

const EMPTY: ClassificationIndex = {
  schemaVersion: 1,
  revision: 0,
  entries: {},
};

export function createSqliteClassificationIndexRepository(
  options: SqliteClassificationIndexOptions,
): ClassificationIndexRepository {
  const { database } = options;
  const knownRefs = new Map<string, ClassificationIndexEntry>();
  const refHash = (ref: string): string =>
    hashSensitiveRef(options.hmacKey, "project", ref);

  const readOne = (ref: string): ClassificationIndexEntry | undefined => {
    const row = database
      .prepare(
        "SELECT kind, label, fingerprint, classified_at_ms FROM project_classifications WHERE ref_hash=?",
      )
      .get(refHash(ref));
    if (!row) return undefined;
    const entry: ClassificationIndexEntry = {
      ref,
      kind: String(row.kind) as ClassificationIndexEntry["kind"],
      label: String(row.label),
      classifiedAt: new Date(Number(row.classified_at_ms)).toISOString(),
      fingerprint: row.fingerprint == null ? null : String(row.fingerprint),
    };
    knownRefs.set(ref, entry);
    return entry;
  };

  const repository: ClassificationIndexRepository = {
    async get(ref) {
      return readOne(ref);
    },
    async getMany(refs) {
      const unique = [...new Set(refs.filter(Boolean))];
      const found = new Map<string, ClassificationIndexEntry>();
      for (const ref of unique) {
        const entry = readOne(ref);
        if (entry) found.set(ref, entry);
      }
      return found;
    },
    async commit(entries) {
      if (entries.length === 0) return EMPTY;
      const transaction = database.transaction();
      transaction.begin();
      try {
        for (const entry of entries) {
          database
            .prepare(
              `INSERT INTO project_classifications(ref_hash,kind,label,fingerprint,classified_at_ms,revision)
             VALUES (?, ?, ?, ?, ?, 1)
             ON CONFLICT(ref_hash) DO UPDATE SET kind=excluded.kind,label=excluded.label,
               fingerprint=excluded.fingerprint,classified_at_ms=excluded.classified_at_ms,
               revision=project_classifications.revision+1`,
            )
            .run(
              refHash(entry.ref),
              entry.kind,
              entry.label,
              entry.fingerprint,
              Math.max(0, Date.parse(entry.classifiedAt)),
            );
          knownRefs.set(entry.ref, entry);
        }
        transaction.commit();
      } catch (error) {
        transaction.rollback();
        throw error;
      }
      const revisionRow = database
        .prepare(
          "SELECT COALESCE(MAX(revision),0) AS revision FROM project_classifications",
        )
        .get();
      return {
        schemaVersion: 1,
        revision: Number(revisionRow?.revision ?? 0),
        entries: Object.fromEntries(knownRefs),
      };
    },
    async needsClassification(refs, currentFingerprints) {
      const found = await repository.getMany(refs);
      return [...new Set(refs)].filter((ref) => {
        const entry = found.get(ref);
        return (
          !entry || entry.fingerprint !== (currentFingerprints.get(ref) ?? null)
        );
      });
    },
    async clear() {
      database.prepare("DELETE FROM project_classifications").run();
      knownRefs.clear();
    },
  };
  return repository;
}
