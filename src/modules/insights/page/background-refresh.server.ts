/** Persistent, renderer-independent orchestration for "refresh today's insights". */
import type { Locale } from "../../../lib/i18n/locale.ts";
import type {
  InsightEnvelopeStatus,
  InsightScope,
  InsightSurfaceId,
} from "./contracts.ts";
import { INSIGHT_SURFACE_IDS } from "./contracts.ts";
import type { PageInsightsApplication } from "./application.ts";
import type {
  InsightRefreshRunView,
  InsightRefreshWorkItem,
  InsightRefreshItemView,
  SqliteInsightRepository,
} from "../infrastructure/sqlite-insight-repository.server.ts";

export interface InsightRefreshBatchService {
  start(locale: Locale): Promise<{
    readonly created: boolean;
    readonly run: InsightRefreshRunView;
  }>;
  /** Run view plus per-surface execution state (renderer progress display). */
  get(runId: string):
    | (InsightRefreshRunView & {
        readonly items: readonly InsightRefreshItemView[];
      })
    | undefined;
}

type BatchScheduler = (work: () => void | Promise<void>) => void;

const DEFAULT_SCOPE_JSON = JSON.stringify({});

/**
 * How many surfaces the batch processes concurrently. Each item still goes
 * through the enhancer's own bounded pool; this keeps the total model
 * concurrency at `min(BATCH_CONCURRENCY, maxConcurrentRequests)`.
 */
const BATCH_CONCURRENCY = 3;

function defaultItems(): readonly InsightRefreshWorkItem[] {
  return INSIGHT_SURFACE_IDS.map((surfaceId) => ({
    surfaceId,
    scopeJson: DEFAULT_SCOPE_JSON,
  }));
}

function itemOutcome(
  status: InsightEnvelopeStatus,
): "completed" | "failed" | "skipped" {
  if (status === "enhanced-ready" || status === "enhanced-cached") {
    return "completed";
  }
  if (
    status === "no-eligible-candidates" ||
    status === "enhancer-unavailable" ||
    status === "rules" ||
    status === "pending"
  ) {
    return "skipped";
  }
  return "failed";
}

function parseScope(scopeJson: string): InsightScope {
  try {
    const parsed: unknown = JSON.parse(scopeJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as InsightScope)
      : {};
  } catch {
    return {};
  }
}

export function createInsightRefreshBatchService(options: {
  readonly application: PageInsightsApplication;
  readonly store: SqliteInsightRepository;
  readonly items?: readonly InsightRefreshWorkItem[];
  readonly now?: () => number;
  readonly createId?: () => string;
  readonly schedule?: BatchScheduler;
}): InsightRefreshBatchService {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const items = options.items ?? defaultItems();
  const schedule =
    options.schedule ??
    ((work: () => void) => {
      setTimeout(work, 0);
    });
  const scheduled = new Set<string>();

  function requiredStoreMethods() {
    const { store } = options;
    if (
      !store.startRefreshRun ||
      !store.getRefreshRun ||
      !store.listRefreshItems ||
      !store.startRefreshItem ||
      !store.finishRefreshItem
    ) {
      throw new Error("insight refresh persistence unavailable");
    }
    return {
      startRefreshRun: store.startRefreshRun.bind(store),
      getRefreshRun: store.getRefreshRun.bind(store),
      listRefreshItems: store.listRefreshItems.bind(store),
      startRefreshItem: store.startRefreshItem.bind(store),
      finishRefreshItem: store.finishRefreshItem.bind(store),
    };
  }

  async function run(runId: string, locale: Locale): Promise<void> {
    const store = requiredStoreMethods();
    const items = store.listRefreshItems(runId);
    let cursor = 0;
    const processItem = async (item: InsightRefreshWorkItem) => {
      if (!store.startRefreshItem(runId, item, now())) return;
      let resultStatus: InsightEnvelopeStatus = "enhancer-failed";
      let resultDetail: string | undefined;
      try {
        const envelope = await options.application.enhance(
          item.surfaceId as InsightSurfaceId,
          parseScope(item.scopeJson),
          { locale, reason: "batch" },
        );
        resultStatus = envelope.status;
        if (envelope.failureDetail !== undefined) {
          resultDetail = envelope.failureDetail;
        }
      } catch {
        // The status is intentionally stable and renderer-safe. Provider
        // diagnostics are recorded separately by AI execution auditing.
      }
      store.finishRefreshItem({
        runId,
        item,
        status: itemOutcome(resultStatus),
        resultStatus,
        ...(resultDetail !== undefined ? { resultDetail } : {}),
        nowMs: now(),
      });
    };
    try {
      // Claimed once per item (startRefreshItem is conditional); a small
      // worker pool keeps model concurrency bounded while the batch no longer
      // serializes all 14 surfaces behind a single LLM call each.
      const workers = Array.from({ length: BATCH_CONCURRENCY }, async () => {
        while (cursor < items.length) {
          const item = items[cursor]!;
          cursor += 1;
          await processItem(item);
        }
      });
      await Promise.all(workers);
    } finally {
      scheduled.delete(runId);
    }
  }

  function ensureScheduled(batch: InsightRefreshRunView): void {
    if (batch.status === "completed" || scheduled.has(batch.runId)) return;
    scheduled.add(batch.runId);
    schedule(() => {
      return run(batch.runId, batch.locale as Locale);
    });
  }

  return {
    async start(locale) {
      const store = requiredStoreMethods();
      const result = store.startRefreshRun({
        runId: createId(),
        locale,
        items,
        nowMs: now(),
      });
      ensureScheduled(result.run);
      return result;
    },
    get(runId) {
      const store = requiredStoreMethods();
      const run = store.getRefreshRun(runId);
      if (run === undefined) return undefined;
      return { ...run, items: store.listRefreshItems(runId) };
    },
  };
}

let cachedService:
  | { readonly root: unknown; readonly service: InsightRefreshBatchService }
  | undefined;

async function applicationService(): Promise<InsightRefreshBatchService> {
  const { getCompositionRoot } =
    await import("../../../app/composition.server.ts");
  const { getPageInsightsApplication } =
    await import("../../../app/insight-registry.server.ts");
  const root = await getCompositionRoot();
  if (cachedService?.root === root) return cachedService.service;
  const service = createInsightRefreshBatchService({
    application: await getPageInsightsApplication(),
    store: root.database.features.insights,
  });
  cachedService = { root, service };
  return service;
}

export async function startPageInsightRefreshBatch(
  locale: Locale,
): Promise<{ readonly created: boolean; readonly run: InsightRefreshRunView }> {
  return (await applicationService()).start(locale);
}

export async function getPageInsightRefreshBatch(runId: string): Promise<
  | (InsightRefreshRunView & {
      readonly items: readonly InsightRefreshItemView[];
    })
  | undefined
> {
  return (await applicationService()).get(runId);
}

export function resetInsightRefreshBatchServiceForTests(): void {
  cachedService = undefined;
}
