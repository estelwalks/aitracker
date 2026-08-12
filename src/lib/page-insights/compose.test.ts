import assert from "node:assert/strict";
import test from "node:test";

import type { SourcesQuerySummary } from "../../modules/sources/query/presentation/model.ts";
import type { TrackerReadModel } from "../../modules/usage/contracts.ts";
import { composeSourcesInsights, composeTrackerInsights } from "./compose.ts";

const LOCALE = "zh-CN";

function sourcesSummary(
  totals: Partial<SourcesQuerySummary["totals"]>,
): SourcesQuerySummary {
  return {
    generatedAt: "2026-08-12T00:00:00.000Z",
    entries: [],
    totals: {
      toolCount: 0,
      connectedCount: 0,
      noLogsCount: 0,
      notInstalledCount: 0,
      eventCount: 0,
      malformedCount: 0,
      ...totals,
    },
  };
}

function trackerModel(
  totals: TrackerReadModel["totals"],
  rows: TrackerReadModel["boards"]["project"]["rows"],
): TrackerReadModel {
  return {
    generatedAt: "2026-08-12T00:00:00.000Z",
    boards: {
      skill: { rows: [] },
      project: { rows: rows },
      session: { rows: [] },
    },
    totals,
  };
}

const row = (
  overrides: Partial<
    TrackerReadModel["boards"]["project"]["rows"][number]
  > = {},
): TrackerReadModel["boards"]["project"]["rows"][number] => ({
  key: "project-a",
  name: "project-a",
  tokens: 120_000,
  events: 40,
  calls: 0,
  cacheRate: 25,
  outputRatio: 0.7,
  waste: 52.5,
  trend: "up",
  previousTokens: 100_000,
  suggestion: "cache",
  ...overrides,
});

test("sources: empty universe emits an honest no-data line", () => {
  const lines = composeSourcesInsights(sourcesSummary({}), LOCALE);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].key, "insights.sources.empty");
  assert.equal(lines[0].params, undefined);
});

test("sources: coverage plus issue lines are derived from real totals", () => {
  const lines = composeSourcesInsights(
    sourcesSummary({
      toolCount: 10,
      connectedCount: 6,
      eventCount: 1200,
      noLogsCount: 2,
      notInstalledCount: 1,
      malformedCount: 3,
    }),
    LOCALE,
  );
  const keys = lines.map((item) => item.key);
  assert.deepEqual(keys, [
    "insights.sources.coverage",
    "insights.sources.events",
    "insights.sources.notInstalled",
    "insights.sources.noLogs",
    "insights.sources.malformed",
  ]);
  const coverage = lines[0].params as Record<string, string>;
  assert.equal(coverage.connected, "6");
  assert.equal(coverage.total, "10");
  assert.equal(coverage.rate, "60%");
});

test("sources: healthy universe adds an all-good line", () => {
  const lines = composeSourcesInsights(
    sourcesSummary({ toolCount: 4, connectedCount: 4, eventCount: 99 }),
    LOCALE,
  );
  assert.deepEqual(
    lines.map((item) => item.key),
    [
      "insights.sources.coverage",
      "insights.sources.events",
      "insights.sources.allGood",
    ],
  );
});

test("tracker: no tokens emits an honest no-data line", () => {
  const lines = composeTrackerInsights(
    trackerModel({ tokens: 0, events: 0, entries: 0 }, []),
    LOCALE,
  );
  assert.equal(lines.length, 1);
  assert.equal(lines[0].key, "insights.tracker.empty");
});

test("tracker: burn, waste leader and cache lines from read model rows", () => {
  const lines = composeTrackerInsights(
    trackerModel({ tokens: 520_000, events: 180, entries: 1 }, [
      row({ name: "project-a" }),
      row({
        key: "project-b",
        name: "project-b",
        tokens: 40_000,
        cacheRate: 70,
        waste: 10,
        suggestion: "none",
      }),
    ]),
    LOCALE,
  );
  const keys = lines.map((item) => item.key);
  assert.deepEqual(keys, [
    "insights.tracker.burn",
    "insights.tracker.wasteLeader",
    "insights.tracker.cacheLow",
    "insights.tracker.suggestCount",
    "insights.tracker.topBurn",
  ]);
  const burn = lines[0].params as Record<string, string>;
  assert.equal(burn.tokens, "520K");
  assert.equal(burn.events, "180");
  const waste = lines[1].params as Record<string, string>;
  assert.equal(waste.name, "project-a");
  assert.equal(waste.waste, "52.5%");
  const cache = lines[2].params as Record<string, string>;
  assert.equal(cache.name, "project-a");
  assert.equal(cache.rate, "25%");
  const suggest = lines[3].params as Record<string, string>;
  assert.equal(suggest.count, "1");
  const top = lines[4].params as Record<string, string>;
  assert.equal(top.name, "project-a");
  assert.equal(top.tokens, "120K");
});

test("tracker: healthy rows surface only burn + suggest lines", () => {
  const lines = composeTrackerInsights(
    trackerModel({ tokens: 60_000, events: 20, entries: 1 }, [
      row({
        name: "healthy",
        tokens: 60_000,
        cacheRate: 85,
        waste: 4,
        suggestion: "none",
      }),
    ]),
    LOCALE,
  );
  assert.deepEqual(
    lines.map((item) => item.key),
    ["insights.tracker.burn"],
  );
});
