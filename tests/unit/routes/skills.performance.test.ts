import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../../../src/routes/skills.tsx", import.meta.url),
  "utf8",
);
const query = readFileSync(
  new URL("../../../src/modules/skill-distribution/query.ts", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL(
    "../../../src/modules/skill-distribution/presentation/SkillHubPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Skill Management loader waits only for its page-data RPC", () => {
  // One server RPC owns the whole page payload (P6-T6-04 route splitting).
  // Secondary KPIs must not delay that first render, so the loader never
  // reaches for the agent usage overview or the distillation query/activity.
  assert.match(route, /const data = await getSkillHubPageData\(\)/);
  assert.doesNotMatch(route, /getAgentUsageOverview/);
  assert.doesNotMatch(route, /getDistillationQuery/);
  assert.doesNotMatch(route, /getDistillationActivity/);
});

test("the page-data RPC resolves workspace and security in parallel", () => {
  // The workspace snapshot, the canonical security overview and the security
  // history are awaited together — never in a chain — and the secondary
  // security evidence degrades instead of failing the page.
  assert.match(
    query,
    /const \[workspace, overview, history\] = await Promise\.all\(/,
  );
  assert.match(query, /getSkillWorkspace\(\),/);
  assert.match(query, /resolveSecurityOverview\(\)\.catch\(\(\) => null\)/);
  assert.match(query, /readSecurityHistoryViews\(\)\.catch\(\(\) => \[\]\)/);
  // Heavy scanner/DB modules are imported from the handler only, so they stay
  // out of the browser bundle.
  assert.match(query, /import\("\.\.\/skill-catalog\/query\.ts"\)/);
  assert.doesNotMatch(query, /getAgentUsageOverview/);
  assert.doesNotMatch(query, /getDistillationQuery/);
});

test("Skill Management retrieves its secondary KPI after first paint", () => {
  assert.match(page, /getDistillationActivity/);
  assert.match(page, /void getDistillationActivity\(\)/);
});
