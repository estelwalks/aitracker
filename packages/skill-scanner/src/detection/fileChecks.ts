import { format, getMessages } from "../i18n/index.js";
import type { Finding, LocaleKey, SkillFile } from "../types.js";

// risky extensions such as executables / macro documents / archives (known script and text extensions are never treated as risk files even if matched)
const RISK_EXT = [".exe", ".bat", ".cmd", ".com", ".scr", ".bash", ".csh", ".vbs", ".jse", ".wsf", ".wsh", ".jar", ".class", ".app", ".dmg", ".ps1", ".psm1", ".psd1", ".xla", ".xlam", ".xll", ".xlm", ".xlsm", ".docm", ".dotm", ".pptm", ".potm", ".ppam", ".msi", ".msp", ".mst", ".zip", ".rar"];
const SCRIPT_EXT = [".py", ".pyc", ".sh", ".bash", ".js", ".ts", ".rb", ".pl", ".go", ".rs", ".ps1", ".psm1", ".psd1", ".cmd", ".bat"];
const TEXT_EXT = [".txt", ".md"];
const IP_PATTERN = /\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
// whitelist: public DNS / well-known CDN / mail services, etc. — since a pure rule layer cannot tell internal from external networks, common legitimate targets are filtered out
const KNOWN_IPS = new Set([
  "8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1", "9.9.9.9", "149.112.112.112", "208.67.222.222", "208.67.220.220",
  "180.76.76.76", "119.29.29.29", "114.114.114.114", "114.114.115.115", "223.5.5.5", "223.6.6.6", "101.226.4.6", "218.30.118.6",
  "13.107.21.200", "13.107.22.200", "23.216.0.0", "23.216.0.1", "104.16.0.0", "104.16.0.1", "52.84.0.0", "52.84.0.1",
  "74.125.0.0", "74.125.0.1", "40.107.0.0", "40.107.0.1", "0.0.0.0", "255.255.255.255",
]);

function isPublicIp(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return false;                                   // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return false;            // 172.16.0.0/12
  if (a === 192 && b === 168) return false;                     // 192.168.0.0/16
  if (a === 127) return false;                                  // 127.0.0.0/8
  if (a === 0) return false;                                    // 0.0.0.0/8
  if (a === 169 && b === 254) return false;                     // 169.254.0.0/16
  if (a >= 224 && a <= 239) return false;                       // 224.0.0.0/4 multicast
  if (a >= 240 && a <= 255) return false;                       // 240.0.0.0/4 reserved
  return true;
}

function extOf(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : "";
}

function collectSuspiciousIps(content: string): { ips: string[]; line: number; lineText: string } {
  const ips: string[] = [];
  let line = 0;
  let lineText = "";
  for (const [offset, text] of content.split(/\r?\n/).entries()) {
    const matches = text.matchAll(IP_PATTERN);
    for (const match of matches) {
      const ip = match[0];
      if (!isPublicIp(ip) || KNOWN_IPS.has(ip)) continue;
      ips.push(ip);
      if (line === 0) { line = offset + 1; lineText = text; }
    }
  }
  return { ips, line, lineText };
}

/**
 * File-level risk checks ported from knownsec-skill-scanner.
 * Every check is based solely on the host-provided relative paths and text content; no file paths are opened and no code is executed.
 */
export function fileLevelScan(allFiles: SkillFile[], _scannedFiles: SkillFile[], locale: LocaleKey, fileHashes: ReadonlyMap<string, string> = new Map()): Finding[] {
  const m = getMessages(locale);
  const output: Finding[] = [];
  const base = (
    id: "file-01" | "file-02" | "file-03" | "file-04" | "file-05",
    ruleId: "RISK_FILE" | "LONG_FILE" | "CONSECUTIVE_NEWLINES" | "LARGE_SKILL_DIR" | "SUSPICIOUS_EXTERNAL_IP",
    path: string,
    message: string,
    options: { kind: Finding["kind"]; severity: Finding["severity"]; weight: number; bypass?: boolean; remediation?: string },
  ): Finding => {
    const fileHash = fileHashes.get(path);
    return {
      id: `${ruleId}:${fileHash ?? path}:0`, kind: options.kind,
      severity: options.severity, source: "static", kindDisplay: m.kind[options.kind], severityDisplay: m.severity[options.severity],
      ruleId, ruleName: m.fileCheck[id].name, message, remediation: options.remediation ?? m.fileCheck[id].remediation,
      weight: options.weight, ...(options.bypass ? { bypassVerification: true } : {}), path, ...(fileHash ? { fileHash } : {}),
    };
  };
  // file-01 risky file: judged by path extension (including binary files)
  for (const file of allFiles) {
    const ext = extOf(file.path);
    const binary = file.isBinary || file.content.includes("\0");
    if ((RISK_EXT.includes(ext) || binary) && !SCRIPT_EXT.includes(ext) && !TEXT_EXT.includes(ext)) {
      output.push(base("file-01", "RISK_FILE", file.path, m.fileCheck["file-01"].message, { kind: "remote_execution", severity: "medium", weight: 25, bypass: true }));
    }
  }
  let totalContentLength = 0;
  // line count / consecutive newlines / total content size are structural heuristics applied to all provided content
  // (including files the host marked binary but that still have content), matching knownsec file_check; binary content
  // itself is not analyzed and regex rules only run against text files.
  // Content size is approximated by UTF-16 code units: for ASCII text this ≈ byte count, without the inflation caused
  // by lossy decode-and-re-encode.
  for (const file of allFiles) {
    totalContentLength += file.byteSize ?? Buffer.byteLength(file.content, "utf8");
    // file-02 extremely long file: may hide obfuscated content
    if ((TEXT_EXT.includes(extOf(file.path)) || SCRIPT_EXT.includes(extOf(file.path))) && file.content.split(/\r?\n/).length > 2000) {
      output.push(base("file-02", "LONG_FILE", file.path, m.fileCheck["file-02"].message, { kind: "obfuscation", severity: "medium", weight: 25, bypass: true }));
    }
    // file-03 consecutive newlines: may hide malicious code
    if (file.content.includes("\n".repeat(10))) {
      output.push(base("file-03", "CONSECUTIVE_NEWLINES", file.path, m.fileCheck["file-03"].message, { kind: "obfuscation", severity: "medium", weight: 25, bypass: true }));
    }
  }
  for (const file of allFiles) {
    const suspicious = collectSuspiciousIps(file.content);
    if (suspicious.ips.length > 0) {
      output.push({
        ...base("file-05", "SUSPICIOUS_EXTERNAL_IP", file.path, format(m.fileCheck["file-05"].message, { ips: suspicious.ips.join(", ") }), { kind: "obfuscation", severity: "high", weight: 30 }),
      });
    }
  }
  // file-04 oversized SKILL content (adapted for the in-memory model: approximates directory size by total text content)
  if (totalContentLength > 1024 * 1024) {
    output.push(base("file-04", "LARGE_SKILL_DIR", ".", format(m.fileCheck["file-04"].message, { size: (totalContentLength / 1024 / 1024).toFixed(2) }), { kind: "remote_execution", severity: "medium", weight: 15, bypass: true }));
  }
  return output;
}
