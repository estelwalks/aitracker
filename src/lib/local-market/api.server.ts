import { parseMarketApiResponse } from "./schema.ts";
import { MARKET_API_BASE } from "../app-config";
import { AppError } from "../errors";
import {
  marketCacheKey,
  readMarketCache,
  writeMarketCache,
} from "./cache.server.ts";
import type { MarketListResult, MarketSkill, MarketSort } from "./types.ts";

const MARKET_API = MARKET_API_BASE;
const REQUEST_TIMEOUT_MS = 8_000;

export interface MarketApiOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

function sortSkills(skills: MarketSkill[], sort: MarketSort): MarketSkill[] {
  const sorted = [...skills];
  switch (sort) {
    case "downloads":
      sorted.sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0));
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
      sorted.sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));
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
    totalDownloads: skills.reduce((sum, s) => sum + (s.installCount ?? 0), 0),
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
      throw new AppError("errors.market.api.http", { status: response.status });

    const parsed = parseMarketApiResponse(await response.json());
    const sortedSkills = sortSkills(parsed.skills, sort);
    // 市场接口不在列表返回体积；并发受限地 HEAD 预取 Content-Length 回填 size。
    await prefetchSkillSizes(sortedSkills, options.fetcher).catch(
      () => undefined,
    );
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

    throw new AppError("errors.market.api.networkTimeout");
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

const SIZE_HEAD_CONCURRENCY = 4;
const SIZE_HEAD_TIMEOUT_MS = 3_000;

/**
 * 并发受限地对每个 Skill 的下载地址发起 HEAD，读取 Content-Length 回填 size。
 * 市场接口不在列表项返回体积；体积仅用于展示，失败/缺失保持 null。
 * 永不抛错——网络异常时静默跳过，不影响列表加载。
 */
export async function prefetchSkillSizes(
  skills: MarketSkill[],
  fetcher?: typeof fetch,
): Promise<void> {
  const targets = skills.filter((skill) => skill.size == null);
  if (targets.length === 0) return;
  const fetchFn = fetcher ?? fetch;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const skill = targets[cursor++];
      if (skill == null) continue;
      try {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          SIZE_HEAD_TIMEOUT_MS,
        );
        const response = await fetchFn(buildDownloadUrl(skill), {
          method: "HEAD",
          signal: controller.signal,
        });
        clearTimeout(timer);
        const length = Number.parseInt(
          response.headers.get("content-length") ?? "",
          10,
        );
        if (Number.isFinite(length) && length > 0) skill.size = length;
      } catch {
        // 单个体积探测失败不影响整体列表。
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(SIZE_HEAD_CONCURRENCY, targets.length) },
      worker,
    ),
  );
}
