import { parseUserSecurityRules, type SecurityRuleKind, type UserSecurityRule } from "./rules.ts";

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

export type AiReviewStatus = "未请求" | "未配置" | "已完成" | "失败" | "限流";

export interface AiReviewResult {
  status: AiReviewStatus;
  summary: string;
}

export interface SecurityReport {
  scannedAt: string;
  filesScanned: number;
  risks: SecurityRisk[];
  verdict: "安全" | "可疑" | "危险";
  aiReview: AiReviewResult;
}

const RULES: Array<{
  name: string;
  kind: SecurityRiskKind;
  severity: SecuritySeverity;
  pattern: RegExp;
  message: string;
}> = [
  {
    name: "短链接",
    kind: "恶意 URL",
    severity: "中危",
    pattern: /\b(?:https?:\/\/)?(?:bit\.ly|tinyurl\.com|t\.co|is\.gd|cutt\.ly)\/[\w/?=&.-]+/i,
    message: "发现短链接，无法直接确认最终目标",
  },
  {
    name: "直接 IP 地址",
    kind: "恶意 URL",
    severity: "高危",
    pattern: /\b(?:https?:\/\/)?(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\/[\w/?=&.-]*/i,
    message: "发现直接访问 IP 的 URL",
  },
  {
    name: "递归删除系统目录",
    kind: "危险命令",
    severity: "高危",
    pattern: /\brm\s+-rf\s+(?:\/|~|\$HOME)\b/i,
    message: "发现可能破坏系统或用户目录的递归删除命令",
  },
  {
    name: "下载后执行脚本",
    kind: "危险命令",
    severity: "高危",
    pattern: /\b(?:curl|wget)\b[^\n|;&]*(?:\||&&|;)\s*(?:sudo\s+)?(?:bash|sh|zsh)\b/i,
    message: "发现下载后直接执行脚本的命令",
  },
  {
    name: "动态代码执行",
    kind: "危险命令",
    severity: "中危",
    pattern: /\b(?:eval|exec)\s*\(/i,
    message: "发现动态代码执行调用",
  },
  {
    name: "访问密钥特征",
    kind: "敏感信息",
    severity: "高危",
    pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b/,
    message: "发现疑似真实访问密钥",
  },
  {
    name: "硬编码凭据",
    kind: "敏感信息",
    severity: "中危",
    pattern: /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][^"'\n]{8,}["']/i,
    message: "发现疑似硬编码凭据",
  },
];

function maskedExcerpt(line: string): string {
  const compact = line.trim().slice(0, 180);
  return compact
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-••••••••")
    .replace(/AKIA[0-9A-Z]{16}/g, "AKIA••••••••••••••••")
    .replace(/ghp_[A-Za-z0-9]{12,}/g, "ghp_••••••••")
    .replace(
      /((?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'])[^"']+(["'])/gi,
      "$1••••••••$2",
    );
}

const USER_RULE_SEVERITY: Record<SecurityRiskKind, SecuritySeverity> = {
  "恶意 URL": "中危",
  危险命令: "高危",
  敏感信息: "高危",
};

function compileUserRules(rules: UserSecurityRule[]) {
  return parseUserSecurityRules(rules)
    .filter((rule) => rule.enabled)
    .flatMap((rule) => {
      try {
        return [
          {
            ...rule,
            severity: USER_RULE_SEVERITY[rule.kind],
            regex: new RegExp(rule.pattern, "i"),
          },
        ];
      } catch {
        return [];
      }
    });
}

export function scanSecurityFiles(
  files: SecurityInputFile[],
  userRules: UserSecurityRule[] = [],
): SecurityReport {
  const risks: SecurityRisk[] = [];
  const compiledUserRules = compileUserRules(userRules);
  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        if (!rule.pattern.test(line)) continue;
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
      for (const rule of compiledUserRules) {
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

  return {
    scannedAt: new Date().toISOString(),
    filesScanned: files.length,
    risks,
    verdict: risks.some((risk) => risk.severity === "高危")
      ? "危险"
      : risks.length > 0
        ? "可疑"
        : "安全",
    aiReview: {
      status: "未请求",
      summary: "未启用 AI 二次审查，结论仅来自本地静态规则。",
    },
  };
}
