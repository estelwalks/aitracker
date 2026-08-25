import { createHash } from "node:crypto";

import type {
  SecurityScanSchedule,
  SecurityScanScheduleRuntime,
} from "./contracts.js";

export type AutomaticSecurityScanAttempt = "started" | "busy" | "failed";

export interface AutomaticSecurityScanClock {
  now(): Date;
  setTimeout(handler: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface AutomaticSecurityScanSchedulerOptions {
  readonly readSchedule: () => Promise<SecurityScanSchedule>;
  readonly readRuntime: () => Promise<SecurityScanScheduleRuntime | null>;
  readonly writeRuntime: (
    runtime: SecurityScanScheduleRuntime,
  ) => Promise<void>;
  readonly attempt: (
    schedule: SecurityScanSchedule,
  ) => Promise<AutomaticSecurityScanAttempt>;
  readonly clock?: AutomaticSecurityScanClock;
  readonly retryDelayMs?: number;
  readonly failureRetryDelayMs?: number;
}

const systemClock: AutomaticSecurityScanClock = {
  now: () => new Date(),
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (timer) => clearTimeout(timer as NodeJS.Timeout),
};

export function securityScheduleFingerprint(
  schedule: SecurityScanSchedule,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        enabled: schedule.enabled,
        cycle: schedule.cycle,
        time: schedule.time,
        scope: schedule.scope,
        agents: [...schedule.agents].sort(),
        dir: schedule.dir,
        notify: schedule.notify,
      }),
    )
    .digest("hex");
}

function timeParts(time: string): [number, number] {
  const [hour, minute] = time.split(":").map(Number);
  return [hour!, minute!];
}

/** Computes the next configured occurrence strictly after `base`. */
export function nextAutomaticSecurityScanAt(
  schedule: SecurityScanSchedule,
  base: Date,
): Date {
  if (schedule.cycle === "hourly")
    return new Date(base.getTime() + 60 * 60 * 1_000);
  const [hour, minute] = timeParts(schedule.time);
  const next = new Date(base);
  next.setHours(hour, minute, 0, 0);
  if (schedule.cycle === "daily") {
    if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }
  if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 7);
  return next;
}

export interface AutomaticSecurityScanScheduler {
  start(): Promise<void>;
  update(schedule: SecurityScanSchedule): Promise<void>;
  suspend(): void;
  resume(): Promise<void>;
  stop(): void;
}

/**
 * Durable, single-timer scheduler. A due pass that finds the scanner busy stays
 * pending and retries until it starts; restart/resume uses the persisted cursor
 * to catch up instead of silently dropping the occurrence.
 */
export function createAutomaticSecurityScanScheduler(
  options: AutomaticSecurityScanSchedulerOptions,
): AutomaticSecurityScanScheduler {
  const clock = options.clock ?? systemClock;
  const retryDelayMs = options.retryDelayMs ?? 5_000;
  const failureRetryDelayMs = options.failureRetryDelayMs ?? 60_000;
  let timer: unknown;
  let generation = 0;
  let stopped = false;

  const clearTimer = () => {
    if (timer === undefined) return;
    clock.clearTimeout(timer);
    timer = undefined;
  };

  const runtimeFor = (
    schedule: SecurityScanSchedule,
    nextRunAt: string | null,
    pending: boolean,
  ): SecurityScanScheduleRuntime => ({
    scheduleFingerprint: securityScheduleFingerprint(schedule),
    nextRunAt,
    pending,
    updatedAt: clock.now().toISOString(),
  });

  const persist = async (
    schedule: SecurityScanSchedule,
    nextRunAt: string | null,
    pending: boolean,
  ) => options.writeRuntime(runtimeFor(schedule, nextRunAt, pending));

  const armRetry = (
    schedule: SecurityScanSchedule,
    dueAt: string,
    expectedGeneration: number,
    delayMs: number,
  ) => {
    clearTimer();
    timer = clock.setTimeout(() => {
      timer = undefined;
      void attemptDue(schedule, dueAt, expectedGeneration);
    }, delayMs);
  };

  const armOccurrence = (
    schedule: SecurityScanSchedule,
    dueAt: string,
    expectedGeneration: number,
  ) => {
    clearTimer();
    const delayMs = Math.max(0, Date.parse(dueAt) - clock.now().getTime());
    timer = clock.setTimeout(() => {
      timer = undefined;
      void attemptDue(schedule, dueAt, expectedGeneration);
    }, delayMs);
  };

  const attemptDue = async (
    schedule: SecurityScanSchedule,
    dueAt: string,
    expectedGeneration: number,
  ): Promise<void> => {
    if (stopped || expectedGeneration !== generation) return;
    await persist(schedule, dueAt, true);
    if (stopped || expectedGeneration !== generation) return;
    const outcome = await options.attempt(schedule);
    if (stopped || expectedGeneration !== generation) return;
    if (outcome !== "started") {
      armRetry(
        schedule,
        dueAt,
        expectedGeneration,
        outcome === "busy" ? retryDelayMs : failureRetryDelayMs,
      );
      return;
    }
    const next = nextAutomaticSecurityScanAt(
      schedule,
      clock.now(),
    ).toISOString();
    await persist(schedule, next, false);
    if (stopped || expectedGeneration !== generation) return;
    armOccurrence(schedule, next, expectedGeneration);
  };

  const armFresh = async (
    schedule: SecurityScanSchedule,
    expectedGeneration: number,
  ) => {
    if (!schedule.enabled) {
      await persist(schedule, null, false);
      return;
    }
    const next = nextAutomaticSecurityScanAt(
      schedule,
      clock.now(),
    ).toISOString();
    await persist(schedule, next, false);
    if (stopped || expectedGeneration !== generation) return;
    armOccurrence(schedule, next, expectedGeneration);
  };

  const reconcile = async (): Promise<void> => {
    const expectedGeneration = ++generation;
    stopped = false;
    clearTimer();
    const [schedule, previous] = await Promise.all([
      options.readSchedule(),
      options.readRuntime(),
    ]);
    if (stopped || expectedGeneration !== generation) return;
    if (!schedule.enabled) {
      await persist(schedule, null, false);
      return;
    }
    const fingerprint = securityScheduleFingerprint(schedule);
    if (
      previous?.scheduleFingerprint !== fingerprint ||
      previous.nextRunAt == null
    ) {
      await armFresh(schedule, expectedGeneration);
      return;
    }
    if (
      previous.pending ||
      Date.parse(previous.nextRunAt) <= clock.now().getTime()
    ) {
      await attemptDue(schedule, previous.nextRunAt, expectedGeneration);
      return;
    }
    armOccurrence(schedule, previous.nextRunAt, expectedGeneration);
  };

  return {
    start: reconcile,
    async update(schedule) {
      const expectedGeneration = ++generation;
      stopped = false;
      clearTimer();
      await armFresh(schedule, expectedGeneration);
    },
    suspend() {
      generation += 1;
      clearTimer();
    },
    resume: reconcile,
    stop() {
      stopped = true;
      generation += 1;
      clearTimer();
    },
  };
}
