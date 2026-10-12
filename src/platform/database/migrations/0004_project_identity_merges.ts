/**
 * Migration 0004: user-confirmed project identity merges.
 *
 * The table stores only installation-scoped HMAC identities. It deliberately
 * never stores the raw project path, so a manual merge remains inside the
 * same privacy contract as the usage/session snapshots.
 */
export const PROJECT_IDENTITY_MERGES_SQL = `-- AITracker local storage database — opaque project identity merges.
CREATE TABLE project_identity_merges (
  source_identity TEXT PRIMARY KEY CHECK (
    length(source_identity) = 43
    AND source_identity NOT GLOB '*[^A-Za-z0-9_-]*'
    AND instr(source_identity, char(0)) = 0
  ),
  target_identity TEXT NOT NULL CHECK (
    length(target_identity) = 43
    AND target_identity NOT GLOB '*[^A-Za-z0-9_-]*'
    AND instr(target_identity, char(0)) = 0
  ),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  CHECK (source_identity <> target_identity)
) STRICT;

CREATE INDEX idx_project_identity_merges_target
  ON project_identity_merges(target_identity);
`;
