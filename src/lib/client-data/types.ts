export type ClientDataRuntime = "browser" | "electron" | "node" | "unknown";
export type TrendDirection = "up" | "flat" | "down";
export type Health = "active" | "low" | "doze" | "dead";

export type ClientDataRequestOptions = {
  signal?: AbortSignal;
};

export type DashboardKpis = {
  todayTokens: number;
  todayDelta: number;
  monthCost: number;
  monthBudget: number;
  cacheSaved: number;
  cacheHitRate: number;
  skillsActive: number;
  skillsTotal: number;
  skillDist: Record<Health, number>;
};

export type DashboardTrendPoint = {
  label: string;
  claude: number;
  codex: number;
  cursor: number;
  gemini: number;
};

export type ProviderShare = {
  name: string;
  value: number;
  color: string;
};

export type RecentModel = {
  name: string;
  tokens: string;
  pct: number;
};

export type RecentActivity = {
  time: string;
  tool: string;
  model: string;
  tokens: string;
  cost: string;
};

export type DashboardData = {
  kpis: DashboardKpis;
  trends: {
    daily: DashboardTrendPoint[];
    weekly: DashboardTrendPoint[];
    monthly: DashboardTrendPoint[];
  };
  providerShare: ProviderShare[];
  recentModels: RecentModel[];
  activities: RecentActivity[];
  heatmap: number[][];
  weekdayLabels: string[];
};

export type TokenDimension = "provider" | "project" | "model";

export type TokenSummaryItem = {
  label: string;
  value: string;
};

export type Row = {
  name: string;
  tokens: string;
  cost: string;
  share: number;
  cache: number;
  trend: TrendDirection;
  children: {
    name: string;
    tokens: string;
    cost: string;
  }[];
};

export type TokenBreakdownPoint = {
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type TokenSession = {
  time: string;
  model: string;
  tokens: string;
  cost: string;
};

export type TokenData = {
  summary: TokenSummaryItem[];
  dimensions: {
    provider: Row[];
    project: Row[];
    model: Row[];
  };
  breakdown: TokenBreakdownPoint[];
  sessions: TokenSession[];
};

export type TokenDetailRequest = {
  row: Row;
  dimension: TokenDimension;
};

export type ModelDetail = {
  composition: {
    label: string;
    value: number;
    cost: string;
    color: string;
  }[];
  behaviors: {
    label: string;
    tokens: string;
    cost: string;
    share: number;
  }[];
  pricing: {
    input: string;
    output: string;
    cacheRead: string;
    cacheWrite: string;
  };
  avgLatency: string;
  calls: string;
  avgPerCall: string;
};

export type SourceNode = {
  label: string;
  tokens: number;
  color: string;
  children?: {
    label: string;
    tokens: number;
  }[];
};

export type SourceTree = {
  nodes: SourceNode[];
  total: number;
  cacheHit: number;
  cacheReuse: number;
  cacheInput: number;
};

export type Skill = {
  id: string;
  name: string;
  health: Health;
  agents: string[];
  calls: number;
  daily: number;
  lastActive: string;
  trend: TrendDirection;
  version: string;
  source: string;
  installedAt: string;
  installed: Record<string, boolean>;
  note?: string;
};

export type HealthPresentation = {
  label: string;
  color: string;
  dot: string;
};

export type SkillData = {
  items: Skill[];
  agents: string[];
  healthMeta: Record<Health, HealthPresentation>;
};

export type SecurityVerdict = "safe" | "warn" | "danger";

export type SecurityScanHistoryItem = {
  date: string;
  file: string;
  verdict: SecurityVerdict;
  note: string;
};

export type SecurityData = {
  history: SecurityScanHistoryItem[];
  steps: string[];
};

export type MarketSkill = {
  name: string;
  desc: string;
  downloads: string;
  rating: number;
  updated: string;
  safe: boolean;
  cat: string;
};

export type MarketData = {
  items: MarketSkill[];
  categories: string[];
  agents: string[];
};

export type MemorySource = {
  name: string;
  count: number;
  children: {
    name: string;
    count: number;
  }[];
};

export type MemoryItem = {
  title: string;
  body: string;
  date: string;
  ago: string;
  source: string;
  project: string;
};

export type MemoryData = {
  items: MemoryItem[];
  sources: MemorySource[];
};

export interface ClientDataSource {
  readonly runtime: ClientDataRuntime;
  readonly name: string;
  getDashboard(options?: ClientDataRequestOptions): Promise<DashboardData>;
  getTokens(options?: ClientDataRequestOptions): Promise<TokenData>;
  getTokenDetail(
    request: TokenDetailRequest,
    options?: ClientDataRequestOptions,
  ): Promise<ModelDetail>;
  getTokenSourceTree(
    row: Row,
    options?: ClientDataRequestOptions,
  ): Promise<SourceTree>;
  getSkills(options?: ClientDataRequestOptions): Promise<SkillData>;
  getSecurity(options?: ClientDataRequestOptions): Promise<SecurityData>;
  getMarket(options?: ClientDataRequestOptions): Promise<MarketData>;
  getMemory(options?: ClientDataRequestOptions): Promise<MemoryData>;
}
