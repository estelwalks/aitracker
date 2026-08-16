import assert from "node:assert/strict";
import test from "node:test";
import {
  addPeriods,
  aggregateSessionDensity,
  dayKeyOf,
  monthKeyOf,
  parseDayKey,
  periodContains,
  periodKeyOf,
  periodStartDate,
  sumPeriodDensity,
  weekKeyOf,
} from "./period.ts";

const local = (iso: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`bad day iso: ${iso}`);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

test("day keys are local zero-padded and comparable", () => {
  assert.equal(dayKeyOf(local("2026-08-07")), "2026-08-07");
  assert.equal(dayKeyOf(local("2026-01-03")), "2026-01-03");
  assert.equal(monthKeyOf(local("2026-08-07")), "2026-08");
  // Lexicographic ordering matches chronological ordering.
  assert.equal("2026-08-31" < "2026-09-01", true);
});

test("weeks are Monday-keyed", () => {
  // 2026-08-07 is a Friday.
  assert.equal(weekKeyOf(local("2026-08-07")), "2026-08-03");
  assert.equal(weekKeyOf(local("2026-08-03")), "2026-08-03"); // Monday itself
  assert.equal(weekKeyOf(local("2026-08-02")), "2026-07-27"); // Sunday → prior Mon
});

test("periodKeyOf picks the right bucket", () => {
  const date = local("2026-08-07");
  assert.equal(periodKeyOf("day", date), "2026-08-07");
  assert.equal(periodKeyOf("week", date), "2026-08-03");
  assert.equal(periodKeyOf("month", date), "2026-08");
});

test("periodStartDate parses keys back to local time", () => {
  assert.equal(dayKeyOf(periodStartDate("day", "2026-08-07")!), "2026-08-07");
  assert.equal(dayKeyOf(periodStartDate("week", "2026-08-03")!), "2026-08-03");
  assert.equal(dayKeyOf(periodStartDate("month", "2026-08")!), "2026-08-01");
  assert.equal(periodStartDate("day", "nope"), null);
});

test("addPeriods shifts across boundaries", () => {
  assert.equal(addPeriods("day", "2026-08-31", 1), "2026-09-01");
  assert.equal(addPeriods("week", "2026-08-03", -1), "2026-07-27");
  assert.equal(addPeriods("month", "2026-08", 1), "2026-09");
  assert.equal(addPeriods("month", "2026-12", 1), "2027-01");
});

test("periodContains uses half-open intervals", () => {
  assert.equal(periodContains("day", "2026-08-07", "2026-08-07"), true);
  assert.equal(periodContains("day", "2026-08-07", "2026-08-08"), false);
  assert.equal(periodContains("week", "2026-08-03", "2026-08-07"), true);
  assert.equal(periodContains("week", "2026-08-03", "2026-08-10"), false);
  assert.equal(periodContains("month", "2026-08", "2026-08-31"), true);
  assert.equal(periodContains("month", "2026-08", "2026-09-01"), false);
});

test("aggregateSessionDensity builds real per-day totals", () => {
  const sessions = [
    {
      startedAt: "2026-08-07T01:00:00Z",
      totals: { totalTokens: 10 },
      cost: { knownUsd: 0.5 },
    },
    {
      startedAt: "2026-08-07T10:00:00+08:00",
      totals: { totalTokens: 20 },
      cost: { knownUsd: 1 },
    },
    {
      startedAt: "bad-date",
      totals: { totalTokens: 5 },
      cost: { knownUsd: 9 },
    },
  ];
  const density = aggregateSessionDensity(sessions);
  assert.equal(density.total, 2);
  const day = density.days["2026-08-07"];
  assert.ok(day);
  assert.equal(day.count, 2);
  assert.equal(day.tokens, 30);
  assert.equal(day.knownUsd, 1.5);
});

test("sumPeriodDensity aggregates day metrics into week/month buckets", () => {
  const density = aggregateSessionDensity([
    {
      startedAt: "2026-08-03T01:00:00Z",
      totals: { totalTokens: 5 },
      cost: { knownUsd: 0.25 },
    },
    {
      startedAt: "2026-08-07T01:00:00Z",
      totals: { totalTokens: 5 },
      cost: { knownUsd: 0.25 },
    },
    {
      startedAt: "2026-08-10T01:00:00Z",
      totals: { totalTokens: 5 },
      cost: { knownUsd: 0.25 },
    },
  ]);
  const week = sumPeriodDensity(density, "week", "2026-08-03");
  assert.equal(week.count, 2);
  assert.equal(week.tokens, 10);
  const month = sumPeriodDensity(density, "month", "2026-08");
  assert.equal(month.count, 3);
  assert.equal(month.knownUsd, 0.75);
});

test("parseDayKey is a safe day-key reader", () => {
  assert.equal(dayKeyOf(parseDayKey("2026-08-07")!), "2026-08-07");
  assert.equal(parseDayKey("not-a-key"), null);
});
