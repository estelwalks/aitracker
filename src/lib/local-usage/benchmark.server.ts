import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  cacheBytes: number;
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
  const cacheDirectory = await mkdtemp(
    join(tmpdir(), "trusttools-local-usage-"),
  );
  const now = new Date();

  try {
    const cold = await timedScan(cacheDirectory, now);
    const warm = await timedScan(cacheDirectory, now);
    assert.deepEqual(
      comparableSnapshot(warm.snapshot),
      comparableSnapshot(cold.snapshot),
    );

    const cacheFile = await stat(
      join(cacheDirectory, "local-usage-index-v10.json"),
    );
    return {
      coldMs: cold.durationMs,
      warmMs: warm.durationMs,
      cacheBytes: cacheFile.size,
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
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
}
