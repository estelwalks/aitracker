import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import { epoch } from "../../../platform/database/sqlite-values.server.ts";
import type { DistributionRun, DistributionRunStore } from "../contracts.ts";

const OPAQUE = /^[a-z-]+:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function safeRef(value: string): string {
  if (!OPAQUE.test(value) || /[\\/]/.test(value))
    throw new TypeError("distribution reference is invalid");
  return value;
}

function transaction<T>(database: SqliteDatabasePort, work: () => T): T {
  const tx = database.transaction();
  tx.begin();
  try {
    const result = work();
    tx.commit();
    return result;
  } catch (error) {
    tx.rollback();
    throw error;
  }
}

export function createSqliteDistributionRunStore(
  database: SqliteDatabasePort,
): DistributionRunStore {
  const append = (run: DistributionRun): number => {
    safeRef(run.runRef);
    safeRef(run.planRef);
    const status = run.status === "rolled-back" ? "rolled-back" : run.status;
    const changed = Number(
      database
        .prepare(
          `INSERT INTO distribution_runs
      (run_id, plan_ref, operation, status, requested_at_ms, finished_at_ms, actor)
      VALUES (?, ?, 'install', ?, ?, ?, 'local')
      ON CONFLICT (run_id) DO UPDATE SET plan_ref=excluded.plan_ref,
        status=excluded.status, requested_at_ms=excluded.requested_at_ms,
        finished_at_ms=excluded.finished_at_ms`,
        )
        .run(
          run.runRef,
          run.planRef,
          status,
          epoch(run.startedAt),
          epoch(run.finishedAt),
        ).changes,
    );
    database
      .prepare("DELETE FROM distribution_run_targets WHERE run_id = ?")
      .run(run.runRef);
    const insert = database.prepare(
      "INSERT INTO distribution_run_targets (run_id, agent_id, status, error_code) VALUES (?, ?, ?, ?)",
    );
    run.targets.forEach((target) =>
      insert.run(
        run.runRef,
        safeRef(target.targetRef),
        target.status,
        target.errorCode ?? null,
      ),
    );
    return changed;
  };
  return {
    async append(run) {
      transaction(database, () => {
        append(run);
        database
          .prepare(
            `DELETE FROM distribution_runs WHERE run_id IN (
          SELECT run_id FROM distribution_runs ORDER BY requested_at_ms DESC, run_id DESC LIMIT -1 OFFSET 500
        )`,
          )
          .run();
      });
    },
  };
}
