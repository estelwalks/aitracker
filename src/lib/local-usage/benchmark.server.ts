import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { scanLocalUsage } from "./scanner.server.ts";
import type { LocalUsageSnapshot } from "./types.ts";

interface BenchmarkScan {
  durationMs: number;
  snapshot: LocalUsageSnapshot;
}

export interface LocalUsageCacheBenchmark {
  coldMs: number;
  warmMs: number;
  filesParsedCold: number;
  filesParsedWarm: number;
  filesReusedWarm: number;
  events: number;
  totalTokens: number;
}

function comparableSnapshot(snapshot: LocalUsageSnapshot): unknown {
  return {
    ...snapshot,
    generatedAt: undefined,
    sources: snapshot.sources.map(
      ({ filesParsed: _filesParsed, filesReused: _filesReused, ...source }) =>
        source,
    ),
  };
}

async function timedScan(
  cacheDirectory: string,
  now: Date,
): Promise<BenchmarkScan> {
  const startedAt = performance.now();
  const snapshot = await scanLocalUsage({ cacheDirectory, now });
  return {
    durationMs: performance.now() - startedAt,
    snapshot,
  };
}

export async function benchmarkLocalUsagePersistentCache(): Promise<LocalUsageCacheBenchmark> {
  const cacheDirectory = `benchmark-${Date.now()}-${Math.random()}`;
  const now = new Date();
  const cold = await timedScan(cacheDirectory, now);
  const warm = await timedScan(cacheDirectory, now);
  assert.deepEqual(
    comparableSnapshot(warm.snapshot),
    comparableSnapshot(cold.snapshot),
  );
  return {
    coldMs: cold.durationMs,
    warmMs: warm.durationMs,
    filesParsedCold: cold.snapshot.sources.reduce(
      (total, source) => total + source.filesParsed,
      0,
    ),
    filesParsedWarm: warm.snapshot.sources.reduce(
      (total, source) => total + source.filesParsed,
      0,
    ),
    filesReusedWarm: warm.snapshot.sources.reduce(
      (total, source) => total + source.filesReused,
      0,
    ),
    events: warm.snapshot.events,
    totalTokens: warm.snapshot.totals.totalTokens,
  };
}
