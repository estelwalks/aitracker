import { parseMarketApiResponse } from "./schema.ts";
import {
  marketCacheKey,
  readMarketCache,
  writeMarketCache,
} from "./cache.server.ts";
import type { MarketListResult, MarketSkill, MarketSort } from "./types.ts";

const MARKET_API = "https://ai.trusttools.cn/api";
const REQUEST_TIMEOUT_MS = 8_000;

export interface MarketApiOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

function sortSkills(skills: MarketSkill[], sort: MarketSort): MarketSkill[] {
  const sorted = [...skills];
  switch (sort) {
    case "downloads":
      sorted.sort(
        (a, b) => (b.installCount ?? 0) - (a.installCount ?? 0),
      );
      break;
    case "latest":
      sorted.sort((a, b) => {
        const timeA = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const timeB = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return timeB - timeA;
      });
      break;
    case "stars":
      sorted.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
      break;
    case "tokens":
      // MarketSkill has no token field; fall back to installCount as proxy
      sorted.sort(
        (a, b) => (b.installCount ?? 0) - (a.installCount ?? 0),
      );
      break;
  }
  return sorted;
}

function computeStats(
  skills: MarketSkill[],
  total: number,
): MarketListResult["stats"] {
  return {
    totalSkills: total,
    officialCount: skills.filter((s) => s.isOfficial === true).length,
    totalDownloads: skills.reduce(
      (sum, s) => sum + (s.installCount ?? 0),
      0,
    ),
    installedCount: 0,
  };
}

export async function fetchMarketSkills(
  query: {
    page: number;
    limit: number;
    search: string;
    sort?: MarketSort;
  },
  options: MarketApiOptions = {},
): Promise<MarketListResult> {
  const sort = query.sort ?? "downloads";
  const key = marketCacheKey(query.page, query.limit, query.search, sort);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );

  try {
    const url = new URL(`${MARKET_API}/skills`);
    url.searchParams.set("page", String(query.page));
    url.searchParams.set("limit", String(query.limit));
    if (query.search) url.searchParams.set("search", query.search);
    url.searchParams.set("sort", sort);

    const response = await (options.fetcher ?? fetch)(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(`市场接口请求失败（HTTP ${response.status}）`);

    const parsed = parseMarketApiResponse(await response.json());
    const sortedSkills = sortSkills(parsed.skills, sort);
    const result: MarketListResult = {
      skills: sortedSkills,
      pagination: parsed.pagination,
      source: "network",
      fetchedAt: new Date().toISOString(),
      warning: null,
      stats: computeStats(sortedSkills, parsed.pagination.total),
    };
    await writeMarketCache(key, result).catch(() => undefined);
    return result;
  } catch (error) {
    const cached = await readMarketCache(key);
    if (cached) {
      return {
        ...cached,
        source: "cache",
        warning: "网络不可用，正在显示本地缓存结果",
      };
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("网络不可用：Skill 市场请求超时，本地也没有可用缓存");
    }
    throw new Error(
      `网络不可用：${error instanceof Error ? error.message : "Skill 市场请求失败"}，本地也没有可用缓存`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function buildDownloadUrl(skill: {
  repoOwner: string;
  repoName: string;
  slug: string;
  repoPath: string;
}): URL {
  const segments = [skill.repoOwner, skill.repoName, skill.slug].map(
    encodeURIComponent,
  );
  const url = new URL(`${MARKET_API}/skills/${segments.join("/")}/download`);
  url.searchParams.set("repo_path", skill.repoPath);
  return url;
}
