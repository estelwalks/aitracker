import { gunzipSync } from "node:zlib";
import { AppError } from "../errors";

import type {
  SkillDownloadInspection,
  StaticScanFinding,
  StaticScanReport,
} from "./types.ts";
import { buildDownloadUrl } from "./api.server.ts";

export const MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_UNPACKED_BYTES = 40 * 1024 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ENTRIES = 1_000;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export interface TarEntry {
  path: string;
  type: "file" | "directory";
  content: Buffer;
}

const TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".css",
  ".env",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
  ".zsh",
]);

const SCAN_RULES: Array<{
  rule: string;
  severity: "critical" | "warning";
  message: string;
  pattern: RegExp;
}> = [
  {
    rule: "embedded-private-key",
    severity: "critical",
    message: "发现内嵌私钥",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  },
  {
    rule: "download-pipe-shell",
    severity: "critical",
    message: "发现下载内容直接交给 shell 执行",
    pattern: /\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:ba)?sh\b/i,
  },
  {
    rule: "destructive-root-delete",
    severity: "critical",
    message: "发现高风险根目录递归删除命令",
    pattern:
      /\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+(?:\/|\$HOME|~)(?:\s|$)/i,
  },
  {
    rule: "dynamic-code-execution",
    severity: "warning",
    message: "发现动态代码执行调用，请人工确认",
    pattern: /\b(?:eval|exec|Function)\s*\(/,
  },
  {
    rule: "process-spawn",
    severity: "warning",
    message: "发现子进程或 shell 调用，请核对命令边界",
    pattern:
      /\b(?:child_process|execSync|spawnSync|subprocess\.(?:run|Popen|call)|os\.system)\b/,
  },
  {
    rule: "external-network",
    severity: "warning",
    message: "发现外部网络访问能力，请核对目标地址",
    pattern:
      /\b(?:fetch|axios\.(?:get|post)|requests\.(?:get|post)|curl|wget)\b/,
  },
  {
    rule: "credential-access",
    severity: "warning",
    message: "发现凭据或敏感环境变量访问，请核对用途",
    pattern:
      /(?:process\.env|os\.environ|getenv\s*\()[^\n]{0,160}(?:TOKEN|SECRET|PASSWORD|API_KEY)/i,
  },
];

function readTarString(block: Buffer, start: number, length: number): string {
  const end = block.indexOf(0, start);
  return block
    .subarray(
      start,
      end >= start && end < start + length ? end : start + length,
    )
    .toString("utf8")
    .trim();
}

function readTarOctal(block: Buffer, start: number, length: number): number {
  const raw = readTarString(block, start, length).replace(/\0/g, "").trim();
  if (!/^[0-7]*$/.test(raw))
    throw new AppError("errors.market.archive.tarNumericField");
  return raw === "" ? 0 : Number.parseInt(raw, 8);
}

function validateTarChecksum(block: Buffer): void {
  const expected = readTarOctal(block, 148, 8);
  let actual = 0;
  for (let index = 0; index < 512; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : (block[index] ?? 0);
  }
  if (expected !== actual)
    throw new AppError("errors.market.archive.tarChecksum");
}

export function validateArchivePath(input: string): string {
  if (!input || input.includes("\0") || input.includes("\\")) {
    throw new AppError("errors.market.archive.invalidPath");
  }
  if (input.startsWith("/") || /^[a-zA-Z]:/.test(input)) {
    throw new AppError("errors.market.archive.absolutePath", { path: input });
  }

  const parts = input.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) {
    throw new AppError("errors.market.archive.pathTraversal", { path: input });
  }
  return parts.join("/");
}

export function parseTarArchive(buffer: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  let unpackedBytes = 0;
  let headersChecked = 0;

  while (offset + 512 <= buffer.length) {
    headersChecked += 1;
    if (headersChecked > MAX_ENTRIES)
      throw new AppError("errors.market.archive.tooManyEntries");
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    validateTarChecksum(header);

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const path = validateArchivePath(prefix ? `${prefix}/${name}` : name);
    const size = readTarOctal(header, 124, 12);
    const typeFlag = readTarString(header, 156, 1) || "0";
    if (size > MAX_FILE_BYTES)
      throw new AppError("errors.market.archive.fileTooLarge", { path });
    if (offset + 512 + size > buffer.length)
      throw new AppError("errors.market.archive.tarTruncated");
    if (["x", "g"].includes(typeFlag)) {
      const metadata = buffer
        .subarray(offset + 512, offset + 512 + size)
        .toString("utf8");
      for (const record of metadata.split("\n")) {
        const separator = record.indexOf(" ");
        const assignment =
          separator === -1 ? record : record.slice(separator + 1);
        const equals = assignment.indexOf("=");
        if (equals === -1) continue;
        const key = assignment.slice(0, equals);
        const value = assignment.slice(equals + 1);
        if (key === "path") validateArchivePath(value);
        if (key === "linkpath") {
          throw new AppError("errors.market.archive.paxBadLink");
        }
      }
      offset += 512 + Math.ceil(size / 512) * 512;
      continue;
    }
    if (!["0", "5"].includes(typeFlag)) {
      throw new AppError("errors.market.archive.badLinkEntry", { path });
    }

    unpackedBytes += size;
    if (unpackedBytes > MAX_UNPACKED_BYTES)
      throw new AppError("errors.market.archive.unpackedTooLarge");

    entries.push({
      path,
      type: typeFlag === "5" ? "directory" : "file",
      content:
        typeFlag === "5"
          ? Buffer.alloc(0)
          : buffer.subarray(offset + 512, offset + 512 + size),
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  if (entries.length === 0)
    throw new AppError("errors.market.archive.emptyTar");
  return entries;
}

function isTextFile(entry: TarEntry): boolean {
  if (entry.type !== "file" || entry.content.includes(0)) return false;
  const dot = entry.path.lastIndexOf(".");
  const extension = dot === -1 ? "" : entry.path.slice(dot).toLocaleLowerCase();
  return TEXT_EXTENSIONS.has(extension);
}

export function scanTarEntries(entries: TarEntry[]): StaticScanReport {
  const findings: StaticScanFinding[] = [];
  let filesScanned = 0;
  let unpackedBytes = 0;

  for (const entry of entries) {
    unpackedBytes += entry.content.byteLength;
    if (!isTextFile(entry)) continue;
    filesScanned += 1;
    const lines = entry.content.toString("utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of SCAN_RULES) {
        if (rule.pattern.test(line)) {
          findings.push({
            path: entry.path,
            line: index + 1,
            severity: rule.severity,
            rule: rule.rule,
            message: rule.message,
          });
        }
      }
    });
  }

  if (filesScanned === 0) {
    findings.push({
      path: "(archive)",
      line: null,
      severity: "warning",
      rule: "no-text-files",
      message: "下载包中没有可供静态扫描的文本文件",
    });
  }

  return {
    safe: !findings.some((finding) => finding.severity === "critical"),
    filesScanned,
    entriesChecked: entries.length,
    unpackedBytes,
    findings,
  };
}

async function readLimitedBody(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_COMPRESSED_BYTES) {
    throw new AppError("errors.market.archive.tarTooLarge");
  }
  if (!response.body) throw new AppError("errors.market.archive.emptyDownload");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_COMPRESSED_BYTES) {
      await reader.cancel();
      throw new AppError("errors.market.archive.tarTooLarge");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, size);
}

export async function inspectSkillDownload(
  skill: SkillDownloadInspection["skill"],
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<SkillDownloadInspection> {
  return (await downloadAndInspectSkill(skill, options)).inspection;
}

export async function downloadAndInspectSkill(
  skill: SkillDownloadInspection["skill"],
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ inspection: SkillDownloadInspection; entries: TarEntry[] }> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS,
  );

  try {
    const response = await (options.fetcher ?? fetch)(buildDownloadUrl(skill), {
      headers: {
        accept:
          "application/gzip, application/x-gzip, application/octet-stream",
      },
      signal: controller.signal,
    });
    if (!response.ok)
      throw new AppError("errors.market.archive.downloadHttp", {
        status: response.status,
      });

    const compressed = await readLimitedBody(response);
    if (
      compressed.length < 2 ||
      compressed[0] !== 0x1f ||
      compressed[1] !== 0x8b
    ) {
      throw new AppError("errors.market.archive.notGzip");
    }

    let unpacked: Buffer;
    try {
      unpacked = gunzipSync(compressed, {
        maxOutputLength: MAX_UNPACKED_BYTES,
      });
    } catch {
      throw new AppError("errors.market.archive.inflateFailed");
    }

    const entries = parseTarArchive(unpacked);
    return {
      inspection: {
        skill,
        compressedBytes: compressed.byteLength,
        contentType: response.headers.get("content-type"),
        scan: scanTarEntries(entries),
      },
      entries,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError("errors.market.archive.downloadTimeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
