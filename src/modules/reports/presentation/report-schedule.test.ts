import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_REPORT_SCHEDULES,
  nextReportScheduleAt,
  parseReportSchedules,
  parseReportSchedulesWithMigration,
  reportSchedulePreferenceRequests,
  reportSchedulesPreferenceValue,
  serializeReportSchedules,
} from "../schedule.ts";

test("v2 report schedules round-trip with three independent switches", () => {
  const config = {
    ...DEFAULT_REPORT_SCHEDULES,
    configured: true,
    daily: { enabled: true, time: "18:30" },
    weekly: { enabled: false, time: "09:00", dayOfWeek: 6 },
    monthly: { enabled: true, time: "08:15", dayOfMonth: 31 },
  } as const;
  assert.deepEqual(
    parseReportSchedules(serializeReportSchedules(config)),
    config,
  );
  assert.deepEqual(reportSchedulesPreferenceValue(config), config);
  const requests = reportSchedulePreferenceRequests(config);
  assert.deepEqual(
    requests.map(({ taskId, enabled }) => ({ taskId, enabled })),
    [
      { taskId: "reports.generate.daily", enabled: true },
      { taskId: "reports.generate.weekly", enabled: false },
      { taskId: "reports.generate.monthly", enabled: true },
      { taskId: "reports.generate", enabled: false },
    ],
  );
});

test("legacy single schedule migrates only its selected cadence without loss", () => {
  const parsed = parseReportSchedulesWithMigration(
    JSON.stringify({
      configured: true,
      enabled: true,
      granularity: "weekly",
      time: "21:45",
      dayOfWeek: 6,
      dayOfMonth: 31,
    }),
  );
  assert.equal(parsed.migratedFromLegacy, true);
  assert.deepEqual(parsed.config.weekly, {
    enabled: true,
    time: "21:45",
    dayOfWeek: 6,
  });
  assert.equal(parsed.config.daily.enabled, false);
  assert.equal(parsed.config.monthly.enabled, false);
});

test("weekly Sunday maps to task weekday 7", () => {
  const requests = reportSchedulePreferenceRequests({
    ...DEFAULT_REPORT_SCHEDULES,
    configured: true,
    weekly: { enabled: true, time: "09:00", dayOfWeek: 6 },
  });
  assert.deepEqual(requests[1], {
    taskId: "reports.generate.weekly",
    enabled: true,
    schedule: { kind: "weekly", weekday: 7, localTime: "09:00" },
  });
});

test("monthly day 31 clamps to 28, 29, 30 or 31 for the target month", () => {
  const schedule = {
    kind: "monthly",
    dayOfMonth: 31,
    localTime: "09:00",
  } as const;
  const cases = [
    [new Date(2026, 1, 1, 8), 28],
    [new Date(2028, 1, 1, 8), 29],
    [new Date(2026, 3, 1, 8), 30],
    [new Date(2026, 4, 1, 8), 31],
  ] as const;
  for (const [from, expectedDay] of cases) {
    assert.equal(nextReportScheduleAt(schedule, from).getDate(), expectedDay);
  }
});

test("reports page uses a collapsed schedule card and Settings stays expanded", async () => {
  const [component, reportsPage, settingsPage] = await Promise.all([
    readFile(new URL("./ReportSchedule.tsx", import.meta.url), "utf8"),
    readFile(new URL("./ReportsPage.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../../settings/presentation/SettingsPage.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(component, /variant = "card"/);
  assert.match(component, /aria-expanded=\{open\}/);
  assert.match(component, /rounded-xl bg-card px-4 py-3/);
  assert.match(component, /SCHEDULE_KINDS\.map/);
  assert.match(reportsPage, /<ReportSchedule \/>/);
  assert.match(settingsPage, /<ReportSchedule variant="settings" \/>/);
});
