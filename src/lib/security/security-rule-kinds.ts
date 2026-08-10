/**
 * Stable built-in/user security rule categories.
 *
 * Kept in a dependency-free contract module so the generated rule artifact and
 * the user-rule runtime helpers can share the vocabulary without importing
 * each other. This is intentionally data-only: validation and persistence
 * behavior belongs to `rules.ts`, while the JSON schema belongs to
 * `security-rules.schema.ts`.
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
