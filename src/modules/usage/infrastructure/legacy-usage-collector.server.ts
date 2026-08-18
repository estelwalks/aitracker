import type { LocalUsageScanOptions } from "../../../lib/local-usage/scanner.server.ts";
import type {
  SnapshotRepository,
  UsageCollectionRequest,
  UsageCollectionResult,
  UsageCollector,
  UsageHealthSummary,
  UsageSnapshotDto,
} from "../contracts.ts";
import {
  createLegacyUsageScanner,
  toPublicUsageSnapshot,
  type LegacyUsageScanner,
} from "./legacy-usage-adapter.server.ts";
import { isCancellation } from "../../../platform/runtime/abort.ts";

export interface LegacyUsageCollectorOptions {
  readonly scanner?: LegacyUsageScanner;
  readonly repository?: SnapshotRepository;
  readonly now?: () => number;
}

const EMPTY_SNAPSHOT: UsageSnapshotDto = {
  generatedAt: new Date(0).toISOString(),
  mode: "empty",
  sources: [],
  events: 0,
  totals: {
    events: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  },
  bySource: [],
  byModel: [],
  byProject: [],
  daily: [],
  details: [],
  recent: [],
};

function health(snapshot: UsageSnapshotDto): UsageHealthSummary {
  const diagnostics = snapshot.sources.flatMap((source) =>
    (source.diagnostics ?? []).map((diagnostic) => diagnostic.code),
  );
  const availableSourceCount = snapshot.sources.filter(
    (source) => source.available,
  ).length;
  const failedSourceCount = snapshot.sources.filter((source) =>
    (source.diagnostics ?? []).some(
      (diagnostic) => diagnostic.code === "read-failed",
    ),
  ).length;
  return {
    status:
      failedSourceCount > 0
        ? "degraded"
        : availableSourceCount === 0
          ? "unavailable"
          : "healthy",
    sourceCount: snapshot.sources.length,
    availableSourceCount,
    failedSourceCount,
    diagnostics: [...new Set(diagnostics)],
  };
}

function abortError(): Error {
  return new Error("usage:cancelled");
}

/**
 * P5-T5-02: real budget enforcement. The scanner receives the caller's signal
 * (so directory loops and file reads can stop), and a timeout signal aborts
 * the same operation. `Promise.race` would leave the scan running — it is
 * deliberately not used here.
 */
function withBudget<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  request: UsageCollectionRequest,
): Promise<{ value?: T; budgetExhausted: boolean; cancelled: boolean }> {
  const signal = request.signal;
  if (signal?.aborted) return Promise.reject(abortError());
  const maxDurationMs = request.budget?.maxDurationMs;
  if (maxDurationMs == null || maxDurationMs <= 0) {
    return operation(signal ?? new AbortController().signal).then((value) => ({
      value,
      budgetExhausted: false,
      cancelled: false,
    }));
  }
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let budgetExhausted = false;
    const onParentAbort = () => {
      clearTimeout(timeout);
      controller.abort();
    };
    const onTimeout = () => {
      budgetExhausted = true;
      controller.abort();
    };
    const timeout = setTimeout(onTimeout, maxDurationMs);
    signal?.addEventListener("abort", onParentAbort, { once: true });
    controller.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onParentAbort);
        if (budgetExhausted)
          resolve({ budgetExhausted: true, cancelled: false });
        else reject(abortError());
      },
      { once: true },
    );
    operation(controller.signal).then(
      (value) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onParentAbort);
        if (budgetExhausted)
          resolve({ budgetExhausted: true, cancelled: false });
        else resolve({ value, budgetExhausted: false, cancelled: false });
      },
      (error) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onParentAbort);
        if (isCancellation(error) || budgetExhausted) {
          if (budgetExhausted)
            resolve({ budgetExhausted: true, cancelled: false });
          else reject(error);
        } else reject(error);
      },
    );
  });
}

export function createLegacyUsageCollector(
  options: LegacyUsageCollectorOptions = {},
): UsageCollector {
  const scanner = options.scanner ?? createLegacyUsageScanner();
  const now = options.now ?? Date.now;
  return {
    async collect(request = {}): Promise<UsageCollectionResult> {
      const startedAt = now();
      const scanInput = request.scannerOptions;
      const scannerOptions: LocalUsageScanOptions = {
        homeDirectory: scanInput?.homeDirectory,
        additionalHomeDirectories:
          scanInput?.additionalHomeDirectories == null
            ? undefined
            : [...scanInput.additionalHomeDirectories],
        claudeConfigDirectory: scanInput?.claudeConfigDirectory,
        codexHomeDirectory: scanInput?.codexHomeDirectory,
        now: scanInput?.now,
        lookbackDays: scanInput?.lookbackDays,
        cacheDirectory: scanInput?.cacheDirectory,
        disablePersistentCache: scanInput?.disablePersistentCache,
        ...(scanInput?.wslTopology
          ? { wslTopology: scanInput.wslTopology }
          : {}),
        ...(request.budget?.maxFilesPerSource == null
          ? {}
          : { maxFilesPerSource: request.budget.maxFilesPerSource }),
      };
      try {
        const outcome = await withBudget(
          (signal) => scanner.scan({ ...scannerOptions, signal }),
          request,
        );
        if (outcome.budgetExhausted || outcome.value == null) {
          const previous = (await options.repository?.load()) ?? EMPTY_SNAPSHOT;
          return {
            snapshot: previous,
            health: health(previous),
            durationMs: Math.max(0, now() - startedAt),
            budgetExhausted: true,
            cancelled: false,
            retainedPreviousSnapshot: options.repository != null,
          };
        }
        const snapshot = toPublicUsageSnapshot(outcome.value);
        const currentHealth = health(snapshot);
        if (currentHealth.status !== "healthy" && options.repository != null) {
          const previous = await options.repository.load();
          if (previous != null) {
            return {
              snapshot: previous,
              health: currentHealth,
              durationMs: Math.max(0, now() - startedAt),
              budgetExhausted: false,
              cancelled: false,
              retainedPreviousSnapshot: true,
            };
          }
        }
        await options.repository?.save(snapshot);
        return {
          snapshot,
          health: currentHealth,
          durationMs: Math.max(0, now() - startedAt),
          budgetExhausted: false,
          cancelled: false,
          retainedPreviousSnapshot: false,
        };
      } catch (error) {
        const cancelled =
          error instanceof Error && error.message === "usage:cancelled";
        const previous = (await options.repository?.load()) ?? EMPTY_SNAPSHOT;
        return {
          snapshot: previous,
          health: health(previous),
          durationMs: Math.max(0, now() - startedAt),
          budgetExhausted: false,
          cancelled,
          retainedPreviousSnapshot: options.repository != null,
        };
      }
    },
  };
}
