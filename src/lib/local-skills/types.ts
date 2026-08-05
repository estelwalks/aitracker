import { SKILL_TOOL_NAMES } from "../tools/catalog.ts";

/**
 * Skill agent labels - derived from the catalog as the `nameZh` of every tool
 * that exposes a skills directory (`skillRootSuffix !== null`). Kept as a
 * `readonly` tuple so `SkillAgent` is a narrow literal union.
 */
export const SKILL_AGENTS = SKILL_TOOL_NAMES as readonly [string, ...string[]];

export type SkillAgent = (typeof SKILL_AGENTS)[number];
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
  description: string | null;
  lastUsedAt: string | null;
  installations: SkillInstallation[];
}

export interface BatchUninstallResult {
  succeeded: string[];
  failed: { path: string; error: string }[];
}

export interface SkillSyncResult {
  succeeded: { agent: string; path: string }[];
  skipped: { agent: string; reason: "conflict" }[];
  failed: { agent: string; error: string }[];
}

export interface SkillSnapshot {
  generatedAt: string;
  fingerprint: string;
  roots: Record<SkillAgent, string>;
  /** Actual Agent installation probe results, independent of Skill contents. */
  agents: Record<SkillAgent, { installed: boolean; detectedPaths: string[] }>;
  skills: LocalSkill[];
  blacklist: string[];
}
