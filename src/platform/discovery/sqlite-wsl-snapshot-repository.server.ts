import {
  DatabaseError,
  type SqliteDatabasePort,
} from "../database/contracts.ts";
import {
  clearGenerations,
  commitGeneration,
  loadGeneration,
} from "../database/snapshot-generation.server.ts";
import { sqliteText } from "../database/sqlite-values.server.ts";
import type { SnapshotRepository } from "../snapshot-runtime/contracts.ts";
import type { WslTopology } from "./wsl-topology.server.ts";

export interface SqliteWslSnapshotRepositoryOptions {
  readonly database: SqliteDatabasePort;
  readonly now?: () => number;
  readonly createId?: () => string;
}

/**
 * Repository-layer payload bound for `snapshot_blobs` (architecture §5.1):
 * the WSL topology is a small, low-frequency object, so a single 256 KB blob
 * is the documented ceiling. Anything larger is refused before the write.
 */
const MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * SQLite-backed WSL topology snapshot (S-03, T-03-02). Reuses the shared
 * generation/head helpers (`loadGeneration`/`commitGeneration`) with
 * domain="wsl"; the topology object itself is stored as one JSON blob row in
 * `snapshot_blobs` rather than normalized child tables.
 */
export function createSqliteWslSnapshotRepository(
  options: SqliteWslSnapshotRepositoryOptions,
): SnapshotRepository<WslTopology> {
  const { database } = options;
  return {
    async load() {
      return loadGeneration({
        database,
        domain: "wsl",
        readData(snapshotId) {
          const row = database
            .prepare(
              "SELECT payload_json FROM snapshot_blobs WHERE snapshot_id = ?",
            )
            .get(snapshotId);
          if (row === undefined) {
            throw new DatabaseError("corrupt", "read", { retryable: false });
          }
          return JSON.parse(sqliteText(row.payload_json)) as WslTopology;
        },
      });
    },
    async save(envelope) {
      commitGeneration({
        database,
        domain: "wsl",
        envelope,
        now: options.now,
        createId: options.createId,
        writeData(snapshotId, data) {
          const payload = JSON.stringify(data);
          const payloadBytes = Buffer.byteLength(payload, "utf8");
          if (payloadBytes > MAX_PAYLOAD_BYTES) {
            throw new DatabaseError("invalid-argument", "write", {
              retryable: false,
            });
          }
          database
            .prepare(
              "INSERT INTO snapshot_blobs (snapshot_id, payload_json, payload_bytes) VALUES (?, ?, ?)",
            )
            .run(snapshotId, payload, payloadBytes);
        },
      });
    },
    async clear() {
      clearGenerations(database, "wsl");
    },
  };
}
