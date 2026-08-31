import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("./DashboardV2Page.tsx", import.meta.url),
  "utf8",
);
const sections = readFileSync(
  new URL("./dashboard-v2-sections.tsx", import.meta.url),
  "utf8",
);

test("new workspaces receive visible initialization feedback without route invalidation", () => {
  assert.match(page, /dashboard\.onboarding\.workspaceInitializing/);
  assert.match(page, /dashboard\.onboarding\.workspaceInitializingDesc/);
  assert.match(page, /role="status"/);
  assert.doesNotMatch(page, /setInterval/);
  assert.doesNotMatch(page, /router\.invalidate/);
  assert.match(page, /onClick=\{\(\) => void onRetry\(\)\}/);
});

test("trend lazy chunk keeps a stable fallback", () => {
  assert.match(page, /Suspense fallback=\{<DashboardTrendFallback \/>\}/);
});

test("agent workflow management keeps the selected tool", () => {
  assert.match(sections, /search=\{\{ agent: selectedTool \}\}/);
});
