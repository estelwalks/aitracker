import type { SqliteDatabasePort } from "../database/contracts.ts";
import {
  clearGenerations,
  commitGeneration,
  loadGeneration,
  msToIso,
} from "../database/snapshot-generation.server.ts";
import type { SnapshotRepository } from "../snapshot-runtime/contracts.ts";
import type { InstallationSnapshotData } from "./installation-snapshot.contracts.ts";

export interface SqliteInstallationSnapshotRepositoryOptions {
  readonly database: SqliteDatabasePort;
  readonly now?: () => number;
  readonly createId?: () => string;
}

function safeRelativePath(value: string): string | null {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized.startsWith("~/")) return null;
  if (/^[A-Za-z]:/u.test(normalized) || normalized.startsWith("//"))
    return null;
  return normalized.slice(0, 512);
}

export function createSqliteInstallationSnapshotRepository(
  options: SqliteInstallationSnapshotRepositoryOptions,
): SnapshotRepository<InstallationSnapshotData> {
  const { database } = options;
  return {
    async load() {
      return loadGeneration({
        database,
        domain: "installations",
        readData(snapshotId, generation) {
          const facts = database
            .prepare(
              "SELECT * FROM agent_installations WHERE snapshot_id=? ORDER BY agent_id",
            )
            .all(snapshotId)
            .map((row) => ({
              id: String(row.agent_id),
              installed: Number(row.installed) === 1,
              executableFound: Number(row.executable_found) === 1,
              paths: database
                .prepare(
                  "SELECT relative_path FROM agent_installation_paths WHERE snapshot_id=? AND agent_id=? ORDER BY relative_path",
                )
                .all(snapshotId, String(row.agent_id))
                .map((path) => String(path.relative_path)),
            }));
          return {
            generatedAt:
              msToIso(generation.generated_at_ms) ?? new Date(0).toISOString(),
            facts,
          };
        },
      });
    },
    async save(envelope) {
      commitGeneration({
        database,
        domain: "installations",
        envelope,
        now: options.now,
        createId: options.createId,
        writeData(snapshotId, data) {
          for (const fact of data.facts) {
            const paths = [
              ...new Set(
                fact.paths
                  .map(safeRelativePath)
                  .filter((path): path is string => path != null),
              ),
            ];
            database
              .prepare("INSERT INTO agent_installations VALUES (?, ?, ?, ?, ?)")
              .run(
                snapshotId,
                fact.id,
                fact.installed ? 1 : 0,
                fact.executableFound ? 1 : 0,
                paths.length,
              );
            for (const path of paths) {
              database
                .prepare(
                  "INSERT INTO agent_installation_paths VALUES (?, ?, ?)",
                )
                .run(snapshotId, fact.id, path);
            }
          }
        },
      });
    },
    async clear() {
      clearGenerations(database, "installations");
    },
  };
}
