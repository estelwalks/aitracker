export const MARKET_AGENTS = [
  "Claude Code",
  "Codex",
  "Cursor",
  "Gemini CLI",
  "Windsurf",
  "Cline",
  "Roo Code",
  "OpenCode",
] as const;

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
  version: null;
  rating: null;
}

export interface MarketPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface MarketListResult {
  skills: MarketSkill[];
  pagination: MarketPagination;
  source: "network" | "cache";
  fetchedAt: string;
  warning: string | null;
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
