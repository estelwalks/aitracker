import { RISK_KINDS, type RiskKind, type Severity } from "../types.js";

/** Maps display names / aliases a model may return back to language-independent canonical slugs; returns null when unclassifiable. */
const KIND_ALIASES: Record<string, RiskKind> = {
  // Chinese display names
  "远程命令执行": "remote_execution", "命令注入": "command_injection", "数据泄露": "data_exfiltration",
  "密钥泄露": "secret_access", "持久化": "persistence", "破坏性操作": "destructive", "代码混淆": "obfuscation",
  "权限提升": "privilege_escalation", "文件访问": "sensitive_file_access",
  "网络外联": "network_abuse", "提示注入": "prompt_injection",
  // English aliases
  "remote execution": "remote_execution", "remote command execution": "remote_execution", "remote code execution": "remote_execution",
  "remote code/command execution": "remote_execution", "dangerous semantics": "remote_execution",
  "command injection": "command_injection", "command execution": "command_injection", "code injection": "command_injection",
  "shell injection": "command_injection", "os command injection": "command_injection",
  "data exfiltration": "data_exfiltration", "data leak": "data_exfiltration", "data exfil": "data_exfiltration",
  "secret access": "secret_access", "secret leakage": "secret_access", "hardcoded secret": "secret_access",
  "persistence": "persistence", "persistent backdoor": "persistence",
  "destructive": "destructive", "destructive operations": "destructive", "destruction": "destructive",
  "obfuscation": "obfuscation", "obfuscated code": "obfuscation", "code obfuscation": "obfuscation",
  "privilege escalation": "privilege_escalation", "privilege elevation": "privilege_escalation",
  "sensitive file access": "sensitive_file_access", "file access": "sensitive_file_access", "sensitive file": "sensitive_file_access",
  "network abuse": "network_abuse", "network egress": "network_abuse", "network call": "network_abuse",
  "prompt injection": "prompt_injection", "prompt injection attack": "prompt_injection",
};

export function normalizeKind(raw: string): RiskKind | null {
  const trimmed = raw.trim();
  const slug = trimmed.toLowerCase();
  if ((RISK_KINDS as readonly string[]).includes(slug)) return slug as RiskKind;
  const key = trimmed.toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  return KIND_ALIASES[key] ?? null;
}

export function normalizeSeverity(raw: string): Severity {
  const s = raw.trim().toLowerCase();
  if (s === "critical" || s === "严重") return "critical";
  if (s === "high" || s === "高危" || s === "高") return "high";
  if (s === "medium" || s === "中危" || s === "warn" || s === "警告" || s === "中") return "medium";
  return "low";
}

/** Redacts matched excerpts to avoid echoing access keys / credentials back into the report. */
const SECRET = /(?:sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{8,}|ghp_[A-Za-z0-9]{8,}|(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?)[^\s"']+/gi;
export const redact = (value: string) => value.replace(SECRET, (match) => (match.includes(":") || match.includes("=") ? `${match.slice(0, Math.max(0, match.search(/[:=]/) + 1))}[REDACTED]` : "[REDACTED]")).slice(0, 240);
