import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./agents.tsx", import.meta.url), "utf8");
const page = readFileSync(
  new URL("./agents.lazy.tsx", import.meta.url),
  "utf8",
);

test("Agent overview loader waits only for its workspace snapshot", () => {
  assert.match(route, /const data = await getSkillWorkspace\(\)/);
  assert.doesNotMatch(route, /getAgentUsageOverview/);
  assert.doesNotMatch(route, /getSecuritySkillVerdicts/);
});

test("Agent analytics and security status load after first route paint", () => {
  assert.match(page, /void Promise\.all/);
  assert.match(page, /getAgentUsageOverview/);
  assert.match(page, /getSecuritySkillVerdicts/);
  // P2-16: a failed fetch renders a retryable error panel, never a skeleton.
  assert.match(page, /status === "loading"\) return <RoutePending/);
  assert.match(page, /LoadErrorPanel/);
});
