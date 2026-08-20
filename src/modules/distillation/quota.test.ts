import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ENV, TEST_TMP_PREFIX } from "../../lib/app-config.ts";
import {
  getCompositionRoot,
  resetCompositionRootForTests,
} from "../../app/composition.server.ts";
import { DatabaseHost } from "../../platform/database/database-host.server.ts";
import { runMigrations } from "../../platform/database/migration-runner.server.ts";
import { createSessionQueryService } from "../sessions/index.ts";
import type { SessionSummary } from "../sessions/contracts.ts";
import { createDistillationApplication } from "./application/index.ts";
import type { DistillationRequest } from "./contracts.ts";
import { createSqliteDistillQuotaStore } from "./infrastructure/sqlite-quota-store.server.ts";
import {
  DISTILL_DAILY_QUOTA,
  distillDailyQuotaLimit,
  localDateKey,
  type DistillQuota,
} from "./quota.ts";
import { loadDistillation } from "./api.server.ts";

const FIXED_NOW = new Date("2026-08-07T12:00:00");
const TODAY = "2026-08-07";

const session = (id: string): SessionSummary => ({
  sessionId: id,
  source: "codex",
  title: `Session ${id}`,
  projectKey: "demo",
  model: "model-a",
  startedAt: "2026-08-07T00:00:00.000Z",
  endedAt: "2026-08-07T00:01:00.000Z",
  durationMs: 60_000,
  turns: 3,
  editTurns: 1,
  retryTurns: 0,
  totals: {
    inputTokens: 1,
    outputTokens: 2,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 3,
  },
  cost: {
    knownUsd: 0,
    estimatedUsd: 0,
    cacheSavingsUsd: 0,
    pricedEvents: 0,
    estimatedEvents: 0,
    unknownEvents: 0,
    unknownModels: [],
    complete: true,
  },
  subagentCalls: 0,
  status: "available",
  statusReason: null,
  resumeAvailable: true,
});

const execution = () => ({
  summary: {
    requestId: "req-1",
    modelId: "model-a",
    providerId: "provider-a",
    promptVersionId: "distill",
    promptVersion: 1,
    status: "completed" as const,
    cost: {
      confidence: "estimated" as const,
      currency: "USD" as const,
      reason: "estimated" as const,
    },
    usedFallback: false,
  },
  response: {
    providerId: "provider-a",
    modelId: "model-a",
    text: "safe candidate",
  },
});

const request = (
  overrides: Record<string, unknown> = {},
): DistillationRequest => ({
  requestId: "req-1",
  selection: {
    sessionRefs: [{ source: "codex", sessionId: "s1" }],
  },
  modelId: "model-a",
  prompt: { id: "distill", version: 1, template: "Summarize metadata" },
  ...overrides,
});

/** In-memory `DistillQuotaPort` double that records every call. */
function fakeQuota(
  initial: DistillQuota = { date: TODAY, used: 0, limit: DISTILL_DAILY_QUOTA },
) {
  let state = { ...initial };
  const calls: string[] = [];
  return {
    port: {
      async read() {
        calls.push("read");
        return { ...state };
      },
      async increment(date: string) {
        calls.push(`increment:${date}`);
        state = {
          date,
          used: state.date === date ? state.used + 1 : 1,
          limit: state.limit,
        };
        return { ...state };
      },
    },
    calls,
    snapshot: () => ({ ...state }),
  };
}

interface Harness {
  app: ReturnType<typeof createDistillationApplication>;
  aiInvoked(): boolean;
  calls: string[];
  snapshot(): DistillQuota;
}

/**
 * Application harness with an optional quota port. `quota: false` omits the
 * port entirely (degrade-to-unlimited path); `failRead`/`failIncrement`
 * simulate ledger I/O failures (which must never block distillation).
 */
function setupApp(
  options: {
    quota?: boolean;
    used?: number;
    limit?: number;
    failRead?: boolean;
    failIncrement?: boolean;
  } = {},
): Harness {
  const {
    quota = true,
    used = 0,
    limit = DISTILL_DAILY_QUOTA,
    failRead = false,
    failIncrement = false,
  } = options;
  const state = fakeQuota({ date: TODAY, used, limit });
  let invoked = false;
  const app = createDistillationApplication({
    sessions: createSessionQueryService({ list: async () => [session("s1")] }),
    ai: {
      execute: async () => {
        invoked = true;
        return execution();
      },
    },
    ...(quota
      ? {
          quota: {
            async read() {
              if (failRead) throw new Error("quota read exploded");
              return state.port.read();
            },
            async increment(date: string) {
              if (failIncrement) throw new Error("quota write exploded");
              return state.port.increment(date);
            },
          },
        }
      : {}),
    createCandidateId: () => "candidate-1",
    now: () => FIXED_NOW,
  });
  return {
    app,
    aiInvoked: () => invoked,
    calls: state.calls,
    snapshot: state.snapshot,
  };
}

function database(t: { after(fn: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), `${TEST_TMP_PREFIX}quota-`));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return host;
}

test("localDateKey renders the local calendar day as YYYY-MM-DD", () => {
  assert.equal(localDateKey(new Date("2026-08-07T12:00:00")), "2026-08-07");
  assert.equal(localDateKey(new Date("2026-01-02T23:59:59")), "2026-01-02");
});

test("sqlite quota store read() defaults to the local calendar day", async (t) => {
  const port = createSqliteDistillQuotaStore(database(t), { limit: 20 });
  const current = await port.read();
  // The un-injected clock is `localDateKey(new Date())`, not the UTC day.
  assert.equal(current.date, localDateKey(new Date()));
  assert.deepEqual(current, { date: current.date, used: 0, limit: 20 });
});

test("sqlite quota store shares one local date key between read and increment", async (t) => {
  // A fixed late-evening local instant: even when the UTC day rolls over, the
  // injected clock keeps read() and increment() on the same local key.
  const host = database(t);
  const today = () => localDateKey(new Date(2026, 7, 7, 23, 30));
  const port = createSqliteDistillQuotaStore(host, { limit: 20, today });
  assert.equal((await port.read()).date, "2026-08-07");
  const incremented = await port.increment("2026-08-07");
  assert.deepEqual(incremented, { date: "2026-08-07", used: 1, limit: 20 });
});

test("distillDailyQuotaLimit falls back to the default and parses the env override", () => {
  assert.equal(
    distillDailyQuotaLimit(() => ({})),
    DISTILL_DAILY_QUOTA,
  );
  assert.equal(
    distillDailyQuotaLimit(() => ({ [ENV.DISTILL_DAILY_QUOTA]: "5" })),
    5,
  );
  // Invalid values (non-integer, zero, negative) degrade to the default.
  assert.equal(
    distillDailyQuotaLimit(() => ({ [ENV.DISTILL_DAILY_QUOTA]: "abc" })),
    DISTILL_DAILY_QUOTA,
  );
  assert.equal(
    distillDailyQuotaLimit(() => ({ [ENV.DISTILL_DAILY_QUOTA]: "0" })),
    DISTILL_DAILY_QUOTA,
  );
});

test("sqlite quota store accumulates same-date increments and reports the row", async (t) => {
  const port = createSqliteDistillQuotaStore(database(t), {
    limit: 20,
    today: () => TODAY,
  });
  await port.increment(TODAY);
  await port.increment(TODAY);
  const current = await port.read();
  assert.deepEqual(current, { date: TODAY, used: 2, limit: 20 });
  assert.equal(Math.max(0, current.limit - current.used), 18);
});

test("sqlite quota store resets the counter when the date changes", async (t) => {
  const port = createSqliteDistillQuotaStore(database(t), {
    limit: 20,
    today: () => "2026-08-08",
  });
  await port.increment("2026-08-07");
  await port.increment("2026-08-07");
  const nextDay = await port.increment("2026-08-08");
  assert.deepEqual(nextDay, { date: "2026-08-08", used: 1, limit: 20 });
});

test("a real-model request with exhausted quota is rejected before the model runs", async () => {
  const harness = setupApp({ used: 20, limit: 20 });
  const result = await harness.app.start(request());
  assert.equal(result.ok, false);
  assert.equal(
    result.ok ? "" : result.error.code,
    "errors.distillation.quotaExceeded",
  );
  assert.equal(harness.aiInvoked(), false);
  assert.equal(harness.calls.filter((call) => call === "read").length, 1);
});

test("a real-model run under the limit records one usage for today", async () => {
  const harness = setupApp({ used: 3, limit: 20 });
  const result = await harness.app.start(request());
  assert.equal(result.ok, true);
  assert.ok(
    harness.calls.includes(`increment:${TODAY}`),
    `expected an increment for ${TODAY}, got ${JSON.stringify(harness.calls)}`,
  );
  assert.equal(harness.snapshot().used, 4);
});

test("offline distillation never touches the quota ledger", async () => {
  const harness = setupApp({ used: 19, limit: 20 });
  const result = await harness.app.start(
    request({ modelId: "offline", providerId: undefined }),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(harness.calls, []);
  assert.equal(harness.snapshot().used, 19);
});

test("a missing quota port degrades to unlimited for real-model runs", async () => {
  const harness = setupApp({ quota: false });
  const result = await harness.app.start(request());
  assert.equal(result.ok, true);
  assert.equal(harness.aiInvoked(), true);
});

test("a failing quota read degrades to unlimited instead of blocking the run", async () => {
  const harness = setupApp({ failRead: true });
  const result = await harness.app.start(request());
  assert.equal(result.ok, true);
  assert.equal(harness.aiInvoked(), true);
});

test("a failing quota increment never fails the completed run", async () => {
  const harness = setupApp({ failIncrement: true });
  const result = await harness.app.start(request());
  assert.equal(result.ok, true);
  assert.equal(harness.aiInvoked(), true);
});

async function withIsolatedRoot<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(
    join(tmpdir(), `${TEST_TMP_PREFIX}quota-api-${randomUUID()}-`),
  );
  const previous = process.env[ENV.USAGE_HOME];
  process.env[ENV.USAGE_HOME] = dir;
  resetCompositionRootForTests();
  try {
    await getCompositionRoot();
    return await fn(dir);
  } finally {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await (await getCompositionRoot()).scheduler.stop();
    resetCompositionRootForTests();
    if (previous === undefined) delete process.env[ENV.USAGE_HOME];
    else process.env[ENV.USAGE_HOME] = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadDistillation exposes the server-side quota projection", async () => {
  await withIsolatedRoot(async (dir) => {
    void dir;
    const root = await getCompositionRoot();
    // Increment "today" exactly as the SQLite quota ledger defines it, so the
    // write lands on the same date_key `loadDistillation` reads back. The
    // ledger's default clock is the local calendar day (`localDateKey`), which
    // matches the application layer even across UTC-midnight boundaries.
    const today = (await root.distillQuota.read()).date;
    await root.distillQuota.increment(today);

    const view = await loadDistillation("zh-CN");
    assert.ok(view.quota, "quota projection must be present");
    assert.equal(view.quota.used, 1);
    assert.equal(view.quota.limit, 20);
    assert.equal(view.quota.remaining, 19);
  });
});

test("composition root wires a working quota ledger into distillation", async () => {
  await withIsolatedRoot(async () => {
    const root = await getCompositionRoot();
    assert.ok(root.distillQuota, "quota port must be assembled");
    const current = await root.distillQuota.read();
    assert.equal(current.limit, DISTILL_DAILY_QUOTA);
    assert.equal(current.used, 0);
  });
});
