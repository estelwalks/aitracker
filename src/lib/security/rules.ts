/**
 * 安全规则分类与用户规则持久化工具。
 *
 * PRD v3.0 v1.2 §11 FR-019：安全扫描覆盖 11 个维度，规则库带版本号。
 */

/**
 * 规则库版本号。由 security-rules.json 内容哈希派生（scripts/
 * generate-security-rules.mjs），任何规则增删/正则变更都会自动改变版本号，
 * 用于报告回溯与版本审计。
 */
export { SECURITY_RULES_VERSION } from "./security-rules.generated.ts";

/**
 * 内置安全规则的 11 个维度分类（顺序固定，对应 PRD §11）。
 */
export const SECURITY_RULE_KINDS = [
  "远程命令执行",
  "数据泄露",
  "密钥泄露",
  "持久化",
  "破坏性操作",
  "代码混淆",
  "注入攻击",
  "权限提升",
  "文件访问",
  "网络外联",
  "提示注入",
] as const;

export type SecurityRuleKind = (typeof SECURITY_RULE_KINDS)[number];

export interface UserSecurityRule {
  id: string;
  name: string;
  kind: SecurityRuleKind;
  pattern: string;
  enabled: boolean;
}

export interface SecurityRuleValidation {
  valid: boolean;
  message: string;
}

export function validateSecurityRulePattern(
  pattern: string,
): SecurityRuleValidation {
  const normalized = pattern.trim();
  if (!normalized) {
    return { valid: false, message: "请输入正则表达式" };
  }
  if (normalized.length > 500) {
    return { valid: false, message: "正则表达式不能超过 500 个字符" };
  }
  try {
    new RegExp(normalized, "i");
    return { valid: true, message: "" };
  } catch (error) {
    return {
      valid: false,
      message:
        error instanceof Error
          ? `正则无效：${error.message}`
          : "正则表达式无效",
    };
  }
}

export function isSecurityRuleKind(value: unknown): value is SecurityRuleKind {
  return SECURITY_RULE_KINDS.includes(value as SecurityRuleKind);
}

/**
 * 解析外部持久化（如设置文件、旧版本数据）中的用户规则。
 *
 * 注意：旧版本使用的 3 类（恶意 URL / 危险命令 / 敏感信息）在 11 维度下不再合法，
 * 这里会沿用历史行为——静默丢弃分类不匹配的条目，避免老配置导致崩溃。
 */
export function parseUserSecurityRules(value: unknown): UserSecurityRule[] {
  if (!Array.isArray(value)) return [];

  const ids = new Set<string>();
  return value.filter((item): item is UserSecurityRule => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<UserSecurityRule>;
    if (
      typeof candidate.id !== "string" ||
      !candidate.id ||
      ids.has(candidate.id) ||
      typeof candidate.name !== "string" ||
      !candidate.name.trim() ||
      candidate.name.length > 80 ||
      !isSecurityRuleKind(candidate.kind) ||
      typeof candidate.pattern !== "string" ||
      typeof candidate.enabled !== "boolean" ||
      !validateSecurityRulePattern(candidate.pattern).valid
    ) {
      return false;
    }
    ids.add(candidate.id);
    return true;
  });
}
