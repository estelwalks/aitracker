import { SKILL_AGENTS } from "./agent-rules.ts";
import type { MessageKey } from "../i18n/messages";

export { SKILL_AGENTS };

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
  /** Total bytes of all files under the skill directory (browser-safe). */
  sizeBytes: number;
  /** Estimated context tokens from the skill's readable text (chars / 4). */
  tokenEstimate: number;
  installations: SkillInstallation[];
}

export interface BatchUninstallFailure {
  path: string;
  /** i18n message key rendered by the UI (null → generic fallback). */
  errorCode: MessageKey | null;
  errorParams?: Record<string, string | number>;
}

export interface SyncFailure {
  agent: string;
  /** i18n message key rendered by the UI (null → generic fallback). */
  errorCode: MessageKey | null;
  errorParams?: Record<string, string | number>;
}

export interface BatchUninstallResult {
  succeeded: string[];
  failed: BatchUninstallFailure[];
}

export interface SkillSyncResult {
  succeeded: { agent: string; path: string }[];
  skipped: { agent: string; reason: "conflict" }[];
  failed: SyncFailure[];
}

export interface SkillSnapshot {
  generatedAt: string;
  fingerprint: string;
  /** Resolved skill roots per agent (multiple roots allowed). */
  roots: Record<SkillAgent, string[]>;
  /** Actual Agent installation probe results, independent of Skill contents. */
  agents: Record<SkillAgent, { installed: boolean; detectedPaths: string[] }>;
  skills: LocalSkill[];
  blacklist: string[];
}
