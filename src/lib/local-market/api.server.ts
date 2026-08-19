import { parseMarketApiResponse } from "./schema.ts";
import { MARKET_API_BASE } from "../app-config";
import { AppError } from "../errors";
import {
  marketCacheKey,
  readMarketCache,
  writeMarketCache,
} from "./cache.server.ts";
import type { MarketListResult, MarketSkill, MarketSort } from "./types.ts";
import type { SkillSnapshot } from "../local-skills/types.ts";

const MARKET_API = MARKET_API_BASE;
const REQUEST_TIMEOUT_MS = 8_000;
export const MARKET_QUERY_CACHE_TTL_MS = 30 * 60 * 1_000;

export interface MarketApiOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  /**
   * Fast path: the number of market skills already installed on this machine,
   * supplied by a caller that already holds a local snapshot. When provided it
   * skips the (server-only) local scan that would otherwise back `installedCount`.
   */
  installedCount?: number;
  /** Test seam / fast path: a real local skills snapshot to count from. */
  localSnapshot?: { skills: readonly MarketInstalledSkillShape[] };
  /** Clock and cache-bypass seams for deterministic unit tests. */
  now?: () => Date;
  skipFreshCache?: boolean;
}

/** Structural slice of a local skill used to detect market-managed installs. */
export interface MarketInstalledSkillShape {
  readonly id: string;
  readonly installations: readonly {
    readonly source: { readonly kind: string } | null;
  }[];
}

/**
 * Number of distinct local Skills that carry at least one market-managed
 * installation (`installation.source.kind === "market"`). A Skill installed
 * into several Agents is counted once — it is one market Skill, not N copies.
 * Both the full scanner snapshot and the renderer-safe projection satisfy the
 * structural shape, so callers can reuse the same helper.
 */
export function countInstalledMarketSkills(
  skills: readonly MarketInstalledSkillShape[],
): number {
  const names = new Set<string>();
  for (const skill of skills) {
    if (
      skill.installations.some(
        (installation) => installation.source?.kind === "market",
      )
    ) {
      names.add(skill.id);
    }
  }
  return names.size;
}

function sortSkills(skills: MarketSkill[], sort: MarketSort): MarketSkill[] {
  const sorted = [...skills];
  switch (sort) {
    case "downloads":
      sorted.sort((a, b) => (b.installCount ?? 0) - (a.installCount ?? 0));
      break;
    case "created_at":
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
    case "name_asc":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "name_desc":
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
  }
  return sorted;
}

function computeStats(
  skills: MarketSkill[],
  total: number,
  installedCount: number,
): MarketListResult["stats"] {
  return {
    totalSkills: total,
    officialCount: skills.filter((s) => s.isOfficial === true).length,
    totalDownloads: skills.reduce((sum, s) => sum + (s.installCount ?? 0), 0),
    installedCount,
  };
}

/**
 * Real local market-install count. Prefers an injected value (callers that
 * already loaded a local snapshot), then a snapshot-shaped test seam, and
 * finally the real on-disk scanner — the single source of truth for which
 * installed Skills carry `source.kind === "market"`.
 */
async function resolveInstalledCount(
  options: MarketApiOptions,
): Promise<number> {
  if (
    options.installedCount != null &&
    Number.isInteger(options.installedCount) &&
    options.installedCount >= 0
  ) {
    return options.installedCount;
  }
  const snapshot = options.localSnapshot ?? (await loadLocalSkillsSnapshot());
  return countInstalledMarketSkills(snapshot.skills);
}

async function loadLocalSkillsSnapshot(): Promise<SkillSnapshot> {
  const { scanLocalSkills } = await import("../local-skills/scanner.server.ts");
  return scanLocalSkills();
}

export async function fetchMarketSkills(
  query: {
    page: number;
    limit: number;
    search: string;
    sort?: MarketSort;
    tags?: string[];
    forceRefresh?: boolean;
  },
  options: MarketApiOptions = {},
): Promise<MarketListResult> {
  const sort = query.sort ?? "stars";
  const tags = query.tags ?? [];
  const key = marketCacheKey(
    query.page,
    query.limit,
    query.search,
    sort,
    tags.join(","),
  );
  const cached = await readMarketCache(key);
  const fetchedAt = cached == null ? Number.NaN : Date.parse(cached.fetchedAt);
  const ageMs = (options.now?.() ?? new Date()).getTime() - fetchedAt;
  if (
    !query.forceRefresh &&
    !options.skipFreshCache &&
    cached != null &&
    Number.isFinite(fetchedAt) &&
    ageMs >= 0 &&
    ageMs <= MARKET_QUERY_CACHE_TTL_MS
  ) {
    return { ...cached, source: "cache", warning: null };
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );

  try {
    const url = new URL(`${MARKET_API}/skills/search`);
    url.searchParams.set("lang", "zh");

    const response = await (options.fetcher ?? fetch)(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        search: query.search,
        mode: "fast",
        limit: query.limit,
        page: query.page,
        tags,
        safety_level: null,
        status: null,
        language: null,
        // 上游接口不识别 tokens 排序；交由本地 sortSkills 重排（downloads 亦走
        // 上游专用字段，其余排序按 sort_by 透传）。
        ...(sort === "downloads"
          ? { sort }
          : sort === "tokens"
            ? {}
            : { sort_by: sort }),
      }),
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
    const installedCount = await resolveInstalledCount(options);
    const result: MarketListResult = {
      skills: sortedSkills,
      pagination: parsed.pagination,
      source: "network",
      fetchedAt: (options.now?.() ?? new Date()).toISOString(),
      warning: null,
      stats: computeStats(
        sortedSkills,
        parsed.pagination.total,
        installedCount,
      ),
    };
    await writeMarketCache(key, result).catch(() => undefined);
    return result;
  } catch (error) {
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
