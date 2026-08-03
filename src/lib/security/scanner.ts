import {
  parseUserSecurityRules,
  SECURITY_RULES_VERSION,
  type SecurityRuleKind,
  type UserSecurityRule,
} from "./rules.ts";

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
  /** 命中规则库的版本号，便于审计与回溯 */
  rulesVersion: string;
}

interface BuiltInRule {
  name: string;
  kind: SecurityRiskKind;
  severity: SecuritySeverity;
  pattern: RegExp;
  message: string;
}

/**
 * 内置静态正则规则集合，覆盖 PRD §11 全部 11 个安全维度。
 *
 * 约束：
 * - 全部使用 `i` 标志、不使用 `g` 标志，避免 lastIndex 状态导致漏检；
 * - 避免嵌套量词，杜绝灾难性回溯；
 * - 单行匹配，仅做形态学检测，不解析语义。
 */
const RULES: BuiltInRule[] = [
  // 1. 远程命令执行
  {
    name: "下载脚本管道执行",
    kind: "远程命令执行",
    severity: "高危",
    pattern:
      /\b(?:curl|wget)\b[^\n|;&]*(?:\||&&|;)\s*(?:sudo\s+)?(?:bash|sh|zsh|dash|ksh)\b/i,
    message: "发现从网络下载并直接执行 shell 脚本的命令链",
  },
  {
    name: "Base64 解码执行",
    kind: "远程命令执行",
    severity: "高危",
    pattern:
      /\bbase64\b[^\n|;&]*(?:-d|--decode)[^\n|;&]*(?:\||&&|;)\s*(?:sudo\s+)?(?:bash|sh|zsh|eval)\b/i,
    message: "发现 Base64 解码后直接执行的命令链",
  },
  {
    name: "反向 Shell",
    kind: "远程命令执行",
    severity: "高危",
    pattern:
      /(?:bash|sh|zsh)\s+-[il]\b[^\n]*?>\s*&\s*\/dev\/tcp\/|\bnc\b[^\n]*?\s-[elk]\b|\bmkfifo\b|\bsh\s+-i\b/i,
    message: "发现疑似反向 Shell 命令",
  },

  // 2. 数据泄露
  {
    name: "外发敏感数据",
    kind: "数据泄露",
    severity: "高危",
    pattern:
      /\b(?:curl|wget)\b[^\n]*?-X\s*POST\b[^\n]*?(?:\/upload\b|\/log\b|exfil)|\brequests\.post\b|\bfetch\s*\([^)]*?(?:upload|exfil|\/log)/i,
    message: "发现向外部接口 POST 数据的疑似外发行为",
  },
  {
    name: "环境变量或密钥外传",
    kind: "数据泄露",
    severity: "高危",
    pattern:
      /(?:os\.environ|~\/\.ssh|~\/\.aws\/credentials|id_rsa)[^\n]{0,80}?\b(?:curl|wget|requests\.|socket|fetch)\b/i,
    message: "发现疑似将环境变量、SSH 或云凭据发送到外网的行为",
  },
  {
    name: "原始套接字外联上传",
    kind: "数据泄露",
    severity: "中危",
    pattern:
      /\b(?:socket|net\.connect)\b[^\n]{0,120}?\b(?:send|write|connect)\b[^\n]{0,80}?(?:read_file|open\(|readfile)/i,
    message: "发现通过原始套接字外发文件内容的可疑调用",
  },

  // 3. 密钥泄露
  {
    name: "访问密钥特征",
    kind: "密钥泄露",
    severity: "高危",
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b/,
    message: "发现疑似真实访问密钥（OpenAI / AWS / GitHub）",
  },
  {
    name: "硬编码凭据",
    kind: "密钥泄露",
    severity: "中危",
    pattern:
      /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["'][^"'\n]{8,}["']/i,
    message: "发现疑似硬编码凭据",
  },

  // 4. 持久化
  {
    name: "计划任务写入",
    kind: "持久化",
    severity: "高危",
    pattern:
      /\bcrontab\s+(?:-e\b|-l\b[^\n]*?\|)|(?:echo|cat)\b[^\n]*?>>\s*(?:\/var\/spool\/cron|\/etc\/cron\w*)/i,
    message: "发现修改 cron 计划任务的可疑操作",
  },
  {
    name: "SSH authorized_keys 写入",
    kind: "持久化",
    severity: "高危",
    pattern:
      /authorized_keys\b[^\n]{0,60}?>>|>>\s*~?\/?\.ssh\/authorized_keys/i,
    message: "发现向 SSH authorized_keys 追加公钥的持久化操作",
  },
  {
    name: "系统计划任务注册",
    kind: "持久化",
    severity: "中危",
    pattern:
      /\b(?:launchctl|schtasks|at)\b[^\n]{0,60}?(?:create|register|load|add)\b/i,
    message: "发现注册系统计划任务（launchctl/schtasks/at）的行为",
  },

  // 5. 破坏性操作
  {
    name: "递归删除系统目录",
    kind: "破坏性操作",
    severity: "高危",
    pattern: /\brm\s+-rf\s+(?:\/(?:\s|$)|~|\$HOME\b)/i,
    message: "发现可能破坏系统或用户目录的递归删除命令",
  },
  {
    name: "磁盘擦除",
    kind: "破坏性操作",
    severity: "高危",
    pattern:
      /\bdd\b[^\n]*?\bof=\/dev\/(?:disk|sd|nvme|hd)|\bmkfs(?:\.\w+)?\b[^\n]*?\/dev\//i,
    message: "发现 dd / mkfs 形式的磁盘擦除或格式化命令",
  },
  {
    name: "Fork 炸弹",
    kind: "破坏性操作",
    severity: "高危",
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
    message: "发现 Fork 炸弹模式",
  },

  // 6. 代码混淆
  {
    name: "十六进制执行链",
    kind: "代码混淆",
    severity: "中危",
    pattern:
      /(?:\\x[0-9a-f]{2}\s*){4,}[^\n]{0,60}?(?:eval|exec|Function\s*\()/i,
    message: "发现十六进制字符串解码后立即执行的可疑代码",
  },
  {
    name: "Base64/Hex 缓冲解码执行",
    kind: "代码混淆",
    severity: "中危",
    pattern:
      /Buffer\.from\s*\([^)]*?["'](?:hex|base64)["']\s*\)[^\n]{0,120}?(?:eval|exec|Function\s*\()/i,
    message: "发现 Base64/Hex 缓冲解码后用于动态执行的可疑代码",
  },
  {
    name: "XOR 解码循环",
    kind: "代码混淆",
    severity: "中危",
    pattern:
      /String\.fromCharCode\s*\([^)]*?\^\s*0x[0-9a-f]+\b|for\s*\([^)]*?\^\s*0x[0-9a-f]+[^\n]{0,80}?eval\b/i,
    message: "发现 XOR 异或解码后用于动态执行的可疑代码",
  },

  // 7. 注入攻击
  {
    name: "SQL 注入特征",
    kind: "注入攻击",
    severity: "高危",
    pattern:
      /['"]\s+(?:or|and)\s+1\s*=\s*1\b|;\s*drop\s+table\b|--\s*$|\bunion\s+select\b/i,
    message: "发现 SQL 注入特征字符串",
  },
  {
    name: "YAML/JSON 注入",
    kind: "注入攻击",
    severity: "中危",
    pattern:
      /\b(?:yaml\.load|JSON\.parse)\s*\([^)]*?(?:\+|`|\$\{)[^\n]{0,80}?(?:input|req\.|args|argv)/i,
    message: "发现将未清洗输入拼入 YAML/JSON 解析的注入风险",
  },

  // 8. 权限提升
  {
    name: "高危命令 sudo 提权",
    kind: "权限提升",
    severity: "中危",
    pattern:
      /\bsudo\s+(?:rm|dd|mkfs|chmod|chown|visudo|tee\s+\/etc\/sudoers)\b/i,
    message: "发现对高危命令使用 sudo 提权",
  },
  {
    name: "宽松权限或 SUID 设置",
    kind: "权限提升",
    severity: "高危",
    pattern: /\bchmod\s+(?:777|u\+s)\b|\bvisudo\b|tee\s+-a\s+\/etc\/sudoers/i,
    message: "发现 chmod 777、SUID 设置或 sudoers 修改",
  },

  // 9. 文件访问
  {
    name: "读取敏感凭据文件",
    kind: "文件访问",
    severity: "中危",
    pattern:
      /\b(?:cat|head|tail|less|more|open|read|readfile|read_file)\b[^\n]{0,40}?(?:\.env\b|\.ssh\/id_rsa|\.gitconfig|\.aws\/credentials|\.npmrc\b)/i,
    message: "发现读取敏感凭据/配置文件的操作",
  },

  // 10. 网络外联
  {
    name: "非 HTTPS 外联",
    kind: "网络外联",
    severity: "中危",
    pattern: /\b(?:http:\/\/|ftp:\/\/|ws:\/\/)[a-z0-9.-]+\.[a-z]{2,}\b/i,
    message: "发现使用明文协议（HTTP/FTP/WS）外联",
  },
  {
    name: "原始 IP 外联",
    kind: "网络外联",
    severity: "低危",
    pattern:
      /\b(?:curl|wget|nc|netcat)\b[^\n]{0,40}?\b(?:\d{1,3}\.){3}\d{1,3}\b/i,
    message: "发现直接通过 IP 地址外联的可疑调用",
  },

  // 11. 提示注入
  {
    name: "指令覆盖提示注入",
    kind: "提示注入",
    severity: "中危",
    pattern:
      /ignore\s+(?:all|previous|prior)\s+instructions|disregard\s+(?:the\s+)?above|forget\s+(?:your\s+)?previous|you\s+are\s+now\b/i,
    message: "发现疑似提示注入：覆盖既有指令的措辞",
  },
  {
    name: "系统提示覆盖",
    kind: "提示注入",
    severity: "中危",
    pattern:
      /system\s+prompt\b[^\n]{0,40}?(?:override|ignore|replace)|<\/?system>/i,
    message: "发现疑似系统提示覆盖或系统标签注入",
  },
];

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
    rulesVersion: SECURITY_RULES_VERSION,
  };
}
