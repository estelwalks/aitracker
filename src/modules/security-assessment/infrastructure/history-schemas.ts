import { z } from "zod";

import type { AssetAssessment } from "../contracts.ts";

export interface SecurityAssessmentHistoryDocument {
  readonly entries: readonly AssetAssessment[];
}

const opaqueRef = /^[a-z-]+:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const assetKind = z.enum(["skill", "package", "knowledge", "distillation"]);
const verdict = z.enum(["clean", "suspicious", "dangerous", "unknown"]);
const severity = z.enum(["high", "medium", "low"]);

const assessmentSchema = z
  .object({
    assessmentRef: z
      .string()
      .regex(/^assessment:/)
      .regex(opaqueRef),
    assetRef: z
      .string()
      .regex(/^asset:/)
      .regex(opaqueRef),
    assetHashRef: z
      .string()
      .regex(/^asset-hash:/)
      .regex(opaqueRef)
      .optional(),
    assetKind,
    verdict,
    findings: z.array(
      z
        .object({
          ref: z
            .string()
            .regex(/^finding:/)
            .regex(opaqueRef),
          severity,
          status: z.enum(["active", "resolved"]),
          evidenceRef: z
            .string()
            .regex(/^evidence:/)
            .regex(opaqueRef),
        })
        .strict(),
    ),
    ruleVersion: z
      .object({
        version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
        provenance: z.enum(["builtin", "local", "unknown"]),
        rulePackRef: z
          .string()
          .regex(/^rule-pack:/)
          .regex(opaqueRef)
          .optional(),
      })
      .strict(),
    assessedAt: z.string().datetime({ offset: true }),
    evidenceCount: z.number().int().nonnegative(),
  })
  .strict();

/** Durable documents remain limited to the renderer-safe assessment contract. */
export const securityAssessmentHistorySchema = {
  currentVersion: 1,
  parse(value: unknown): SecurityAssessmentHistoryDocument {
    return z
      .object({ entries: z.array(assessmentSchema).max(500) })
      .strict()
      .parse(value) as SecurityAssessmentHistoryDocument;
  },
};
