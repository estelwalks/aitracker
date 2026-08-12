import assert from "node:assert/strict";
import test from "node:test";

import type { DistillationSessionItem } from "../index.ts";
import {
  filterDistillationSessions,
  groupDistillationSessionsByProject,
  materialKeyOf,
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
  assert.equal(filterDistillationSessions(sessions, "all", NOW).length, 5);
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
