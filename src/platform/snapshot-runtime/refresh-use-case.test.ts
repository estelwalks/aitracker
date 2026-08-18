import assert from "node:assert/strict";
import test from "node:test";

import { createDomainRefreshPort } from "./refresh-use-case.ts";

test("manual refresh bypasses freshness but respects single-flight", async () => {
  let refreshes = 0;
  const port = createDomainRefreshPort({
    refreshNow: async () => {
      refreshes += 1;
      return { revision: "rev-1", data: {} };
    },
    isFresh: () => true,
    refreshing: () => false,
  });
  const outcome = await port.refresh({ reason: "manual", force: true });
  assert.equal(outcome.status, "refreshed");
  assert.equal(refreshes, 1);
});

test("non-forced refresh is skipped when fresh", async () => {
  let refreshes = 0;
  const port = createDomainRefreshPort({
    refreshNow: async () => {
      refreshes += 1;
      return { revision: "rev-1", data: {} };
    },
    isFresh: () => true,
    refreshing: () => false,
  });
  const outcome = await port.refresh({ reason: "schedule" });
  assert.equal(outcome.status, "skipped");
  assert.equal(refreshes, 0);
});

test("stale refresh runs and reports the new revision", async () => {
  let refreshes = 0;
  const port = createDomainRefreshPort({
    refreshNow: async () => {
      refreshes += 1;
      return { revision: "rev-2", data: {} };
    },
    isFresh: () => false,
    refreshing: () => false,
  });
  const outcome = await port.refresh({ reason: "startup" });
  assert.equal(outcome.status, "refreshed");
  assert.equal(outcome.revision, "rev-2");
});

test("already-running reports without duplicating the refresh", async () => {
  let refreshes = 0;
  const port = createDomainRefreshPort({
    refreshNow: async () => {
      refreshes += 1;
      return { revision: "rev-3", data: {} };
    },
    isFresh: () => false,
    refreshing: () => true,
  });
  const outcome = await port.refresh({ reason: "empty" });
  assert.equal(outcome.status, "already-running");
  assert.equal(refreshes, 0);
});

test("collector failure maps to a stable failed outcome", async () => {
  const port = createDomainRefreshPort({
    refreshNow: async () => {
      throw new Error("boom");
    },
    isFresh: () => false,
    refreshing: () => false,
  });
  const outcome = await port.refresh({ reason: "manual", force: true });
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.revision, null);
});
