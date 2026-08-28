import { STATIC_RULES } from "../rules/index.js";
import { getMessages } from "../i18n/index.js";
import { redact } from "../model/normalize.js";
import type { Finding, LocaleKey, SkillFile } from "../types.js";

const LEGACY_I18N_RULE_ID: Record<string, string> = {
  RM_RF_ROOT: "builtin-12", RM_RF_HOME: "builtin-12", DD_WIPE: "builtin-13", MKFS_FORMAT: "builtin-13", DISKUTIL_ERASE: "builtin-40",
  CURL_PIPE_SH_IP: "builtin-01", CURL_REMOTE_IP: "builtin-24", CURL_PIPE_SH_DOMAIN: "builtin-01", WGET_PIPE_SH: "builtin-01", BASE64_EXEC: "builtin-02", REVERSE_SHELL: "builtin-03",
  POWERSHELL_ENCODED_COMMAND: "builtin-34", POWERSHELL_IEX_DOWNLOAD: "builtin-34", MSHTA_EXEC: "builtin-35", REGSVR32_SCJ: "builtin-35", RUNDLL32_SCRIPT: "builtin-35", OSASCRIPT_EXEC: "builtin-36",
  MALICIOUS_OPENCLAW_DOWNLOAD: "builtin-61", MALICIOUS_GLOT_SNIPPET: "builtin-60", IOC_C2_IP: "builtin-45", IOC_PAYLOAD_DOMAIN: "builtin-47", IOC_GITHUB_MALICIOUS: "builtin-48", IOC_MALWARE_HASH: "builtin-49", IOC_MALICIOUS_PUBLISHER: "builtin-48",
  PY_EVAL: "builtin-27", PY_EXEC: "builtin-27", OS_SYSTEM: "builtin-28", SUBPROCESS_SHELL_TRUE: "builtin-28", NODE_CHILD_EXEC: "builtin-30", NODE_VM_RUN: "builtin-30", PICKLE_LOAD: "builtin-29",
  GO_EXEC_COMMAND: "builtin-33", JAVA_RUNTIME_EXEC: "builtin-33", CSHARP_PROCESS_START: "builtin-33", PHP_EXEC: "builtin-31", RUBY_EXEC: "builtin-32",
  HTTP_POST_SENSITIVE: "builtin-04", CURL_POST_IP: "builtin-04", CURL_POST_DOMAIN: "builtin-04", SOCKET_CONNECT: "builtin-06", NETCAT: "builtin-24", PY_URLLIB: "builtin-56", HTTP_REQUEST: "builtin-55", JS_FETCH: "builtin-57", BASE64_AND_NETWORK: "builtin-54", IOC_EXFIL_DOMAIN: "builtin-46",
  PRIVATE_KEY: "builtin-41", PASSWORD_HARDCODE: "builtin-08", AWS_KEY: "builtin-07", GITHUB_TOKEN: "builtin-07", SLACK_WEBHOOK: "builtin-42",
  SSH_KEYS_WRITE: "builtin-10", REG_RUN_KEY_ADD: "builtin-37", STARTUP_FOLDER_PERSISTENCE: "builtin-51", SCHTASKS_CREATE: "builtin-38", SYSTEMD_SERVICE: "builtin-50", LAUNCH_AGENT: "builtin-39",
  SUDOERS_MODIFY: "builtin-21", READ_SSH_KEY: "builtin-22", READ_AWS_CREDS: "builtin-22", READ_ENV_FILE: "builtin-22", READ_PASSWD: "builtin-44", READ_SHADOW: "builtin-43", READ_WIN_CREDENTIALS: "builtin-58", READ_BROWSER_PASSWORDS: "builtin-59",
  BASE64_DECODE_EXEC: "builtin-16", HEX_BLOB: "builtin-15", XOR_ENCODING: "builtin-17", ROT13: "builtin-53", WEBSOCKET_UNSECURE: "builtin-23", FTP_PROTOCOL: "builtin-23",
  IGNORE_INSTRUCTIONS: "builtin-25", DISREGARD_GUIDELINES: "builtin-25", FORGET_CONTEXT: "builtin-25", ROLE_ELEVATION: "builtin-25", DAN_MODE: "builtin-52",
};

function extOf(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function localizedRuleCopy(rule: (typeof STATIC_RULES)[number], locale: LocaleKey) {
  const messages = getMessages(locale);
  if (locale === "zh-CN") return { name: rule.nameZh, message: rule.messageZh, remediation: rule.remediationZh };
  if (locale === "en-US") return { name: rule.name, message: rule.message, remediation: rule.remediation };
  const legacyId = LEGACY_I18N_RULE_ID[rule.id];
  return { name: messages.ruleName[legacyId] ?? rule.name, message: messages.ruleMessage[legacyId] ?? rule.message, remediation: messages.remediation[rule.kind] };
}

function buildSnippet(lines: string[], hitLine: number): string {
  const start = Math.max(0, hitLine - 2);
  const end = Math.min(lines.length, hitLine + 1);
  const width = String(end).length;
  return lines.slice(start, end).map((line, index) => {
    const lineNumber = start + index + 1;
    const marker = lineNumber === hitLine ? ">" : " ";
    const display = line.length > 200 ? `${line.slice(0, 200)}...` : line;
    return `${marker} ${String(lineNumber).padStart(width)} | ${display}`;
  }).join("\n");
}

const COMPILED_RULES = STATIC_RULES.map((rule) => {
  if (rule.id === "PHP_EXEC") {
    const insensitive = /(?:^|[^\w.=])(shell_exec|exec|passthru|proc_open|popen)\((?!s\))/i;
    const caseSensitiveSystem = /(?:^|[^\w.=])system\((?!s\))/;
    return { rule, test: (line: string) => insensitive.test(line) || caseSensitiveSystem.test(line) };
  }
  if (rule.id === "RUBY_EXEC") {
    const insensitive = /(?:^|[^\w.=])(exec|IO\.popen|Open3\.popen3)\((?!s\))/i;
    const caseSensitiveSystem = /(?:^|[^\w.=])system\((?!s\))/;
    return { rule, test: (line: string) => insensitive.test(line) || caseSensitiveSystem.test(line) };
  }
  const regex = new RegExp(rule.pattern, "im");
  return { rule, test: (line: string) => regex.test(line) };
});

/** Exact knownsec line-by-line rule matching, including fileTypes and the 512 KiB guard. */
export function staticScan(files: SkillFile[], locale: LocaleKey, fileHashes: ReadonlyMap<string, string> = new Map()): Finding[] {
  const m = getMessages(locale);
  const output: Finding[] = [];
  for (const file of files) {
    if (Buffer.byteLength(file.content, "utf8") > 512 * 1024) continue;
    const ext = extOf(file.path);
    const fileHash = fileHashes.get(file.path);
    const lines = file.content.split("\n");
    for (const { rule, test } of COMPILED_RULES) {
      if (rule.fileTypes && !rule.fileTypes.includes(ext)) continue;
      const copy = localizedRuleCopy(rule, locale);
      for (const [offset, line] of lines.entries()) {
        if (rule.fileTypes && !rule.fileTypes.includes(ext)) continue;
        if (test(line)) {
          output.push({
            id: `${rule.id}:${fileHash ?? file.path}:${offset + 1}`, kind: rule.kind, severity: rule.severity, source: "static",
            kindDisplay: m.kind[rule.kind], severityDisplay: m.severity[rule.severity],
            ruleId: rule.id, ruleName: copy.name, message: copy.message, remediation: copy.remediation,
            weight: rule.weight, ...(rule.cweId ? { cweId: rule.cweId } : {}), ...(rule.bypassVerification ? { bypassVerification: true } : {}),
            path: file.path, line: offset + 1, excerpt: redact(buildSnippet(lines, offset + 1)), ...(fileHash ? { fileHash } : {}),
          });
        }
      }
    }
  }
  return output;
}
