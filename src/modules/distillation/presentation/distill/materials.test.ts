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
    isGitProject: true,
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

test("toggleMaterialSelection adds and removes without a count limit", () => {
  const full = new Set(["a", "b", "c", "d"]);
  // Adding beyond the old 8-cap still succeeds.
  assert.deepEqual(
    [...toggleMaterialSelection(full, "e")],
    ["a", "b", "c", "d", "e"],
  );
  assert.deepEqual([...toggleMaterialSelection(full, "a")], ["b", "c", "d"]);
  // Toggling the same key twice returns the original set (stable identity).
  const once = toggleMaterialSelection(full, "e");
  assert.deepEqual([...toggleMaterialSelection(once, "e")], [...full]);
});

test("toggleProjectSelection is atomic and accumulates without a limit", () => {
  assert.deepEqual(
    [...toggleProjectSelection(new Set(), ["p:1", "p:2", "p:2"])],
    ["p:1", "p:2"],
  );
  assert.deepEqual(
    [...toggleProjectSelection(new Set(["p:1", "p:2"]), ["p:1", "p:2"])],
    [],
  );
  // A project larger than the old 8-cap still selects in full.
  const many = Array.from({ length: 12 }, (_, i) => `p:${i + 1}`);
  assert.deepEqual([...toggleProjectSelection(new Set(), many)], many);
});

test("groupDistillationSessionsByProject merges same-named projects across sources", () => {
  const groups = groupDistillationSessionsByProject([
    session("codex-a", "2026-08-12T10:00:00+08:00"),
    session("codex-b", "2026-08-12T11:00:00+08:00"),
    session("claude-a", "2026-08-12T12:00:00+08:00", {
      source: "claude-code",
    }),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups.map((group) => [
      group.key,
      group.sessions.length,
      group.sources,
      group.last,
    ]),
    [
      [
        "sample-project",
        3,
        ["codex", "claude-code"],
        "2026-08-12T12:00:00+08:00",
      ],
    ],
  );
  assert.equal(materialKeyOf(groups[0]!.sessions[0]!), "codex:codex-a");
});

test("groupDistillationSessionsByProject only groups git-backed sessions", () => {
  const groups = groupDistillationSessionsByProject([
    session("git-a", "2026-08-12T10:00:00+08:00"),
    session("git-b", "2026-08-12T11:00:00+08:00"),
    // A plain folder (scanner found no repository): selectable by session but
    // never a project.
    session("folder-c", "2026-08-12T12:00:00+08:00", {
      projectKey: "plain-folder",
      isGitProject: false,
    }),
    // Legacy session with no git flag defaults to non-project too.
    session("legacy-d", "2026-08-12T13:00:00+08:00", {
      projectKey: "legacy-folder",
      isGitProject: undefined,
    }),
  ]);

  assert.deepEqual(
    groups.map((group) => [group.key, group.sessions.length]),
    [["sample-project", 2]],
  );
});
