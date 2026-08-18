import type {
  SkillSnapshot as LegacySkillSnapshot,
  LocalSkill as LegacyLocalSkill,
} from "../../../lib/local-skills/types.ts";
import type { SkillSnapshotData } from "../query/contracts.ts";

/**
 * P3-T3-02: Skill snapshot conversion.
 *
 * The snapshot stores the browser-safe skill projection — list, size, agent
 * ownership and update status — with paths and detected roots removed.
 * `roots` and `agents` keep only counts/booleans, mirroring the public query
 * facade, so the persisted snapshot is safe to read by pages directly.
 *
 * The `SkillSnapshotData` contract lives in the public query contracts
 * (`query/contracts.ts`) so pages can type the snapshot without a
 * public -> server module edge; this file only adapts the legacy scanner
 * output into that shape.
 */

export type { SkillSnapshotData } from "../query/contracts.ts";

/** Strips paths/detected roots from the legacy scanner snapshot. */
export function toSkillSnapshotData(
  snapshot: LegacySkillSnapshot,
): SkillSnapshotData {
  const sanitizeInstallation = (
    installation: LegacyLocalSkill["installations"][number],
  ): SkillSnapshotData["skills"][number]["installations"][number] => ({
    agent: installation.agent,
    installedAt: installation.installedAt,
    modifiedAt: installation.modifiedAt,
    version: installation.version,
    source: installation.source
      ? {
          kind: installation.source.kind,
          label: installation.source.label,
        }
      : null,
    updateStatus: installation.updateStatus,
    updateReason: installation.updateReason,
  });
  return {
    generatedAt: snapshot.generatedAt,
    fingerprint: snapshot.fingerprint,
    roots: Object.fromEntries(
      Object.entries(snapshot.roots).map(([agent, roots]) => [
        agent,
        { count: roots.length },
      ]),
    ),
    agents: Object.fromEntries(
      Object.entries(snapshot.agents).map(([agent, probe]) => [
        agent,
        { installed: probe.installed },
      ]),
    ),
    skills: snapshot.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      lastUsedAt: skill.lastUsedAt,
      sizeBytes: skill.sizeBytes,
      tokenEstimate: skill.tokenEstimate,
      installations: skill.installations.map(sanitizeInstallation),
    })),
    blacklist: snapshot.blacklist,
  };
}
