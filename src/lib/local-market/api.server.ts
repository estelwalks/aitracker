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
import type { SkillSnapshotData } from "../../modules/skill-catalog/query/contracts.ts";
import {
  countInstalledMarketSkills,
  type MarketInstalledSkillShape,
} from "./installed-count.ts";

export {
  countInstalledMarketSkills,
  type MarketInstalledSkillShape,
} from "./installed-count.ts";

/** External Skill API v1 list root path (documentation: /api/external-api/v1/skills). */
const MARKET_API = `${MARKET_API_BASE}/external-api/v1/skills`;
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

function sortSkills(skills: MarketSkill[], sort: MarketSort): MarketSkill[] {
  const sorted = [...skills];
  switch (sort) {
    case "security_score":
      sorted.sort((a, b) => (b.securityScore ?? 0) - (a.securityScore ?? 0));
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
  total: number,
  installedCount: number,
): MarketListResult["stats"] {
  return {
    totalSkills: total,
    installedCount,
  };
}

/**
 * Real local market-install count. Prefers an injected value (callers that
 * already loaded a local snapshot), then a snapshot-shaped test seam, then the
 * Skill snapshot coordinator, and finally the real on-disk scanner — the
 * single source of truth for which installed Skills carry
 * `source.kind === "market"`. The coordinator read keeps pages off the scan
 * path (P2-18); the direct scan remains the fallback when it has no data.
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
  if (options.localSnapshot != null) {
    return countInstalledMarketSkills(options.localSnapshot.skills);
  }
  const coordinated = await readCoordinatedSkillSnapshot();
  if (coordinated != null) {
    return countInstalledMarketSkills(coordinated.skills);
  }
  const snapshot = await loadLocalSkillsSnapshot();
  return countInstalledMarketSkills(snapshot.skills);
}

/**
 * P2-18: read the installed-skill projection from the Skill snapshot
 * coordinator instead of bypassing it with a full scan. Returns null when the
 * coordinator has no data yet so callers can fall back to a direct scan.
 */
async function readCoordinatedSkillSnapshot(): Promise<SkillSnapshotData | null> {
  try {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const { skillSnapshot } = await getCompositionRoot();
    await skillSnapshot.ensureHydrated();
    return skillSnapshot.readLatest().data;
  } catch {
    return null;
  }
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
    const url = new URL(`${MARKET_API}/search`);
    url.searchParams.set("lang", "zh");

    const response = await (options.fetcher ?? fetch)(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        search: query.search,
        limit: query.limit,
        page: query.page,
        tags,
        // Sort_by enum for add-in API v1: security_score/stars/created_at/name_asc/name_desc.
        // Search deduplication is controlled by the backend switch by default, and the caller does not need to pass deduplicate.
        sort_by: sort,
      }),
      signal: controller.signal,
    });
    if (!response.ok)
      throw new AppError("errors.market.api.http", { status: response.status });

    const parsed = parseMarketApiResponse(await response.json());
    const sortedSkills = sortSkills(parsed.skills, sort);
    // Market interface does not return volumes in lists; concurrency-limited HEAD prefetch Content-Length backfill size.
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
      stats: computeStats(parsed.pagination.total, installedCount),
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
  const url = new URL(`${MARKET_API}/${segments.join("/")}/download`);
  url.searchParams.set("repo_path", skill.repoPath);
  return url;
}

const SIZE_HEAD_CONCURRENCY = 4;
const SIZE_HEAD_TIMEOUT_MS = 3_000;

/**
 * Initiate HEAD to the download address of each Skill with limited concurrency, and read the Content-Length backfill size.
 * The market interface does not return volume for list items; volume is for display only and remains null on failure/missing.
 * Never throw an error - silently skip when network exception occurs, does not affect list loading.
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
