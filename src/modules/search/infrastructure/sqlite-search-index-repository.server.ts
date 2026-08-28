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
 * Opaque-reference guard for `id` / `sourceRef`. These identifiers legally
 * carry `type:id` and `type:a/b` shapes (see `domain.ts` SAFE_ID / SAFE_SOURCE),
 * so the projection guard — which forbids bare `/` and mid-text drive
 * letters — cannot apply verbatim. Only host content that can never be a valid
 * opaque reference is rejected: drive-letter paths, absolute paths,
 * backslashes and secret-shaped values.
 */
const FORBIDDEN_REFERENCE_PATTERNS: readonly RegExp[] = [
  /^[A-Za-z]:[/\\]/, // Windows drive-letter path (C:/ C:\ D:temp)
  /^[/\\]/, // POSIX absolute path or leading backslash
  /\\/, // any backslash (UNC, escaped)
  /\bsk-/i, // secret key (Anthropic/OpenAI)
  /\bghp_/i, // GitHub classic PAT
  /\bgho_/i, // GitHub OAuth token
  /\bgithub_pat_/i, // GitHub fine-grained PAT
  /\bglpat-/i, // GitLab PAT
  /\bxox[bpas]-/i, // Slack token
  /\bbearer\b/i, // Bearer credential
  /-----BEGIN [a-z ]*PRIVATE KEY-----/i,
];

function assertReferenceSafe(value: string): void {
  for (const pattern of FORBIDDEN_REFERENCE_PATTERNS) {
    if (pattern.test(value)) {
      throw new TypeError("search identifiers must be opaque safe references");
    }
  }
}

/** Chunk size for the `NOT IN`-style deletion below (SQLite caps bound
 * variables per statement at 32766; 500 keeps every batch far below it). */
const DELETE_CHUNK_SIZE = 500;

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
        // the domain shape/privacy guard and SKIPS violating documents, so a
        // single bad record can never fail the whole index write (P1-9). The
        // opaque-reference guard below stays a hard reject because an invalid
        // id/sourceRef would corrupt the index identity.
        const canonical = createSnapshot(
          snapshot.documents,
          snapshot.generatedAt,
          snapshot.stale,
        );
        for (const document of canonical.documents) {
          assertReferenceSafe(document.id);
          assertReferenceSafe(document.sourceRef);
        }
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
            // Chunked deletion (P2-13): `DELETE ... WHERE document_id NOT IN
            // (all ids)` grows one bound variable per id and exceeds SQLite's
            // 32766-variable limit on large rebuilds. Compute the rows absent
            // from the incoming snapshot once, then delete them in batches of
            // 500 — semantically identical to a single NOT IN over the full
            // list (naive per-chunk NOT IN would delete rows belonging to
            // other chunks).
            const keep = new Set(
              canonical.documents.map((document) => document.id),
            );
            const staleIds = database
              .prepare("SELECT document_id FROM search_documents")
              .all()
              .map((row) => String(row.document_id))
              .filter((id) => !keep.has(id));
            for (
              let index = 0;
              index < staleIds.length;
              index += DELETE_CHUNK_SIZE
            ) {
              const chunk = staleIds.slice(index, index + DELETE_CHUNK_SIZE);
              const placeholders = chunk.map(() => "?").join(", ");
              database
                .prepare(
                  `DELETE FROM search_documents WHERE document_id IN (${placeholders})`,
                )
                .run(...chunk);
            }
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
