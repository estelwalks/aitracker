import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENV, TEST_TMP_PREFIX } from "../../lib/app-config.ts";
import {
  getCompositionRoot,
  resetCompositionRootForTests,
} from "../../app/composition.server.ts";
import {
  buildReportPeriod,
  reportScheduleInputSchema,
  reportScheduleStatusFor,
  syncReportScheduleToTaskPreference,
  type ReportScheduleInput,
} from "./server-fns.ts";

const base: ReportScheduleInput = {
  version: 2,
  configured: true,
  daily: { enabled: true, time: "18:30" },
  weekly: { enabled: true, time: "09:00", dayOfWeek: 6 },
  monthly: { enabled: true, time: "08:15", dayOfMonth: 31 },
};

test("report schedule schema accepts three valid independent plans", () => {
  assert.equal(reportScheduleInputSchema.safeParse(base).success, true);
});

test("report schedule schema rejects malformed nested plans", () => {
  const cases: unknown[] = [
    { ...base, version: 1 },
    { ...base, daily: { enabled: true, time: "25:00" } },
    { ...base, weekly: { ...base.weekly, dayOfWeek: 7 } },
    { ...base, monthly: { ...base.monthly, dayOfMonth: 0 } },
    { ...base, monthly: { ...base.monthly, enabled: "yes" } },
    { ...base, extra: true },
  ];
  for (const value of cases) {
    assert.equal(
      reportScheduleInputSchema.safeParse(value).success,
      false,
      `expected rejection for ${JSON.stringify(value)}`,
    );
  }
});

async function isolatedRoot<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `${TEST_TMP_PREFIX}reports-sync-`));
  const savedHome = process.env[ENV.USAGE_HOME];
  process.env[ENV.USAGE_HOME] = dir;
  resetCompositionRootForTests();
  try {
    const root = await getCompositionRoot();
    try {
      return await fn();
    } finally {
      await root.scheduler.stop();
    }
  } finally {
    resetCompositionRootForTests();
    if (savedHome === undefined) delete process.env[ENV.USAGE_HOME];
    else process.env[ENV.USAGE_HOME] = savedHome;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

test("sync persists all three tasks independently and disables legacy", async () => {
  await isolatedRoot(async () => {
    const result = await syncReportScheduleToTaskPreference(base);
    assert.deepEqual(result, { ok: true });
    const root = await getCompositionRoot();
    assert.deepEqual(await root.preferences.get("reports.generate.daily"), {
      enabled: true,
      schedule: { kind: "daily", localTime: "18:30" },
    });
    assert.deepEqual(await root.preferences.get("reports.generate.weekly"), {
      enabled: true,
      schedule: { kind: "weekly", weekday: 7, localTime: "09:00" },
    });
    assert.deepEqual(await root.preferences.get("reports.generate.monthly"), {
      enabled: true,
      schedule: { kind: "monthly", dayOfMonth: 31, localTime: "08:15" },
    });
    assert.deepEqual(await root.preferences.get("reports.generate"), {
      enabled: false,
    });
  });
});

test("composition startup migrates the legacy app preference before scheduling", async () => {
  const dir = await mkdtemp(
    join(tmpdir(), `${TEST_TMP_PREFIX}reports-migrate-`),
  );
  const savedHome = process.env[ENV.USAGE_HOME];
  process.env[ENV.USAGE_HOME] = dir;
  resetCompositionRootForTests();
  try {
    const first = await getCompositionRoot();
    first.database.features.appPreferences.set({
      key: "tt.report.schedule",
      value: {
        configured: true,
        enabled: true,
        granularity: "monthly",
        time: "07:45",
        dayOfWeek: 1,
        dayOfMonth: 31,
      },
      updatedAtMs: 1,
    });
    await first.scheduler.stop();
    resetCompositionRootForTests();

    const migrated = await getCompositionRoot();
    const stored =
      migrated.database.features.appPreferences.get(
        "tt.report.schedule",
      )?.value;
    assert.equal((stored as { version?: number } | undefined)?.version, 2);
    assert.deepEqual(
      await migrated.preferences.get("reports.generate.monthly"),
      {
        enabled: true,
        schedule: { kind: "monthly", dayOfMonth: 31, localTime: "07:45" },
      },
    );
    assert.deepEqual(await migrated.preferences.get("reports.generate"), {
      enabled: false,
    });
    await migrated.scheduler.stop();
  } finally {
    resetCompositionRootForTests();
    if (savedHome === undefined) delete process.env[ENV.USAGE_HOME];
    else process.env[ENV.USAGE_HOME] = savedHome;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("independent switches do not overwrite another task preference", async () => {
  await isolatedRoot(async () => {
    await syncReportScheduleToTaskPreference(base);
    await syncReportScheduleToTaskPreference({
      ...base,
      daily: { ...base.daily, enabled: false },
    });
    const root = await getCompositionRoot();
    assert.deepEqual(await root.preferences.get("reports.generate.daily"), {
      enabled: false,
    });
    assert.equal(
      (await root.preferences.get("reports.generate.weekly"))?.enabled,
      true,
    );
    assert.equal(
      (await root.preferences.get("reports.generate.monthly"))?.enabled,
      true,
    );
  });
});

test("status reads and reports each task independently", async () => {
  const requested: string[] = [];
  const listRuns = async ({ taskId }: { taskId: string; limit: number }) => {
    requested.push(taskId);
    return {
      ok: true as const,
      value:
        taskId === "reports.generate.weekly"
          ? ([
              {
                trigger: "schedule" as const,
                status: "succeeded" as const,
                finishedAt: "2026-08-23T09:01:00.000Z",
              },
            ] as const)
          : [],
    };
  };
  const now = new Date(2026, 7, 27, 12, 0);
  const statuses = await Promise.all(
    (["daily", "weekly", "monthly"] as const).map((kind) =>
      reportScheduleStatusFor({ kind, config: base, now, listRuns }),
    ),
  );
  assert.deepEqual(requested, [
    "reports.generate.daily",
    "reports.generate.weekly",
    "reports.generate.monthly",
  ]);
  assert.equal(statuses[0]?.lastRun, null);
  assert.equal(statuses[1]?.lastRun?.status, "succeeded");
  assert.ok(statuses[0]?.nextRunAt);
  assert.ok(statuses[1]?.nextRunAt);
  assert.ok(statuses[2]?.nextRunAt);
});

test("buildReportPeriod resolves day/week/month keys and rejects malformed ones", () => {
  assert.deepEqual(buildReportPeriod("day", "2026-08-15"), {
    granularity: "day",
    key: "2026-08-15",
  });
  assert.deepEqual(buildReportPeriod("week", "2026-08-10"), {
    granularity: "week",
    key: "2026-08-10",
  });
  assert.deepEqual(buildReportPeriod("month", "2026-08"), {
    granularity: "month",
    key: "2026-08",
  });
  assert.equal(buildReportPeriod("day", "2026-8-5"), undefined);
  assert.equal(buildReportPeriod("month", "2026-08-15"), undefined);
});
