/**
 * Built-in security-rules contract (v1.5 M6-T3).
 *
 * The built-in static scan rules live in `security-rules.json` (auditable,
 * versioned) instead of TypeScript. The JSON is Zod-validated and every pattern
 * passes a build-time safety check (scripts/generate-security-rules.mjs); the
 * runtime compiler trusts the already-validated generated data. The match
 * interpreter, length limits and ReDoS guards stay in TypeScript (docs §6.2).
 */
import { z } from "zod";

import { detectReDoS } from "./redos.ts";
import { SECURITY_RULE_KINDS } from "./security-rule-kinds.ts";

export { detectReDoS } from "./redos.ts";

export const SecuritySeveritySchema = z.enum(["高危", "中危", "低危"]);
export type SecuritySeverity = z.infer<typeof SecuritySeveritySchema>;

export const BuiltinSecurityRuleSchema = z.object({
  /** Stable lowercase-kebab id; never reused (docs: unique rule ID). */
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/u),
  name: z.string().min(1).max(64),
  kind: z.enum(SECURITY_RULE_KINDS),
  severity: SecuritySeveritySchema,
  /** Regex source. No `g` flag is ever applied (avoids lastIndex state). */
  pattern: z.string().min(1).max(500),
  message: z.string().min(1).max(200),
});
export type BuiltinSecurityRule = z.infer<typeof BuiltinSecurityRuleSchema>;

export const SecurityRulesFileSchema = z.object({
  schemaVersion: z.literal(1),
  rules: z.array(BuiltinSecurityRuleSchema),
});
export type SecurityRulesFile = z.infer<typeof SecurityRulesFileSchema>;

/**
 * Build-time pattern safety gate (docs: Build-time pattern safety gate). Hard checks:
 * non-empty, ≤500 chars, compiles with the `i` flag (the runtime compiler never
 * applies `g`, avoiding lastIndex state), and no dangerous catastrophic-
 * backtracking shapes (nested/overlapping quantifiers, ambiguous multi-branch
 * alternation under a quantifier, backreferences, adjacent quantifiers).
 *
 * The ReDoS detection itself lives in `redos.ts` (zero-dependency module shared
 * with user-rule validation in `rules.ts`; see its header for the detector
 * model). `detectReDoS(pattern)` returns a human-readable danger description
 * for callers that need to surface the reason (e.g. user-rule save errors).
 */
export function isSafeSecurityPattern(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > 500) return false;
  try {
    new RegExp(pattern, "i");
  } catch {
    return false;
  }
  return detectReDoS(pattern) === null;
}

export interface CompiledBuiltinRule extends BuiltinSecurityRule {
  regex: RegExp;
}

/** Compile a validated pattern to a `RegExp` (`i` only, never `g`). */
export function compileBuiltinRule(
  rule: BuiltinSecurityRule,
): CompiledBuiltinRule {
  return { ...rule, regex: new RegExp(rule.pattern, "i") };
}
