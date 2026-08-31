import { SKILL_AGENTS } from "../local-skills/types.ts";
import type { MessageKey } from "../i18n/messages";

/**
 * Market install targets — same agent set as Skill agents (the market
 * installer forwards these to the skills scanner), so `MarketAgent` is a
 * narrow literal union that matches `SkillAgent`.
 */
export const MARKET_AGENTS = SKILL_AGENTS;

export type MarketAgent = (typeof MARKET_AGENTS)[number];

export interface MarketSkill {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  /** Short description (External API `short_description`). */
  shortDescription: string | null;
  repoOwner: string;
  repoName: string;
  repoPath: string;
  securityScore: number | null;
  securityLevel: string | null;
  stars: number | null;
  tags: string[];
  updatedAt: string | null;
  /** Compressed package size (bytes); the market interface does not return it, HEAD is prefetched on demand, and if it is missing, it is null. */
  size: number | null;
  version: null;
  rating: null;
}

export interface MarketPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export type MarketSort =
  "security_score" | "stars" | "created_at" | "name_asc" | "name_desc";

export interface MarketStats {
  totalSkills: number;
  installedCount: number;
}

export interface MarketListResult {
  skills: MarketSkill[];
  pagination: MarketPagination;
  source: "network" | "cache";
  fetchedAt: string;
  warning: string | null;
  stats?: MarketStats;
}

export type ScanSeverity = "critical" | "warning" | "info";

export interface StaticScanFinding {
  path: string;
  line: number | null;
  severity: ScanSeverity;
  rule: string;
  message: string;
}

export interface StaticScanReport {
  safe: boolean;
  filesScanned: number;
  entriesChecked: number;
  unpackedBytes: number;
  findings: StaticScanFinding[];
}

export interface SkillDownloadInspection {
  skill: Pick<
    MarketSkill,
    "name" | "repoOwner" | "repoName" | "repoPath" | "slug"
  > &
    Partial<Pick<MarketSkill, "updatedAt">> & {
      version?: string | null;
    };
  compressedBytes: number;
  contentType: string | null;
  scan: StaticScanReport;
}

export interface InstallSkillTarget {
  agent: MarketAgent;
  installed: boolean;
  /** i18n message key rendered by the UI (null → generic fallback). */
  messageCode: MessageKey | null;
  messageParams?: Record<string, string | number>;
}

export interface InstallSkillResult {
  installed: boolean;
  reason: "installed" | "partial" | "failed" | "scan-blocked";
  /** i18n message key rendered by the UI (null → generic fallback). */
  messageCode: MessageKey | null;
  messageParams?: Record<string, string | number>;
  agents: MarketAgent[];
  targets: InstallSkillTarget[];
  inspection: SkillDownloadInspection;
}
