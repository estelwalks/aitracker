import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const briefingSource = source(
  "src/modules/security-assessment/presentation/components/SecurityBriefing.tsx",
);
const securityPageSource = source(
  "src/modules/security-assessment/presentation/SecurityAssessmentPage.tsx",
);

test("security briefing delegates copy and layout to the shared insight card", () => {
  assert.match(briefingSource, /InsightCard/);
  assert.match(briefingSource, /surfaceId=["']security["']/);
  assert.match(briefingSource, /showRotate={false}/);
  assert.match(briefingSource, /actions=\{actions\}/);
});

test("security route keeps one bespoke briefing and does not add a second insight card", () => {
  assert.match(securityPageSource, /<SecurityBriefing/);
  assert.doesNotMatch(securityPageSource, /<InsightCard/);
});
