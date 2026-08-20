import { z } from "zod";

/**
 * SQLite distillation candidate validation schema.
 *
 * Privacy: only the candidate's privacy-filtered projection is stored — the
 * session refs (opaque ids), the AI-generated knowledge note (`summary`), the
 * execution summary and the approval state. Raw conversation content is never
 * read, returned or persisted by the distillation module; `summary` is already
 * safety-filtered by the domain before it reaches this store.
 */

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
    // 批准时写入的知识资产 id，关联记忆库条目（迁移 0004 的 knowledge_asset_id 列）。
    knowledgeAssetId: opaqueId.optional(),
    execution: ExecutionSummarySchema,
  })
  .strict();
