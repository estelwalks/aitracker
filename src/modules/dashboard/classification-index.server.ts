import type {
  AtomicJsonStore,
  JsonSchema,
} from "../../platform/persistence/contracts.ts";

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

export const DEFAULT_CLASSIFICATION_INDEX: ClassificationIndex = {
  schemaVersion: 1,
  revision: 0,
  entries: {},
};

export const classificationIndexSchema: JsonSchema<ClassificationIndex> = {
  currentVersion: 1,
  parse(value: unknown): ClassificationIndex {
    const index = value as ClassificationIndex;
    if (
      typeof index !== "object" ||
      index === null ||
      index.schemaVersion !== 1 ||
      typeof index.revision !== "number" ||
      typeof index.entries !== "object" ||
      index.entries === null
    ) {
      throw new TypeError("Invalid classification index");
    }
    return index;
  },
};

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

export function createClassificationIndexRepository(
  store: AtomicJsonStore<ClassificationIndex>,
): ClassificationIndexRepository {
  let cached: ClassificationIndex | undefined;

  const read = async (): Promise<ClassificationIndex> => {
    if (cached) return cached;
    const result = await store.read();
    cached = result.value;
    return cached;
  };

  return {
    async get(ref) {
      const index = await read();
      return index.entries[ref];
    },
    async getMany(refs) {
      const index = await read();
      const found = new Map<string, ClassificationIndexEntry>();
      for (const ref of refs) {
        const entry = index.entries[ref];
        if (entry) found.set(ref, entry);
      }
      return found;
    },
    async commit(entries) {
      const index = await read();
      const next: ClassificationIndex = {
        schemaVersion: 1,
        revision: index.revision + 1,
        entries: { ...index.entries },
      };
      for (const entry of entries) next.entries[entry.ref] = entry;
      await store.write(next);
      cached = next;
      return next;
    },
    async needsClassification(refs, currentFingerprints) {
      const index = await read();
      const missing: string[] = [];
      for (const ref of refs) {
        const entry = index.entries[ref];
        const fingerprint = currentFingerprints.get(ref) ?? null;
        if (!entry || entry.fingerprint !== fingerprint) missing.push(ref);
      }
      return missing;
    },
    async clear() {
      cached = undefined;
      await store.write(DEFAULT_CLASSIFICATION_INDEX);
    },
  };
}
