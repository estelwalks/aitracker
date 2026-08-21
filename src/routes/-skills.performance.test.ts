import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("./skills.tsx", import.meta.url), "utf8");
const page = readFileSync(
  new URL(
    "../modules/skill-distribution/presentation/SkillHubPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Skill Management loader waits only for its workspace snapshot", () => {
  assert.match(route, /const workspace = await getSkillWorkspace\(\)/);
  assert.doesNotMatch(route, /getAgentUsageOverview/);
  assert.doesNotMatch(route, /getDistillationQuery/);
});

test("Skill Management retrieves its secondary KPI after first paint", () => {
  assert.match(page, /getDistillationActivity/);
  assert.match(page, /void getDistillationActivity\(\)/);
});
