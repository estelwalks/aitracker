/**
 * P3-T3-06: project classification index.
 *
 * The index persists classification results keyed by normalized project
 * reference so the Dashboard request path never re-probes the filesystem.
 * Incremental updates reuse entries whose directory fingerprint (mtime) is
 * unchanged; only new or changed references are re-classified, with a bounded
 * worker pool (maxProjectClassifiers = 8).
 */

export interface ClassificationIndexEntry {
  /** Normalized project reference (never a raw cwd path in the browser). */
  readonly ref: string;
  readonly kind: "workspace" | "quick-conversation" | "unknown";
  /** Display-safe label (basename or "unknown"). */
  readonly label: string;
  readonly classifiedAt: string;
  /** Directory mtime signature used for incremental reuse. */
  readonly fingerprint: string | null;
}

export interface ClassificationIndex {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly entries: Record<string, ClassificationIndexEntry>;
}

export interface ClassificationIndexRepository {
  /** O(1) lookup; undefined when the ref was never classified. */
  get(ref: string): Promise<ClassificationIndexEntry | undefined>;
  /** Batch lookup; returns entries for refs already indexed. */
  getMany(
    refs: readonly string[],
  ): Promise<Map<string, ClassificationIndexEntry>>;
  /** Atomically commits a set of (re)classified entries. */
  commit(
    entries: readonly ClassificationIndexEntry[],
  ): Promise<ClassificationIndex>;
  /** Returns refs that are missing or whose fingerprint changed. */
  needsClassification(
    refs: readonly string[],
    currentFingerprints: ReadonlyMap<string, string | null>,
  ): Promise<string[]>;
  clear(): Promise<void>;
}
