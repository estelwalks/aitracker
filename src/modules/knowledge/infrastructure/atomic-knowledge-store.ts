import { z } from "zod";

import type { JsonSchema } from "../../../platform/persistence/contracts.ts";
import type { KnowledgeDocument } from "../contracts.ts";

/**
 * Persisted knowledge file. Mirrors the reports/tasks store pattern: the
 * AtomicJsonStore wraps the file as `{ schemaVersion, data }`, so this schema
 * describes only the inner `data` payload.
 *
 * Privacy: only asset ids, kinds, titles, content hashes (opaque), provenance
 * refs, statuses, timestamps and audit actors are stored. The distilled
 * `content` itself is never persisted by the knowledge module — only its hash
 * is recorded (see `createDraft` in the application layer).
 */
export const KNOWLEDGE_SCHEMA_VERSION = 1 as const;

const opaqueId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const contentHash = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,255}$/);
const isoTimestamp = z.string();
const provenanceRef = z.string();

const ProvenanceSchema = z
  .object({
    sourceRef: provenanceRef,
    sourceType: z.enum([
      "session",
      "report",
      "distillation",
      "manual",
      "unknown",
    ]),
    capturedAt: isoTimestamp,
    summary: z.string().optional(),
  })
  .strict();

const KnowledgeVersionSchema = z
  .object({
    versionId: z.string().min(1),
    assetId: opaqueId,
    version: z.number().int().nonnegative(),
    kind: z.enum(["memory", "brief", "snippet", "document", "other"]),
    title: z.string().min(1),
    contentRef: z.string().min(1),
    contentHash,
    provenance: z.array(ProvenanceSchema),
    createdBy: z.string().min(1),
    status: z.enum(["draft", "approved", "published", "archived"]),
    securityVerdict: z
      .enum(["clean", "suspicious", "dangerous", "unknown"])
      .optional(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
    audit: z.object({ action: z.string(), actor: z.string() }).strict(),
  })
  .strict();

const KnowledgeAssetSchema = z
  .object({
    assetId: opaqueId,
    kind: z.enum(["memory", "brief", "snippet", "document", "other"]),
    title: z.string().min(1),
    currentVersion: z.number().int().nonnegative(),
    status: z.enum(["draft", "approved", "published", "archived"]),
    securityVerdict: z
      .enum(["clean", "suspicious", "dangerous", "unknown"])
      .optional(),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  })
  .strict();

export const KnowledgeDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    assets: z.array(KnowledgeAssetSchema),
    versions: z.array(KnowledgeVersionSchema),
  })
  .strict();

export const DEFAULT_KNOWLEDGE_DOCUMENT: KnowledgeDocument = {
  schemaVersion: 1,
  revision: 0,
  assets: [],
  versions: [],
};

export function knowledgeDocumentSchema(): JsonSchema<KnowledgeDocument> {
  return {
    currentVersion: KNOWLEDGE_SCHEMA_VERSION,
    parse(value: unknown): KnowledgeDocument {
      // The zod schema validates the document shape but cannot narrow the
      // branded `ContentHash`/`ProvenanceRef` string types; the cast is safe
      // because the regexes above already constrain their character set.
      return KnowledgeDocumentSchema.parse(
        value,
      ) as unknown as KnowledgeDocument;
    },
  };
}
