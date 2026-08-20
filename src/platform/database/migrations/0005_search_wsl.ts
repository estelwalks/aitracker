/** Generated inline migration for Nitro's single-file server bundle.
 * Keep byte-identical with 0005_search_wsl.sql (LF normalized). */
export const PLATFORM_MIGRATION_0005_SQL = `-- TrustTools local storage database — migration 0005 "search & wsl".
-- Closes the remaining SQLite gaps from Story S-03: a small-object snapshot
-- blob store for the WSL topology snapshot, and the browser-safe search
-- projection index. Both tables are STRICT. The snapshot_blobs payload size is
-- enforced at the repository layer (≤ 256 KB), never inside this migration.

CREATE TABLE snapshot_blobs (
  snapshot_id TEXT PRIMARY KEY REFERENCES snapshot_generations (snapshot_id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0)
) STRICT;

CREATE TABLE search_documents (
  document_id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('agent', 'skill', 'session', 'report', 'knowledge', 'finding')),
  source_ref TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  text_summary TEXT NOT NULL,
  freshness TEXT NOT NULL CHECK (freshness IN ('fresh', 'stale', 'unknown')),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  source_revision TEXT,
  UNIQUE (type, source_ref)
) STRICT;

CREATE INDEX idx_search_documents_type_updated
  ON search_documents (type, updated_at_ms DESC);

CREATE INDEX idx_search_documents_freshness
  ON search_documents (freshness);
`;
