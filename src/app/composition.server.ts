import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { APP_DATA_DIR, APP_ID, ENV } from "../lib/app-config.ts";
import { SystemClock } from "../platform/persistence/clock.ts";
import type { Clock } from "../platform/persistence/contracts.ts";
import type { SnapshotRefreshPort } from "../platform/snapshot-runtime/contracts.ts";
import { RUNTIME_POLICY } from "./runtime-policy.generated.ts";
import {
  createDatabaseRuntime,
  type DatabaseRuntime,
} from "./database-runtime.server.ts";
import {
  type PerformanceRolloutRepository,
  type PerformanceRolloutStage,
} from "./performance-rollout.ts";
import { createExecutorRegistry } from "../modules/tasks/application/executor-registry/index.ts";
import { createTaskScheduler } from "../modules/tasks/application/scheduler.ts";
import { createTaskApi } from "../modules/tasks/application/task-api.ts";
import type { TaskApi } from "../modules/tasks/application/task-api.ts";
import {
  type TaskPreferenceRepository,
  type TaskRunRepository,
} from "../modules/tasks/application/task-storage.ts";
import type { TaskScheduler } from "../modules/tasks/application/scheduler.ts";
import {
  createAiExecutor,
  type AIExecutorPort,
} from "../modules/ai-orchestration/ai-executor.ts";
import type { PageInsightsApplication } from "../modules/insights/page/application.ts";
import {
  createProviderRegistry,
  createRegistryRouter,
  offlineProvider,
} from "../modules/ai-orchestration/provider-registry.ts";
import {
  createProfileBackedProvider,
  type ModelProfileRepository,
} from "../modules/ai-orchestration/model-profile.server.ts";
import type { ModelSecretCodec } from "../modules/ai-orchestration/infrastructure/sqlite-model-profile-repository.server.ts";
import { deterministicOfflineFallback } from "../modules/ai-orchestration/application.ts";
import { createReportsApplication } from "../modules/reports/application/index.ts";
import type { ReportsApplication } from "../modules/reports/index.ts";
import { createReportGenerationPort } from "../modules/reports/infrastructure/ai-generation-adapter.ts";
import { createReportContextPort } from "../modules/reports/infrastructure/usage-context-adapter.ts";
import { createMarkdownReportStore } from "../modules/reports/infrastructure/markdown-report-store.server.ts";
import type { KnowledgeRepository } from "../modules/knowledge/contracts.ts";
import { createDistillationApplication } from "../modules/distillation/application/index.ts";
import type { DistillationApplication } from "../modules/distillation/index.ts";
import type { DistillQuotaPort } from "../modules/distillation/quota.ts";
import { createSessionQueryService } from "../modules/sessions/index.ts";
import type {
  ResumeSessionPort,
  SessionQueryPort,
} from "../modules/sessions/contracts.ts";
import { createSessionResumePort } from "../modules/sessions/infrastructure/session-adapter.server.ts";
import { createNodeResumeExecutor } from "../modules/sessions/infrastructure/node-resume-executor.server.ts";
import { createUsageCollector } from "../modules/usage/infrastructure/usage-collector.server.ts";
import { createUsageSnapshotRuntime } from "../modules/usage/infrastructure/usage-snapshot-runtime.server.ts";
import type { UsageSnapshotRuntime } from "../modules/usage/contracts.ts";
import type { MonitoringRuntime } from "../modules/monitoring/index.ts";
import { createMonitoringRuntime } from "../modules/monitoring/application/index.ts";

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
  /** SQLite lifecycle and renderer-safe cutover/health status. */
  readonly database: DatabaseRuntime;
  /** The background task scheduler. `start()` is NOT called by this module. */
  readonly scheduler: TaskScheduler;
  readonly preferences: TaskPreferenceRepository;
  readonly runs: TaskRunRepository;
  /**
   * Task use-case API (preferences, definitions, runs). Exposed so feature
   * server functions can drive the scheduler through the same validated
   * application layer the UI uses — e.g. the reports schedule sync writes the
   * `reports.generate` preference here.
   */
  readonly taskApi: TaskApi;
  /**
   * AI executor for distillation/reports. Backed by the provider registry with
   * the offline provider registered, so consumers get a deterministic fallback
   * response until a real provider is registered.
   */
  readonly aiExecutor: AIExecutorPort;
  /**
   * Multi-profile model configuration stored in SQLite; renderer-facing reads
   * return key-free projections. The registry's `profile` provider resolves
   * executions through this repository.
   */
  readonly modelProfiles: ModelProfileRepository;
  /**
   * Reports application. Backed by the normalized SQLite report store, the AI
   * generation adapter (using `aiExecutor`) and the offline context port.
   * Generation currently runs against the deterministic offline model.
   */
  readonly reports: ReportsApplication;
  /**
   * Distillation application backed by SQLite knowledge, candidate and quota
   * repositories. Approval is the only path that writes knowledge assets.
   */
  readonly distillation: DistillationApplication;
  /**
   * Server-side SQLite quota ledger for real-model distillation calls.
   */
  readonly distillQuota: DistillQuotaPort;
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
   * SessionSnapshot coordinator (P3-T3-01, O(1) read); the session scanner
   * remains only as the snapshot collector adapter. Exposed so the
   * distillation transport can render the session picker without reaching
   * into the application's private ports.
   */
  readonly sessions: SessionQueryPort;
  /**
   * Server-only session recovery port. It revalidates the scanned record and
   * launches only a registry-owned tokenized command without a shell.
   */
  readonly resumeSession: ResumeSessionPort;
  /**
   * Local-only usage application used by the collector scheduler.
   */
  /** Unified Usage snapshot runtime (P2); pages + the usage.refresh task read
   * and refresh this coordinator. */
  readonly usageSnapshot: UsageSnapshotRuntime;
  /** Session snapshot runtime (P3-T3-01); Reports/Sessions read this. */
  readonly sessionSnapshot: import("../modules/sessions/infrastructure/session-snapshot-runtime.server.ts").SessionSnapshotRuntime;
  /** Skill snapshot runtime (P3-T3-02); Skills/Sources read this. */
  readonly skillSnapshot: import("../modules/skill-catalog/infrastructure/skill-snapshot-runtime.server.ts").SkillSnapshotRuntime;
  /** Installation snapshot runtime (P3-T3-03); Sources/Usage share facts. */
  readonly installationSnapshot: import("../platform/discovery/installation-snapshot-runtime.server.ts").InstallationSnapshotRuntime;
  /** WSL topology snapshot runtime (P3-T3-04); scanners read this once. */
  readonly wslSnapshot: import("../platform/discovery/wsl-snapshot-runtime.server.ts").WslSnapshotRuntime;
  /** Project classification service (P3-T3-06); queries read the index. */
  readonly classificationService: import("../modules/dashboard/classification-service.server.ts").ClassificationService;
  /** Search index service (S-03, T-03-03); SQLite-backed safe projection. */
  readonly searchIndex: import("../modules/search/application/index.ts").SearchIndexService;
  /** Renderer-safe heartbeat for the desktop background listener. */
  readonly monitoring: MonitoringRuntime;
  /** In-memory read-model metrics sink (P0-T0-09; observe-only). */
  readonly metrics: import("../platform/observability/contracts.ts").MetricSink;
  /**
   * Local performance-rollout state persisted in SQLite runtime flags.
   */
  readonly performanceRollout: PerformanceRolloutRepository;
  /**
   * Page-insights application (M3): the 14 surface evidence adapters plus, when
   * the `insight.killswitch` flag is off, the AI enhancer (M2). Renders
   * rule-generated candidates always, enhanced candidates when allowed.
   */
  readonly insights: PageInsightsApplication;
  /** Resolved data root (`process.env[ENV.USAGE_HOME] ?? homedir()`). */
  readonly dataRoot: string;
}

export const COMPOSITION_GLOBAL = `__${APP_ID.toUpperCase()}_COMPOSITION__`;

let secretCodecOverride: ModelSecretCodec | undefined;

/** Test-only seam; production always supplies the Electron safe-storage codec. */
export function setSecretCodecForTests(codec?: ModelSecretCodec): void {
  secretCodecOverride = codec;
}

let composition: CompositionRoot | undefined;
let shutdownHookInstalled = false;
let databaseForProcessExit: DatabaseRuntime | undefined;

function installDatabaseShutdownHook(database: DatabaseRuntime): void {
  databaseForProcessExit = database;
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;
  process.once("beforeExit", () => {
    try {
      databaseForProcessExit?.checkpoint();
    } catch {
      // Teardown is best effort; close still performs its own checkpoint.
    }
    databaseForProcessExit?.close();
  });
}

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
  const databaseRuntime = await createDatabaseRuntime({
    dataRoot,
    clock,
    secretCodec: secretCodecOverride ?? {
      async encrypt() {
        throw new Error("errors.modelProfile.safeStorageUnavailable");
      },
      async decrypt() {
        throw new Error("errors.modelProfile.safeStorageUnavailable");
      },
    },
  });
  const {
    preferences,
    runs,
    monitoring: monitoringStore,
    performanceRollout,
  } = databaseRuntime.features;

  // P3-T3-06: project classification index. Dashboard queries resolve from
  // this persisted index (O(1)); the Usage refresh collector feeds observed
  // refs through the incremental classifier in the background.
  const { createIncrementalClassifier } =
    await import("../modules/dashboard/incremental-classifier.server.ts");
  const { createClassificationService } =
    await import("../modules/dashboard/classification-service.server.ts");
  const classificationRepository = databaseRuntime.features.classifications;
  const classificationService = createClassificationService({
    repository: classificationRepository,
    classifier: createIncrementalClassifier({
      repository: classificationRepository,
      homeDirectory: dataRoot,
    }),
  });

  // P3-T3-04: WSL topology snapshot. Enumerates distro/home at most once per
  // freshness window (6h from the runtime policy) and persists it; usage
  // collection reads this coordinator instead of invoking `wsl.exe` on every
  // refresh. S-03 (T-03-02): the repository is the SQLite `snapshot_blobs`
  // store, not a per-process in-memory envelope, so the topology survives
  // restarts.
  const { createWslSnapshotRuntime } =
    await import("../platform/discovery/wsl-snapshot-runtime.server.ts");
  type Envelope<T> =
    import("../platform/snapshot-runtime/contracts.ts").SnapshotEnvelope<T>;
  const wslSnapshot = createWslSnapshotRuntime({
    repository: databaseRuntime.features.wslSnapshots,
    now: () => clock.now().getTime(),
  });

  // P3-T3-11: page-triggered refreshes (empty/stale/manual/mutation) go
  // through the unified task runtime. The ports are bound lazily after the
  // task API is constructed below; until then a request is a no-op, which is
  // safe because the scheduler itself drives startup/scheduled refreshes.
  // The snapshot runtimes are constructed BEFORE the ports exist, so each
  // runtime receives a DELEGATING port that resolves the bound port at
  // request time — a by-value capture here would make every
  // `requestRefresh()` a silent no-op.
  const refreshPorts: {
    usage?: SnapshotRefreshPort;
    sessions?: SnapshotRefreshPort;
    skills?: SnapshotRefreshPort;
    installation?: SnapshotRefreshPort;
  } = {};
  const deferredPort = (
    getPort: () => SnapshotRefreshPort | undefined,
  ): SnapshotRefreshPort => ({
    requestRefresh(request) {
      const port = getPort();
      return port ? port.requestRefresh(request) : Promise.resolve();
    },
  });

  const usageSnapshot = createUsageSnapshotRuntime({
    repository: databaseRuntime.features.usageSnapshots,
    now: () => clock.now().getTime(),
    requestRefresh: deferredPort(() => refreshPorts.usage),
    // T3-06: after each Usage refresh, feed observed project refs to the
    // incremental classifier so the index stays fresh without blocking the
    // query path.
    collect: async (request) => {
      const collector = createUsageCollector();
      // P3-T3-04: reuse the shared WSL topology snapshot instead of re-running
      // `wsl.exe` on every usage refresh. The coordinator hydrates the
      // persisted topology once; a missing/stale snapshot triggers exactly one
      // bounded enumeration (with cancellation) and the result is injected
      // into the scan and shared by every provider.
      await wslSnapshot.ensureHydrated();
      let latest = wslSnapshot.readLatest();
      if (latest.data == null || latest.status === "stale") {
        latest = await wslSnapshot.refreshNow(request.signal);
      }
      const wslTopology = latest.data ?? {
        distros: [],
        enumeratedAt: null,
        failed: true,
        warningCodes: ["wsl-unavailable"],
      };
      const result = await collector.collect({
        signal: request.signal,
        budget: {
          maxDurationMs: RUNTIME_POLICY.snapshotPolicies.usage.timeoutMs,
        },
        scannerOptions: {
          wslTopology: {
            distros: wslTopology.distros,
            enumeratedAt: wslTopology.enumeratedAt,
            failed: wslTopology.failed,
          },
        },
      });
      const refs = result.snapshot.details.map((event) => event.project);
      if (refs.length > 0) {
        await classificationService
          .classifyIncrementally(refs, request.signal)
          .catch(() => {});
      }
      return {
        data: result.snapshot,
        sourceFingerprint: result.snapshot.generatedAt,
        scannedItems: result.snapshot.events,
      };
    },
  });

  // P3-T3-01/02/03: domain snapshots for Sessions, Skills and Installations.
  // Pages read the SQLite-backed coordinator (O(1)) instead of re-scanning.
  const { createSessionSnapshotRuntime } =
    await import("../modules/sessions/infrastructure/session-snapshot-runtime.server.ts");
  const { createSkillSnapshotRuntime } =
    await import("../modules/skill-catalog/infrastructure/skill-snapshot-runtime.server.ts");
  const { createInstallationSnapshotRuntime } =
    await import("../platform/discovery/installation-snapshot-runtime.server.ts");

  const emptySessionEnvelope: Envelope<
    import("../modules/sessions/infrastructure/session-snapshot.contracts.ts").SessionSnapshotData
  > = {
    schemaVersion: 1,
    revision: "empty",
    generatedAt: null,
    sourceFingerprint: null,
    status: "empty",
    data: null,
    diagnostics: { lastAttemptAt: null, lastSuccessAt: null, warningCodes: [] },
  };
  const sessionSnapshot = createSessionSnapshotRuntime({
    repository: databaseRuntime.features.sessionSnapshots,
    now: () => clock.now().getTime(),
    requestRefresh: deferredPort(() => refreshPorts.sessions),
  });

  const emptySkillEnvelope: Envelope<
    import("../modules/skill-catalog/infrastructure/skill-snapshot.contracts.ts").SkillSnapshotData
  > = {
    schemaVersion: 1,
    revision: "empty",
    generatedAt: null,
    sourceFingerprint: null,
    status: "empty",
    data: null,
    diagnostics: { lastAttemptAt: null, lastSuccessAt: null, warningCodes: [] },
  };
  const skillSnapshot = createSkillSnapshotRuntime({
    repository: databaseRuntime.features.skillSnapshots,
    now: () => clock.now().getTime(),
    requestRefresh: deferredPort(() => refreshPorts.skills),
  });

  const emptyInstallationEnvelope: Envelope<
    import("../platform/discovery/installation-snapshot.contracts.ts").InstallationSnapshotData
  > = {
    schemaVersion: 1,
    revision: "empty",
    generatedAt: null,
    sourceFingerprint: null,
    status: "empty",
    data: null,
    diagnostics: { lastAttemptAt: null, lastSuccessAt: null, warningCodes: [] },
  };
  const installationSnapshot = createInstallationSnapshotRuntime({
    repository: databaseRuntime.features.installationSnapshots,
    now: () => clock.now().getTime(),
    requestRefresh: deferredPort(() => refreshPorts.installation),
  });

  // S-03 (T-03-03): search index service. The repository persists the safe
  // projection in search_documents; the service keeps the in-memory snapshot
  // for O(1) query scoring and rebuilds it from the SQLite store on startup.
  const { SearchIndexService } =
    await import("../modules/search/application/index.ts");
  const searchIndex = new SearchIndexService(
    databaseRuntime.features.searchIndex,
    clock,
  );
  await searchIndex.load();

  const monitoring = createMonitoringRuntime({
    store: monitoringStore,
    now: () => clock.now(),
  });

  // P0-T0-09: in-memory read-model metrics sink. Loader/projector adapters
  // observe durations and DTO bytes here; nothing sensitive is ever recorded.
  const { createInMemoryMetrics } =
    await import("../platform/observability/metrics.ts");
  const metrics = createInMemoryMetrics();

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
  const modelProfiles = databaseRuntime.features.modelProfiles;
  const aiRegistry = createProviderRegistry([offlineProvider]);
  aiRegistry.register(
    createProfileBackedProvider({
      resolve: (profileId) => modelProfiles.getProfileForExecution(profileId),
    }),
  );
  const coreAiExecutor = createAiExecutor({
    router: createRegistryRouter(aiRegistry),
    offlineFallback: deterministicOfflineFallback,
  });
  const aiExecutor: AIExecutorPort = {
    async execute(request) {
      const startedAtMs = Date.now();
      const result = await coreAiExecutor.execute(request);
      const finishedAtMs = Date.now();
      const audit = databaseRuntime.features.aiExecutions;
      {
        const capability = request.prompt.id.startsWith("report")
          ? "report"
          : "distillation";
        const amountUsd = result.summary.cost.amountUsd;
        audit.recordWithBudget({
          mode: "enhanced-manual",
          key: {
            dateKey: new Date(finishedAtMs).toISOString().slice(0, 10),
            capability,
            profileKey:
              request.providerId === "profile" ? request.modelId : "offline",
          },
          dailyCallLimit: null,
          execution: {
            capability,
            summary: result.summary,
            ...(result.response?.usage ? { usage: result.response.usage } : {}),
            ...(amountUsd !== undefined && Number.isFinite(amountUsd)
              ? {
                  costMicrousd: BigInt(
                    Math.max(0, Math.round(amountUsd * 1_000_000)),
                  ),
                }
              : {}),
            startedAtMs,
            finishedAtMs,
            durationMs: finishedAtMs - startedAtMs,
          },
          nowMs: finishedAtMs,
        });
      }
      return result;
    },
  };

  // Reports: assemble the application after aiExecutor so the generation
  // adapter can depend on it. The store lives next to the task runs under the
  // Metadata is normalized in SQLite; editable bodies remain real Markdown
  // files under `.trusttools/reports` for straightforward copy/migration.
  const reports = createReportsApplication({
    store: databaseRuntime.features.reports,
    content: createMarkdownReportStore({
      rootDirectory: join(dataRoot, APP_DATA_DIR, "reports"),
    }),
    context: createReportContextPort({ snapshot: sessionSnapshot }),
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
  // backed by the SessionSnapshot coordinator (P3-T3-01) — the same O(1)
  // source the `/sessions` route reads. `dataRoot` mirrors the scanner's
  // `$HOME`-relative storage.
  //
  // TODO(security-gate): `gateForDistillationCandidate` could not be wired
  // here this round — the distillation application keeps no `AssetAssessment`,
  // so the gate has nothing to read. `createDraft` is therefore called
  // without `securityVerdict` (consumers treat the missing verdict as
  // "unknown", never "clean"). Stamping a verdict at approval time is a
  // follow-up once distillation carries an assessment reference.
  const knowledge = databaseRuntime.features.knowledge;
  // P3-T3-01 (fix): the sessions page and distillation read the SessionSnapshot
  // index (O(1)) instead of re-scanning local session logs on every query; the
  // session scanner remains only as the snapshot collector adapter.
  const { createSnapshotSessionRepository } =
    await import("../modules/sessions/infrastructure/snapshot-session-repository.ts");
  const sessions = createSessionQueryService(
    createSnapshotSessionRepository(sessionSnapshot),
  );
  const resumeSession = createSessionResumePort(createNodeResumeExecutor());

  // Candidate store lives next to the reports/knowledge state under the same
  // `.trusttools/tasks` directory. It persists only privacy-filtered candidate
  // projections (session refs, generated knowledge note, execution summary).
  const distillQuota = databaseRuntime.features.distillQuota;
  const distillation = createDistillationApplication({
    sessions,
    ai: aiExecutor,
    knowledge,
    persistence: databaseRuntime.features.candidates,
    quota: distillQuota,
    // Story B-100: user-selected transcript segments. The adapter stays
    // behind a dynamic import of the sessions transport so this composition
    // root never forms a static cycle with the sessions module; reads are
    // in-memory only and failures degrade to metadata-only distillation.
    transcriptPort: {
      async load(ref) {
        try {
          const { loadSessionTranscript } =
            await import("../modules/sessions/api.server.ts");
          return await loadSessionTranscript({
            source: ref.source,
            sessionId: ref.sessionId,
          });
        } catch {
          return null;
        }
      },
    },
    now: () => new Date(),
    createCandidateId: () => `candidate:${randomUUID()}`,
  });

  // Refresh adapters deliberately invoke feature ports rather than exposing a
  // scanner or filesystem path to the task module. P3-T3-08/09: sessions and
  // skills executors refresh through their snapshot coordinators so the task
  // runtime is the single refresh entry and pages only read snapshots.
  //
  // The usage.refresh executor updates the same SQLite snapshot coordinator
  // that page queries read.
  const executorRegistry = createExecutorRegistry({
    usage: {
      async refresh({ signal }) {
        if (signal.aborted) throw new Error("errors.tasks.cancelled");
        await usageSnapshot.refreshNow(signal);
      },
    },
    sessions: {
      async refresh({ signal }) {
        await sessionSnapshot.refreshNow(signal);
      },
    },
    skills: {
      async refresh({ signal }) {
        if (signal.aborted) throw new Error("errors.tasks.cancelled");
        await skillSnapshot.refreshNow(signal);
      },
    },
    // P3-T3-09: exchange refresh uses the network-allowed policy task; the
    // repository keeps last-known-good on failure (never throws).
    exchange: {
      async refresh({ signal }) {
        if (signal.aborted) throw new Error("errors.tasks.cancelled");
        const { createExchangeRateRepository } =
          await import("../platform/snapshot-runtime/exchange-rate.server.ts");
        const repository = createExchangeRateRepository();
        const result = await repository.refresh();
        if (result.source === "fallback") {
          throw new Error("errors.pricing.rateUnavailable");
        }
      },
    },
    // P3-T3-03: installation refresh runs through the shared snapshot
    // coordinator (6h freshness, single-flight, timeout from the policy).
    installation: {
      async refresh({ signal }) {
        if (signal.aborted) throw new Error("errors.tasks.cancelled");
        await installationSnapshot.refreshNow(signal);
      },
    },
    retention: {
      async apply({ signal }) {
        if (signal.aborted) throw new Error("errors.tasks.cancelled");
        const [{ readCurrentRetentionDays }, { applyDatabaseRetention }] =
          await Promise.all([
            import("../lib/settings/retention-policy.server.ts"),
            import("../platform/database/retention.server.ts"),
          ]);
        const retentionDays = await readCurrentRetentionDays();
        if (signal.aborted) throw new Error("errors.tasks.cancelled");
        // S-03 (T-03-04): retention now clears expired SQLite cache rows. The
        // persisted retentionDays preference is read for parity/logging only;
        // each table's own expires_at_ms drives the actual deletion.
        return applyDatabaseRetention(databaseRuntime.database, Date.now());
      },
    },
    reports,
    monitoring,
  });

  // P5-T5-06: the scheduler's heavy collectors share the global resource
  // budget (maxHeavyCollectors = 1 from the runtime policy).
  const { createResourceBudget } =
    await import("../platform/runtime/resource-budget.ts");
  const resourceBudget = createResourceBudget();

  const scheduler = createTaskScheduler({
    preferences,
    runs,
    clock,
    executors: executorRegistry.executors,
    resourceBudget,
  });

  const taskApi = createTaskApi({ scheduler, preferences, runs });

  // P3-T3-11: bind the snapshot refresh ports to the unified task runtime so
  // page-triggered refreshes (empty/stale/manual/mutation) are single-flighted
  // against scheduled runs, recorded in the run store and subject to the
  // heavy-collector budget.
  refreshPorts.usage = {
    requestRefresh: async () => {
      await taskApi.runNow({ taskId: "usage.refresh" }).catch(() => {});
    },
  };
  refreshPorts.sessions = {
    requestRefresh: async () => {
      await taskApi.runNow({ taskId: "sessions.refresh" }).catch(() => {});
    },
  };
  refreshPorts.skills = {
    requestRefresh: async () => {
      await taskApi.runNow({ taskId: "skills.refresh" }).catch(() => {});
    },
  };
  refreshPorts.installation = {
    requestRefresh: async () => {
      await taskApi.runNow({ taskId: "installation.refresh" }).catch(() => {});
    },
  };

  // M3: page-insights application — the 14 surface evidence adapters plus the
  // optional AI enhancer (M2). Assembled through the registry so the root never
  // statically imports the adapters (avoids a module cycle); the registry also
  // owns the `insight.killswitch` gate (enhancer disabled, Profile unread).
  const { createPageInsightsApplicationForRoot } =
    await import("./insight-registry.server.ts");
  const insights = await createPageInsightsApplicationForRoot({
    aiExecutor,
    modelProfiles,
    store: databaseRuntime.features.insights,
    runtimeFlags: databaseRuntime.features.runtimeFlags,
  });

  return {
    database: databaseRuntime,
    scheduler,
    preferences,
    runs,
    taskApi,
    aiExecutor,
    modelProfiles,
    reports,
    distillation,
    distillQuota,
    knowledge,
    sessions,
    resumeSession,
    usageSnapshot,
    sessionSnapshot,
    skillSnapshot,
    installationSnapshot,
    wslSnapshot,
    classificationService,
    searchIndex,
    monitoring,
    metrics,
    performanceRollout,
    insights,
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
  // Defer construction one microtask so concurrent callers cannot enter the
  // synchronous DatabaseHost.open() before the in-flight promise is cached.
  const promise = Promise.resolve()
    .then(() => buildCompositionRoot(clock))
    .then((root) => {
      composition = root;
      installDatabaseShutdownHook(root.database);
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
  composition?.database.close();
  if (databaseForProcessExit === composition?.database) {
    databaseForProcessExit = undefined;
  }
  composition = undefined;
  writeGlobalCache(undefined);
}
