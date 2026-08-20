import { test } from "node:test";
import assert from "node:assert/strict";

import { dashboardInsightAdapter } from "./insight-evidence.server.ts";
import type {
  InsightEvidence,
  InsightEvidenceBundle,
} from "../insights/page/contracts.ts";

function metric(id: string, value: number): InsightEvidence {
  return {
    id,
    kind: "metric",
    value,
    observedAt: "2026-08-20T00:00:00.000Z",
    freshness: "fresh",
    sensitivity: "aggregate",
  };
}

function bundle(evidence: readonly InsightEvidence[]): InsightEvidenceBundle {
  return {
    surfaceId: "dashboard",
    scope: {},
    observedAt: "2026-08-20T00:00:00.000Z",
    evidence,
  };
}

test("dashboard compose: usage data without a security scan yields usage line, not empty", () => {
  const result = dashboardInsightAdapter.composeCandidates(
    bundle([
      metric("dashboard.events", 128),
      metric("dashboard.tokens", 500_000),
      metric("dashboard.sessions", 12),
    ]),
  );
  assert.ok(result.length > 0);
  assert.equal(result[0]!.factKey, "insights.page.dashboard.dashboard-usage");
  assert.ok(
    result.every(
      (candidate) =>
        candidate.factKey !== "insights.page.dashboard.dashboard-empty",
    ),
  );
});

test("dashboard compose: no usage and no security yields the honest empty line", () => {
  const result = dashboardInsightAdapter.composeCandidates(bundle([]));
  assert.equal(result.length, 1);
  assert.equal(result[0]!.factKey, "insights.page.dashboard.dashboard-empty");
});

test("dashboard compose: security risk is mandatory and ranked first", () => {
  const result = dashboardInsightAdapter.composeCandidates(
    bundle([
      metric("dashboard.events", 1),
      metric("dashboard.securityAssessed", 12),
      metric("dashboard.securityRisk", 3),
    ]),
  );
  assert.equal(result[0]!.id, "dashboard.security-risk");
  assert.equal(result[0]!.mandatory, true);
});

test("dashboard compose: clean scan surfaces the safe line", () => {
  const result = dashboardInsightAdapter.composeCandidates(
    bundle([metric("dashboard.securityAssessed", 12)]),
  );
  assert.equal(result[0]!.id, "dashboard.security-safe");
});
