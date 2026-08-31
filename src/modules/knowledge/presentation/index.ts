import type { KnowledgeModuleContract } from "../contracts";

export type KnowledgeViewModel = KnowledgeModuleContract;

/** Memory type: portrait (about you)/task memory (agreements and decisions). */
export type MemoryType = "profile" | "task";

/**
 * Renderer-safe memory hub read model. The projection carries privacy-filtered
 * metadata plus the memory product body: the module hashes raw content on
 * write and never persists conversation content (CLEAN_ROOM); the only
 * persisted body is the AI-distilled / manually entered memory itself.
 * `summary` comes from the version's provenance summaries.
 */
export interface MemoryEntry {
  readonly assetId: string;
  readonly title: string;
  readonly kind: "memory";
  readonly status: string;
  /** Portrait/task memory (provenance is written when entering manually; the default portrait is for distilled entries). */
  readonly type: MemoryType;
  /**
   * Source display token: "distill" indicates distillation source (sourceType "session"), manual entry
   * It is the source name entered in the form. If there is no provenance, it is "unknown". The client is responsible for i18n copywriting.
   */
  readonly source: string;
  readonly project?: string;
  /** Security digest: Distilled entries are provenance digests, manual entries are text truncation digests. */
  readonly summary: string;
  /**
   * Memory Text (FR-014 Title + Text): The complete product of distillation/manual memory persistence; old entries have none
   * Fallback to provenance summary when content is used. Memorized artifacts only, never containing original conversations.
   */
  readonly body?: string;
  readonly origin: "distill" | "manual";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryListResult {
  readonly entries: readonly MemoryEntry[];
  /** All / Portraits / Task Memory Count (directly exported by projection to avoid duplication of statistics by the client). */
  readonly counts: {
    readonly total: number;
    readonly profile: number;
    readonly task: number;
  };
}

export interface MemoryCreateInput {
  readonly type: MemoryType;
  readonly title: string;
  readonly body: string;
  readonly source?: string;
  readonly project?: string;
}

export interface MemoryUpdateInput extends MemoryCreateInput {
  readonly assetId: string;
}

export interface MemoryActionResponse {
  readonly ok: boolean;
  readonly errorCode?: string;
  readonly entry?: MemoryEntry;
}
