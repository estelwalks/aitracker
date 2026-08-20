import { createHash } from "node:crypto";
import { join } from "node:path";

import { APP_DATA_DIR, APP_VERSION } from "../lib/app-config.ts";
import { createSqlitePerformanceRolloutRepository } from "./sqlite-performance-rollout-repository.server.ts";
import { createSqliteAIExecutionRepository } from "../modules/ai-orchestration/infrastructure/sqlite-ai-execution-repository.server.ts";
import { createSqliteInsightRepository } from "../modules/insights/infrastructure/sqlite-insight-repository.server.ts";
import {
  createSqliteModelProfileRepository,
  type ModelSecretCodec,
} from "../modules/ai-orchestration/infrastructure/sqlite-model-profile-repository.server.ts";
import { createModelProfileNetworkOperations } from "../modules/ai-orchestration/model-profile.server.ts";
import { createSqliteClassificationIndexRepository } from "../modules/dashboard/sqlite-classification-index.server.ts";
import { createSqliteCandidatePersistence } from "../modules/distillation/infrastructure/sqlite-candidate-store.server.ts";
import { createSqliteDistillQuotaStore } from "../modules/distillation/infrastructure/sqlite-quota-store.server.ts";
import { createSha256HashPort } from "../modules/knowledge/infrastructure/hash-port.server.ts";
import { createSqliteKnowledgeRepository } from "../modules/knowledge/infrastructure/sqlite-knowledge-repository.server.ts";
import { createSqliteMonitoringStatusStore } from "../modules/monitoring/sqlite-status-store.server.ts";
import { createSqliteReportStore } from "../modules/reports/infrastructure/sqlite-report-store.server.ts";
import { createSqliteSearchIndexRepository } from "../modules/search/infrastructure/sqlite-search-index-repository.server.ts";
import { createSqliteSessionSnapshotRepository } from "../modules/sessions/infrastructure/sqlite-session-snapshot-repository.server.ts";
import { createSqlitePreferenceRepository } from "../modules/settings/infrastructure/sqlite-preference-repository.server.ts";
import { createSqliteSkillSnapshotRepository } from "../modules/skill-catalog/infrastructure/sqlite-skill-snapshot-repository.server.ts";
import { createSqliteDistributionRunStore } from "../modules/skill-distribution/infrastructure/sqlite-run-store.server.ts";
import { createSqliteTaskPreferenceRepository } from "../modules/tasks/infrastructure/sqlite-task-preference-repository.server.ts";
import { createSqliteTaskRunRepository } from "../modules/tasks/infrastructure/sqlite-task-run-repository.server.ts";
import { createSqliteUsageSnapshotRepository } from "../modules/usage/infrastructure/sqlite-usage-snapshot-repository.server.ts";
import {
  NodeRuntimeVersionsProvider,
  type RuntimeVersionsProvider,
} from "../platform/database/capability-probe.server.ts";
import { DatabaseError } from "../platform/database/contracts.ts";
import { DatabaseHost } from "../platform/database/database-host.server.ts";
import { createSqliteHttpCacheRepository } from "../platform/database/http-cache-repository.server.ts";
import { runMigrations } from "../platform/database/migration-runner.server.ts";
import { createSqliteRuntimeFlagRepository } from "../platform/database/runtime-flag-repository.server.ts";
import { createSqliteInstallationSnapshotRepository } from "../platform/discovery/sqlite-installation-snapshot-repository.server.ts";
import { createSqliteWslSnapshotRepository } from "../platform/discovery/sqlite-wsl-snapshot-repository.server.ts";
import type { Clock } from "../platform/persistence/contracts.ts";

const DATABASE_FILE = "trusttools.v1.db";

export interface CreateDatabaseRuntimeOptions {
  readonly dataRoot: string;
  readonly clock: Clock;
  readonly databasePath?: string;
  readonly versionsProvider?: RuntimeVersionsProvider;
  readonly secretCodec: ModelSecretCodec;
  readonly modelProfileFetch?: typeof fetch;
}

/** Opens the sole application persistence authority. Any failure is fatal. */
export async function createDatabaseRuntime(
  options: CreateDatabaseRuntimeOptions,
) {
  const host = DatabaseHost.open({
    path:
      options.databasePath ??
      join(options.dataRoot, APP_DATA_DIR, "data", DATABASE_FILE),
    versionsProvider:
      options.versionsProvider ?? new NodeRuntimeVersionsProvider(),
  });
  try {
    const migration = runMigrations({
      database: host,
      appVersion: APP_VERSION,
    });
    assertHealthy(host);
    const modelProfileNetwork = createModelProfileNetworkOperations({
      ...(options.modelProfileFetch
        ? { fetchFn: options.modelProfileFetch }
        : {}),
    });
    const hmacKey = createHash("sha256")
      .update(`trusttools:${options.dataRoot}`)
      .digest();
    const features = {
      appPreferences: createSqlitePreferenceRepository(host),
      runtimeFlags: createSqliteRuntimeFlagRepository(host),
      httpCache: createSqliteHttpCacheRepository(host),
      aiExecutions: createSqliteAIExecutionRepository(host),
      insights: createSqliteInsightRepository(host),
      preferences: createSqliteTaskPreferenceRepository({ database: host }),
      runs: createSqliteTaskRunRepository({ database: host }),
      monitoring: createSqliteMonitoringStatusStore(host),
      performanceRollout: createSqlitePerformanceRolloutRepository(
        host,
        options.clock,
      ),
      usageSnapshots: createSqliteUsageSnapshotRepository({
        database: host,
        hmacKey,
      }),
      sessionSnapshots: createSqliteSessionSnapshotRepository({
        database: host,
        hmacKey,
      }),
      skillSnapshots: createSqliteSkillSnapshotRepository({
        database: host,
        hmacKey,
      }),
      installationSnapshots: createSqliteInstallationSnapshotRepository({
        database: host,
      }),
      wslSnapshots: createSqliteWslSnapshotRepository({
        database: host,
      }),
      searchIndex: createSqliteSearchIndexRepository({
        database: host,
      }),
      classifications: createSqliteClassificationIndexRepository({
        database: host,
        hmacKey,
      }),
      reports: createSqliteReportStore(host),
      knowledge: createSqliteKnowledgeRepository({
        database: host,
        clock: options.clock,
        hash: createSha256HashPort(),
      }),
      candidates: createSqliteCandidatePersistence(host),
      distillQuota: createSqliteDistillQuotaStore(host),
      distributionRuns: createSqliteDistributionRunStore(host),
      modelProfiles: createSqliteModelProfileRepository({
        database: host,
        secretCodec: options.secretCodec,
        testProfile: modelProfileNetwork.test,
        listModels: modelProfileNetwork.listModels,
      }),
    };
    let closed = false;
    return {
      status: {
        state: "active" as const,
        schemaVersion: migration.currentVersion,
        sqliteVersion: host.runtimeVersions.sqliteVersion,
        errorCode: null,
      },
      features,
      /** Narrow SQLite port for platform-level operations (retention). */
      database: host,
      checkpoint() {
        if (!closed && host.isOpen) host.checkpoint("passive");
      },
      close() {
        if (closed) return;
        closed = true;
        if (host.isOpen) host.close();
      },
    };
  } catch (error) {
    try {
      host.close();
    } catch {
      // Preserve the initialization error; there is no alternate store.
    }
    throw error;
  }
}

export type DatabaseRuntime = Awaited<ReturnType<typeof createDatabaseRuntime>>;
export type DatabaseFeatureAdapters = DatabaseRuntime["features"];

function assertHealthy(database: DatabaseHost): void {
  const result = database.prepare("PRAGMA quick_check").get();
  if (!result || Object.values(result)[0] !== "ok") {
    throw new DatabaseError("integrity-check-failed", "integrity", {
      retryable: false,
    });
  }
}
