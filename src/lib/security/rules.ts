export const SECURITY_RULE_KINDS = [
  "恶意 URL",
  "危险命令",
  "敏感信息",
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
