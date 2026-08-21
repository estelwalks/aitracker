import assert from "node:assert/strict";
import test from "node:test";
import type {
  InsightCandidate,
  InsightEvidence,
  InsightEvidenceBundle,
  InsightScope,
  InsightSeverity,
} from "./contracts.ts";
import {
  canonicalScopeHash,
  evidenceHash,
  isInsightSurfaceId,
  rankCandidates,
  resolveFactText,
  validateCandidates,
  validateEvidenceBundle,
} from "./domain.ts";

function evidence(
  id: string,
  value: InsightEvidence["value"],
  overrides: Partial<InsightEvidence> = {},
): InsightEvidence {
  return {
    id,
    kind: "metric",
    value,
    observedAt: "2026-08-07T00:00:00.000Z",
    freshness: "fresh",
    sensitivity: "aggregate",
    ...overrides,
  };
}

function bundle(
  items: readonly InsightEvidence[],
  overrides: Partial<InsightEvidenceBundle> = {},
): InsightEvidenceBundle {
  return {
    surfaceId: "dashboard",
    scope: { range: "today" },
    observedAt: "2026-08-07T00:00:00.000Z",
    evidence: items,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<InsightCandidate> = {},
): InsightCandidate {
  return {
    id: "c1",
    severity: "info",
    factKey: "insights.page.dashboard.dashboard-watch",
    factParams: {},
    evidenceRefs: ["e1"],
    allowedActionIds: [],
    ...overrides,
  };
}

test("rankCandidates orders mandatory first, then severity, then stable, and truncates", () => {
  const make = (
    id: string,
    severity: InsightSeverity,
    mandatory: boolean,
  ): InsightCandidate => candidate({ id, severity, mandatory });
  const ranked = rankCandidates(
    [
      make("info-1", "info", false),
      make("risk-1", "risk", false),
      make("attn-1", "attention", false),
      make("mand-1", "attention", true),
      make("info-2", "info", false),
      make("risk-2", "risk", false),
    ],
    4,
  );
  assert.deepEqual(
    ranked.map((item) => item.id),
    ["mand-1", "risk-1", "risk-2", "attn-1"],
  );
});

test("validateEvidenceBundle accepts scalars and rejects paths, secrets, ids and objects", () => {
  const good = bundle([
    evidence("e1", 42),
    evidence("e2", "plain text"),
    evidence("e3", true),
    evidence("e4", null),
  ]);
  assert.deepEqual(validateEvidenceBundle(good), []);

  const posixPath = bundle([evidence("bad", "/etc/passwd")]);
  assert.ok(validateEvidenceBundle(posixPath).some((e) => e.includes("path")));

  const winPath = bundle([evidence("bad2", "C:\\Users\\alice")]);
  assert.ok(validateEvidenceBundle(winPath).some((e) => e.includes("path")));

  const secret = bundle([evidence("bad3", "apiKey=abc123")]);
  assert.ok(validateEvidenceBundle(secret).some((e) => e.includes("secret")));

  const badId = bundle([evidence("has space!", "x")]);
  assert.ok(validateEvidenceBundle(badId).some((e) => e.includes("id")));

  const objectValue = bundle([
    { ...evidence("e", 1), value: { a: 1 } } as unknown as InsightEvidence,
  ]);
  assert.ok(
    validateEvidenceBundle(objectValue).some((e) => e.includes("type")),
  );
});

test("validateCandidates checks refs, action whitelist, uniqueness and severity", () => {
  const b = bundle([evidence("e1", 1)]);

  const good = [
    candidate({
      id: "a",
      actionId: "open_security",
      allowedActionIds: ["open_security"],
    }),
  ];
  assert.deepEqual(validateCandidates(b, good), []);

  const missingRef = [candidate({ id: "a", evidenceRefs: ["nope"] })];
  assert.ok(
    validateCandidates(b, missingRef).some((e) => e.includes("evidenceRef")),
  );

  const badAction = [
    candidate({
      id: "a",
      actionId: "open_security",
      allowedActionIds: ["open_distill"],
    }),
  ];
  assert.ok(
    validateCandidates(b, badAction).some((e) => e.includes("notAllowed")),
  );

  const duplicate = [candidate({ id: "a" }), candidate({ id: "a" })];
  assert.ok(
    validateCandidates(b, duplicate).some((e) => e.includes("duplicate")),
  );

  const badSeverity = [
    { ...candidate(), severity: "critical" } as unknown as InsightCandidate,
  ];
  assert.ok(
    validateCandidates(b, badSeverity).some((e) => e.includes("severity")),
  );
});

test("canonicalScopeHash is deterministic and key-order independent", () => {
  const a: InsightScope = { range: "7d", entityId: "agent-1" };
  const b: InsightScope = { entityId: "agent-1", range: "7d" };
  assert.equal(canonicalScopeHash(a), canonicalScopeHash(b));
  assert.equal(canonicalScopeHash({}), canonicalScopeHash({}));
  assert.notEqual(
    canonicalScopeHash({ range: "today" }),
    canonicalScopeHash({ range: "7d" }),
  );
});

test("evidenceHash is deterministic, key-order independent and whitelist-only", () => {
  const e1: InsightEvidence = {
    id: "e1",
    kind: "metric",
    value: 5,
    observedAt: "t",
    freshness: "fresh",
    sensitivity: "aggregate",
  };
  const e2: InsightEvidence = {
    value: 5,
    id: "e1",
    freshness: "fresh",
    sensitivity: "aggregate",
    observedAt: "t",
    kind: "metric",
  };
  assert.equal(evidenceHash(bundle([e1])), evidenceHash(bundle([e2])));

  assert.notEqual(
    evidenceHash(bundle([e1])),
    evidenceHash(bundle([{ ...e1, value: 6 }])),
  );

  const extra = {
    ...e1,
    ignored: "not-whitelisted",
  } as unknown as InsightEvidence;
  assert.equal(evidenceHash(bundle([e1])), evidenceHash(bundle([extra])));
});

test("evidenceHash ignores bundle and item sampling timestamps", () => {
  const first = bundle([evidence("e1", 5)], {
    observedAt: "2026-08-07T00:00:00.000Z",
  });
  const resampled = bundle(
    [evidence("e1", 5, { observedAt: "2026-08-07T00:05:00.000Z" })],
    { observedAt: "2026-08-07T00:05:00.000Z" },
  );

  assert.equal(evidenceHash(first), evidenceHash(resampled));
});

test("evidenceHash changes when evidence value or freshness changes", () => {
  const base = bundle([evidence("e1", 5)]);

  assert.notEqual(
    evidenceHash(base),
    evidenceHash(bundle([evidence("e1", 6)])),
  );
  assert.notEqual(
    evidenceHash(base),
    evidenceHash(bundle([evidence("e1", 5, { freshness: "stale" })])),
  );
});

test("resolveFactText resolves zh/en and falls back to zh-CN for unknown locales", () => {
  const c = candidate({
    factKey: "insights.page.widget.widget-broadcast-security",
    factParams: { count: 3 },
  });
  const zh = resolveFactText("zh-CN", c);
  const en = resolveFactText("en-US", c);
  assert.match(zh, /3/);
  assert.match(en, /3/);
  assert.notEqual(zh, en);
  assert.equal(resolveFactText("xx-XX", c), zh);
});

test("isInsightSurfaceId narrows valid ids and rejects everything else", () => {
  assert.equal(isInsightSurfaceId("dashboard"), true);
  assert.equal(isInsightSurfaceId("chat-detail"), true);
  assert.equal(isInsightSurfaceId("nope"), false);
  assert.equal(isInsightSurfaceId(42), false);
  assert.equal(isInsightSurfaceId(null), false);
  assert.equal(isInsightSurfaceId(undefined), false);
});
