import type { ClassificationIndexRepository } from "./classification-index.server.ts";
import type { IncrementalClassifier } from "./incremental-classifier.server.ts";
import type { DashboardProjectClassification } from "./project-classification.server.ts";

/**
 * P3-T3-06: classification service.
 *
 * Query paths resolve project classifications from the persisted index (O(1)
 * per ref, no filesystem probing); the Usage refresh task feeds observed refs
 * through `classifyIncrementally` so new/changed projects are classified in
 * the background with a bounded worker pool.
 */

export interface ClassificationService {
  /** O(1) read of classifications for the given refs. */
  resolve(
    refs: readonly string[],
  ): Promise<ReadonlyMap<string, DashboardProjectClassification>>;
  /** Incremental background classification (Usage refresh path). */
  classifyIncrementally(
    refs: readonly string[],
    signal?: AbortSignal,
  ): Promise<{
    readonly probed: number;
    readonly reused: number;
    readonly failed: number;
    readonly total: number;
  }>;
}

export function createClassificationService(options: {
  readonly repository: ClassificationIndexRepository;
  readonly classifier: IncrementalClassifier;
}): ClassificationService {
  return {
    async resolve(refs) {
      const unique = [...new Set(refs.filter(Boolean))];
      const found = await options.repository.getMany(unique);
      const result = new Map<string, DashboardProjectClassification>();
      for (const ref of unique) {
        const entry = found.get(ref);
        // A missing entry means classification is pending, not that the
        // reference was verified as unknown. Omit it so the dashboard can
        // retain its safe display fallback while the index is backfilled.
        if (entry) {
          result.set(ref, { kind: entry.kind, label: entry.label });
        }
      }
      return result;
    },
    async classifyIncrementally(refs, signal) {
      return options.classifier.classify(refs, signal);
    },
  };
}
