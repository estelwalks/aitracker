import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveWorkspaceInitializationState,
  retryWorkspaceInitialization,
} from "./workspace-initialization-state.ts";

test("shows onboarding progress only while an empty workspace is initializing", () => {
  assert.equal(
    resolveWorkspaceInitializationState({
      hasUsageData: false,
      hasSessionData: false,
      snapshotStatus: "empty",
    }),
    "loading",
  );
  assert.equal(
    resolveWorkspaceInitializationState({
      hasUsageData: false,
      hasSessionData: false,
      snapshotStatus: "refreshing",
    }),
    "loading",
  );
  assert.equal(
    resolveWorkspaceInitializationState({
      hasUsageData: true,
      hasSessionData: false,
      snapshotStatus: "failed",
    }),
    "idle",
  );
});

test("shows retry only when an empty workspace initialization fails", () => {
  assert.equal(
    resolveWorkspaceInitializationState({
      hasUsageData: false,
      hasSessionData: false,
      snapshotStatus: "failed",
    }),
    "failed",
  );
  assert.equal(
    resolveWorkspaceInitializationState({
      hasUsageData: false,
      hasSessionData: true,
      snapshotStatus: "failed",
    }),
    "idle",
  );
});

test("retry resets the local status and invalidates the dashboard loader", async () => {
  const statuses: string[] = [];
  const actions: string[] = [];
  retryWorkspaceInitialization({
    resetStatus: (status) => {
      statuses.push(status);
      actions.push("reset");
    },
    triggerRefresh: async () => {
      actions.push("refresh");
    },
    invalidate: async () => {
      actions.push("invalidate");
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(statuses, ["empty"]);
  assert.deepEqual(actions, ["reset", "refresh", "invalidate"]);
});
