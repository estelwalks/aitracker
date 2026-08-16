import type { MessageKey } from "../../lib/i18n/messages";
import { AppError } from "../../lib/errors";
import { AI_TOOLS } from "../../lib/tools/catalog.ts";
import { SKILL_AGENTS } from "../../lib/local-skills/types.ts";
import {
  scanLocalSkills,
  syncLocalSkill,
} from "../../lib/local-skills/scanner.server.ts";

/**
 * Sources 一键迁移（Story B-300）——服务端核心。
 *
 * 迁移的「路径不出服务端」：renderer 只提交 `sourceId`（工具 id）+ 目标
 * agents + 冲突策略；本模块在服务端用 `scanLocalSkills` 枚举该工具 skill
 * 根下的 Skill 目录，再逐个复用既有 `syncLocalSkill`（含 origins 追踪与
 * 冲突处理），文件路径从不跨过 RPC 边界。
 */

export interface SourceMigrationInput {
  /** 已知工具 id（`AI_TOOLS[].id`），如 `claude-code`。 */
  sourceId: string;
  /** 目标 agent 标签（`SKILL_AGENTS` 子集）；源工具自身会被自动排除。 */
  targetAgents: string[];
  onConflict: "overwrite" | "skip";
}

export interface SourceMigrationFailure {
  agent: string;
  skillName: string;
  /** i18n message key rendered by the UI (null → generic fallback). */
  errorCode: MessageKey | null;
  errorParams?: Record<string, string | number>;
}

export interface SourceMigrationResult {
  ok: true;
  /** 成功复制条目，一条对应一个 (skill, agent)。 */
  migrated: { agent: string; skillName: string }[];
  /** onConflict=skip 时因目标已存在同名 Skill 而跳过的条目。 */
  skipped: { agent: string; skillName: string; reason: "conflict" }[];
  failed: SourceMigrationFailure[];
  /** 发现的源 Skill 数量（前端据此判断「无可迁移」）。 */
  total: number;
}

/** 可注入的 home/data 目录（与 scanner 的 SkillOpOptions 同构），供测试隔离。 */
export interface MigrationOptions {
  homeDirectory?: string;
  dataDirectory?: string;
}

/**
 * 输入校验：sourceId 必须是已知工具 id；targetAgents 非空、不超过
 * SKILL_AGENTS 总数、且每个都是受支持的 Skill agent；onConflict 只能是
 * overwrite/skip。非法输入抛出 AppError（`errors.sources.migrateInvalid`），
 * 与既有 `syncLocalSkill` 的校验风格一致。
 */
export function validateMigrationInput(
  input: SourceMigrationInput,
): SourceMigrationInput {
  if (
    typeof input?.sourceId !== "string" ||
    !AI_TOOLS.some((tool) => tool.id === input.sourceId) ||
    !Array.isArray(input?.targetAgents) ||
    input.targetAgents.length === 0 ||
    input.targetAgents.length > SKILL_AGENTS.length ||
    input.targetAgents.some(
      (agent) => typeof agent !== "string" || !SKILL_AGENTS.includes(agent),
    ) ||
    (input.onConflict !== "overwrite" && input.onConflict !== "skip")
  ) {
    throw new AppError("errors.sources.migrateInvalid");
  }
  return input;
}

/**
 * 把某个工具的 Skill 迁移到其他 agent 的 skill 根目录。服务端枚举：
 * 1. `sourceId` → 该工具的 agent 标签（无 Skill 根 → 空结果，不报错）；
 * 2. `scanLocalSkills` 找出所有安装在源 agent 下的 Skill 目录（真实路径只
 *    在服务端）；
 * 3. 逐目录调 `syncLocalSkill`（targetAgents 已剔除源 agent 自身），汇总
 *    成功/跳过/失败。
 */
export async function migrateSourceSkills(
  input: SourceMigrationInput,
  options: MigrationOptions = {},
): Promise<SourceMigrationResult> {
  validateMigrationInput(input);
  const { sourceId, onConflict } = input;
  const tool = AI_TOOLS.find((candidate) => candidate.id === sourceId);
  const sourceAgent = tool?.nameZh;

  // 工具没有受管 Skill 根（或不存在该映射）→ 无可迁移候选。
  if (sourceAgent == null || !SKILL_AGENTS.includes(sourceAgent)) {
    return { ok: true, migrated: [], skipped: [], failed: [], total: 0 };
  }
  // 防御性剔除源 agent 自身（UI 已排除，此处双保险避免自复制）。
  const targetAgents = input.targetAgents.filter(
    (agent) => agent !== sourceAgent,
  );
  if (targetAgents.length === 0) {
    return { ok: true, migrated: [], skipped: [], failed: [], total: 0 };
  }

  const snapshot = await scanLocalSkills(options);
  const candidates = snapshot.skills.flatMap((skill) => {
    const sourcePath = skill.installations.find(
      (installation) => installation.agent === sourceAgent,
    )?.path;
    return sourcePath == null ? [] : [{ skill, sourcePath }];
  });

  const migrated: SourceMigrationResult["migrated"] = [];
  const skipped: SourceMigrationResult["skipped"] = [];
  const failed: SourceMigrationFailure[] = [];

  for (const { skill, sourcePath } of candidates) {
    const result = await syncLocalSkill(
      { sourcePath, targetAgents, onConflict },
      options,
    );
    for (const item of result.succeeded) {
      migrated.push({ agent: item.agent, skillName: skill.name });
    }
    for (const item of result.skipped) {
      skipped.push({
        agent: item.agent,
        skillName: skill.name,
        reason: item.reason,
      });
    }
    for (const item of result.failed) {
      failed.push({
        agent: item.agent,
        skillName: skill.name,
        errorCode: item.errorCode,
        ...(item.errorParams ? { errorParams: item.errorParams } : {}),
      });
    }
  }

  return { ok: true, migrated, skipped, failed, total: candidates.length };
}
