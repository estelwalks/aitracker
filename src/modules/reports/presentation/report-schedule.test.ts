import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_REPORT_SCHEDULE,
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
