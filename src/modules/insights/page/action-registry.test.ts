import assert from "node:assert/strict";
import test from "node:test";
import type { InsightActionId } from "./contracts.ts";
import { INSIGHT_ACTIONS, isInsightActionId } from "./action-registry.ts";

const ALL_ACTIONS: readonly InsightActionId[] = [
  "open_security",
  "open_distill",
  "open_reports",
  "open_sessions",
  "open_sources",
  "open_settings",
  "open_tracker",
  "open_market",
  "open_skills",
  "open_memory",
];

test("all ten actions are registered with a label and a path", () => {
  assert.equal(Object.keys(INSIGHT_ACTIONS).length, 10);
  for (const id of ALL_ACTIONS) {
    const entry = INSIGHT_ACTIONS[id];
    assert.ok(entry, id);
    assert.equal(typeof entry.labelKey, "string");
    assert.equal(typeof entry.path, "string");
  }
  assert.equal(INSIGHT_ACTIONS.open_security.path, "/security");
  assert.equal(INSIGHT_ACTIONS.open_sessions.path, "/chats");
  assert.equal(INSIGHT_ACTIONS.open_distill.path, "/distill");
  assert.equal(INSIGHT_ACTIONS.open_memory.path, "/memory");
});

test("isInsightActionId accepts only registered ids", () => {
  for (const id of ALL_ACTIONS) {
    assert.equal(isInsightActionId(id), true, id);
  }
  assert.equal(isInsightActionId("open_nonexistent"), false);
  assert.equal(isInsightActionId(""), false);
  assert.equal(isInsightActionId("security"), false);
  assert.equal(isInsightActionId(null), false);
  assert.equal(isInsightActionId(undefined), false);
  assert.equal(isInsightActionId(42), false);
});
