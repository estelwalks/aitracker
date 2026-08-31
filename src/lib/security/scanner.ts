import {
  parseUserSecurityRules,
  SECURITY_RULE_KINDS,
  SECURITY_RULES_VERSION,
  type SecurityRuleKind,
  type UserSecurityRule,
} from "./rules.ts";
import {
  compileBuiltinRule,
  type CompiledBuiltinRule,
} from "./security-rules.schema.ts";
import { SECURITY_RULES_DATA } from "./security-rules.generated.ts";

export type SecurityRiskKind = SecurityRuleKind;
export type SecuritySeverity = "高危" | "中危" | "低危";
export type SecurityRiskSource = "内置规则" | "用户规则";

export interface SecurityInputFile {
  name: string;
  content: string;
}

export interface SecurityRisk {
  kind: SecurityRiskKind;
  severity: SecuritySeverity;
  source: SecurityRiskSource;
  ruleName: string;
  file: string;
  line: number;
  message: string;
  excerpt: string;
}

export interface SecurityReport {
  scannedAt: string;
  /** SKILL.md selected by the user or the directory name to which it belongs; the source code is not persisted. */
  targetName: string;
  filesScanned: number;
  risks: SecurityRisk[];
  verdict: "安全" | "可疑" | "危险";
  /** Numerical risk score 0–100: High risk 25/Medium risk 8/Low risk 2 points are accumulated and capped. */
  riskScore: number;
  /** Only the time taken for local File API reading and static rule execution is included. */
  durationMs: number;
  /** Hit the version number of the rule base to facilitate auditing and backtracking */
  rulesVersion: string;
  /**
   * The scan was terminated early due to the regular execution budget being exceeded (there were incompletely scanned dimensions).
   * See the budget description of `scanDimension` for trigger conditions; old reports without persistence flag do not have this field.
   */
  truncated?: boolean;
}

/**
 * Regular execution budget (deviation list P1/F4-T3): both built-in and user rules have passed the construction period/storage period
 * ReDoS gate (redos.ts), theoretically there is no exponential backtracking; the budget is for "large files × multiple rules"
 * The scene is covered to prevent legal but very large input (single file upper limit of 100MB) from blocking the UI thread for a long time.
 *
 * Implementation: Estimate the cost of each `test()` in "character step" (no anchor point scan visits at least
 * Once per character, `line.length` is a linear lower bound). Budgets are accumulated independently by dimension:
 * - `MAX_REGEX_STEPS_PER_RULE_LINE`: a single rule for a single line - if the line exceeds the budget, it will be aborted
 *   Current dimension (when a single line is too long, you cannot use the call count to find out, and you must exit early);
 * - `MAX_REGEX_STEPS_TOTAL`: If the cumulative number of all rules × rows in the dimension exceeds the budget, the current dimension will be terminated.
 * Aborted dimensions are marked with `truncated: true` in reports, the UI/History makes no other assumptions.
 *
 * They are all pure integer counts (no timing), behave consistently in browsers and Node, and can be tested deterministically.
 */
export const MAX_REGEX_STEPS_PER_RULE_LINE = 200_000;
export const MAX_REGEX_STEPS_TOTAL = 5_000_000;

/** Compiled built-in rule (pattern string validated at build time, compiled here). */
type BuiltInRule = CompiledBuiltinRule;

/**
 * Built-in static regular rule set, covering all 11 security dimensions of PRD §11.
 * Rule data comes from security-rules.json (scripts/generate-security-rules.mjs build period verification +
 * security gate), pattern is compiled here to RegExp (`i` flag only, avoids lastIndex state).
 */
const RULES: BuiltInRule[] = SECURITY_RULES_DATA.rules.map(compileBuiltinRule);

/**
 * While retaining the hit context, desensitize suspected credentials to avoid leaking clear text in reports or logs.
 */
function maskedExcerpt(line: string): string {
  const compact = line.trim().slice(0, 180);
  return compact
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-••••••••")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA••••••••••••••••")
    .replace(/ghp_[A-Za-z0-9]{12,}/g, "ghp_••••••••")
    .replace(
      /((?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["'])[^"']+(["'])/gi,
      "$1••••••••$2",
    );
}

/**
 * The default severity level of user-defined rules in each dimension.
 * Destructive operations, key leakage, privilege escalation, remote command execution, and persistence are high-risk by default;
 * The remaining dimensions default to medium risk.
 */
const USER_RULE_SEVERITY: Record<SecurityRiskKind, SecuritySeverity> = {
  远程命令执行: "高危",
  数据泄露: "中危",
  密钥泄露: "高危",
  持久化: "高危",
  破坏性操作: "高危",
  代码混淆: "中危",
  注入攻击: "中危",
  权限提升: "高危",
  文件访问: "中危",
  网络外联: "中危",
  提示注入: "中危",
};

interface CompiledUserRule {
  id: string;
  name: string;
  kind: SecurityRiskKind;
  severity: SecuritySeverity;
  pattern: string;
  regex: RegExp;
}

function compileUserRules(rules: UserSecurityRule[]): CompiledUserRule[] {
  return parseUserSecurityRules(rules)
    .filter((rule) => rule.enabled)
    .flatMap((rule): CompiledUserRule[] => {
      try {
        return [
          {
            id: rule.id,
            name: rule.name,
            kind: rule.kind,
            severity: USER_RULE_SEVERITY[rule.kind],
            pattern: rule.pattern,
            regex: new RegExp(rule.pattern, "i"),
          },
        ];
      } catch {
        return [];
      }
    });
}

/**
 * Numerical risk score (0–100). Capped after weighted accumulation according to severity:
 * High risk 25 / medium risk 8 / low risk 2 points each. It is 0 when there is no hit.
 * Scores are independent of verdict text and used for visual risk bars in safety reports.
 */
export function computeRiskScore(risks: SecurityRisk[]): number {
  let score = 0;
  for (const risk of risks) {
    if (risk.severity === "高危") score += 25;
    else if (risk.severity === "中危") score += 8;
    else if (risk.severity === "低危") score += 2;
  }
  return Math.min(100, score);
}

interface ScanBudgetState {
  /** Whether at least one dimension was truncated due to budget overrun (written to report `truncated`). */
  truncated: boolean;
}

/**
 * Perform a rule scan on a single dimension. See `MAX_REGEX_STEPS_*` for budget description. Note:
 * Overlong single lines (> 200k characters) and cumulative step overruns (> 5M) will immediately abort the dimension.
 * `file.content.split(/\r?\n/)` itself is an O(n) linear split (V8 has no backtracking for `\r?\n`
 * Risk), the overhead under the 100MB upper limit is millisecond level; the budget constraint is the subsequent line-by-line × rule-by-rule matching work.
 */
function scanDimension(
  files: SecurityInputFile[],
  rules: BuiltInRule[],
  userRules: CompiledUserRule[],
  risks: SecurityRisk[],
  budget: ScanBudgetState,
): void {
  let steps = 0;
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      // Budget for a single rule for a single row: For an extremely long single row, the call count cannot be used to cover the problem, so the dimension will be terminated directly.
      if (line.length > MAX_REGEX_STEPS_PER_RULE_LINE) {
        budget.truncated = true;
        return;
      }
      for (const rule of rules) {
        rule.regex.lastIndex = 0;
        if (rule.regex.test(line)) {
          risks.push({
            kind: rule.kind,
            severity: rule.severity,
            source: "内置规则",
            ruleName: rule.name,
            file: file.name,
            line: index + 1,
            message: rule.message,
            excerpt: maskedExcerpt(line),
          });
        }
        steps += line.length;
        if (steps > MAX_REGEX_STEPS_TOTAL) {
          budget.truncated = true;
          return;
        }
      }
      for (const rule of userRules) {
        rule.regex.lastIndex = 0;
        if (rule.regex.test(line)) {
          risks.push({
            kind: rule.kind,
            severity: rule.severity,
            source: "用户规则",
            ruleName: rule.name,
            file: file.name,
            line: index + 1,
            message: `命中用户配置规则“${rule.name}”`,
            excerpt: maskedExcerpt(line),
          });
        }
        steps += line.length;
        if (steps > MAX_REGEX_STEPS_TOTAL) {
          budget.truncated = true;
          return;
        }
      }
    }
  }
}

function buildReport(
  files: SecurityInputFile[],
  risks: SecurityRisk[],
  startedAt: number,
  truncated: boolean,
): SecurityReport {
  return {
    scannedAt: new Date().toISOString(),
    targetName: files[0]?.name ?? "SKILL.md",
    filesScanned: files.length,
    risks,
    verdict: risks.some((risk) => risk.severity === "高危")
      ? "危险"
      : risks.length > 0
        ? "可疑"
        : "安全",
    riskScore: computeRiskScore(risks),
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    rulesVersion: SECURITY_RULES_VERSION,
    ...(truncated ? { truncated: true } : {}),
  };
}

/**
 * Synchronous local scanning interface, suitable for testing and callers that do not need to display the process.
 * Does not read the network, does not send files, and only runs built-in/local user rules.
 */
export function scanSecurityFiles(
  files: SecurityInputFile[],
  userRules: UserSecurityRule[] = [],
): SecurityReport {
  const startedAt = performance.now();
  const risks: SecurityRisk[] = [];
  const compiledUserRules = compileUserRules(userRules);
  const budget: ScanBudgetState = { truncated: false };
  for (const kind of SECURITY_RULE_KINDS) {
    scanDimension(
      files,
      RULES.filter((rule) => rule.kind === kind),
      compiledUserRules.filter((rule) => rule.kind === kind),
      risks,
      budget,
    );
  }
  return buildReport(files, risks, startedAt, budget.truncated);
}

export interface LocalScanProgress {
  completedDimensions: number;
  totalDimensions: number;
  kind: SecurityRiskKind;
}

/**
 * Uses the exact same static rules as synchronous scanning, but gives way to the UI after each truly completed detection dimension.
 * In this way, the page progress only reflects the rules that have been executed on the local machine, and no timer is used to fake the scanning process.
 */
export async function scanSecurityFilesWithProgress(
  files: SecurityInputFile[],
  userRules: UserSecurityRule[] = [],
  onProgress?: (progress: LocalScanProgress) => void,
): Promise<SecurityReport> {
  const startedAt = performance.now();
  const risks: SecurityRisk[] = [];
  const compiledUserRules = compileUserRules(userRules);
  const totalDimensions = SECURITY_RULE_KINDS.length;
  const budget: ScanBudgetState = { truncated: false };

  for (const [index, kind] of SECURITY_RULE_KINDS.entries()) {
    scanDimension(
      files,
      RULES.filter((rule) => rule.kind === kind),
      compiledUserRules.filter((rule) => rule.kind === kind),
      risks,
      budget,
    );
    onProgress?.({
      completedDimensions: index + 1,
      totalDimensions,
      kind,
    });
    // Give React a chance to draw the real rule dimensions you just finished.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return buildReport(files, risks, startedAt, budget.truncated);
}
