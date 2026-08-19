import { z } from "zod";

import type { JsonSchema } from "../../../test-support/json-schema.ts";

/**
 * SQLite report row validation schemas.
 *
 * New records store metadata and a relative Markdown filename. The optional
 * body field exists only to read legacy reports.v1.json files and is removed
 * when the application lazily migrates that record.
 */
export const REPORTS_SCHEMA_VERSION = 1 as const;

const opaqueId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const isoTimestamp = z.string();
const safeErrorCode = z.string().regex(/^errors\.[a-z][A-Za-z0-9._-]*$/);

const EvidenceRefSchema = z
  .object({
    module: z.enum(["usage", "insights", "security", "knowledge", "tasks"]),
    ref: z.string().min(1),
    observedAt: isoTimestamp,
  })
  .strict();

const AssetRefSchema = z
  .object({
    assetId: z.string().min(1),
    kind: z.enum(["knowledge", "chart", "attachment"]),
  })
  .strict();

export const ReportRunSchema = z
  .object({
    runId: opaqueId,
    definitionId: z.enum(["reports.daily", "reports.weekly"]),
    trigger: z.enum(["manual", "schedule"]),
    status: z.enum([
      "queued",
      "running",
      "succeeded",
      "failed",
      "offline",
      "budget-exceeded",
    ]),
    startedAt: isoTimestamp,
    finishedAt: isoTimestamp.optional(),
    errorCode: safeErrorCode.optional(),
    retryable: z.boolean().optional(),
    evidence: z.array(EvidenceRefSchema),
  })
  .strict();

export const ReportDocumentSchema = z
  .object({
    reportId: opaqueId,
    runId: opaqueId,
    definitionId: z.enum(["reports.daily", "reports.weekly"]),
    status: z.enum(["draft", "approved", "archived"]),
    title: z.string().min(1),
    contentFile: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.md$/)
      .optional(),
    body: z.string().optional(),
    generatedAt: isoTimestamp,
    templateVersion: z.number().int().nonnegative(),
    evidence: z.array(EvidenceRefSchema),
    assets: z.array(AssetRefSchema),
    approvedBy: z.string().optional(),
    approvedAt: isoTimestamp.optional(),
  })
  .strict();

export const ReportFileSchema = z
  .object({
    runs: z.array(ReportRunSchema),
    documents: z.array(ReportDocumentSchema),
  })
  .strict();

export type ReportFile = z.infer<typeof ReportFileSchema>;

export const DEFAULT_REPORT_FILE: ReportFile = { runs: [], documents: [] };

export function reportStoreSchema(): JsonSchema<ReportFile> {
  return {
    currentVersion: REPORTS_SCHEMA_VERSION,
    parse(value: unknown): ReportFile {
      return ReportFileSchema.parse(value);
    },
  };
}
