import { SKILL_TOOL_NAMES } from "../tools/catalog.ts";

/**
 * Skill agent labels — derived from the catalog as the `nameZh` of every tool
 * that exposes a skills directory (`skillRootSuffix !== null`). Kept as a
 * `readonly` tuple so `SkillAgent` is a narrow literal union.
 */
export const SKILL_AGENTS = SKILL_TOOL_NAMES as readonly [string, ...string[]];

export type SkillAgent = (typeof SKILL_AGENTS)[number];
export type SkillHealth = "active" | "low" | "doze" | "dead" | "unknown";
export type SkillUpdateStatus = "current" | "available" | "unknown";

export interface SkillSource {
  kind: "frontmatter" | "market";
  label: string;
  url: string | null;
  repoOwner: string | null;
  repoName: string | null;
  repoPath: string | null;
  slug: string | null;
}

export interface SkillInstallation {
  agent: SkillAgent;
  path: string;
  installedAt: string;
  modifiedAt: string;
  version: string | null;
  source: SkillSource | null;
  updateStatus: SkillUpdateStatus;
  updateReason: string;
}

export interface LocalSkill {
  id: string;
  name: string;
  health: SkillHealth;
  healthReason: string;
  lastUsedAt: string | null;
  usageCount: number;
  installations: SkillInstallation[];
}

export interface TrashEntry {
  id: string;
  skillName: string;
  agent: SkillAgent;
  originalPath: string;
  trashedAt: string;
  expiresAt: string;
}

export interface BatchTrashFailure {
  path: string;
  error: string;
}

export interface BatchTrashResult {
  succeeded: TrashEntry[];
  failed: BatchTrashFailure[];
}

export interface SkillSnapshot {
  generatedAt: string;
  fingerprint: string;
  healthBasis: string;
  roots: Record<SkillAgent, string>;
  skills: LocalSkill[];
  trash: TrashEntry[];
  blacklist: string[];
}
