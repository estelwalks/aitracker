import type { Result } from "../../shared/result.ts";

export const searchModuleId = "search" as const;
export type SearchModuleId = typeof searchModuleId;

export type SearchDocumentType =
  "agent" | "skill" | "session" | "report" | "knowledge" | "finding";
export type SearchFreshness = "fresh" | "stale" | "unknown";

/** Browser-safe, deliberately lossy search projection. */
export interface SearchDocument {
  readonly id: string;
  readonly type: SearchDocumentType;
  readonly sourceRef: string;
  readonly title: string;
  readonly tags: readonly string[];
  readonly textSummary: string;
  readonly freshness: SearchFreshness;
  readonly updatedAt: string;
}

export interface SearchIndexSnapshot {
  readonly schemaVersion: 1;
  /** Content fingerprint; changes whenever the document set changes. */
  readonly version: string;
  readonly generatedAt: string;
  readonly stale: boolean;
  readonly documents: readonly SearchDocument[];
  /**
   * Number of input documents dropped by the privacy/shape guard when the
   * snapshot was built. Absent on hand-built snapshots; `createSnapshot`
   * always sets it (0 = nothing skipped).
   */
  readonly skipped?: number;
}

export interface SearchQuery {
  readonly text: string;
  readonly types?: readonly SearchDocumentType[];
  readonly limit?: number;
  readonly includeStale?: boolean;
}

export interface SearchResult {
  readonly document: SearchDocument;
  readonly score: number;
}

export interface SearchQueryResult {
  readonly query: string;
  readonly indexVersion: string;
  readonly stale: boolean;
  readonly results: readonly SearchResult[];
}

export interface SearchIndexRepository {
  read(): Promise<Result<SearchIndexSnapshot>>;
  write(snapshot: SearchIndexSnapshot): Promise<Result<void>>;
}

export interface SearchModuleContract {
  readonly module: SearchModuleId;
  readonly schemaVersion: 1;
}
