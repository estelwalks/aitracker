import assert from "node:assert/strict";
import test from "node:test";
import { resolveDashboardSnapshotStatus } from "./snapshot-status.ts";

const snapshot = (
  status: "empty" | "fresh" | "stale" | "failed" | "refreshing",
  data: unknown = null,
  warningCodes: readonly string[] = [],
) => ({ status, data, warningCodes });

test("first-scan collection failures are observable despite an empty coordinator", () => {
  assert.equal(
    resolveDashboardSnapshotStatus({
      usage: snapshot("empty", null, ["collection-failed"]),
      sessions: snapshot("empty"),
    }),
    "failed",
  );
});

test("a previous workspace snapshot remains usable after a refresh failure", () => {
  assert.equal(
    resolveDashboardSnapshotStatus({
      usage: snapshot("fresh", { events: [] }, ["collection-failed"]),
      sessions: snapshot("fresh", { sessions: [] }),
    }),
    "fresh",
  );
});
