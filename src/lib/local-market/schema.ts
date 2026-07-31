import { MARKET_AGENTS } from "./types.ts";
import type {
  MarketAgent,
  MarketListResult,
  MarketPagination,
  MarketSkill,
  SkillDownloadInspection,
} from "./types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`市场接口字段 ${field} 无效`);
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
    throw new Error(`市场接口分页字段 ${field} 无效`);
  }
  return value;
}

function parseSkill(value: unknown): MarketSkill {
  if (!isRecord(value)) throw new Error("市场接口返回了无效的 Skill 数据");

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
    version: null,
    rating: null,
  };
}

function parsePagination(value: unknown): MarketPagination {
  if (!isRecord(value)) throw new Error("市场接口缺少分页信息");

  const page = nonNegativeInteger(value.page, "page");
  const limit = nonNegativeInteger(value.limit, "limit");
  const total = nonNegativeInteger(value.total, "total");
  const pages = nonNegativeInteger(value.pages, "pages");
  if (page < 1 || limit < 1) throw new Error("市场接口分页范围无效");

  return { page, limit, total, pages };
}

export function parseMarketApiResponse(
  value: unknown,
): Omit<MarketListResult, "source" | "fetchedAt" | "warning"> {
  if (!isRecord(value) || value.success !== true || !Array.isArray(value.data)) {
    throw new Error("市场接口返回格式无效");
  }

  return {
    skills: value.data.map(parseSkill),
    pagination: parsePagination(value.pagination),
  };
}

export function parseMarketQuery(value: unknown): { page: number; limit: number; search: string } {
  if (!isRecord(value)) throw new Error("市场查询参数无效");

  const page = typeof value.page === "number" ? value.page : Number(value.page);
  const limit = typeof value.limit === "number" ? value.limit : Number(value.limit);
  const search = typeof value.search === "string" ? value.search.trim() : "";

  if (!Number.isInteger(page) || page < 1) throw new Error("页码必须是正整数");
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("每页数量必须在 1 到 50 之间");
  }
  if (search.length > 100) throw new Error("搜索关键词不能超过 100 个字符");

  return { page, limit, search };
}

export function parseInstallRequest(value: unknown): {
  skill: SkillDownloadInspection["skill"];
  agents: MarketAgent[];
} {
  if (!isRecord(value)) throw new Error("安装参数无效");
  if (!isRecord(value.skill)) throw new Error("Skill 参数无效");
  const required = ["name", "repoOwner", "repoName", "repoPath", "slug"] as const;
  for (const field of required) {
    if (typeof value.skill[field] !== "string" || value.skill[field].trim() === "") {
      throw new Error(`Skill 安装字段 ${field} 无效`);
    }
  }
  if (!Array.isArray(value.agents) || value.agents.length === 0) {
    throw new Error("请至少选择一个 Agent");
  }
  const agents = [...new Set(value.agents)];
  if (
    agents.some(
      (agent) => typeof agent !== "string" || !MARKET_AGENTS.includes(agent as MarketAgent),
    )
  ) {
    throw new Error("包含不支持的 Agent");
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
