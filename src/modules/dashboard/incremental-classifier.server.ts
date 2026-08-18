import { stat } from "node:fs/promises";

import {
  classifyDashboardProjectRef,
  normaliseProjectRefFor,
  pathImplForPlatform,
} from "./project-classification.server.ts";
import type {
  ClassificationIndexEntry,
  ClassificationIndexRepository,
} from "./classification-index.server.ts";
import { RUNTIME_POLICY } from "../../app/runtime-policy.generated.ts";
import { createResourceBudget } from "../../platform/runtime/resource-budget.ts";

/** Bounded stat pool for fingerprint computation (P5-T5-07). */
const MAX_FINGERPRINT_WORKERS = 8;

/**
 * P3-T3-06: incremental project classification.
 *
 * Usage refresh feeds the observed project references here; the classifier
 * only probes references that are new or whose directory fingerprint changed
 * (mtime), and never more than `maxProjectClassifiers` (8) concurrently.
 * Dashboard queries then read the index (O(1)) instead of probing the
 * filesystem.
 */

export interface IncrementalClassificationResult {
  readonly probed: number;
  readonly reused: number;
  readonly failed: number;
  readonly total: number;
}

export interface IncrementalClassifierOptions {
  readonly repository: ClassificationIndexRepository;
  readonly homeDirectory?: string;
  readonly platform?: NodeJS.Platform;
  readonly now?: () => Date;
  /** Test seam; defaults to stat-based mtime fingerprints. */
  readonly fingerprintOf?: (directory: string) => Promise<string | null>;
}

export interface IncrementalClassifier {
  /** Classifies only missing/changed refs; returns reuse/probe counts. */
  classify(
    refs: readonly string[],
    signal?: AbortSignal,
  ): Promise<IncrementalClassificationResult>;
}

async function directoryFingerprint(directory: string): Promise<string | null> {
  try {
    const result = await stat(directory);
    return result.isDirectory() ? String(result.mtimeMs) : null;
  } catch {
    return null;
  }
}

export function createIncrementalClassifier(
  options: IncrementalClassifierOptions,
): IncrementalClassifier {
  const repository = options.repository;
  const home = options.homeDirectory ?? process.env.HOME ?? "";
  const pathImpl = pathImplForPlatform(options.platform ?? process.platform);
  const now = options.now ?? (() => new Date());
  const fingerprintOf = options.fingerprintOf ?? directoryFingerprint;
  const budget = createResourceBudget();

  return {
    async classify(refs, signal) {
      signal?.throwIfAborted();
      // 1. Normalize to unique, resolvable references. Refs that cannot be
      // resolved to a directory are recorded as unknown without probing.
      const unique = [
        ...new Set(refs.map((ref) => ref.trim()).filter(Boolean)),
      ];
      const normalized = new Map<string, string>();
      for (const ref of unique) {
        signal?.throwIfAborted();
        const path = normaliseProjectRefFor(pathImpl, ref, home);
        if (path != null) normalized.set(ref, path);
      }
      const resolvable = [...normalized.keys()];
      const unresolvable = unique.filter((ref) => !normalized.has(ref));

      // 2. Compute fingerprints for all resolvable refs with a bounded pool
      // (P5-T5-07: no unbounded Promise.all over the refs; each stat counts as
      // a "file"-class operation under the runtime policy budget).
      const fingerprints = new Map<string, string | null>();
      const entries = [...normalized.entries()];
      let fingerprintCursor = 0;
      const fingerprintWorkers = Array.from(
        { length: Math.min(entries.length, MAX_FINGERPRINT_WORKERS) },
        async () => {
          while (fingerprintCursor < entries.length) {
            signal?.throwIfAborted();
            const item = entries[fingerprintCursor++];
            if (item == null) continue;
            const release = await budget.acquire("file");
            try {
              fingerprints.set(item[0], await fingerprintOf(item[1]));
            } finally {
              release();
            }
          }
        },
      );
      await Promise.all(fingerprintWorkers);
      signal?.throwIfAborted();

      // 3. Only missing/changed resolvable refs need probing.
      const missing = await repository.needsClassification(
        resolvable,
        fingerprints,
      );
      const reused = resolvable.length - missing.length;

      // 4. Probe with a bounded worker pool (max 8 classifiers).
      let probed = 0;
      let failed = 0;
      const entriesToCommit: ClassificationIndexEntry[] = [];
      for (const ref of unresolvable) {
        entriesToCommit.push({
          ref,
          kind: "unknown",
          label: "unknown",
          classifiedAt: now().toISOString(),
          fingerprint: null,
        });
      }
      let cursor = 0;
      const workerCount = Math.min(
        missing.length,
        // policy: resourceBudgets.maxProjectClassifiers
        RUNTIME_POLICY.resourceBudgets.maxProjectClassifiers,
      );
      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < missing.length) {
          signal?.throwIfAborted();
          const ref = missing[cursor++];
          if (ref == null) continue;
          const release = await budget.acquire("classifier");
          try {
            const classification = await classifyDashboardProjectRef(ref, {
              home,
              platform: options.platform,
            });
            probed += 1;
            entriesToCommit.push({
              ref,
              kind: classification.kind,
              label: classification.label,
              classifiedAt: now().toISOString(),
              fingerprint: fingerprints.get(ref) ?? null,
            });
          } catch {
            failed += 1;
          } finally {
            release();
          }
        }
      });
      await Promise.all(workers);

      // 5. Commit only what was probed or recorded as unknown.
      if (entriesToCommit.length > 0) await repository.commit(entriesToCommit);
      return { probed, reused, failed, total: unique.length };
    },
  };
}
