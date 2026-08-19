import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  sqliteInteger,
  sqliteText,
} from "../../../platform/database/sqlite-values.server.ts";
import { err, ok, type Result } from "../../../shared/result.ts";
import type {
  SearchDocument,
  SearchDocumentType,
  SearchFreshness,
  SearchIndexRepository,
  SearchIndexSnapshot,
} from "../contracts.ts";
import { createSnapshot } from "../domain.ts";

export interface SqliteSearchIndexRepositoryOptions {
  readonly database: SqliteDatabasePort;
  /** Clock in epoch milliseconds for the rebuilt snapshot's generatedAt. */
  readonly now?: () => number;
}

const INSERT_OR_UPSERT = `INSERT INTO search_documents
  (document_id, type, source_ref, title, tags_json, text_summary, freshness, updated_at_ms, source_revision)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT (type, source_ref) DO UPDATE SET
    document_id = excluded.document_id,
    title = excluded.title,
    tags_json = excluded.tags_json,
    text_summary = excluded.text_summary,
    freshness = excluded.freshness,
    updated_at_ms = excluded.updated_at_ms,
    source_revision = excluded.source_revision`;

function rowToDocument(row: Readonly<Record<string, unknown>>): SearchDocument {
  return {
    id: sqliteText(row.document_id),
    type: sqliteText(row.type) as SearchDocumentType,
    sourceRef: sqliteText(row.source_ref),
    title: sqliteText(row.title),
    tags: JSON.parse(sqliteText(row.tags_json)) as string[],
    textSummary: sqliteText(row.text_summary),
    freshness: sqliteText(row.freshness) as SearchFreshness,
    updatedAt: new Date(sqliteInteger(row.updated_at_ms)).toISOString(),
  };
}

/**
 * SQLite-backed search projection index (S-03, T-03-03).
 *
 * `write` is a full rebuild: every document is upserted on its
 * `UNIQUE(type, source_ref)` identity and rows absent from the incoming
 * snapshot are deleted in the same transaction. `read` reconstructs the
 * snapshot from `search_documents` and recomputes the version fingerprint via
 * `createSnapshot` (nothing version-shaped is persisted).
 */
export function createSqliteSearchIndexRepository(
  options: SqliteSearchIndexRepositoryOptions,
): SearchIndexRepository {
  const { database } = options;
  const now = options.now ?? Date.now;
  return {
    async read(): Promise<Result<SearchIndexSnapshot>> {
      try {
        const rows = database
          .prepare("SELECT * FROM search_documents ORDER BY document_id")
          .all();
        const documents = rows.map(rowToDocument);
        return ok(createSnapshot(documents, new Date(now()).toISOString()));
      } catch {
        return err("errors.search.readFailed");
      }
    },
    async write(snapshot: SearchIndexSnapshot): Promise<Result<void>> {
      try {
        // Re-validate + canonicalize (defence in depth): createSnapshot runs
        // the domain privacy/shape guard so a direct caller cannot bypass it.
        const canonical = createSnapshot(
          snapshot.documents,
          snapshot.generatedAt,
          snapshot.stale,
        );
        const transaction = database.transaction();
        transaction.begin();
        try {
          const upsert = database.prepare(INSERT_OR_UPSERT);
          for (const document of canonical.documents) {
            upsert.run(
              document.id,
              document.type,
              document.sourceRef,
              document.title,
              JSON.stringify(document.tags),
              document.textSummary,
              document.freshness,
              Date.parse(document.updatedAt),
            );
          }
          if (canonical.documents.length === 0) {
            database.prepare("DELETE FROM search_documents").run();
          } else {
            const ids = canonical.documents.map((document) => document.id);
            const placeholders = ids.map(() => "?").join(", ");
            database
              .prepare(
                `DELETE FROM search_documents WHERE document_id NOT IN (${placeholders})`,
              )
              .run(...ids);
          }
          transaction.commit();
        } catch (error) {
          try {
            transaction.rollback();
          } catch {
            // Preserve the original failure.
          }
          throw error;
        }
        return ok(undefined);
      } catch {
        return err("errors.search.writeFailed");
      }
    },
  };
}
