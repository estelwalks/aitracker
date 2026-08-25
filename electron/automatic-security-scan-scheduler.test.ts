import assert from "node:assert/strict";
import test from "node:test";

import type {
  SecurityScanSchedule,
  SecurityScanScheduleRuntime,
} from "./contracts.js";
import {
  createAutomaticSecurityScanScheduler,
  nextAutomaticSecurityScanAt,
  securityScheduleFingerprint,
  type AutomaticSecurityScanAttempt,
  type AutomaticSecurityScanClock,
} from "./automatic-security-scan-scheduler.js";

const ENABLED_SCHEDULE: SecurityScanSchedule = {
  enabled: true,
  cycle: "hourly",
  time: "13:24",
  scope: "all",
  agents: [],
  dir: null,
  notify: false,
};

class FakeClock implements AutomaticSecurityScanClock {
  #now: number;
  #nextId = 1;
  readonly #timers = new Map<
    number,
    { readonly at: number; readonly handler: () => void }
  >();

  constructor(now: string) {
    this.#now = Date.parse(now);
  }

  now(): Date {
    return new Date(this.#now);
  }

  setTimeout(handler: () => void, delayMs: number): unknown {
    const id = this.#nextId++;
    this.#timers.set(id, { at: this.#now + Math.max(0, delayMs), handler });
    return id;
  }

  clearTimeout(timer: unknown): void {
    this.#timers.delete(timer as number);
  }

  async advanceTo(target: string): Promise<void> {
    const targetTime = Date.parse(target);
    while (true) {
      const due = [...this.#timers.entries()]
        .filter(([, value]) => value.at <= targetTime)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      this.#now = due[1].at;
      this.#timers.delete(due[0]);
      due[1].handler();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.#now = targetTime;
    await Promise.resolve();
  }
}

function harness(options?: {
  readonly now?: string;
  readonly runtime?: SecurityScanScheduleRuntime | null;
  readonly outcomes?: AutomaticSecurityScanAttempt[];
}) {
  const clock = new FakeClock(options?.now ?? "2026-08-25T02:00:00.000Z");
  let schedule = structuredClone(ENABLED_SCHEDULE);
  let runtime = structuredClone(options?.runtime ?? null);
  const attempts: string[] = [];
  const outcomes = [...(options?.outcomes ?? ["started"])];
  const scheduler = createAutomaticSecurityScanScheduler({
    clock,
    retryDelayMs: 5_000,
    readSchedule: async () => structuredClone(schedule),
    readRuntime: async () => structuredClone(runtime),
    writeRuntime: async (next) => {
      runtime = structuredClone(next);
    },
    attempt: async () => {
      attempts.push(clock.now().toISOString());
      return outcomes.shift() ?? "started";
    },
  });
  return {
    attempts,
    clock,
    get runtime() {
      return runtime;
    },
    scheduler,
    setSchedule(next: SecurityScanSchedule) {
      schedule = structuredClone(next);
    },
  };
}

test("arms the next occurrence without scanning immediately", async () => {
  const state = harness();
  await state.scheduler.start();

  assert.deepEqual(state.attempts, []);
  assert.equal(state.runtime?.nextRunAt, "2026-08-25T03:00:00.000Z");
  assert.equal(state.runtime?.pending, false);

  await state.clock.advanceTo("2026-08-25T03:00:00.000Z");
  assert.deepEqual(state.attempts, ["2026-08-25T03:00:00.000Z"]);
  assert.equal(state.runtime?.nextRunAt, "2026-08-25T04:00:00.000Z");
});

test("keeps a busy due run pending and retries until it starts", async () => {
  const state = harness({ outcomes: ["busy", "started"] });
  await state.scheduler.start();
  await state.clock.advanceTo("2026-08-25T03:00:00.000Z");

  assert.equal(state.runtime?.pending, true);
  assert.equal(state.runtime?.nextRunAt, "2026-08-25T03:00:00.000Z");

  await state.clock.advanceTo("2026-08-25T03:00:05.000Z");
  assert.equal(state.attempts.length, 2);
  assert.equal(state.runtime?.pending, false);
  assert.equal(state.runtime?.nextRunAt, "2026-08-25T04:00:05.000Z");
});

test("catches up a persisted deadline missed while the app was stopped", async () => {
  const state = harness({
    runtime: {
      scheduleFingerprint: securityScheduleFingerprint(ENABLED_SCHEDULE),
      nextRunAt: "2026-08-25T01:00:00.000Z",
      pending: false,
      updatedAt: "2026-08-25T01:00:00.000Z",
    },
  });

  await state.scheduler.start();
  assert.deepEqual(state.attempts, ["2026-08-25T02:00:00.000Z"]);
  assert.equal(state.runtime?.nextRunAt, "2026-08-25T03:00:00.000Z");
});

test("catches up once after sleep passes the armed deadline", async () => {
  const state = harness();
  await state.scheduler.start();
  state.scheduler.suspend();
  await state.clock.advanceTo("2026-08-25T03:30:00.000Z");
  assert.deepEqual(state.attempts, []);

  await state.scheduler.resume();
  assert.deepEqual(state.attempts, ["2026-08-25T03:30:00.000Z"]);
  assert.equal(state.runtime?.nextRunAt, "2026-08-25T04:30:00.000Z");
});

test("changing a schedule resets its cursor without an immediate pass", async () => {
  const state = harness();
  await state.scheduler.start();
  const updated = {
    ...ENABLED_SCHEDULE,
    cycle: "daily" as const,
    time: "23:59",
  };
  state.setSchedule(updated);
  await state.scheduler.update(updated);

  assert.deepEqual(state.attempts, []);
  assert.equal(
    state.runtime?.scheduleFingerprint,
    securityScheduleFingerprint(updated),
  );
  assert.equal(state.runtime?.pending, false);
});

test("daily and weekly occurrences follow local wall-clock time", () => {
  const base = new Date(2026, 7, 25, 13, 0, 0, 0);
  const daily = nextAutomaticSecurityScanAt(
    { ...ENABLED_SCHEDULE, cycle: "daily", time: "13:24" },
    base,
  );
  const weekly = nextAutomaticSecurityScanAt(
    { ...ENABLED_SCHEDULE, cycle: "weekly", time: "12:00" },
    base,
  );

  assert.equal(daily.getHours(), 13);
  assert.equal(daily.getMinutes(), 24);
  assert.equal(daily.getDate(), 25);
  assert.equal(weekly.getHours(), 12);
  assert.equal(weekly.getDate(), 1);
  assert.equal(weekly.getMonth(), 8);
});
