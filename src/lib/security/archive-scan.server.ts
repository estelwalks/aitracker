import { gunzipSync } from "node:zlib";

import { parseTarArchive } from "../local-market/archive.server.ts";
import { reviewSecurityRisks } from "./ai-review.server.ts";
import { parseUserSecurityRules, type UserSecurityRule } from "./rules.ts";
import {
  scanSecurityFiles,
  type SecurityInputFile,
  type SecurityReport,
} from "./scanner.ts";

export const MAX_SECURITY_ARCHIVE_BYTES = 20 * 1024 * 1024;
export const MAX_SECURITY_ARCHIVE_UNPACKED_BYTES = 40 * 1024 * 1024;

export interface SecurityArchiveScanRequest {
  name: string;
  base64: string;
  userRules: UserSecurityRule[];
  aiReviewEnabled: boolean;
}

export interface SecurityArchiveScanResult {
  archiveName: string;
  archiveBytes: number;
  unpackedBytes: number;
  entriesChecked: number;
  report: SecurityReport;
}

function archiveType(name: string): "tar" | "tar.gz" {
  const lowerName = name.toLocaleLowerCase();
  if (lowerName.endsWith(".tar.gz")) return "tar.gz";
  if (lowerName.endsWith(".tar")) return "tar";
  throw new Error("仅支持 .tar 与 .tar.gz；.zip 等其他压缩格式不支持");
}

function decodeArchiveBase64(base64: string): Buffer {
  const maxBase64Length = Math.ceil(MAX_SECURITY_ARCHIVE_BYTES / 3) * 4;
  if (
    !base64 ||
    base64.length > maxBase64Length ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  ) {
    throw new Error("压缩包数据无效或超过 20 MB 限制");
  }

  const archive = Buffer.from(base64, "base64");
  if (
    archive.byteLength === 0 ||
    archive.byteLength > MAX_SECURITY_ARCHIVE_BYTES
  ) {
    throw new Error("压缩包为空或超过 20 MB 限制");
  }
  if (archive.toString("base64") !== base64) {
    throw new Error("压缩包数据编码无效");
  }
  return archive;
}

function unpackArchive(name: string, archive: Buffer): Buffer {
  const type = archiveType(name);
  const isGzip = archive[0] === 0x1f && archive[1] === 0x8b;

  if (type === "tar") {
    if (isGzip) throw new Error("文件扩展名与内容不匹配：请使用 .tar.gz");
    return archive;
  }
  if (!isGzip) throw new Error("文件不是有效的 gzip 压缩包");

  try {
    return gunzipSync(archive, {
      maxOutputLength: MAX_SECURITY_ARCHIVE_UNPACKED_BYTES,
    });
  } catch {
    throw new Error("压缩包解压失败或解压后体积超过 40 MB 限制");
  }
}

function toSecurityFiles(entries: ReturnType<typeof parseTarArchive>): {
  files: SecurityInputFile[];
  unpackedBytes: number;
} {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: SecurityInputFile[] = [];
  let unpackedBytes = 0;

  for (const entry of entries) {
    unpackedBytes += entry.content.byteLength;
    if (entry.type !== "file" || entry.content.includes(0)) continue;
    try {
      files.push({
        name: entry.path,
        content: decoder.decode(entry.content),
      });
    } catch {
      continue;
    }
  }

  if (files.length === 0)
    throw new Error("压缩包中没有可扫描的 UTF-8 文本文件");
  return { files, unpackedBytes };
}

export async function scanUploadedSecurityArchive(
  input: SecurityArchiveScanRequest,
): Promise<SecurityArchiveScanResult> {
  const archive = decodeArchiveBase64(input.base64);
  const unpacked = unpackArchive(input.name, archive);
  if (unpacked.byteLength > MAX_SECURITY_ARCHIVE_UNPACKED_BYTES) {
    throw new Error("压缩包解压后体积超过 40 MB 限制");
  }

  const entries = parseTarArchive(unpacked);
  const { files, unpackedBytes } = toSecurityFiles(entries);
  const report = scanSecurityFiles(
    files,
    parseUserSecurityRules(input.userRules),
  );
  if (input.aiReviewEnabled) {
    report.aiReview = await reviewSecurityRisks(report.risks);
  }

  return {
    archiveName: input.name,
    archiveBytes: archive.byteLength,
    unpackedBytes,
    entriesChecked: entries.length,
    report,
  };
}
