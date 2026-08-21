import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  clearGenerations,
  commitGeneration,
  hashSensitiveRef,
  isoToMs,
  loadGeneration,
  msToIso,
} from "../../../platform/database/snapshot-generation.server.ts";
import type { SnapshotRepository } from "../../../platform/snapshot-runtime/contracts.ts";
import type { SkillForm } from "../../../lib/local-skills/types.ts";
import type { SkillSnapshotData } from "./skill-snapshot.contracts.ts";

export interface SqliteSkillSnapshotRepositoryOptions {
  readonly database: SqliteDatabasePort;
  readonly hmacKey: string | Uint8Array;
  readonly now?: () => number;
  readonly createId?: () => string;
}

const n = (value: unknown): number => Number(value ?? 0);
const b = (value: unknown): boolean => Number(value) === 1;

export function createSqliteSkillSnapshotRepository(
  options: SqliteSkillSnapshotRepositoryOptions,
): SnapshotRepository<SkillSnapshotData> {
  const { database } = options;
  return {
    async load() {
      return loadGeneration({
        database,
        domain: "skills",
        readData(snapshotId, generation) {
          const agentRows = database
            .prepare(
              "SELECT * FROM agent_installations WHERE snapshot_id=? ORDER BY agent_id",
            )
            .all(snapshotId);
          const roots: Record<string, { count: number }> = {};
          const agents: Record<string, { installed: boolean }> = {};
          for (const row of agentRows) {
            const id = String(row.agent_id);
            roots[id] = { count: n(row.root_count) };
            agents[id] = { installed: b(row.installed) };
          }
          const skills = database
            .prepare(
              "SELECT * FROM skills WHERE snapshot_id=? ORDER BY name, skill_id",
            )
            .all(snapshotId)
            .map((row) => ({
              id: String(row.skill_id),
              name: String(row.name),
              description:
                row.description == null ? null : String(row.description),
              form: row.form == null ? null : (String(row.form) as SkillForm),
              lastUsedAt: msToIso(row.last_used_at_ms),
              sizeBytes: n(row.size_bytes),
              tokenEstimate: n(row.token_estimate),
              installations: database
                .prepare(
                  "SELECT * FROM skill_installations WHERE snapshot_id=? AND skill_id=? ORDER BY agent_id, installation_ref",
                )
                .all(snapshotId, String(row.skill_id))
                .map((installation) => ({
                  agent: String(installation.agent_id),
                  installedAt: msToIso(installation.installed_at_ms)!,
                  modifiedAt: msToIso(installation.modified_at_ms)!,
                  version:
                    installation.version == null
                      ? null
                      : String(installation.version),
                  source:
                    installation.source_kind == null
                      ? null
                      : {
                          kind: String(installation.source_kind) as
                            "frontmatter" | "market",
                          label: String(installation.source_label ?? ""),
                        },
                  updateStatus: String(installation.update_status) as
                    "current" | "available" | "unknown",
                  updateReason: String(installation.update_reason_code),
                })),
            }));
          const blacklist = database
            .prepare(
              "SELECT skill_name FROM skill_blacklist WHERE snapshot_id=? ORDER BY skill_name",
            )
            .all(snapshotId)
            .map((row) => String(row.skill_name));
          return {
            generatedAt:
              msToIso(generation.generated_at_ms) ?? new Date(0).toISOString(),
            fingerprint:
              typeof generation.source_fingerprint === "string"
                ? generation.source_fingerprint
                : "",
            roots,
            agents,
            skills,
            blacklist,
          };
        },
      });
    },
    async save(envelope) {
      commitGeneration({
        database,
        domain: "skills",
        envelope,
        now: options.now,
        createId: options.createId,
        writeData(snapshotId, data) {
          const agentIds = new Set([
            ...Object.keys(data.roots),
            ...Object.keys(data.agents),
          ]);
          for (const agentId of agentIds) {
            database
              .prepare("INSERT INTO agent_installations VALUES (?, ?, ?, ?, ?)")
              .run(
                snapshotId,
                agentId,
                data.agents[agentId]?.installed ? 1 : 0,
                data.agents[agentId]?.installed ? 1 : 0,
                data.roots[agentId]?.count ?? 0,
              );
          }
          for (const skill of data.skills) {
            database
              .prepare("INSERT INTO skills VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
              .run(
                snapshotId,
                skill.id,
                skill.name,
                skill.description,
                isoToMs(skill.lastUsedAt),
                skill.sizeBytes,
                skill.tokenEstimate,
                skill.form ?? null,
              );
            skill.installations.forEach((installation, sequence) => {
              const installationRef = hashSensitiveRef(
                options.hmacKey,
                "skill-installation",
                [
                  skill.id,
                  installation.agent,
                  installation.installedAt,
                  installation.modifiedAt,
                  sequence,
                ].join("\0"),
              );
              database
                .prepare(
                  "INSERT INTO skill_installations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .run(
                  snapshotId,
                  skill.id,
                  installationRef,
                  installation.agent,
                  isoToMs(installation.installedAt) ?? 0,
                  isoToMs(installation.modifiedAt) ?? 0,
                  installation.version,
                  installation.source?.kind ?? null,
                  installation.source?.label ?? null,
                  installation.updateStatus,
                  installation.updateReason,
                );
            });
          }
          for (const name of data.blacklist) {
            database
              .prepare("INSERT INTO skill_blacklist VALUES (?, ?)")
              .run(snapshotId, name);
          }
        },
      });
    },
    async clear() {
      clearGenerations(database, "skills");
    },
  };
}
