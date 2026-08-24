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
 * Host-content guard for the persisted WSL topology blob. The topology
 * legitimately contains Linux home paths discovered inside WSL distros
 * (a distro user's home), so the platform preference guard's POSIX-root rules cannot
 * apply verbatim. Only *host* Windows content — drive-letter paths, UNC
 * roots, secret-shaped values and shell commands — must never reach
 * `snapshot_blobs`. The serialized payload is scanned as one string so content
 * assembled only by serialization is caught too.
 */
const HOST_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /[A-Za-z]:[\\/]/, // Windows drive-letter path (C:\ C:/ D:temp\x)
  /\\{2}/, // UNC root or escaped backslash (\\server\share)
  /\bsk-/i, // secret key (Anthropic/OpenAI)
  /\bghp_/i, // GitHub classic PAT
  /\bgho_/i, // GitHub OAuth token
  /\bgithub_pat_/i, // GitHub fine-grained PAT
  /\bglpat-/i, // GitLab PAT
  /\bxox[bpas]-/i, // Slack token
  /\bbearer\b/i, // Bearer credential
  /-----BEGIN [a-z ]*PRIVATE KEY-----/i,
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bpowershell\b/i,
  /\bcmd(?:\.exe)?\b/i,
  /\bbash\s+-c\b/i,
  /\bsh\s+-c\b/i,
];

function assertWslPayloadSafe(serialized: string): void {
  for (const pattern of HOST_FORBIDDEN_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new DatabaseError("invalid-argument", "write", {
        retryable: false,
      });
    }
  }
}

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
          assertWslPayloadSafe(payload);
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
