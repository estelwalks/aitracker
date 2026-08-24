import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("./DashboardV2Page.tsx", import.meta.url),
  "utf8",
);

test("new workspaces receive visible initialization feedback with fast polling", () => {
  assert.match(page, /const FIRST_SCAN_POLL_MS = 2_000/);
  assert.match(page, /dashboard\.onboarding\.workspaceInitializing/);
  assert.match(page, /dashboard\.onboarding\.workspaceInitializingDesc/);
  assert.match(page, /role="status"/);
  assert.match(
    page,
    /snapshotStatus === "empty" \|\| snapshotStatus === "refreshing"/,
  );
});
