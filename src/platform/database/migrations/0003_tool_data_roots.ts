/**
 * Migration 0003: per-tool user data-directory overrides (Sources page).
 *
 * Issue #31 companion feature: users can point each agent at the directory
 * that actually holds its data (portable installs, custom HERMES_HOME-style
 * relocations). The selected directory is an absolute path supplied by the
 * user through a native folder dialog.
 *
 * Deliberate privacy carve-out: `app_preferences` and `runtime_flags` reject
 * drive-letter/backslash/absolute values through the forbidden-zone CHECK and
 * the repository guard (§9-4 / §14.4). Those zones exist so the application
 * never *collects* paths by itself. A user-selected data directory is the
 * opposite: the user picked it for local scanning only. It is persisted here,
 * in a table without the forbidden-zone CHECK, and must never be projected
 * into browser summaries, snapshots, exports or insights (the read side
 * enforces that, see tool-data-root.server.ts).
 */
export const TOOL_DATA_ROOTS_SQL = `-- AITracker local storage database — per-tool user data directories.
CREATE TABLE tool_data_roots (
  tool_id TEXT PRIMARY KEY CHECK (
    length(tool_id) BETWEEN 1 AND 64
    AND instr(tool_id, char(0)) = 0
  ),
  data_dir TEXT NOT NULL CHECK (
    length(data_dir) BETWEEN 2 AND 2048
    AND instr(data_dir, char(0)) = 0
  ),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
) STRICT;
`;
