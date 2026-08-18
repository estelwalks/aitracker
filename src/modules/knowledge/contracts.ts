import type { Result } from "../../shared/result.ts";
import type {
  AtomicJsonStore,
  Clock,
} from "../../platform/persistence/contracts.ts";
import type { AssetVerdict } from "../security-assessment/contracts.ts";

export const knowledgeModuleId = "knowledge" as const;
export type KnowledgeModuleId = typeof knowledgeModuleId;
export type KnowledgeStatus = "draft" | "approved" | "published" | "archived";
export type KnowledgeAssetKind =
  "memory" | "brief" | "snippet" | "document" | "other";
export type ContentHash = string & { readonly __contentHash: unique symbol };

/** Opaque, non-filesystem provenance reference (for example session:abc). */
export type ProvenanceRef = string & {
  readonly __provenanceRef: unique symbol;
};

export interface Provenance {
  readonly sourceRef: ProvenanceRef;
  readonly sourceType:
    "session" | "report" | "distillation" | "manual" | "unknown";
  readonly capturedAt: string;
  readonly summary?: string;
}

export interface KnowledgeVersion {
  readonly versionId: string;
  readonly assetId: string;
  readonly version: number;
  readonly kind: KnowledgeAssetKind;
  readonly title: string;
  readonly contentRef: string;
  readonly contentHash: ContentHash;
  readonly provenance: readonly Provenance[];
  readonly createdBy: string;
  readonly status: KnowledgeStatus;
  /**
   * Security verdict carried from the producing flow (distillation
   * assessment gate). Optional: legacy/legacy-imported assets may lack it,
   * and a missing verdict must be treated as "unknown" by consumers, never
   * as "clean".
   */
  readonly securityVerdict?: AssetVerdict;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly audit: Readonly<{ action: string; actor: string }>;
}

export interface KnowledgeAsset {
  readonly assetId: string;
  readonly kind: KnowledgeAssetKind;
  readonly title: string;
  readonly currentVersion: number;
  readonly status: KnowledgeStatus;
  /** Mirrors the latest version's security verdict, if any. */
  readonly securityVerdict?: AssetVerdict;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateDraftInput {
  readonly assetId?: string;
  readonly kind: KnowledgeAssetKind;
  readonly title: string;
  /** Ephemeral content; it is hashed and never persisted by this module. */
  readonly content?: string;
  readonly contentRef?: string;
  readonly contentHash?: ContentHash;
  readonly provenance?: readonly Provenance[];
  /** Security verdict stamped onto the new version (e.g. from a distillation gate). */
  readonly securityVerdict?: AssetVerdict;
  readonly createdBy: string;
  readonly actor?: string;
}

export interface KnowledgeFilter {
  readonly status?: KnowledgeStatus;
  readonly kind?: KnowledgeAssetKind;
}

/**
 * P4-T4-03: batch list summary. One AtomicJsonStore read produces the page —
 * never a per-asset read (no N+1). `cursor` is the last `updatedAt` value of
 * the previous page; pass it back to fetch the next page (stable order).
 */
export interface KnowledgeListCursor {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface KnowledgeListResult {
  readonly entries: readonly KnowledgeAsset[];
  /** Stable continuation cursor; undefined when there are no more entries. */
  readonly nextCursor?: string;
  readonly total: number;
  /** Document revision the page was projected from. */
  readonly revision: number;
}

/**
 * P4-T4-03: an asset paired with its current version, produced by a single
 * store read. Lets transports build list read models without an N+1 of
 * per-asset `get()` calls.
 */
export interface KnowledgeVersionedEntry {
  readonly asset: KnowledgeAsset;
  readonly version: KnowledgeVersion;
}

export interface DedupeSuggestion {
  readonly assetId: string;
  readonly version: number;
  readonly contentHash: ContentHash;
  readonly reason: "same-content-hash";
}

export interface KnowledgeDocument {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly assets: readonly KnowledgeAsset[];
  readonly versions: readonly KnowledgeVersion[];
}

export interface HashPort {
  hash(value: string): ContentHash;
}

export interface KnowledgeRepository {
  createDraft(
    input: CreateDraftInput,
    expectedRevision?: number,
  ): Promise<Result<KnowledgeVersion>>;
  approve(
    assetId: string,
    actor: string,
    expectedRevision?: number,
  ): Promise<Result<KnowledgeVersion>>;
  publish(
    assetId: string,
    actor: string,
    expectedRevision?: number,
  ): Promise<Result<KnowledgeVersion>>;
  archive(
    assetId: string,
    actor: string,
    expectedRevision?: number,
  ): Promise<Result<KnowledgeVersion>>;
  list(filter?: KnowledgeFilter): Promise<Result<readonly KnowledgeAsset[]>>;
  /**
   * Batch list with cursor pagination from a single store read. Defaults to
   * the first 50 entries (latest-updated first) on the first page.
   */
  listLatest(
    cursor?: KnowledgeListCursor,
  ): Promise<Result<KnowledgeListResult>>;
  /**
   * P4-T4-03: lists matching assets together with their current version from
   * ONE store read — transports must never loop `get()` per asset (N+1).
   * Ordered by `updatedAt` descending (newest first).
   */
  listVersions(
    filter?: KnowledgeFilter,
  ): Promise<Result<readonly KnowledgeVersionedEntry[]>>;
  get(assetId: string, version?: number): Promise<Result<KnowledgeVersion>>;
  suggestDuplicates(
    contentHash: ContentHash,
  ): Promise<Result<readonly DedupeSuggestion[]>>;
}

export interface KnowledgeRepositoryOptions {
  readonly store: AtomicJsonStore<KnowledgeDocument>;
  readonly clock: Clock;
  readonly hash: HashPort;
}

export interface KnowledgeModuleContract {
  readonly module: KnowledgeModuleId;
  readonly schemaVersion: 1;
}
