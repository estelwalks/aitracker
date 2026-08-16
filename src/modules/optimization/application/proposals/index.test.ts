import assert from "node:assert/strict";
import test from "node:test";
import {
  applyApproved,
  approve,
  createChangeProposal,
  reject,
  requestApproval,
  rollbackApplied,
} from "./index.ts";
import type { ChangeDispatchResult } from "./contracts.ts";
import type { OptimizationFinding } from "../../contracts.ts";

const finding: OptimizationFinding = {
  id: "finding:high-cost:opaque-123",
  code: "high-cost",
  severity: "high",
  title: "Project cost is above the configured review threshold",
  rationale: "Review the project's model mix.",
  evidenceRef: "opaque-evidence",
  recommendation: {
    id: "recommendation:high-cost:opaque-123",
    action: "review-project",
    priority: "high",
    rationale: "Review the project's model mix.",
    evidenceRef: "opaque-evidence",
    estimatedImpact: {
      kind: "cost",
      confidence: "exact",
      amountUsd: 12,
      unit: "usd",
    },
  },
  estimatedImpact: {
    kind: "cost",
    confidence: "exact",
    amountUsd: 12,
    unit: "usd",
  },
  projectId: "opaque-project",
};

const FIXED_NOW = "2026-08-07T00:00:00.000Z";

function draft(expiresAt?: string) {
  return createChangeProposal({
    finding,
    now: FIXED_NOW,
    // A 30-day window keeps the proposal valid against the real test clock
    // (the suite must pass at any run date), while "expired proposals cannot
    // be approved" below pins its own past expiry + injected now.
    expiresAt: expiresAt ?? "2026-09-06T00:00:00.000Z",
  });
}

/** Clock pinned to the draft creation time so the state machine tests do not
 * depend on the wall clock (the proposal window is far in the future). */
function pinnedNow(): () => Date {
  return () => new Date(FIXED_NOW);
}

test("approval is explicit and no dispatcher is called before apply", async () => {
  let calls = 0;
  const proposal = draft();
  const waiting = requestApproval(proposal, { now: pinnedNow() });
  assert.equal(waiting.ok, true);
  if (!waiting.ok) return;
  const approved = approve(waiting.value, { now: pinnedNow() });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const result = await applyApproved(approved.value, {
    now: pinnedNow(),
    dispatcher: {
      dispatch: async () => {
        calls += 1;
        return { changeRef: "change-1" };
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.state, "applied");
});

test("invalid and duplicate approvals are rejected", () => {
  const proposal = draft();
  assert.equal(approve(proposal, { now: pinnedNow() }).ok, false);
  const waiting = requestApproval(proposal, { now: pinnedNow() });
  assert.equal(waiting.ok, true);
  if (!waiting.ok) return;
  const approved = approve(waiting.value, { now: pinnedNow() });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  assert.equal(approve(approved.value, { now: pinnedNow() }).ok, false);
  assert.equal(reject(approved.value, { now: pinnedNow() }).ok, false);
});

test("expired proposals cannot be approved", () => {
  const proposal = draft("2026-08-06T00:00:00.000Z");
  const waiting = requestApproval(proposal, {
    now: () => new Date("2026-08-07T00:00:00.000Z"),
  });
  assert.equal(waiting.ok, false);
  if (!waiting.ok) assert.equal(waiting.error.code, "errors.proposal-expired");
});

test("proposal DTO and audit contain no paths, commands or body text", () => {
  const events: unknown[] = [];
  const proposal = draft();
  const waiting = requestApproval(proposal, {
    now: pinnedNow(),
    audit: (entry) => events.push(entry),
  });
  assert.equal(waiting.ok, true);
  const serialized = JSON.stringify({ proposal, events });
  assert.doesNotMatch(
    serialized,
    /Users|C:\\\\|command|prompt|token|secret|content/i,
  );
});

test("rollback is explicit and records a safe audit event", async () => {
  const events: unknown[] = [];
  const proposal = draft();
  const waiting = requestApproval(proposal, { now: pinnedNow() });
  assert.equal(waiting.ok, true);
  if (!waiting.ok) return;
  const approved = approve(waiting.value, { now: pinnedNow() });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const dispatch: ChangeDispatchResult = {
    changeRef: "change-2",
    rollbackToken: "opaque-token",
  };
  const applied = await applyApproved(approved.value, {
    now: pinnedNow(),
    dispatcher: { dispatch: async () => dispatch },
  });
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  const rolled = await rollbackApplied(applied.value, dispatch, {
    now: pinnedNow(),
    dispatcher: {
      dispatch: async () => dispatch,
      rollback: async () => undefined,
    },
    audit: (entry) => events.push(entry),
  });
  assert.equal(rolled.ok, true);
  if (rolled.ok) assert.equal(rolled.value.rollback.status, "succeeded");
  assert.equal(events.length, 1);
});

test("dispatcher failure attempts compensation and emits an audit event", async () => {
  let rollbackCalls = 0;
  const events: unknown[] = [];
  const proposal = draft();
  const waiting = requestApproval(proposal, { now: pinnedNow() });
  assert.equal(waiting.ok, true);
  if (!waiting.ok) return;
  const approved = approve(waiting.value, { now: pinnedNow() });
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const result = await applyApproved(approved.value, {
    now: pinnedNow(),
    dispatcher: {
      dispatch: async () => {
        throw new Error("partial failure");
      },
      rollback: async () => {
        rollbackCalls += 1;
      },
    },
    audit: (entry) => events.push(entry),
  });
  assert.equal(result.ok, false);
  assert.equal(rollbackCalls, 1);
  assert.equal(events.length, 1);
  assert.equal((events[0] as { action: string }).action, "dispatch-failed");
});
