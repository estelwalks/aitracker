import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_REPORT_SCHEDULE,
  nextReportScheduleAt,
  parseReportSchedule,
  serializeReportSchedule,
} from "./report-schedule.ts";

test("parseReportSchedule returns defaults for empty input", () => {
  assert.deepEqual(parseReportSchedule(null), DEFAULT_REPORT_SCHEDULE);
  assert.deepEqual(parseReportSchedule(""), DEFAULT_REPORT_SCHEDULE);
  assert.deepEqual(parseReportSchedule("{not json"), DEFAULT_REPORT_SCHEDULE);
});

test("parseReportSchedule round-trips a valid config and clamps invalid fields", () => {
  const config = {
    configured: true,
    enabled: true,
    granularity: "weekly" as const,
    time: "18:30",
    dayOfWeek: 2,
    dayOfMonth: 1,
  };
  const parsed = parseReportSchedule(serializeReportSchedule(config));
  assert.deepEqual(parsed, config);

  const clamped = parseReportSchedule(
    JSON.stringify({
      configured: true,
      enabled: false,
      granularity: "yearly", // invalid → default daily
      time: "25:99", // invalid → default 18:30
      dayOfWeek: 9, // invalid → default 1
      dayOfMonth: 0, // invalid → default 1
    }),
  );
  assert.equal(clamped.granularity, "daily");
  assert.equal(clamped.time, "18:30");
  assert.equal(clamped.dayOfWeek, 1);
  assert.equal(clamped.dayOfMonth, 1);
  assert.equal(clamped.configured, true);
});

test("parseReportSchedule accepts valid monthly/monthly variants", () => {
  const monthly = parseReportSchedule(
    JSON.stringify({
      configured: true,
      enabled: true,
      granularity: "monthly",
      time: "09:00",
      dayOfWeek: 1,
      dayOfMonth: 15,
    }),
  );
  assert.equal(monthly.granularity, "monthly");
  assert.equal(monthly.time, "09:00");
  assert.equal(monthly.dayOfMonth, 15);
});

test("nextReportScheduleAt follows local daily, weekly and month-end semantics", () => {
  const base = new Date(2026, 7, 28, 18, 0, 0, 0); // Friday
  const common = {
    configured: true,
    enabled: true,
    time: "18:30",
    dayOfWeek: 0,
    dayOfMonth: 31,
  } as const;
  assert.equal(
    nextReportScheduleAt({ ...common, granularity: "daily" }, base).getDate(),
    28,
  );
  assert.equal(
    nextReportScheduleAt({ ...common, granularity: "weekly" }, base).getDate(),
    31,
  );
  const january = new Date(2026, 0, 31, 19, 0, 0, 0);
  const monthly = nextReportScheduleAt(
    { ...common, granularity: "monthly" },
    january,
  );
  assert.equal(monthly.getMonth(), 1);
  assert.equal(monthly.getDate(), 28);
});

test("reports page uses the collapsed schedule card while Settings stays expanded", async () => {
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
  assert.match(component, /mt-3 divide-y divide-border\/40/);
  assert.match(reportsPage, /<ReportSchedule \/>/);
  assert.match(settingsPage, /<ReportSchedule variant="settings" \/>/);
});
