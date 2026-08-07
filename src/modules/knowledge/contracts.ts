import type { Result } from "../../shared/result.ts";
import type {
  AtomicJsonStore,
  Clock,
} from "../../platform/persistence/contracts.ts";

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
  readonly createdBy: string;
  readonly actor?: string;
}

export interface KnowledgeFilter {
  readonly status?: KnowledgeStatus;
  readonly kind?: KnowledgeAssetKind;
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
