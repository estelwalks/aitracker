import assert from "node:assert/strict";
import test from "node:test";

import { BUILTIN_REPORT_DEFINITIONS } from "../domain.ts";
import {
  createReportContextPort,
  type SnapshotSession,
} from "./usage-context-adapter.ts";

const daily = BUILTIN_REPORT_DEFINITIONS[0]!;
const weekly = BUILTIN_REPORT_DEFINITIONS[1]!;

/** ISO instant whose LOCAL wall clock is the given date/time (tz-independent). */
const localIso = (year: number, month: number, day: number, hour = 10) =>
  new Date(year, month - 1, day, hour).toISOString();

function session(
  iso: string,
  extra: Partial<SnapshotSession> = {},
): SnapshotSession {
  return {
    source: "claude-code",
    title: "T",
    projectKey: "p1",
    startedAt: iso,
    turns: 5,
    editTurns: 1,
    totals: { totalTokens: 1000 },
    cost: { knownUsd: 0.01 },
    durationMs: 600_000,
    ...extra,
  };
}

function snapshotWith(sessions: readonly SnapshotSession[]) {
  return {
    ensureHydrated: async () => undefined,
    readLatest: () => ({ data: { sessions } }),
  };
}

const AUG_SAMPLE = [
  session(localIso(2026, 8, 15, 10)), // local 08-15
  session(localIso(2026, 8, 14, 10)), // local 08-14
  session(localIso(2026, 8, 15, 22)), // local 08-15
  session(localIso(2026, 8, 16, 9)), //  local 08-16
];

test("day period aggregates only that local day", async () => {
  const port = createReportContextPort({ snapshot: snapshotWith(AUG_SAMPLE) });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-08-15" },
  });
  assert.equal(ctx.stats?.sessions, 2);
  assert.equal(ctx.stats?.tokens, 2000);
  assert.equal(ctx.stats?.costUsd, 0.02);
  assert.deepEqual(
    ctx.evidence.map((item) => item.ref),
    ["usage:2026-08-15"],
  );
});

test("week period covers its Monday–Sunday range", async () => {
  const port = createReportContextPort({ snapshot: snapshotWith(AUG_SAMPLE) });
  const ctx = await port.collect({
    definition: weekly,
    // 2026-08-10 is a Monday; the week covers 08-10..08-16.
    period: { granularity: "week", key: "2026-08-10" },
  });
  assert.equal(ctx.stats?.sessions, 4);
  assert.deepEqual(
    ctx.evidence.map((item) => item.ref),
    ["usage:2026-08-10"],
  );
});

test("month period aggregates the whole month", async () => {
  const port = createReportContextPort({ snapshot: snapshotWith(AUG_SAMPLE) });
  const ctx = await port.collect({
    definition: weekly,
    period: { granularity: "month", key: "2026-08" },
  });
  assert.equal(ctx.stats?.sessions, 4);
  assert.deepEqual(
    ctx.evidence.map((item) => item.ref),
    ["usage:2026-08-01"],
  );
});

test("an empty selected period yields an honest zero-stats context", async () => {
  const port = createReportContextPort({ snapshot: snapshotWith(AUG_SAMPLE) });
  const ctx = await port.collect({
    definition: daily,
    period: { granularity: "day", key: "2026-07-01" },
  });
  assert.equal(ctx.stats?.sessions, 0);
  assert.equal(ctx.stats?.tokens, 0);
  assert.deepEqual(ctx.evidence, []);
});

test("no period falls back to the current local day for daily", async () => {
  const now = new Date();
  const today = session(
    localIso(now.getFullYear(), now.getMonth() + 1, now.getDate(), 12),
  );
  const port = createReportContextPort({ snapshot: snapshotWith([today]) });
  const ctx = await port.collect({ definition: daily });
  assert.equal(ctx.stats?.sessions, 1);
  assert.equal(ctx.stats?.tokens, 1000);
});
