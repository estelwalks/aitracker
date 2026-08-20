import { z } from "zod";

import type { JsonSchema } from "../../../platform/persistence/contracts.ts";
import type { ReportDocument, ReportRun, ReportStore } from "../contracts.ts";

/**
 * Persisted reports file. Mirrors the `taskRunsSchema()` pattern: a typed
 * schemaVersioned document validated with zod. The file is wrapped by
 * AtomicJsonStore as `{ schemaVersion, data }`, so this schema describes the
 * inner `data` payload only.
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

export interface AtomicReportStoreOptions {
  readonly store: import("../../../platform/persistence/contracts.ts").AtomicJsonStore<ReportFile>;
}

/**
 * Durable ReportStore backed by an AtomicJsonStore. Each mutation does a
 * read-modify-write so concurrent writers serialise through the file lock.
 *
 * The store clones on read and on write so callers cannot mutate the
 * persisted document graph by holding a reference to a returned object —
 * this matches the in-memory adapter's defensive-copy behaviour.
 */
export function createAtomicReportStore(
  options: AtomicReportStoreOptions,
): ReportStore {
  const read = async (): Promise<ReportFile> =>
    structuredClone((await options.store.read()).value);
  return {
    async createRun(run: ReportRun): Promise<void> {
      const parsed = ReportRunSchema.parse(run);
      const file = await read();
      await options.store.write({
        ...file,
        runs: [...file.runs, parsed],
      });
    },
    async updateRun(run: ReportRun): Promise<void> {
      const parsed = ReportRunSchema.parse(run);
      const file = await read();
      const index = file.runs.findIndex((item) => item.runId === parsed.runId);
      if (index < 0) return;
      const runs = [...file.runs];
      runs[index] = parsed;
      await options.store.write({ ...file, runs });
    },
    async saveDocument(document: ReportDocument): Promise<void> {
      const parsed = ReportDocumentSchema.parse(document);
      const file = await read();
      const index = file.documents.findIndex(
        (item) => item.reportId === parsed.reportId,
      );
      const documents = [...file.documents];
      if (index >= 0) documents[index] = parsed;
      else documents.push(parsed);
      await options.store.write({ ...file, documents });
    },
    async getDocument(reportId: string): Promise<ReportDocument | undefined> {
      const file = await read();
      return file.documents.find((item) => item.reportId === reportId);
    },
    async latest(definitionId: string): Promise<ReportDocument | undefined> {
      const file = await read();
      const rows = file.documents.filter(
        (item) => item.definitionId === definitionId,
      );
      const sorted = rows.sort((a, b) =>
        b.generatedAt.localeCompare(a.generatedAt),
      );
      return sorted[0];
    },
    async listDocuments(): Promise<readonly ReportDocument[]> {
      const file = await read();
      return [...file.documents].sort((a, b) =>
        b.generatedAt.localeCompare(a.generatedAt),
      );
    },
    async listRuns(): Promise<readonly ReportRun[]> {
      const file = await read();
      // Runs are validated against ReportRunSchema on every write; the schema's
      // widened errorCode is restored to the contract's branded union here.
      return [...file.runs].sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      ) as readonly ReportRun[];
    },
  };
}
