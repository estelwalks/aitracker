import { SKILL_AGENTS } from "../local-skills/types.ts";

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
  descriptionZh: string | null;
  repoOwner: string;
  repoName: string;
  repoPath: string;
  repoUrl: string | null;
  branch: string | null;
  installCount: number | null;
  securityScore: number | null;
  securityLevel: string | null;
  verdict: string | null;
  status: string | null;
  stars: number | null;
  tags: string[];
  isOfficial: boolean | null;
  isFeatured: boolean | null;
  updatedAt: string | null;
  lastScannedAt: string | null;
  /** Skill 上下文 Token 估算（来自市场接口 token_estimate.total_tokens）。 */
  tokens: number | null;
  /** 压缩包体积（字节）；市场接口不返回，按需 HEAD 预取，缺失为 null。 */
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

export type MarketSort = "downloads" | "latest" | "stars" | "tokens";

export interface MarketStats {
  totalSkills: number;
  officialCount: number;
  totalDownloads: number;
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

export interface InstallSkillResult {
  installed: boolean;
  reason: "installed" | "partial" | "failed" | "scan-blocked";
  message: string;
  agents: MarketAgent[];
  targets: Array<{
    agent: MarketAgent;
    installed: boolean;
    message: string;
  }>;
  inspection: SkillDownloadInspection;
}
