import assert from "node:assert/strict";
import test from "node:test";

import { buildLocalUsageSnapshot } from "../../../lib/local-usage/aggregate.ts";
import type {
  LocalUsageEvent,
  LocalUsageSourceSummary,
} from "../../../lib/local-usage/types.ts";
import { compactUsageSnapshot } from "./aggregate-projection.ts";
import {
  RETAINED_PREVIOUS_CODE,
  retainSourceEvidence,
} from "./retain-source-evidence.ts";

const counts = {
  inputTokens: 100,
  cachedInputTokens: 10,
  cacheCreationInputTokens: 0,
  outputTokens: 20,
  reasoningOutputTokens: 5,
  totalTokens: 135,
};

function event(
  source: "pi" | "codex",
  id: string,
  timestamp: string,
): LocalUsageEvent {
  return {
    source,
    timestamp,
    model: `model-${source}`,
    project: `project-${source}`,
    sessionId: `session-${source}-${id}`,
    ...counts,
  };
}

function row(
  source: "pi" | "codex",
  options: {
    available?: boolean;
    events: number;
    filesRead?: number;
    filesConsidered?: number;
  },
): LocalUsageSourceSummary {
  const filesRead = options.filesRead ?? options.events;
  return {
    source,
    available: options.available ?? options.events > 0,
    filesConsidered: options.filesConsidered ?? filesRead,
    filesRead,
    filesReused: 0,
    filesParsed: filesRead,
    malformedLines: 0,
    events: options.events,
  };
}

function lifelessRow(source: "pi" | "codex"): LocalUsageSourceSummary {
  return {
    source,
    available: false,
    detected: false,
    filesConsidered: 0,
    filesRead: 0,
    filesReused: 0,
    filesParsed: 0,
    malformedLines: 0,
    events: 0,
  };
}

function built(
  events: LocalUsageEvent[],
  sources: LocalUsageSourceSummary[],
  generatedAt: Date = new Date("2026-09-01T00:00:00.000Z"),
) {
  return buildLocalUsageSnapshot(events, sources, generatedAt);
}

function persisted(
  events: LocalUsageEvent[],
  sources: LocalUsageSourceSummary[],
  generatedAt?: Date,
) {
  return compactUsageSnapshot(built(events, sources, generatedAt));
}

test("retains previous per-source evidence when a source comes back lifeless", () => {
  const previous = persisted(
    [
      event("pi", "a", "2026-08-06T10:00:00.000Z"),
      event("pi", "b", "2026-08-06T11:00:00.000Z"),
    ],
    [row("pi", { events: 2, filesRead: 2 })],
  );
  const current = built(
    [event("codex", "1", "2026-08-07T10:00:00.000Z")],
    [row("codex", { events: 1 }), lifelessRow("pi")],
    new Date("2026-09-02T00:00:00.000Z"),
  );

  const outcome = retainSourceEvidence(previous, current);
  assert.ok(outcome, "pi had evidence before and reports none now");
  assert.deepEqual(outcome.retainedSources, ["pi"]);

  const snapshot = outcome.snapshot;
  const pi = snapshot.sources.find((item) => item.source === "pi");
  assert.ok(pi);
  assert.equal(pi.available, true);
  assert.equal(pi.events, 2);
  assert.equal(pi.filesRead, 2);
  assert.ok(
    pi.diagnostics?.some((item) => item.code === RETAINED_PREVIOUS_CODE),
    "retained row carries the retained-previous marker",
  );
  const codex = snapshot.sources.find((item) => item.source === "codex");
  assert.equal(codex?.events, 1);
  assert.ok(
    !codex?.diagnostics?.some((item) => item.code === RETAINED_PREVIOUS_CODE),
    "healthy sources are not marked",
  );

  // Aggregates stay consistent across every derived layer.
  assert.equal(snapshot.totals.events, 3);
  const bySource = new Map(snapshot.bySource.map((item) => [item.key, item]));
  assert.equal(bySource.get("pi")?.events, 2);
  assert.equal(bySource.get("codex")?.events, 1);
  const byModel = new Map(snapshot.byModel.map((item) => [item.key, item]));
  assert.equal(byModel.get("model-pi")?.events, 2);
  assert.equal(byModel.get("model-codex")?.events, 1);
  assert.equal(snapshot.daily.length, 2);
  const [first, second] = snapshot.daily;
  assert.equal(first.date, "2026-08-06");
  assert.equal(first.events, 2);
  assert.equal(first.bySource["pi"]?.inputTokens, 200);
  assert.equal(second.date, "2026-08-07");
  assert.equal(second.events, 1);
  assert.equal(snapshot.mode, "real");
});

test("fresh evidence is never replaced by previous evidence", () => {
  const previous = persisted(
    [event("pi", "old", "2026-08-06T10:00:00.000Z")],
    [row("pi", { events: 1 })],
  );
  const current = built(
    [event("pi", "new", "2026-08-08T10:00:00.000Z")],
    [row("pi", { events: 1, filesRead: 4 })],
    new Date("2026-09-02T00:00:00.000Z"),
  );
  const outcome = retainSourceEvidence(previous, current);
  assert.equal(outcome, null, "a source that scanned data must stay fresh");
});

test("sources without previous evidence are never retained", () => {
  const previous = persisted(
    [event("pi", "a", "2026-08-06T10:00:00.000Z")],
    [
      row("pi", { events: 1 }),
      { ...lifelessRow("codex"), available: false, detected: false },
    ],
  );
  const current = built(
    [],
    [lifelessRow("pi"), lifelessRow("codex")],
    new Date("2026-09-02T00:00:00.000Z"),
  );
  const outcome = retainSourceEvidence(previous, current);
  assert.ok(outcome);
  assert.deepEqual(outcome.retainedSources, ["pi"]);
  const retained = outcome.snapshot.sources.find(
    (item) => item.source === "pi",
  );
  assert.equal(retained?.events, 1);
  const codex = outcome.snapshot.sources.find(
    (item) => item.source === "codex",
  );
  assert.equal(codex?.events, 0);
});

test("a snapshot without persisted buckets cannot retain anything", () => {
  const previous = built(
    [event("pi", "a", "2026-08-06T10:00:00.000Z")],
    [row("pi", { events: 1 })],
  );
  const current = built(
    [event("codex", "1", "2026-08-07T10:00:00.000Z")],
    [row("codex", { events: 1 }), lifelessRow("pi")],
  );
  const outcome = retainSourceEvidence(previous, current);
  assert.equal(outcome, null);
});

test("an empty previous snapshot never masks a first real scan", () => {
  const previous = persisted([], [lifelessRow("pi")]);
  const current = built(
    [event("pi", "first", "2026-08-07T10:00:00.000Z")],
    [row("pi", { events: 1 })],
  );
  const outcome = retainSourceEvidence(previous, current);
  assert.equal(outcome, null);
});
