import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardSnapshotStatus } from "../summary-query.ts";
import {
  dashboardSnapshotSignature,
  shouldRefreshDashboardSummary,
} from "./dashboard-sync-policy.ts";

const fresh: DashboardSnapshotStatus = {
  status: "fresh",
  revision: "usage-2",
  generatedAt: "2026-08-24T08:00:00.000Z",
};

test("refreshes only when the status probe exposes a new consumable snapshot", () => {
  assert.equal(
    shouldRefreshDashboardSummary({
      navigationPending: false,
      summaryFetching: false,
      summaryRevision: "usage-1",
      sessionsAvailable: true,
      status: fresh,
    }),
    true,
  );
  assert.equal(
    shouldRefreshDashboardSummary({
      navigationPending: false,
      summaryFetching: false,
      summaryRevision: "usage-2",
      sessionsAvailable: true,
      status: fresh,
    }),
    false,
  );
  assert.equal(
    shouldRefreshDashboardSummary({
      navigationPending: false,
      summaryFetching: false,
      summaryRevision: "usage-2",
      sessionsAvailable: false,
      status: fresh,
    }),
    true,
  );
});

test("never refreshes during navigation, an existing fetch, or snapshot refresh", () => {
  for (const input of [
    { navigationPending: true, summaryFetching: false, status: fresh },
    { navigationPending: false, summaryFetching: true, status: fresh },
    {
      navigationPending: false,
      summaryFetching: false,
      status: { ...fresh, status: "refreshing" as const },
    },
  ]) {
    assert.equal(
      shouldRefreshDashboardSummary({
        ...input,
        summaryRevision: "usage-1",
        sessionsAvailable: true,
      }),
      false,
    );
  }
});

test("status signatures deduplicate unchanged polling results", () => {
  assert.equal(
    dashboardSnapshotSignature(fresh),
    "fresh:usage-2:2026-08-24T08:00:00.000Z",
  );
  assert.equal(
    dashboardSnapshotSignature({
      status: "empty",
      revision: null,
      generatedAt: null,
    }),
    "empty:none:none",
  );
});
