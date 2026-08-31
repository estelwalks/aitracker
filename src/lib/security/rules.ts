/**
 * Security rule classification and user rule persistence tool.
 *
 * Security requirements: scans cover 11 dimensions and the rule pack is versioned.
 */

import { detectReDoS } from "./redos.ts";

import {
  SECURITY_RULE_KINDS,
  type SecurityRuleKind,
} from "./security-rule-kinds.ts";

export { SECURITY_RULE_KINDS } from "./security-rule-kinds.ts";
export type { SecurityRuleKind } from "./security-rule-kinds.ts";

/**
 * Rule base version number. Derived from security-rules.json content hash (scripts/
 * generate-security-rules.mjs), any rule additions, deletions/regular changes will automatically change the version number.
 * Used for reporting backtracking and version auditing.
 */
export { SECURITY_RULES_VERSION } from "./security-rules.generated.ts";

/**
 * 11 dimensional classification of built-in security rules (fixed order, corresponding to PRD §11).
 */
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
  } catch (error) {
    return {
      valid: false,
      message:
        error instanceof Error
          ? `正则无效：${error.message}`
          : "正则表达式无效",
    };
  }
  // ReDoS protection: shares the same security gate (redos.ts) with built-in rules,
  // Reject nested/overlapping quantifiers and other dangerous backtracking patterns that may cause scanning to freeze.
  const danger = detectReDoS(normalized);
  if (danger !== null) {
    return { valid: false, message: danger };
  }
  return { valid: true, message: "" };
}

export function isSecurityRuleKind(value: unknown): value is SecurityRuleKind {
  return SECURITY_RULE_KINDS.includes(value as SecurityRuleKind);
}

/**
 * Parse user rules in external persistence (such as settings files, old version data).
 *
 * Note: The 3 categories (malicious URLs/dangerous commands/sensitive information) used by older versions are no longer legal in 11 dimensions,
 * The historical behavior will be used here - silently discarding entries that do not match the classification to avoid crashes caused by old configurations.
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
