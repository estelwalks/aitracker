import type { MessageKey } from "../../lib/i18n/messages";
import { AppError } from "../../lib/errors";
import { AI_TOOLS } from "../../lib/tools/catalog.ts";
import { SKILL_AGENTS } from "../../lib/local-skills/types.ts";
import {
  scanLocalSkills,
  syncLocalSkill,
} from "../../lib/local-skills/scanner.server.ts";

/**
 * Sources one-click migration (Story B-300) - server core.
 *
 * The "path of migration does not exit the server": renderer only submits `sourceId` (tool id) + target
 * agents + conflict strategy; this module uses `scanLocalSkills` to enumerate the tool skill on the server side
 * Skill directory under the root, and then reuse the existing `syncLocalSkill` (including origins tracking and
 * Conflict handling), file paths never cross RPC boundaries.
 */

export interface SourceMigrationInput {
  /** Known tool id (`AI_TOOLS[].id`), such as `claude-code`. */
  sourceId: string;
  /** Target agent tag (`SKILL_AGENTS` subset); the source tool itself is automatically excluded. */
  targetAgents: string[];
  onConflict: "overwrite" | "skip";
}

export interface SourceMigrationFailure {
  agent: string;
  skillName: string;
  /** i18n message key rendered by the UI (null → generic fallback). */
  errorCode: MessageKey | null;
  errorParams?: Record<string, string | number>;
}

export interface SourceMigrationResult {
  ok: true;
  /** Entries were successfully copied, one for each (skill, agent). */
  migrated: { agent: string; skillName: string }[];
  /** When onConflict=skip, the entry will be skipped because the target Skill with the same name already exists. */
  skipped: { agent: string; skillName: string; reason: "conflict" }[];
  failed: SourceMigrationFailure[];
  /** The number of discovered source skills (based on which the front end determines "no migration"). */
  total: number;
}

/** Injectable home/data directory (isomorphic to scanner's SkillOpOptions) for testing isolation. */
export interface MigrationOptions {
  homeDirectory?: string;
  dataDirectory?: string;
}

/**
 * Input verification: sourceId must be a known tool id; targetAgents is not empty and does not exceed
 * SKILL_AGENTS total number, each of which is a supported Skill agent; onConflict can only be
 * overwrite/skip. Illegal input throws AppError(`errors.sources.migrateInvalid`),
 * Consistent with the existing `syncLocalSkill` validation style.
 */
export function validateMigrationInput(
  input: SourceMigrationInput,
): SourceMigrationInput {
  if (
    typeof input?.sourceId !== "string" ||
    !AI_TOOLS.some((tool) => tool.id === input.sourceId) ||
    !Array.isArray(input?.targetAgents) ||
    input.targetAgents.length === 0 ||
    input.targetAgents.length > SKILL_AGENTS.length ||
    input.targetAgents.some(
      (agent) => typeof agent !== "string" || !SKILL_AGENTS.includes(agent),
    ) ||
    (input.onConflict !== "overwrite" && input.onConflict !== "skip")
  ) {
    throw new AppError("errors.sources.migrateInvalid");
  }
  return input;
}

/**
 * Migrate the skill of a certain tool to the skill root directory of another agent. Server-side enumeration:
 * 1. `sourceId` → agent label of the tool (no Skill root → empty result, no error);
 * 2. `scanLocalSkills` finds all Skill directories installed under the source agent (the real path is only
 *    on the server side);
 * 3. Adjust `syncLocalSkill` directory by directory (targetAgents has eliminated the source agent itself), and summarize
 *    Success/Skip/Fail.
 */
export async function migrateSourceSkills(
  input: SourceMigrationInput,
  options: MigrationOptions = {},
): Promise<SourceMigrationResult> {
  validateMigrationInput(input);
  const { sourceId, onConflict } = input;
  const tool = AI_TOOLS.find((candidate) => candidate.id === sourceId);
  const sourceAgent = tool?.nameZh;

  // The tool has no managed skill root (or the mapping does not exist) → No migration candidates.
  if (sourceAgent == null || !SKILL_AGENTS.includes(sourceAgent)) {
    return { ok: true, migrated: [], skipped: [], failed: [], total: 0 };
  }
  // Defensively eliminate the source agent itself (the UI has been excluded, and double insurance is provided here to avoid self-replication).
  const targetAgents = input.targetAgents.filter(
    (agent) => agent !== sourceAgent,
  );
  if (targetAgents.length === 0) {
    return { ok: true, migrated: [], skipped: [], failed: [], total: 0 };
  }

  const snapshot = await scanLocalSkills(options);
  const candidates = snapshot.skills.flatMap((skill) => {
    const sourcePath = skill.installations.find(
      (installation) => installation.agent === sourceAgent,
    )?.path;
    return sourcePath == null ? [] : [{ skill, sourcePath }];
  });

  const migrated: SourceMigrationResult["migrated"] = [];
  const skipped: SourceMigrationResult["skipped"] = [];
  const failed: SourceMigrationFailure[] = [];

  for (const { skill, sourcePath } of candidates) {
    const result = await syncLocalSkill(
      { sourcePath, targetAgents, onConflict },
      options,
    );
    for (const item of result.succeeded) {
      migrated.push({ agent: item.agent, skillName: skill.name });
    }
    for (const item of result.skipped) {
      skipped.push({
        agent: item.agent,
        skillName: skill.name,
        reason: item.reason,
      });
    }
    for (const item of result.failed) {
      failed.push({
        agent: item.agent,
        skillName: skill.name,
        errorCode: item.errorCode,
        ...(item.errorParams ? { errorParams: item.errorParams } : {}),
      });
    }
  }

  return { ok: true, migrated, skipped, failed, total: candidates.length };
}
