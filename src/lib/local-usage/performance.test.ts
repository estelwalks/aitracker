import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { aggregatePricedUsage, estimateUsageCost } from "../pricing";
import { buildLocalUsageSnapshot } from "./aggregate";
import { aggregateEventsByTime, aggregateUsageBySession, filterUsageEvents } from "./presentation";
import { KNOWN_LOCAL_USAGE_SOURCES, type LocalUsageEvent, type LocalUsageTotals } from "./types";

const EVENT_COUNT = 100_000;
const QUERY_BUDGET_MS = 3_000;
const MODELS = [
  "claude-opus-4",
  "claude-sonnet-4",
  "claude-3-7-sonnet",
  "claude-3-5-haiku",
] as const;
const PROJECT_COUNT = 25;
const SESSION_COUNT = 2_000;

interface PerformanceFixture {
  events: LocalUsageEvent[];
  expectedTotals: LocalUsageTotals;
}

interface Measurement {
  name: string;
  durationMs: number;
}

function createPerformanceFixture(): PerformanceFixture {
  const expectedTotals: LocalUsageTotals = {
    events: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };

  const events = Array.from({ length: EVENT_COUNT }, (_, index): LocalUsageEvent => {
    const inputTokens = 100 + (index % 1_000);
    const cachedInputTokens = index % 200;
    const cacheCreationInputTokens = index % 50;
    const outputTokens = 50 + (index % 300);
    const reasoningOutputTokens = index % 80;
    const totalTokens =
      inputTokens +
      cachedInputTokens +
      cacheCreationInputTokens +
      outputTokens +
      reasoningOutputTokens;

    expectedTotals.events += 1;
    expectedTotals.inputTokens += inputTokens;
    expectedTotals.cachedInputTokens += cachedInputTokens;
    expectedTotals.cacheCreationInputTokens += cacheCreationInputTokens;
    expectedTotals.outputTokens += outputTokens;
    expectedTotals.reasoningOutputTokens += reasoningOutputTokens;
    expectedTotals.totalTokens += totalTokens;

    return {
      source: KNOWN_LOCAL_USAGE_SOURCES[index % KNOWN_LOCAL_USAGE_SOURCES.length],
      timestamp: new Date(2026, 6, 1, 0, index % (30 * 24 * 60)).toISOString(),
      model: MODELS[index % MODELS.length],
      project: `project-${String(index % PROJECT_COUNT).padStart(2, "0")}`,
      sessionId: index % 17 === 0 ? undefined : `session-${index % SESSION_COUNT}`,
      inputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens,
    };
  });

  return { events, expectedTotals };
}

function measure<T>(measurements: Measurement[], name: string, query: () => T): T {
  const startedAt = performance.now();
  const result = query();
  measurements.push({ name, durationMs: performance.now() - startedAt });
  return result;
}

const fixture = createPerformanceFixture();

test("NFR-001: 10 万条、30 天核心查询总耗时低于 3000ms", () => {
  const measurements: Measurement[] = [];
  const startedAt = performance.now();

  const filtered = measure(measurements, "30-day filter", () =>
    filterUsageEvents(
      fixture.events,
      "custom",
      "2026-07-01",
      "2026-07-30",
      new Date(2026, 6, 30, 23, 59, 59),
    ),
  );
  const snapshot = measure(measurements, "snapshot/day/provider/model/project/token totals", () =>
    buildLocalUsageSnapshot(filtered, [], new Date(2026, 6, 30, 23, 59, 59)),
  );
  const daily = measure(measurements, "daily aggregation", () =>
    aggregateEventsByTime(filtered, "day"),
  );
  const hourly = measure(measurements, "hourly aggregation", () =>
    aggregateEventsByTime(filtered, "hour"),
  );
  const providers = measure(measurements, "provider aggregation", () =>
    aggregatePricedUsage(filtered, "source"),
  );
  const models = measure(measurements, "model aggregation", () =>
    aggregatePricedUsage(filtered, "model"),
  );
  const projects = measure(measurements, "project aggregation", () =>
    aggregatePricedUsage(filtered, "project"),
  );
  const tokenTypes = measure(measurements, "token aggregation", () =>
    aggregatePricedUsage(filtered, "tokenType"),
  );
  const sessions = measure(measurements, "session aggregation", () =>
    aggregateUsageBySession(filtered),
  );
  const cost = measure(measurements, "cost estimation", () => estimateUsageCost(filtered));

  const totalDurationMs = performance.now() - startedAt;

  assert.equal(filtered.length, EVENT_COUNT);
  assert.deepEqual(snapshot.totals, fixture.expectedTotals);
  assert.equal(snapshot.daily.length, 30);
  assert.equal(daily.length, 30);
  assert.equal(hourly.length, 30 * 24);
  assert.equal(providers.length, KNOWN_LOCAL_USAGE_SOURCES.length);
  assert.equal(models.length, MODELS.length);
  assert.equal(projects.length, PROJECT_COUNT);
  assert.equal(tokenTypes.length, 5);
  assert.equal(sessions.available, true);
  assert.equal(sessions.rows.length, SESSION_COUNT);
  assert.equal(sessions.eventsWithSession + sessions.eventsWithoutSession, EVENT_COUNT);
  assert.equal(cost.pricedEvents, EVENT_COUNT);
  assert.equal(cost.unknownEvents, 0);
  assert.ok(cost.knownUsd > 0);

  console.info(
    [
      `[NFR-001] events=${EVENT_COUNT.toLocaleString("en-US")}`,
      ...measurements.map(({ name, durationMs }) => `${name}=${durationMs.toFixed(2)}ms`),
      `core query total=${totalDurationMs.toFixed(2)}ms`,
      `budget=${QUERY_BUDGET_MS}ms`,
    ].join(" | "),
  );

  assert.ok(
    totalDurationMs < QUERY_BUDGET_MS,
    `NFR-001 failed: core query total ${totalDurationMs.toFixed(2)}ms >= ${QUERY_BUDGET_MS}ms`,
  );
});
