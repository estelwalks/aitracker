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
}

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

function scanDimension(
  files: SecurityInputFile[],
  rules: BuiltInRule[],
  userRules: CompiledUserRule[],
  risks: SecurityRisk[],
): void {
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of rules) {
        rule.regex.lastIndex = 0;
        if (!rule.regex.test(line)) continue;
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
      for (const rule of userRules) {
        rule.regex.lastIndex = 0;
        if (!rule.regex.test(line)) continue;
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
    });
  }
}

function buildReport(
  files: SecurityInputFile[],
  risks: SecurityRisk[],
  startedAt: number,
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
  for (const kind of SECURITY_RULE_KINDS) {
    scanDimension(
      files,
      RULES.filter((rule) => rule.kind === kind),
      compiledUserRules.filter((rule) => rule.kind === kind),
      risks,
    );
  }
  return buildReport(files, risks, startedAt);
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

  for (const [index, kind] of SECURITY_RULE_KINDS.entries()) {
    scanDimension(
      files,
      RULES.filter((rule) => rule.kind === kind),
      compiledUserRules.filter((rule) => rule.kind === kind),
      risks,
    );
    onProgress?.({
      completedDimensions: index + 1,
      totalDimensions,
      kind,
    });
    // 让 React 有机会绘制刚刚完成的真实规则维度。
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return buildReport(files, risks, startedAt);
}
