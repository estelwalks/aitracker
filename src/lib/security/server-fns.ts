import { createServerFn } from "@tanstack/react-start";

import { parseUserSecurityRules } from "./rules.ts";
import type { AiReviewResult, SecurityRisk } from "./scanner.ts";

const MAX_ARCHIVE_BASE64_LENGTH = Math.ceil((20 * 1024 * 1024) / 3) * 4;

const reviewRequestValidator = (input: SecurityRisk[]): SecurityRisk[] => {
  if (
    !Array.isArray(input) ||
    input.length > 50 ||
    input.some(
      (risk) =>
        typeof risk?.kind !== "string" ||
        typeof risk?.severity !== "string" ||
        typeof risk?.message !== "string" ||
        typeof risk?.excerpt !== "string" ||
        risk.excerpt.length > 180,
    )
  ) {
    throw new Error("AI 审查参数不合法");
  }
  return input;
};

export const requestAiSecurityReview = createServerFn({ method: "POST" })
  .validator(reviewRequestValidator)
  .handler(async ({ data }): Promise<AiReviewResult> => {
    const { reviewSecurityRisks } = await import("./ai-review.server.ts");
    return reviewSecurityRisks(data);
  });

const archiveScanRequestValidator = (input: unknown) => {
  if (!input || typeof input !== "object")
    throw new Error("压缩包扫描参数不合法");
  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate.name !== "string" ||
    candidate.name.length === 0 ||
    candidate.name.length > 255 ||
    typeof candidate.base64 !== "string" ||
    candidate.base64.length === 0 ||
    candidate.base64.length > MAX_ARCHIVE_BASE64_LENGTH ||
    typeof candidate.aiReviewEnabled !== "boolean" ||
    !Array.isArray(candidate.userRules)
  ) {
    throw new Error("压缩包扫描参数不合法");
  }

  const userRules = parseUserSecurityRules(candidate.userRules);
  if (userRules.length !== candidate.userRules.length) {
    throw new Error("用户安全规则参数不合法");
  }
  return {
    name: candidate.name,
    base64: candidate.base64,
    aiReviewEnabled: candidate.aiReviewEnabled,
    userRules,
  };
};

export const requestSecurityArchiveScan = createServerFn({ method: "POST" })
  .validator(archiveScanRequestValidator)
  .handler(async ({ data }) => {
    const { scanUploadedSecurityArchive } =
      await import("./archive-scan.server.ts");
    return scanUploadedSecurityArchive(data);
  });
