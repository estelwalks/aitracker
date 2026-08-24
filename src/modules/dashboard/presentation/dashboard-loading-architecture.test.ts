import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../../../routes/index.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("./DashboardPage.tsx", import.meta.url),
  "utf8",
);
const hook = readFileSync(
  new URL("./use-dashboard-summary.ts", import.meta.url),
  "utf8",
);
const dashboard = readFileSync(
  new URL("./DashboardV2Page.tsx", import.meta.url),
  "utf8",
);

test("home route commits without awaiting the Dashboard read model", () => {
  assert.match(route, /loader: \(\{ deps \}\) => deps\.locale/);
  assert.doesNotMatch(route, /getDashboardSummaryReadModel/);
  assert.match(route, /<DashboardPage locale=\{Route\.useLoaderData\(\)\} \/>/);
});

test("Dashboard data starts after hydration and never invalidates the router", () => {
  assert.match(hook, /enabled: clientReady/);
  assert.match(hook, /state\.status === "pending"/);
  assert.match(hook, /refetchInterval:/);
  assert.match(hook, /cancelQueries/);
  assert.match(hook, /data: locale, signal/);
  assert.doesNotMatch(hook, /setInterval/);
  assert.doesNotMatch(hook, /router\.invalidate/);
});

test("insight and trend placeholders preserve the first-paint layout", () => {
  assert.match(page, /requestAnimationFrame/);
  assert.match(page, /DashboardInsightFallback/);
  assert.match(page, /DashboardPageSkeleton/);
  assert.match(dashboard, /className="dashboard-panel flex h-\[280px\]/);
});
