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
import { compactScheduleSummaryItems } from "./compact-schedule-summary.ts";

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

test("compact summary uses real next runs for enabled plans", () => {
  const schedule = {
    ...DEFAULT_REPORT_SCHEDULES,
    daily: { enabled: true, time: "18:30" },
    weekly: { enabled: true, time: "09:00", dayOfWeek: 1 },
    monthly: { enabled: false, time: "08:00", dayOfMonth: 31 },
  };
  assert.deepEqual(
    compactScheduleSummaryItems(schedule, {
      daily: {
        lastRun: null,
        nextRunAt: "2026-08-28T10:30:00.000Z",
        pending: false,
      },
      weekly: {
        lastRun: null,
        nextRunAt: "2026-09-01T01:00:00.000Z",
        pending: false,
      },
    }),
    [
      {
        kind: "daily",
        state: "scheduled",
        nextRunAt: "2026-08-28T10:30:00.000Z",
      },
      {
        kind: "weekly",
        state: "scheduled",
        nextRunAt: "2026-09-01T01:00:00.000Z",
      },
    ],
  );
});

test("compact summary distinguishes pending, loading, and all disabled", () => {
  const enabled = {
    ...DEFAULT_REPORT_SCHEDULES,
    daily: { enabled: true, time: "18:30" },
    weekly: { enabled: true, time: "09:00", dayOfWeek: 1 },
  };
  assert.deepEqual(
    compactScheduleSummaryItems(enabled, {
      daily: {
        lastRun: null,
        nextRunAt: "2026-08-28T10:30:00.000Z",
        pending: true,
      },
    }),
    [
      { kind: "daily", state: "pending" },
      { kind: "weekly", state: "loading" },
    ],
  );
  assert.deepEqual(
    compactScheduleSummaryItems(DEFAULT_REPORT_SCHEDULES, null),
    [],
  );
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
  assert.match(component, /summaryItems\.map/);
  assert.doesNotMatch(component, /flex-1 truncate font-mono/);
  const compactEditor = component.slice(
    component.indexOf("function CompactPlanEditor"),
    component.indexOf("function SettingsPlanEditor"),
  );
  const timeInputIndex = compactEditor.indexOf("<TimeInput");
  const weeklyPickerIndex = compactEditor.indexOf('{kind === "weekly"');
  const monthDayInputIndex = compactEditor.indexOf('{kind === "monthly"');
  assert.notEqual(timeInputIndex, -1);
  assert.notEqual(weeklyPickerIndex, -1);
  assert.notEqual(monthDayInputIndex, -1);
  assert.ok(weeklyPickerIndex < timeInputIndex);
  assert.ok(monthDayInputIndex < timeInputIndex);
  assert.equal(compactEditor.match(/<TimeInput/g)?.length, 1);
  const compactHeader = compactEditor.slice(
    compactEditor.indexOf('className="flex items-center gap-2"'),
    compactEditor.indexOf('className="mt-2 flex flex-wrap items-center gap-2"'),
  );
  assert.doesNotMatch(
    compactEditor,
    /planSummary|disabledStatus|schedule\.(?:daily|weekly|monthly)\.time/,
  );
  assert.match(compactHeader, /<ScheduleToggle/);
  assert.match(compactHeader, /<\/span>\s*<ScheduleToggle/);
  assert.match(
    component,
    /COMPACT_CONTROL_CLASS =\s*"security-config-input h-8 w-\[9rem\] py-0 text-\[11px\]"/,
  );
  assert.equal(component.match(/COMPACT_CONTROL_CLASS/g)?.length, 4);
  assert.match(component, /width: "9rem", height: "2rem"/);
  assert.match(reportsPage, /<ReportSchedule \/>/);
  assert.match(settingsPage, /<ReportSchedule variant="settings" \/>/);
});
