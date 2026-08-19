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
  reportScheduleToPreferenceRequest,
  reportScheduleToTaskSchedule,
  syncReportScheduleToTaskPreference,
  type ReportScheduleInput,
} from "./server-fns.ts";

const base: ReportScheduleInput = {
  configured: true,
  enabled: true,
  granularity: "daily",
  time: "18:30",
  dayOfWeek: 1,
  dayOfMonth: 1,
};

test("reportScheduleToTaskSchedule maps daily/weekly/monthly configs", () => {
  assert.deepEqual(
    reportScheduleToTaskSchedule({
      ...base,
      granularity: "daily",
      time: "09:00",
    }),
    { kind: "daily", localTime: "09:00" },
  );
  // The report config numbers weekdays 0=Monday…6=Sunday; the task schedule
  // uses 1=Monday…7=Sunday.
  assert.deepEqual(
    reportScheduleToTaskSchedule({
      ...base,
      granularity: "weekly",
      dayOfWeek: 0,
      time: "09:00",
    }),
    { kind: "weekly", weekday: 1, localTime: "09:00" },
  );
  assert.deepEqual(
    reportScheduleToTaskSchedule({
      ...base,
      granularity: "weekly",
      dayOfWeek: 6,
      time: "09:00",
    }),
    { kind: "weekly", weekday: 7, localTime: "09:00" },
  );
  assert.deepEqual(
    reportScheduleToTaskSchedule({
      ...base,
      granularity: "monthly",
      dayOfMonth: 15,
      time: "09:00",
    }),
    { kind: "monthly", dayOfMonth: 15, localTime: "09:00" },
  );
});

test("reportScheduleToPreferenceRequest omits the schedule when disabled", () => {
  assert.deepEqual(
    reportScheduleToPreferenceRequest({ ...base, enabled: false }),
    {
      taskId: "reports.generate",
      enabled: false,
    },
  );
  const enabled = reportScheduleToPreferenceRequest({
    ...base,
    granularity: "weekly",
    dayOfWeek: 2,
  });
  assert.deepEqual(enabled, {
    taskId: "reports.generate",
    enabled: true,
    schedule: { kind: "weekly", weekday: 3, localTime: "18:30" },
  });
});

test("reportScheduleInputSchema rejects malformed input", () => {
  const cases: unknown[] = [
    { ...base, granularity: "yearly" },
    { ...base, time: "25:00" },
    { ...base, time: "09:60" },
    { ...base, time: "9:30" },
    { ...base, dayOfWeek: -1 },
    { ...base, dayOfWeek: 7 },
    { ...base, dayOfMonth: 0 },
    { ...base, dayOfMonth: 32 },
    { ...base, enabled: "yes" },
    { ...base, configured: "yes" },
    { ...base, extra: true },
    { ...base, time: undefined },
  ];
  for (const value of cases) {
    assert.equal(
      reportScheduleInputSchema.safeParse(value).success,
      false,
      `expected rejection for ${JSON.stringify(value)}`,
    );
  }
});

test("reportScheduleInputSchema accepts a valid full config", () => {
  assert.equal(reportScheduleInputSchema.safeParse(base).success, true);
  assert.equal(
    reportScheduleInputSchema.safeParse({
      ...base,
      granularity: "monthly",
      dayOfMonth: 31,
      time: "23:59",
      dayOfWeek: 0,
    }).success,
    true,
  );
});

/**
 * End-to-end sync through the REAL composition root against an isolated
 * usage-home env var (same pattern as composition.integration.test.ts), so the
 * test exercises repository → task-api wiring.
 */
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

test("syncReportScheduleToTaskPreference persists the mapped preference (daily)", async () => {
  await isolatedRoot(async () => {
    const result = await syncReportScheduleToTaskPreference({
      ...base,
      granularity: "daily",
      time: "07:30",
    });
    assert.deepEqual(result, { ok: true });
    const root = await getCompositionRoot();
    const pref = await root.preferences.get("reports.generate");
    assert.deepEqual(pref, {
      enabled: true,
      schedule: { kind: "daily", localTime: "07:30" },
    });
  });
});

test("syncReportScheduleToTaskPreference persists weekly and monthly schedules", async () => {
  await isolatedRoot(async () => {
    const weekly = await syncReportScheduleToTaskPreference({
      ...base,
      granularity: "weekly",
      dayOfWeek: 6,
      time: "09:00",
    });
    assert.deepEqual(weekly, { ok: true });
    const monthly = await syncReportScheduleToTaskPreference({
      ...base,
      granularity: "monthly",
      dayOfMonth: 31,
      time: "09:00",
    });
    assert.deepEqual(monthly, { ok: true });
    const root = await getCompositionRoot();
    const pref = await root.preferences.get("reports.generate");
    assert.deepEqual(pref, {
      enabled: true,
      schedule: { kind: "monthly", dayOfMonth: 31, localTime: "09:00" },
    });
  });
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
  assert.equal(buildReportPeriod(undefined, "2026-08-15"), undefined);
  assert.equal(buildReportPeriod("day", undefined), undefined);
});

test("syncReportScheduleToTaskPreference with enabled=false disables the task", async () => {
  await isolatedRoot(async () => {
    await syncReportScheduleToTaskPreference({ ...base, enabled: true });
    const disabled = await syncReportScheduleToTaskPreference({
      ...base,
      enabled: false,
    });
    assert.deepEqual(disabled, { ok: true });
    const root = await getCompositionRoot();
    const pref = await root.preferences.get("reports.generate");
    assert.deepEqual(pref, { enabled: false });
  });
});
