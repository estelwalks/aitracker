import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { SystemClock } from "../platform/persistence/clock.ts";
import type { Clock } from "../platform/persistence/contracts.ts";
import { NodeAtomicJsonStore } from "../platform/persistence/infrastructure/node-atomic-json-store.ts";
import { createExecutorRegistry } from "../modules/tasks/application/executor-registry/index.ts";
import { createTaskScheduler } from "../modules/tasks/application/scheduler.ts";
import {
  DEFAULT_TASK_PREFERENCES,
  DEFAULT_TASK_RUNS,
  preferenceSchema,
  taskRunsSchema,
  type TaskPreferenceRepository,
  type TaskRunRepository,
} from "../modules/tasks/application/task-storage.ts";
import { createTaskPreferenceRepository } from "../modules/tasks/infrastructure/task-preference-repository.ts";
import { createTaskRunRepository } from "../modules/tasks/infrastructure/task-run-repository.ts";
import type { TaskScheduler } from "../modules/tasks/application/scheduler.ts";
import {
  createAiExecutor,
  type AIExecutorPort,
} from "../modules/ai-orchestration/ai-executor.ts";
import {
  createProviderRegistry,
  createRegistryRouter,
  offlineProvider,
} from "../modules/ai-orchestration/provider-registry.ts";
import { deterministicOfflineFallback } from "../modules/ai-orchestration/application.ts";
import { createReportsApplication } from "../modules/reports/application/index.ts";
import type { ReportsApplication } from "../modules/reports/index.ts";
import {
  DEFAULT_REPORT_FILE,
  createAtomicReportStore,
  reportStoreSchema,
} from "../modules/reports/infrastructure/atomic-report-store.ts";
import { createReportGenerationPort } from "../modules/reports/infrastructure/ai-generation-adapter.ts";
import { createReportContextPort } from "../modules/reports/infrastructure/usage-context-adapter.ts";

/**
 * Server-only composition root for the background task scheduler.
 *
 * This module wires the already-implemented, fully-tested scheduler,
 * executor registry and task repositories into a single production object
 * graph. It is deliberately the ONLY place that knows how these pieces fit
 * together; everything below it remains framework-neutral and independently
 * testable. It is named `*.server.ts` so TanStack Start / Nitro keep it off
 * the browser bundle — do NOT import the `server-only` package (ESLint bans
 * it; the suffix is sufficient).
 *
 * Privacy: the persisted files hold only task ids, run counts and stable
 * error codes (enforced by `taskRunsSchema` / `preferenceSchema`). No
 * conversation content, tokens, absolute paths or commands are stored. The
 * data-root resolution uses `$HOME`-relative storage, mirroring the
 * existing `local-usage` scanners.
 */

/** Shape of the assembled scheduler object graph. */
export interface CompositionRoot {
  /** The background task scheduler. `start()` is NOT called by this module. */
  readonly scheduler: TaskScheduler;
  readonly preferences: TaskPreferenceRepository;
  readonly runs: TaskRunRepository;
  /**
   * AI executor for distillation/reports. Backed by the provider registry with
   * the offline provider registered, so consumers get a deterministic fallback
   * response until a real provider is registered.
   */
  readonly aiExecutor: AIExecutorPort;
  /**
   * Reports application. Backed by an AtomicJsonStore-backed report store, the
   * AI generation adapter (using `aiExecutor`) and the offline context port.
   * Generation currently runs against the deterministic offline model.
   */
  readonly reports: ReportsApplication;
  /** Resolved data root (`process.env.TRUSTTOOLS_USAGE_HOME ?? homedir()`). */
  readonly dataRoot: string;
}

const COMPOSITION_GLOBAL = "__TRUSTTOOLS_COMPOSITION__" as const;

let composition: CompositionRoot | undefined;

type CompositionGlobal = Record<
  typeof COMPOSITION_GLOBAL,
  Promise<CompositionRoot> | undefined
>;

function readGlobalCache(): Promise<CompositionRoot> | undefined {
  const g = globalThis as unknown as Partial<CompositionGlobal>;
  return g[COMPOSITION_GLOBAL];
}

function writeGlobalCache(value: Promise<CompositionRoot> | undefined): void {
  const g = globalThis as unknown as CompositionGlobal;
  g[COMPOSITION_GLOBAL] = value;
}

async function buildCompositionRoot(clock: Clock): Promise<CompositionRoot> {
  const dataRoot = process.env.TRUSTTOOLS_USAGE_HOME ?? homedir();
  const tasksDir = join(dataRoot, ".trusttools", "tasks");
  // Lazy: ensured on first construction so a fresh install incurs no I/O
  // until the scheduler is actually requested. `recursive: true` is a no-op
  // when the directory already exists.
  await mkdir(tasksDir, { recursive: true });

  const preferencesStore = new NodeAtomicJsonStore({
    filePath: join(tasksDir, "preferences.v1.json"),
    defaultValue: DEFAULT_TASK_PREFERENCES,
    schema: preferenceSchema(clock),
    clock,
  });
  const runsStore = new NodeAtomicJsonStore({
    filePath: join(tasksDir, "runs.v1.json"),
    defaultValue: DEFAULT_TASK_RUNS,
    schema: taskRunsSchema(),
    clock,
  });

  const preferences = createTaskPreferenceRepository({
    store: preferencesStore,
    clock,
  });
  const runs = createTaskRunRepository({ store: runsStore, clock });

  // AI orchestration: register the deterministic offline provider by default so
  // distillation/reports get a stable fallback. A real provider can be
  // registered later without touching this wiring.
  const aiRegistry = createProviderRegistry([offlineProvider]);
  const aiExecutor = createAiExecutor({
    router: createRegistryRouter(aiRegistry),
    offlineFallback: deterministicOfflineFallback,
  });

  // Reports: assemble the application after aiExecutor so the generation
  // adapter can depend on it. The store lives next to the task runs under the
  // same `.trusttools/tasks` directory so all scheduler state is co-located.
  const reportsStore = new NodeAtomicJsonStore({
    filePath: join(tasksDir, "reports.v1.json"),
    defaultValue: DEFAULT_REPORT_FILE,
    schema: reportStoreSchema(),
    clock,
  });
  const reports = createReportsApplication({
    store: createAtomicReportStore({ store: reportsStore }),
    context: createReportContextPort(),
    generation: createReportGenerationPort({ ai: aiExecutor }),
    now: () => new Date(),
    createId: (prefix) => `${prefix}:${randomUUID()}`,
  });

  // TODO(usage-migration): inject the real `usage` application once the
  // local-usage scanner ports land (follow-up task). Until then the usage/
  // sessions/skills/retention executors resolve to a safe `unavailable` state.
  // `reports` IS wired above, so `reports.generate` runs end-to-end against the
  // offline model. Passing only `reports` is intentional and is NOT a
  // placeholder for synthetic collectors.
  const executorRegistry = createExecutorRegistry({ reports });

  const scheduler = createTaskScheduler({
    preferences,
    runs,
    clock,
    executors: executorRegistry.executors,
  });

  return { scheduler, preferences, runs, aiExecutor, reports, dataRoot };
}

/**
 * Returns the singleton composition root, constructing it lazily on first
 * call. Idempotent across concurrent callers and resilient to SSR hot
 * reloads by also caching the in-flight promise on `globalThis`.
 *
 * `scheduler.start()` is intentionally NOT called here — starting the
 * background runtime is the bootstrap layer's responsibility so that the
 * `RuntimeIdentity` policy gate stays the single decision point.
 */
export function getCompositionRoot(): Promise<CompositionRoot> {
  if (composition) return Promise.resolve(composition);

  const cached = readGlobalCache();
  if (cached) {
    // Share the in-flight construction across HMR boundaries, but keep the
    // resolved module-level singleton as the authoritative handle.
    return cached.then((root) => {
      if (!composition) composition = root;
      return root;
    });
  }

  const clock = new SystemClock();
  const promise = buildCompositionRoot(clock)
    .then((root) => {
      composition = root;
      return root;
    })
    // A construction failure must never poison the global cache: clear it
    // so the next call can retry. The module-level singleton stays unset.
    .catch((error: unknown) => {
      writeGlobalCache(undefined);
      throw error;
    });

  writeGlobalCache(promise);
  return promise;
}

/**
 * Clears both the module-level and `globalThis` caches. Intended ONLY for
 * tests that need to exercise repeated construction against an isolated
 * data root. Never call this from production code.
 */
export function resetCompositionRootForTests(): void {
  composition = undefined;
  writeGlobalCache(undefined);
}
