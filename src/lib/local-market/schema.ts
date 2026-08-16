import { AppError } from "../errors";
import { MARKET_AGENTS } from "./types.ts";
import type {
  MarketAgent,
  MarketListResult,
  MarketPagination,
  MarketSkill,
  MarketSort,
  SkillDownloadInspection,
} from "./types.ts";

const VALID_SORTS: readonly MarketSort[] = [
  "stars",
  "created_at",
  "name_asc",
  "name_desc",
  "downloads",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AppError("errors.market.fieldInvalid", { field });
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError("errors.market.pagingFieldInvalid", { field });
  }
  return value;
}

function parseSkill(value: unknown): MarketSkill {
  if (!isRecord(value)) throw new AppError("errors.market.invalidSkill");

  return {
    id: nonNegativeInteger(value.id, "skill.id"),
    name: requiredString(value.name, "name"),
    slug: requiredString(value.slug, "slug"),
    description: optionalString(value.description),
    descriptionZh: optionalString(value.description_zh),
    repoOwner: requiredString(value.repo_owner, "repo_owner"),
    repoName: requiredString(value.repo_name, "repo_name"),
    repoPath: requiredString(value.repo_path, "repo_path"),
    repoUrl: optionalString(value.repo_url),
    branch: optionalString(value.branch),
    installCount: optionalNumber(value.install_count),
    securityScore: optionalNumber(value.security_score),
    securityLevel: optionalString(value.security_level),
    verdict: optionalString(value.verdict),
    status: optionalString(value.status),
    stars: optionalNumber(value.stars),
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    isOfficial: optionalBoolean(value.is_official),
    isFeatured: optionalBoolean(value.is_featured),
    updatedAt: optionalString(value.updated_at),
    lastScannedAt: optionalString(value.last_scanned_at),
    tokens: tokenEstimate(value.token_estimate),
    // 市场接口不在列表项返回体积字段；体积由调用方按需 HEAD 预取后回填。
    size: optionalNumber(value.size ?? value.compressed_bytes),
    version: null,
    rating: null,
  };
}

/**
 * 从市场接口的 token_estimate 对象中提取总 Token 数。
 * 接口返回 {total_tokens, ...}；缺失或形态不符时为 null。
 */
function tokenEstimate(value: unknown): number | null {
  if (!isRecord(value)) return null;
  return optionalNumber(value.total_tokens);
}

function parsePagination(value: unknown): MarketPagination {
  if (!isRecord(value)) throw new AppError("errors.market.missingPaging");

  const page = nonNegativeInteger(value.page, "page");
  const limit = nonNegativeInteger(value.limit, "limit");
  const total = nonNegativeInteger(value.total, "total");
  const pages = nonNegativeInteger(value.pages, "pages");
  if (page < 1 || limit < 1)
    throw new AppError("errors.market.pagingRangeInvalid");

  return { page, limit, total, pages };
}

export function parseMarketApiResponse(
  value: unknown,
): Omit<MarketListResult, "source" | "fetchedAt" | "warning"> {
  if (
    !isRecord(value) ||
    value.success !== true ||
    !Array.isArray(value.data)
  ) {
    throw new AppError("errors.market.invalidFormat");
  }

  return {
    skills: value.data.map(parseSkill),
    pagination: parsePagination(value.pagination),
  };
}

export function parseMarketQuery(value: unknown): {
  page: number;
  limit: number;
  search: string;
  sort: MarketSort;
  tags: string[];
} {
  if (!isRecord(value)) throw new AppError("errors.market.queryInvalid");

  const page = typeof value.page === "number" ? value.page : Number(value.page);
  const limit =
    typeof value.limit === "number" ? value.limit : Number(value.limit);
  const search = typeof value.search === "string" ? value.search.trim() : "";
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === "string")
    : [];

  if (!Number.isInteger(page) || page < 1)
    throw new AppError("errors.market.pageNotPositive");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new AppError("errors.market.limitRange");
  }
  if (search.length > 100) throw new AppError("errors.market.searchTooLong");

  const sortRaw = typeof value.sort === "string" ? value.sort : "stars";
  if (!VALID_SORTS.includes(sortRaw as MarketSort)) {
    throw new AppError("errors.market.sortInvalid");
  }

  return { page, limit, search, sort: sortRaw as MarketSort, tags };
}

export function parseInstallRequest(value: unknown): {
  skill: SkillDownloadInspection["skill"];
  agents: MarketAgent[];
} {
  if (!isRecord(value)) throw new AppError("errors.market.installInvalid");
  if (!isRecord(value.skill))
    throw new AppError("errors.market.schema.invalidSkillParam");
  const required = [
    "name",
    "repoOwner",
    "repoName",
    "repoPath",
    "slug",
  ] as const;
  for (const field of required) {
    if (
      typeof value.skill[field] !== "string" ||
      value.skill[field].trim() === ""
    ) {
      throw new AppError("errors.market.schema.invalidInstallField", { field });
    }
  }
  if (!Array.isArray(value.agents) || value.agents.length === 0) {
    throw new AppError("errors.market.schema.agentRequired");
  }
  const agents = [...new Set(value.agents)];
  if (
    agents.some(
      (agent) =>
        typeof agent !== "string" ||
        !MARKET_AGENTS.includes(agent as MarketAgent),
    )
  ) {
    throw new AppError("errors.market.schema.unsupportedAgent");
  }

  return {
    skill: {
      name: value.skill.name as string,
      repoOwner: value.skill.repoOwner as string,
      repoName: value.skill.repoName as string,
      repoPath: value.skill.repoPath as string,
      slug: value.skill.slug as string,
    },
    agents: agents as MarketAgent[],
  };
}
