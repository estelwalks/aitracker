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
  /** 用户选择的 SKILL.md 或其所属目录名；不持久化源码。 */
  targetName: string;
  filesScanned: number;
  risks: SecurityRisk[];
  verdict: "安全" | "可疑" | "危险";
  /** 0–100 数值风险评分：高危 25/中危 8/低危 2 分累加后封顶。 */
  riskScore: number;
  /** 仅包含本地 File API 读取和静态规则执行的耗时。 */
  durationMs: number;
  /** 命中规则库的版本号，便于审计与回溯 */
  rulesVersion: string;
  /**
   * 扫描因正则执行预算超限而提前中止（存在未完整扫描的维度）。
   * 触发条件见 `scanDimension` 的预算说明；不持久化标志的旧报告无此字段。
   */
  truncated?: boolean;
}

/**
 * 正则执行预算（偏差清单 P1 / F4-T3）：内建与用户规则均已通过构建期/保存期
 * ReDoS gate（redos.ts），理论上不存在指数级回溯；预算是对「大文件 × 多规则」
 * 场景的兜底，防止合法但超大的输入（单文件上限 100MB）长时间阻塞 UI 线程。
 *
 * 实现：以「字符步进」估算每次 `test()` 的成本（无锚点扫描对每行至少访问
 * 每个字符一次，`line.length` 是线性下界）。预算按维度独立累计：
 * - `MAX_REGEX_STEPS_PER_RULE_LINE`：单条规则对单行——行超过该预算即中止
 *   当前维度（单行超长时无法用调用计数兜底，必须提前退出）；
 * - `MAX_REGEX_STEPS_TOTAL`：维度内所有规则×行累计超过该预算即中止当前维度。
 * 中止的维度在报告中以 `truncated: true` 标记，UI/历史不做其他假设。
 *
 * 均为纯整数计数（无计时），在浏览器与 Node 下行为一致且可确定性测试。
 */
export const MAX_REGEX_STEPS_PER_RULE_LINE = 200_000;
export const MAX_REGEX_STEPS_TOTAL = 5_000_000;

/** Compiled built-in rule (pattern string validated at build time, compiled here). */
type BuiltInRule = CompiledBuiltinRule;

/**
 * 内置静态正则规则集合，覆盖 PRD §11 全部 11 个安全维度。
 * 规则数据来自 security-rules.json（scripts/generate-security-rules.mjs 构建期校验 +
 * 安全 gate），pattern 在此处编译为 RegExp（仅 `i` 标志，避免 lastIndex 状态）。
 */
const RULES: BuiltInRule[] = SECURITY_RULES_DATA.rules.map(compileBuiltinRule);

/**
 * 在保留命中上下文的同时，对疑似凭据做脱敏，避免在报告或日志中泄露明文。
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
 * 用户自定义规则在各维度上的默认严重等级。
 * 破坏性操作、密钥泄露、权限提升、远程命令执行、持久化默认高危；
 * 其余维度默认中危。
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
 * 数值风险评分（0–100）。按严重度加权累加后封顶：
 * 高危 25 / 中危 8 / 低危 2 分每条。无命中时为 0。
 * 评分独立于 verdict 文本判定，用于安全报告的可视化风险条。
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
  /** 是否至少有一个维度因预算超限被中止（写入报告 `truncated`）。 */
  truncated: boolean;
}

/**
 * 对单个维度执行一次规则扫描。预算说明见 `MAX_REGEX_STEPS_*` 注释：
 * 超长单行（> 200k 字符）与累计步进超限（> 5M）都会立即中止该维度。
 * `file.content.split(/\r?\n/)` 本身是 O(n) 线性切分（V8 对 `\r?\n` 无回溯
 * 风险），100MB 上限下的开销为毫秒级；预算约束的是其后逐行×逐规则的匹配工作。
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
      // 单条规则对单行预算：超长单行无法用调用计数兜底，直接中止该维度
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
 * 同步本地扫描接口，适合测试和不需要展示过程的调用方。
 * 不读取网络、不发送文件，且只运行内置/本地用户规则。
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
 * 与同步扫描使用完全相同的静态规则，但在每个真实完成的检测维度后让出 UI。
 * 这样页面进度只反映已在本机执行的规则，不使用定时器伪造扫描过程。
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
    // 让 React 有机会绘制刚刚完成的真实规则维度。
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return buildReport(files, risks, startedAt, budget.truncated);
}
