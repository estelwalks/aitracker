import { z } from "zod";

import type { JsonSchema } from "../../../platform/persistence/contracts.ts";
import type { CandidateOutput, CandidatePersistence } from "../contracts.ts";

/**
 * Persisted distillation candidates file
 * (`~/.trusttools/tasks/distill-candidates.v1.json`). Mirrors the reports
 * `atomic-report-store` pattern: a schemaVersioned document validated with
 * zod, wrapped by AtomicJsonStore as `{ schemaVersion, data }`. This schema
 * describes the inner `data` payload only.
 *
 * Privacy: only the candidate's privacy-filtered projection is stored — the
 * session refs (opaque ids), the AI-generated knowledge note (`summary`), the
 * execution summary and the approval state. Raw conversation content is never
 * read, returned or persisted by the distillation module; `summary` is already
 * safety-filtered by the domain before it reaches this store.
 */
export const DISTILL_CANDIDATES_SCHEMA_VERSION = 1 as const;

const opaqueId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

const SessionRefSchema = z
  .object({
    source: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
  })
  .strict();

const CostStateSchema = z
  .object({
    confidence: z.enum(["exact", "estimated", "unknown"]),
    amountUsd: z.number().optional(),
    currency: z.literal("USD"),
    reason: z.enum(["priced", "estimated", "no-pricing", "offline"]),
  })
  .strict();

const ExecutionSummarySchema = z
  .object({
    requestId: opaqueId,
    modelId: z.string().min(1).max(128),
    providerId: z.string().min(1).max(128).optional(),
    promptVersionId: z.string().min(1).max(128),
    promptVersion: z.number().int().nonnegative(),
    status: z.enum([
      "completed",
      "offline",
      "fallback",
      "budget-exceeded",
      "timeout",
      "cancelled",
      "failed",
    ]),
    cost: CostStateSchema,
    usedFallback: z.boolean(),
    errorCode: z.string().min(1).max(64).optional(),
  })
  .strict();

/** Serialized form of a candidate; matches `CandidateOutput` field-for-field. */
export const PersistedCandidateSchema = z
  .object({
    candidateId: opaqueId,
    kind: z.enum(["memory", "brief", "prompt", "persona", "skill"]),
    title: z.string().min(1).max(200),
    summary: z.string().max(16_000),
    mode: z.enum(["model", "offline", "fallback", "budget-exceeded"]),
    approvalState: z.enum(["waiting-approval", "approved", "cancelled"]),
    selectedSessionRefs: z.array(SessionRefSchema).max(8),
    generatedAt: z.string(),
    execution: ExecutionSummarySchema,
  })
  .strict();

export const DistillCandidateFileSchema = z
  .object({
    candidates: z.array(PersistedCandidateSchema),
  })
  .strict();

export type DistillCandidateFile = z.infer<typeof DistillCandidateFileSchema>;

export const DEFAULT_DISTILL_CANDIDATE_FILE: DistillCandidateFile = {
  candidates: [],
};

export function distillCandidateStoreSchema(): JsonSchema<DistillCandidateFile> {
  return {
    currentVersion: DISTILL_CANDIDATES_SCHEMA_VERSION,
    parse(value: unknown): DistillCandidateFile {
      return DistillCandidateFileSchema.parse(value);
    },
  };
}

export interface AtomicCandidateStoreOptions {
  readonly store: import("../../../platform/persistence/contracts.ts").AtomicJsonStore<DistillCandidateFile>;
}

/**
 * Durable `CandidatePersistence` backed by an AtomicJsonStore. Each mutation
 * is a read-modify-write so concurrent writers serialise through the file
 * lock. Candidates are validated against `PersistedCandidateSchema` on every
 * write; `list()` returns the newest candidate first.
 */
export function createAtomicCandidateStore(
  options: AtomicCandidateStoreOptions,
): CandidatePersistence {
  const read = async (): Promise<DistillCandidateFile> =>
    structuredClone((await options.store.read()).value);
  return {
    async list(): Promise<readonly CandidateOutput[]> {
      const file = await read();
      // Rows are validated against the persisted schema on every write; the
      // schema's widened `errorCode` is restored to the contract's branded
      // union here (mirrors the reports `listRuns` cast).
      return [...file.candidates]
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
        .map((row) => ({
          ...row,
          selectedSessionRefs: [...row.selectedSessionRefs],
        })) as readonly CandidateOutput[];
    },
    async save(candidate: CandidateOutput): Promise<void> {
      const parsed = PersistedCandidateSchema.parse(candidate);
      const file = await read();
      const index = file.candidates.findIndex(
        (item) => item.candidateId === parsed.candidateId,
      );
      const candidates = [...file.candidates];
      if (index >= 0) candidates[index] = parsed;
      else candidates.push(parsed);
      await options.store.write({ ...file, candidates });
    },
  };
}
