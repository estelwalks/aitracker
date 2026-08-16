import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { APP_DATA_DIR, APP_ID, ENV } from "../lib/app-config.ts";
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
import {
  createProfileBackedProvider,
  getModelProfileRepository,
  type ModelProfileRepository,
} from "../modules/ai-orchestration/model-profile.server.ts";
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
import { createKnowledgeRepository } from "../modules/knowledge/application/index.ts";
import type { KnowledgeRepository } from "../modules/knowledge/contracts.ts";
import {
  DEFAULT_KNOWLEDGE_DOCUMENT,
  knowledgeDocumentSchema,
} from "../modules/knowledge/infrastructure/atomic-knowledge-store.ts";
import { createSha256HashPort } from "../modules/knowledge/infrastructure/hash-port.server.ts";
import { createDistillationApplication } from "../modules/distillation/application/index.ts";
import type { DistillationApplication } from "../modules/distillation/index.ts";
import {
  DEFAULT_DISTILL_CANDIDATE_FILE,
  createAtomicCandidateStore,
  distillCandidateStoreSchema,
} from "../modules/distillation/infrastructure/atomic-candidate-store.ts";
import { createSessionQueryService } from "../modules/sessions/index.ts";
import type {
  ResumeSessionPort,
  SessionQueryPort,
} from "../modules/sessions/contracts.ts";
import {
  createLegacyResumeSessionPort,
  createLegacySessionRepository,
} from "../modules/sessions/infrastructure/legacy-session-adapter.server.ts";
import { createNodeResumeExecutor } from "../modules/sessions/infrastructure/node-resume-executor.server.ts";
import {
  createUsageApplication,
  type UsageApplication,
  type UsageSnapshotDto,
} from "../modules/usage/index.ts";
import { createNullableAtomicSnapshotRepository } from "../modules/usage/infrastructure/atomic-snapshot-repository.ts";
import { createLegacyUsageCollector } from "../modules/usage/infrastructure/legacy-usage-collector.server.ts";
import { scanLocalSkills } from "../lib/local-skills/scanner.server.ts";
import type { MonitoringRuntime } from "../modules/monitoring/index.ts";
import { createMonitoringRuntime } from "../modules/monitoring/application/index.ts";
import {
  createAtomicMonitoringStatusStore,
  monitoringStatusSchema,
} from "../modules/monitoring/infrastructure.ts";

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
   * Multi-profile model configuration store (S-500). Profiles persist under
   * `~/.trusttools/tasks/model-profiles.v1.json` (0600 perms); renderer-facing
   * reads return key-free projections. The registry's `profile` provider
   * resolves executions through this repository.
   */
  readonly modelProfiles: ModelProfileRepository;
  /**
   * Reports application. Backed by an AtomicJsonStore-backed report store, the
   * AI generation adapter (using `aiExecutor`) and the offline context port.
   * Generation currently runs against the deterministic offline model.
   */
  readonly reports: ReportsApplication;
  /**
   * Distillation application. Backed by the legacy local-sessions repository
   * (wrapped as a `SessionQueryPort`), `aiExecutor`, an AtomicJsonStore-backed
   * knowledge repository and an AtomicJsonStore-backed candidate store.
   * Candidates are hydrated from `distill-candidates.v1.json` on construction
   * and every start/approve/cancel writes through; approval is the only path
   * that writes to the knowledge repository.
   */
  readonly distillation: DistillationApplication;
  /**
   * Knowledge repository backing the memory hub and distillation approval
   * writes. Persists only privacy-filtered metadata — asset ids, kinds,
   * titles, opaque content hashes and provenance summaries — never
   * conversation content (the content itself is only hashed, see
   * `createDraft` in the knowledge application layer).
   */
  readonly knowledge: KnowledgeRepository;
  /**
   * Session query port shared by the distillation workbench. Backed by the
   * same legacy local-sessions scanner as `/sessions`. Exposed so the
   * distillation transport can render the session picker without reaching
   * into the application's private ports.
   */
  readonly sessions: SessionQueryPort;
  /**
   * Server-only session recovery port. It revalidates the scanned record and
   * launches only a registry-owned tokenized command without a shell.
   */
  readonly resumeSession: ResumeSessionPort;
  /** Local-only usage application used by the collector scheduler. */
  readonly usage: UsageApplication;
  /** Renderer-safe heartbeat for the desktop background listener. */
  readonly monitoring: MonitoringRuntime;
  /** Resolved data root (`process.env[ENV.USAGE_HOME] ?? homedir()`). */
  readonly dataRoot: string;
}

export const COMPOSITION_GLOBAL = `__${APP_ID.toUpperCase()}_COMPOSITION__`;

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
  const dataRoot = process.env[ENV.USAGE_HOME] ?? homedir();
  const tasksDir = join(dataRoot, APP_DATA_DIR, "tasks");
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

  // Usage snapshots are a sanitized feature DTO: legacy adapters remove
  // paths, command arguments and raw diagnostic locations before this store
  // is written. Keep the parser deliberately narrow at the persistence seam;
  // the collector remains the owner of the full structural contract.
  const usageSnapshotStore = new NodeAtomicJsonStore<UsageSnapshotDto | null>({
    filePath: join(tasksDir, "usage-snapshot.v1.json"),
    defaultValue: null,
    schema: {
      currentVersion: 1,
      parse(value): UsageSnapshotDto | null {
        if (value === null) return null;
        if (
          typeof value !== "object" ||
          value === null ||
          typeof (value as { generatedAt?: unknown }).generatedAt !== "string"
        )
          throw new TypeError("Invalid usage snapshot");
        return value as UsageSnapshotDto;
      },
    },
    clock,
  });
  const usageSnapshotRepository =
    createNullableAtomicSnapshotRepository(usageSnapshotStore);
  const usage = createUsageApplication({
    collector: createLegacyUsageCollector(),
    repository: usageSnapshotRepository,
    clock: { now: () => clock.now().getTime() },
  });

  const monitoringStore = new NodeAtomicJsonStore<
    import("../modules/monitoring/contracts.ts").MonitoringStatus | null
  >({
    filePath: join(tasksDir, "monitoring.v1.json"),
    defaultValue: null,
    schema: {
      ...monitoringStatusSchema,
      parse(value) {
        return value === null ? null : monitoringStatusSchema.parse(value);
      },
    },
    clock,
  });
  const monitoring = createMonitoringRuntime({
    store: createAtomicMonitoringStatusStore(monitoringStore),
    now: () => clock.now(),
  });

  // Automatic security assessment intentionally remains unavailable here.
  // The Electron service owns the trusted-directory, O_NOFOLLOW/realpath and
  // current-locale boundaries. Wiring the older background filesystem adapter
  // would create a weaker second scanning path. The task registry therefore
  // reports its stable `executor-unavailable` result until it can delegate to
  // that same service; manual and configured automatic scans remain available
  // through the desktop security IPC boundary.

  // AI orchestration: register the deterministic offline provider by default so
  // distillation/reports get a stable fallback. The S-500 profile store backs a
  // `profile` provider that resolves a saved profile by `modelId` at invoke
  // time — distillation selects a profile by its id and routes here, giving it
  // a real model call while every renderer-facing read stays key-free.
  const modelProfiles = getModelProfileRepository();
  const aiRegistry = createProviderRegistry([offlineProvider]);
  aiRegistry.register(
    createProfileBackedProvider({
      resolve: (profileId) => modelProfiles.getProfileForExecution(profileId),
    }),
  );
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
    generation: createReportGenerationPort({
      ai: aiExecutor,
      // B-400: reports reuse the active S-500 profile (a real model call via
      // the `profile` provider); without one the adapter keeps the default
      // offline model id. `null` here lets the adapter apply its own default.
      resolveModelId: async () =>
        (await modelProfiles.getActiveView())?.id ?? null,
    }),
    now: () => new Date(),
    createId: (prefix) => `${prefix}:${randomUUID()}`,
  });

  // Distillation: assemble after reports and knowledge so it can depend on
  // both. The knowledge repository persists distilled drafts (only after
  // explicit approval in the distillation application). The sessions port is
  // backed by the legacy local-sessions scanner — the same source the
  // `/sessions` route reads. `dataRoot` mirrors the scanner's `$HOME`-relative
  // storage.
  //
  // TODO(security-gate): `gateForDistillationCandidate` could not be wired
  // here this round — the distillation application keeps no `AssetAssessment`,
  // so the gate has nothing to read. `createDraft` is therefore called
  // without `securityVerdict` (consumers treat the missing verdict as
  // "unknown", never "clean"). Stamping a verdict at approval time is a
  // follow-up once distillation carries an assessment reference.
  const knowledgeStore = new NodeAtomicJsonStore({
    filePath: join(tasksDir, "knowledge.v1.json"),
    defaultValue: DEFAULT_KNOWLEDGE_DOCUMENT,
    schema: knowledgeDocumentSchema(),
    clock,
  });
  const knowledge = createKnowledgeRepository({
    store: knowledgeStore,
    clock,
    hash: createSha256HashPort(),
  });
  const sessions = createSessionQueryService(createLegacySessionRepository());
  const resumeSession = createLegacyResumeSessionPort(
    createNodeResumeExecutor(),
  );

  // Candidate store lives next to the reports/knowledge state under the same
  // `.trusttools/tasks` directory. It persists only privacy-filtered candidate
  // projections (session refs, generated knowledge note, execution summary).
  const candidateStore = new NodeAtomicJsonStore({
    filePath: join(tasksDir, "distill-candidates.v1.json"),
    defaultValue: DEFAULT_DISTILL_CANDIDATE_FILE,
    schema: distillCandidateStoreSchema(),
    clock,
  });
  const distillation = createDistillationApplication({
    sessions,
    ai: aiExecutor,
    knowledge,
    persistence: createAtomicCandidateStore({ store: candidateStore }),
    now: () => new Date(),
    createCandidateId: () => `candidate:${randomUUID()}`,
  });

  // Refresh adapters deliberately invoke feature ports rather than exposing a
  // scanner or filesystem path to the task module. Their output is discarded:
  // each feature keeps its own read cache/privacy projection, while the
  // monitoring runtime records only success/failure heartbeats.
  const executorRegistry = createExecutorRegistry({
    usage,
    sessions: {
      async refresh({ signal }) {
        const result = await sessions.query({ pageSize: 1, signal });
        if (!result.ok) throw new Error(result.error.code);
      },
    },
    skills: {
      async refresh({ signal }) {
        if (signal.aborted) throw new Error("errors.tasks.cancelled");
        const current = await usage.getUsageSnapshot({
          maxAgeMs: Number.MAX_SAFE_INTEGER,
        });
        if (!current.ok) throw new Error(current.error.code);
        await scanLocalSkills({
          usageEvents: current.value.snapshot?.details ?? [],
        });
      },
    },
    reports,
    monitoring,
  });

  const scheduler = createTaskScheduler({
    preferences,
    runs,
    clock,
    executors: executorRegistry.executors,
  });

  return {
    scheduler,
    preferences,
    runs,
    aiExecutor,
    modelProfiles,
    reports,
    distillation,
    knowledge,
    sessions,
    resumeSession,
    usage,
    monitoring,
    dataRoot,
  };
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
