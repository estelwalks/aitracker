import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

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
import { createSqliteSecurityScanRunRepository } from "../modules/security-assessment/infrastructure/sqlite-scan-run-repository.server.ts";
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
import { createPreMigrationBackup } from "../platform/database/backup.server.ts";
import { runMigrations } from "../platform/database/migration-runner.server.ts";
import { LATEST_MIGRATION_VERSION } from "../platform/database/migrations/index.ts";
import { createSqliteRuntimeFlagRepository } from "../platform/database/runtime-flag-repository.server.ts";
import { createSqliteInstallationSnapshotRepository } from "../platform/discovery/sqlite-installation-snapshot-repository.server.ts";
import { createSqliteWslSnapshotRepository } from "../platform/discovery/sqlite-wsl-snapshot-repository.server.ts";
import type { Clock } from "../platform/persistence/contracts.ts";

const DATABASE_FILE = "aitracker.v1.db";

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
  const databasePath =
    options.databasePath ??
    join(options.dataRoot, APP_DATA_DIR, "data", DATABASE_FILE);
  // Backups live next to the database under `<data>/backups`, mirroring the
  // daily backup executor and the recovery planning path.
  const backupsDirectory = join(dirname(databasePath), "backups");
  let host: DatabaseHost;
  try {
    host = DatabaseHost.open({
      path: databasePath,
      versionsProvider:
        options.versionsProvider ?? new NodeRuntimeVersionsProvider(),
    });
  } catch (error) {
    await recordRecoveryGuidance(error, backupsDirectory);
    throw error;
  }
  try {
    // Architecture §10.2: a mandatory pre-migration backup must exist before
    // any schema migration is applied. Taken only when the database already
    // exists and lags the bundled lineage (a fresh install has nothing to
    // protect yet). A backup failure is recorded but does not block startup:
    // the migration runner is transactional and forward-only.
    try {
      const versionRow = host.prepare("PRAGMA user_version").get();
      const schemaVersion = Number(
        versionRow === undefined ? 0 : (Object.values(versionRow)[0] ?? 0),
      );
      if (schemaVersion > 0 && schemaVersion < LATEST_MIGRATION_VERSION) {
        await createPreMigrationBackup({
          host,
          backupsDirectory,
          appVersion: APP_VERSION,
          sqliteVersion: host.runtimeVersions.sqliteVersion,
        });
      }
    } catch (backupError) {
      console.error("[database] pre-migration backup failed", backupError);
    }
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
      .update(`aitracker:${options.dataRoot}`)
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
      securityScanRuns: createSqliteSecurityScanRunRepository(host),
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
      compact() {
        if (!closed && host.isOpen) {
          host.checkpoint("truncate");
          host.vacuum();
          host.checkpoint("truncate");
        }
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
    await recordRecoveryGuidance(error, backupsDirectory);
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

/**
 * Corruption-recovery guidance (architecture §10.3).
 *
 * When opening or migrating the database fails with a corruption signal, the
 * startup path records what recovery could offer instead of silently dying.
 * `planRecovery` is read-only and needs only the backups directory (no open
 * connection), so it can run even after `DatabaseHost.open` itself failed.
 * Automatic restore is deliberately NOT performed here: `restoreFromBackup`
 * requires explicit user confirmation, which the startup path cannot supply.
 * The guidance is logged and attached to the thrown error so the desktop
 * warmup boundary can surface a stable code to the user.
 */
async function recordRecoveryGuidance(
  error: unknown,
  backupsDirectory: string,
): Promise<void> {
  if (!isCorruptionFailure(error)) return;
  try {
    const { planRecovery } =
      await import("../platform/database/recovery.server.ts");
    const plan = await planRecovery({ backupsDirectory });
    const guidance =
      plan.kind === "backup-available"
        ? "recovery.backup-available"
        : plan.kind === "manifest-corrupt"
          ? "recovery.manifest-corrupt"
          : `recovery.no-backup:${plan.reason}`;
    console.error(`[database] ${guidance}`);
    if (error instanceof Error) {
      (error as Error & { recoveryGuidance?: string }).recoveryGuidance =
        guidance;
    }
  } catch {
    // Guidance is best effort; the original startup failure is authoritative.
  }
}

/** True when the error (or its sanitized cause chain) is a corruption signal. */
function isCorruptionFailure(error: unknown): boolean {
  let current = error;
  for (
    let depth = 0;
    depth < 8 && current instanceof DatabaseError;
    depth += 1
  ) {
    if (current.code === "corrupt" || current.code === "integrity-check-failed")
      return true;
    current = current.cause;
  }
  return false;
}
