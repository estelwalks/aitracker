import assert from "node:assert/strict";
import test from "node:test";

import type { DistillationSessionItem } from "../index.ts";
import {
  filterDistillationSessions,
  groupDistillationSessionsByProject,
  materialKeyOf,
  toggleMaterialSelection,
  toggleProjectSelection,
} from "./materials.ts";

function session(
  sessionId: string,
  startedAt: string,
  overrides: Partial<DistillationSessionItem> = {},
): DistillationSessionItem {
  return {
    source: "codex",
    sessionId,
    title: sessionId,
    projectKey: "sample-project",
    model: null,
    startedAt,
    endedAt: startedAt,
    turns: 1,
    status: "available",
    ...overrides,
  };
}

const NOW = new Date("2026-08-12T14:00:00+08:00");

test("filterDistillationSessions applies today and rolling ranges to real timestamps", () => {
  const sessions = [
    session("today", "2026-08-12T00:05:00+08:00"),
    session("seven-days", "2026-08-06T23:59:00+08:00"),
    session("thirty-days", "2026-07-14T08:00:00+08:00"),
    session("outside", "2026-07-13T23:59:00+08:00"),
    session("future", "2026-08-13T00:00:00+08:00"),
    session("legacy", "not-a-timestamp"),
  ];

  assert.deepEqual(
    filterDistillationSessions(sessions, "today", NOW).map(
      (item) => item.sessionId,
    ),
    ["today"],
  );
  assert.deepEqual(
    filterDistillationSessions(sessions, "7", NOW).map(
      (item) => item.sessionId,
    ),
    ["today", "seven-days"],
  );
  assert.deepEqual(
    filterDistillationSessions(sessions, "30", NOW).map(
      (item) => item.sessionId,
    ),
    ["today", "seven-days", "thirty-days"],
  );
  assert.equal(filterDistillationSessions(sessions, "all", NOW).length, 6);
});

test("toggleMaterialSelection enforces the opaque-ref limit and still allows removal", () => {
  const full = new Set(["a", "b"]);
  assert.equal(toggleMaterialSelection(full, "c", 2), full);
  assert.deepEqual([...toggleMaterialSelection(full, "a", 2)], ["b"]);
});

test("toggleProjectSelection is atomic when a real project exceeds the limit", () => {
  const current = new Set(["outside"]);
  assert.equal(toggleProjectSelection(current, ["p:1", "p:2"], 2), current);
  assert.deepEqual(
    [...toggleProjectSelection(new Set(), ["p:1", "p:2", "p:2"], 2)],
    ["p:1", "p:2"],
  );
  assert.deepEqual(
    [...toggleProjectSelection(new Set(["p:1", "p:2"]), ["p:1", "p:2"], 2)],
    [],
  );
});

test("groupDistillationSessionsByProject keeps same-named projects separate by source", () => {
  const groups = groupDistillationSessionsByProject([
    session("codex-a", "2026-08-12T10:00:00+08:00"),
    session("codex-b", "2026-08-12T11:00:00+08:00"),
    session("claude-a", "2026-08-12T12:00:00+08:00", {
      source: "claude-code",
    }),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => [group.key, group.sessions.length]),
    [
      ["codex:sample-project", 2],
      ["claude-code:sample-project", 1],
    ],
  );
  assert.equal(materialKeyOf(groups[0]!.sessions[0]!), "codex:codex-a");
});
