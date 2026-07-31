import {
  activities,
  agentList,
  byModel,
  byProject,
  byProvider,
  healthMeta,
  heatmap,
  kpis,
  marketCats,
  marketSkills,
  memories,
  memorySources,
  providerShare,
  recentModels,
  rowDetail,
  scanHistory,
  scanSteps,
  sessions,
  skills,
  sourceTree,
  tokenBreakdown,
  tokenSummary,
  trendDaily,
  trendMonthly,
  trendWeekly,
  weekdayLabels,
} from "../mock-data";
import type {
  ClientDataRequestOptions,
  ClientDataSource,
  DashboardData,
  MarketData,
  MemoryData,
  SecurityData,
  SkillData,
  TokenData,
  TokenDetailRequest,
} from "./types";

export type BrowserMockClientDataSourceOptions = {
  latencyMs?: number;
};

const dashboardData: DashboardData = {
  kpis,
  trends: {
    daily: trendDaily,
    weekly: trendWeekly,
    monthly: trendMonthly,
  },
  providerShare,
  recentModels,
  activities,
  heatmap,
  weekdayLabels,
};

const tokenData: TokenData = {
  summary: tokenSummary,
  dimensions: {
    provider: byProvider,
    project: byProject,
    model: byModel,
  },
  breakdown: tokenBreakdown,
  sessions,
};

const skillData: SkillData = {
  items: skills,
  agents: agentList,
  healthMeta,
};

const securityData: SecurityData = {
  history: scanHistory,
  steps: scanSteps,
};

const marketData: MarketData = {
  items: marketSkills,
  categories: marketCats,
  agents: agentList,
};

const memoryData: MemoryData = {
  items: memories,
  sources: memorySources,
};

function abortError() {
  const error = new Error("Client data request was aborted");
  error.name = "AbortError";
  return error;
}

async function delay(latencyMs: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    throw abortError();
  }

  if (latencyMs <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, latencyMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

export class BrowserMockClientDataSource implements ClientDataSource {
  readonly runtime = "browser" as const;
  readonly name = "browser-mock";
  private readonly latencyMs: number;

  constructor(options: BrowserMockClientDataSourceOptions = {}) {
    this.latencyMs = Math.max(0, options.latencyMs ?? 0);
  }

  private async respond<T>(value: T, options?: ClientDataRequestOptions): Promise<T> {
    await delay(this.latencyMs, options?.signal);
    return value;
  }

  getDashboard(options?: ClientDataRequestOptions) {
    return this.respond(dashboardData, options);
  }

  getTokens(options?: ClientDataRequestOptions) {
    return this.respond(tokenData, options);
  }

  getTokenDetail(request: TokenDetailRequest, options?: ClientDataRequestOptions) {
    return this.respond(rowDetail(request.row, request.dimension), options);
  }

  getTokenSourceTree(row: TokenDetailRequest["row"], options?: ClientDataRequestOptions) {
    return this.respond(sourceTree(row), options);
  }

  getSkills(options?: ClientDataRequestOptions) {
    return this.respond(skillData, options);
  }

  getSecurity(options?: ClientDataRequestOptions) {
    return this.respond(securityData, options);
  }

  getMarket(options?: ClientDataRequestOptions) {
    return this.respond(marketData, options);
  }

  getMemory(options?: ClientDataRequestOptions) {
    return this.respond(memoryData, options);
  }
}

export function createBrowserMockClientDataSource(options?: BrowserMockClientDataSourceOptions) {
  return new BrowserMockClientDataSource(options);
}
