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
import { createResourceBudget } from "../../platform/runtime/resource-budget.ts";

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
  classify(refs: readonly string[]): Promise<IncrementalClassificationResult>;
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
    async classify(refs) {
      // 1. Normalize to unique, resolvable references. Refs that cannot be
      // resolved to a directory are recorded as unknown without probing.
      const unique = [
        ...new Set(refs.map((ref) => ref.trim()).filter(Boolean)),
      ];
      const normalized = new Map<string, string>();
      for (const ref of unique) {
        const path = normaliseProjectRefFor(pathImpl, ref, home);
        if (path != null) normalized.set(ref, path);
      }
      const resolvable = [...normalized.keys()];
      const unresolvable = unique.filter((ref) => !normalized.has(ref));

      // 2. Compute fingerprints for all resolvable refs.
      const fingerprints = new Map<string, string | null>();
      await Promise.all(
        [...normalized.entries()].map(async ([ref, path]) => {
          fingerprints.set(ref, await fingerprintOf(path));
        }),
      );

      // 3. Only missing/changed resolvable refs need probing.
      const missing = await repository.needsClassification(
        resolvable,
        fingerprints,
      );
      const reused = resolvable.length - missing.length;

      // 4. Probe with a bounded worker pool (max 8 classifiers).
      let probed = 0;
      let failed = 0;
      const entries: ClassificationIndexEntry[] = [];
      for (const ref of unresolvable) {
        entries.push({
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
        8, // policy: resourceBudgets.maxProjectClassifiers
      );
      const workers = Array.from({ length: workerCount }, async () => {
        while (cursor < missing.length) {
          const ref = missing[cursor++];
          if (ref == null) continue;
          const release = await budget.acquire("classifier");
          try {
            const classification = await classifyDashboardProjectRef(ref, {
              home,
              platform: options.platform,
            });
            probed += 1;
            entries.push({
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
      if (entries.length > 0) await repository.commit(entries);
      return { probed, reused, failed, total: unique.length };
    },
  };
}
