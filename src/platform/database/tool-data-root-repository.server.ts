import { isAbsolute } from "node:path";

/** True for POSIX absolute paths and Windows drive-letter paths (any host). */
export function isAbsoluteDataDir(value: string): boolean {
  if (isAbsolute(value)) return true;
  return /^[A-Za-z]:[\\/]/.test(value);
}

import type { SqliteDatabasePort } from "./contracts.ts";
import { sqliteInteger, sqliteText } from "./sqlite-values.server.ts";

/**
 * Per-tool user data-directory overrides (Sources page "设置数据目录").
 *
 * Deliberate carve-out from the privacy guard (see migration 0003): the only
 * values this table may ever hold are absolute directories the user picked
 * for local scanning. The repository still validates shape (absolute, bounded,
 * no NUL/control characters) but intentionally does NOT run
 * `assertAppPreferenceValueSafe` — drive-letter paths are the point here.
 *
 * Read-side discipline: consumers must never project these values into
 * browser summaries, snapshots, exports or insights. Only the configuration
 * modal may echo the value back to the same user who picked it.
 */

export interface ToolDataRootRecord {
  readonly toolId: string;
  readonly dataDir: string;
  readonly updatedAtMs: number;
}

export interface ToolDataRootRepository {
  list(): Promise<readonly ToolDataRootRecord[]>;
  get(toolId: string): Promise<ToolDataRootRecord | undefined>;
  set(toolId: string, dataDir: string, updatedAtMs?: number): Promise<void>;
  delete(toolId: string): Promise<boolean>;
}

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const MAX_TOOL_ID_LENGTH = 64;
const MAX_DATA_DIR_LENGTH = 2048;

function assertToolId(toolId: string): void {
  if (!TOOL_ID_PATTERN.test(toolId) || toolId.length > MAX_TOOL_ID_LENGTH) {
    throw new TypeError("Invalid tool id for data-directory override");
  }
}

export function assertToolDataRootPath(toolId: string, dataDir: string): void {
  assertToolId(toolId);
  if (typeof dataDir !== "string" || dataDir.trim() === "") {
    throw new TypeError("dataDir must be a non-empty string");
  }
  if (!isAbsoluteDataDir(dataDir)) {
    throw new TypeError("dataDir must be an absolute directory path");
  }
  if (dataDir.length > MAX_DATA_DIR_LENGTH) {
    throw new TypeError("dataDir exceeds the length limit");
  }

  if (/\p{Cc}/u.test(dataDir)) {
    throw new TypeError("dataDir must not contain control characters");
  }
}

export function createSqliteToolDataRootRepository(
  database: SqliteDatabasePort,
): ToolDataRootRepository {
  return {
    async list() {
      const rows = database
        .prepare(
          "SELECT tool_id, data_dir, updated_at_ms FROM tool_data_roots ORDER BY tool_id",
        )
        .all();
      return rows.map((row) => ({
        toolId: sqliteText(row.tool_id),
        dataDir: sqliteText(row.data_dir),
        updatedAtMs: sqliteInteger(row.updated_at_ms),
      }));
    },
    async get(toolId) {
      assertToolId(toolId);
      const row = database
        .prepare(
          "SELECT tool_id, data_dir, updated_at_ms FROM tool_data_roots WHERE tool_id = ?",
        )
        .get(toolId);
      if (!row) return undefined;
      return {
        toolId: sqliteText(row.tool_id),
        dataDir: sqliteText(row.data_dir),
        updatedAtMs: sqliteInteger(row.updated_at_ms),
      };
    },
    async set(toolId, dataDir, updatedAtMs = Date.now()) {
      assertToolDataRootPath(toolId, dataDir);
      const value = dataDir.trim();
      assertToolDataRootPath(toolId, value);
      database
        .prepare(
          `INSERT INTO tool_data_roots (tool_id, data_dir, updated_at_ms)
           VALUES (?, ?, ?)
           ON CONFLICT (tool_id) DO UPDATE SET
             data_dir = excluded.data_dir,
             updated_at_ms = excluded.updated_at_ms`,
        )
        .run(toolId, value, updatedAtMs);
    },
    async delete(toolId) {
      assertToolId(toolId);
      const result = database
        .prepare("DELETE FROM tool_data_roots WHERE tool_id = ?")
        .run(toolId);
      return result.changes > 0;
    },
  };
}
