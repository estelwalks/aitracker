import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateEventsByTime,
  aggregateUsageBySession,
  filterDailyUsage,
  filterUsageEvents,
  resolveUsageRange,
  sourceLabel,
} from "./presentation";
import { PUBLIC_TOOL_MANIFEST } from "../tool-registry/public-manifest.generated.ts";
import type { LocalUsageDaily, LocalUsageEvent } from "./types";

function makeEvent(
  input: Partial<LocalUsageEvent> & Pick<LocalUsageEvent, "timestamp">,
): LocalUsageEvent {
  return {
    source: "codex",
    model: "gpt-5.6",
    project: "~/demo",
    inputTokens: 10,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 5,
    reasoningOutputTokens: 0,
    totalTokens: 15,
    ...input,
  };
}

test("sourceLabel projects the manifest primary display name for every catalog source (F6-T2)", () => {
  for (const tool of PUBLIC_TOOL_MANIFEST.tools) {
    assert.equal(sourceLabel(tool.id), tool.name);
  }
});

test("sourceLabel falls back to the raw id for unknown sources", () => {
  assert.equal(sourceLabel("not-a-tool"), "not-a-tool");
});

test("resolveUsageRange 支持本年范围", () => {
  const now = new Date(2026, 6, 28, 9, 30, 0);
  const range = resolveUsageRange("year", undefined, undefined, now);
  assert.equal(range.valid, true);
  assert.equal(range.from, "2026-01-01");
  assert.equal(range.to, "2026-07-28");
});

test("resolveUsageRange supports prototype rolling range presets", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  assert.equal(
    resolveUsageRange("90d", undefined, undefined, now).from,
    "2026-05-13",
  );
  assert.equal(
    resolveUsageRange("180d", undefined, undefined, now).from,
    "2026-02-12",
  );
  assert.equal(
    resolveUsageRange("1y", undefined, undefined, now).from,
    "2025-08-11",
  );
});

test("filterDailyUsage 处理自定义边界缺失与反转", () => {
  const daily: LocalUsageDaily[] = [
    {
      date: "2026-07-27",
      events: 1,
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 5,
      reasoningOutputTokens: 0,
      totalTokens: 15,
      bySource: {},
    },
  ];

  assert.deepEqual(filterDailyUsage(daily, "custom", "2026-07-27", ""), []);
  assert.deepEqual(
    filterDailyUsage(daily, "custom", "2026-07-28", "2026-07-27"),
    [],
  );
});

test("filterDailyUsage 按本年筛选", () => {
  const daily: LocalUsageDaily[] = [
    {
      date: "2025-12-31",
      events: 1,
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 5,
      reasoningOutputTokens: 0,
      totalTokens: 15,
      bySource: {},
    },
    {
      date: "2026-01-01",
      events: 2,
      inputTokens: 20,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 0,
      totalTokens: 30,
      bySource: {},
    },
    {
      date: "2026-07-28",
      events: 3,
      inputTokens: 30,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 15,
      reasoningOutputTokens: 0,
      totalTokens: 45,
      bySource: {},
    },
  ];

  const filtered = filterDailyUsage(
    daily,
    "year",
    undefined,
    undefined,
    new Date(2026, 6, 28),
  );
  assert.deepEqual(
    filtered.map((row) => row.date),
    ["2026-01-01", "2026-07-28"],
  );
});

test("filterUsageEvents 使用时间戳并包含自定义日期完整边界", () => {
  const events = [
    makeEvent({ timestamp: new Date(2026, 6, 27, 0, 0, 0).toISOString() }),
    makeEvent({
      timestamp: new Date(2026, 6, 27, 23, 59, 59, 999).toISOString(),
    }),
    makeEvent({ timestamp: new Date(2026, 6, 28, 0, 0, 0).toISOString() }),
  ];

  const filtered = filterUsageEvents(
    events,
    "custom",
    "2026-07-27",
    "2026-07-27",
  );
  assert.equal(filtered.length, 2);
  assert.deepEqual(
    filterUsageEvents(events, "custom", "2026-07-28", "2026-07-27"),
    [],
  );
});

test("aggregateEventsByTime 支持按日和按小时聚合", () => {
  const events = [
    makeEvent({
      timestamp: new Date(2026, 6, 28, 9, 15).toISOString(),
      totalTokens: 15,
    }),
    makeEvent({
      timestamp: new Date(2026, 6, 28, 9, 45).toISOString(),
      totalTokens: 20,
    }),
    makeEvent({
      timestamp: new Date(2026, 6, 28, 10, 5).toISOString(),
      totalTokens: 25,
    }),
  ];

  const byDay = aggregateEventsByTime(events, "day");
  const byHour = aggregateEventsByTime(events, "hour");

  assert.equal(byDay.length, 1);
  assert.equal(byDay[0]?.totalTokens, 60);
  assert.deepEqual(
    byHour.map((row) => [row.key, row.totalTokens]),
    [
      ["2026-07-28T09", 35],
      ["2026-07-28T10", 25],
    ],
  );
});

test("aggregateUsageBySession 仅聚合真实 sessionId，并在缺失时标记不可用", () => {
  const unavailable = aggregateUsageBySession([
    makeEvent({ timestamp: new Date(2026, 6, 28, 9, 0).toISOString() }),
    makeEvent({
      timestamp: new Date(2026, 6, 28, 10, 0).toISOString(),
      sessionId: "   ",
    }),
  ]);
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.eventsWithoutSession, 2);

  const available = aggregateUsageBySession([
    makeEvent({
      timestamp: new Date(2026, 6, 28, 9, 0).toISOString(),
      sessionId: "s-1",
    }),
    makeEvent({
      timestamp: new Date(2026, 6, 28, 10, 0).toISOString(),
      sessionId: "s-1",
    }),
    makeEvent({ timestamp: new Date(2026, 6, 28, 11, 0).toISOString() }),
  ]);
  assert.equal(available.available, true);
  assert.equal(available.rows.length, 1);
  assert.equal(available.rows[0]?.sessionId, "s-1");
  assert.equal(available.rows[0]?.events, 2);
  assert.equal(available.eventsWithoutSession, 1);
});
