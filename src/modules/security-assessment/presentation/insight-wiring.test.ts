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

test("security briefing uses the shared security insight envelope with local fallback", () => {
  assert.match(briefingSource, /usePageInsight/);
  assert.match(briefingSource, /surfaceId:\s*["']security["']/);
  assert.match(
    briefingSource,
    /sharedInsightLines\.map\(\(insight\) => insight\.text\)/,
  );
  assert.match(briefingSource, /insightFallbackStatusLabel/);
  assert.match(briefingSource, /settings\.insight\.enhanced/);
  assert.match(briefingSource, /useLocalLines/);
  assert.match(briefingSource, /security\.center\.briefing\.refresh/);
  assert.match(briefingSource, /search=\{\{ section: "model" \}\}/);
});

test("security route keeps one bespoke briefing and does not add a second insight card", () => {
  assert.match(securityPageSource, /<SecurityBriefing/);
  assert.doesNotMatch(securityPageSource, /<InsightCard/);
});
