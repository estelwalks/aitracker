import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheAgeHoursFrom,
  marketInsightAdapter,
} from "../../../lib/local-market/insight-evidence.server.ts";
import { dashboardInsightAdapter } from "../../dashboard/insight-evidence.server.ts";
import { distillInsightAdapter } from "../../distillation/insight-evidence.server.ts";
import { memoryInsightAdapter } from "../../knowledge/insight-evidence.server.ts";
import { reportsInsightAdapter } from "../../reports/insight-evidence.server.ts";
import { securityInsightAdapter } from "../../security-assessment/insight-evidence.server.ts";
import {
  chatDetailInsightAdapter,
  chatsInsightAdapter,
} from "../../sessions/insight-evidence.server.ts";
import { settingsInsightAdapter } from "../../settings/insight-evidence.server.ts";
import { skillsInsightAdapter } from "../../skill-catalog/insight-evidence.server.ts";
import { sourcesInsightAdapter } from "../../sources/insight-evidence.server.ts";
import {
  agentsInsightAdapter,
  isCacheUsageObservable,
  trackerInsightAdapter,
} from "../../usage/insight-evidence.server.ts";
import type {
  InsightEvidence,
  InsightEvidenceBundle,
  InsightSurfaceId,
  PageInsightAdapter,
} from "./contracts.ts";
import {
  composePageCandidates,
  resolveFactText,
  validateCandidates,
} from "./domain.ts";
import { PAGE_SUPPLEMENTAL_CANDIDATES } from "./supplemental-candidates.ts";

const observedAt = "2026-08-21T00:00:00.000Z";

function evidence(
  id: string,
  value: InsightEvidence["value"],
  kind: InsightEvidence["kind"] = "metric",
): InsightEvidence {
  return {
    id,
    kind,
    value,
    observedAt,
    freshness: "fresh",
    sensitivity: "aggregate",
  };
}

function fixture(
  surfaceId: InsightSurfaceId,
  entries: readonly InsightEvidence[],
): InsightEvidenceBundle {
  return { surfaceId, scope: {}, observedAt, evidence: entries };
}

const cases: readonly [PageInsightAdapter, InsightEvidenceBundle][] = [
  [
    dashboardInsightAdapter,
    fixture("dashboard", [
      evidence("dashboard.securityAssessed", 8),
      evidence("dashboard.securityRisk", 0),
      evidence("dashboard.events", 20),
      evidence("dashboard.tokens", 40_000),
      evidence("dashboard.sessions", 6),
      evidence("dashboard.activeSources", 3),
      evidence("dashboard.averageTokensPerEvent", 2_000),
      evidence("dashboard.topSource", "codex", "status"),
      evidence("dashboard.topShareRate", 55),
      evidence("dashboard.skillAssets", 9),
      evidence("dashboard.knowledgeAssets", 4),
    ]),
  ],
  [
    agentsInsightAdapter,
    fixture("agents", [
      evidence("agents.activeSources", 2),
      evidence("agents.totalSources", 3),
      evidence("agents.availableSources", 3),
      evidence("agents.inactiveSources", 1),
      evidence("agents.sessions", 8),
      evidence("agents.events", 30),
      evidence("agents.tokens", 50_000),
      evidence("agents.topSource", "codex", "status"),
      evidence("agents.topShareRate", 60),
    ]),
  ],
  [
    distillInsightAdapter,
    fixture("distill", [
      evidence("distill.waiting", 2),
      evidence("distill.knowledge", 5),
      evidence("distill.quotaRemaining", 7),
      evidence("distill.quotaUsedRate", 30),
      evidence("distill.quotaUsed", 3),
      evidence("distill.quotaLimit", 10),
    ]),
  ],
  [
    reportsInsightAdapter,
    fixture("reports", [
      evidence("reports.total", 6),
      evidence("reports.daily", 4),
      evidence("reports.weekly", 2),
      evidence("reports.draft", 2),
      evidence("reports.approved", 3),
      evidence("reports.archived", 1),
      evidence("reports.latestTime", observedAt, "status"),
    ]),
  ],
  [
    memoryInsightAdapter,
    fixture("memory", [
      evidence("memory.count", 8),
      evidence("memory.approved", 5),
      evidence("memory.pending", 3),
      evidence("memory.unsafe", 1),
      evidence("memory.safe", 7),
    ]),
  ],
  [
    securityInsightAdapter,
    fixture("security", [
      evidence("security.assessed", 9),
      evidence("security.discovered", 10),
      evidence("security.risky", 1),
      evidence("security.clean", 8),
      evidence("security.failed", 1),
      evidence("security.coverageRate", 90),
      evidence("security.scanTime", observedAt, "status"),
    ]),
  ],
  [
    trackerInsightAdapter,
    fixture("tracker", [
      evidence("tracker.tokens", 80_000),
      evidence("tracker.events", 40),
      evidence("tracker.averageTokensPerEvent", 2_000),
      evidence("tracker.topSource", "codex", "status"),
      evidence("tracker.topSourceTokens", 50_000),
      evidence("tracker.topSourceShare", 63),
      evidence("tracker.wasteLeaderName", "codex", "status"),
      evidence("tracker.wasteLeaderRate", 45),
      evidence("tracker.topModel", "gpt-5", "status"),
      evidence("tracker.topProject", "project-a", "status"),
      evidence("tracker.lowCacheSource", "codex", "status"),
      evidence("tracker.lowCacheRate", 20),
      evidence("tracker.cacheObservableSources", 1),
      evidence("tracker.suggestCount", 1),
    ]),
  ],
  [
    skillsInsightAdapter,
    fixture("skills", [
      evidence("skills.count", 8),
      evidence("skills.enabled", 6),
      evidence("skills.agents", 2),
      evidence("skills.outdated", 1),
      evidence("skills.unassigned", 2),
    ]),
  ],
  [
    marketInsightAdapter,
    fixture("market", [
      evidence("market.installed", 3),
      evidence("market.updates", 1),
      evidence("market.current", 2),
      evidence("market.cachedTotal", 50),
      evidence("market.cacheAgeHours", 2),
    ]),
  ],
  [
    chatsInsightAdapter,
    fixture("chats", [
      evidence("chats.total", 8),
      evidence("chats.sources", 3),
      evidence("chats.recoverable", 2),
      evidence("chats.turns", 60),
      evidence("chats.tokens", 90_000),
      evidence("chats.durationMinutes", 120),
      evidence("chats.topSource", "codex", "status"),
    ]),
  ],
  [
    chatDetailInsightAdapter,
    fixture("chat-detail", [
      evidence("chat-detail.turns", 12),
      evidence("chat-detail.tokens", 15_000),
      evidence("chat-detail.recoverable", true, "availability"),
      evidence("chat-detail.durationMinutes", 45),
      evidence("chat-detail.editTurns", 4),
      evidence("chat-detail.retryTurns", 1),
      evidence("chat-detail.subagentCalls", 2),
      evidence("chat-detail.source", "codex", "status"),
      evidence("chat-detail.status", "available", "status"),
    ]),
  ],
  [
    settingsInsightAdapter,
    fixture("settings", [
      evidence("settings.profiles", 2),
      evidence("settings.readyProfiles", 1),
      evidence("settings.tasksTotal", 4),
      evidence("settings.tasksEnabled", 3),
      evidence("settings.tasksDisabled", 1),
    ]),
  ],
  [
    sourcesInsightAdapter,
    fixture("sources", [
      evidence("sources.total", 20),
      evidence("sources.available", 5),
      evidence("sources.connected", 3),
      evidence("sources.gaps", 17),
      evidence("sources.malformed", 1),
      evidence("sources.installed", 6),
    ]),
  ],
];

function normalizeRenderedFact(value: string): string {
  return value.replace(/[\s\p{P}\p{S}]+/gu, "").toLocaleLowerCase();
}

test("complete-page fixtures produce only unique evidence-backed candidates", () => {
  assert.equal(cases.length, 13);
  for (const [adapter, bundle] of cases) {
    const candidates = composePageCandidates(adapter, bundle);
    assert.ok(candidates.length > 0, `${adapter.surfaceId}: no real facts`);
    assert.ok(
      candidates.length <= 10,
      `${adapter.surfaceId}: ${candidates.length}`,
    );
    assert.deepEqual(validateCandidates(bundle, candidates), []);
    assert.equal(
      new Set(candidates.map((candidate) => candidate.id)).size,
      candidates.length,
      adapter.surfaceId,
    );
    const renderedFacts = candidates.map((candidate) =>
      normalizeRenderedFact(resolveFactText("zh-CN", candidate)),
    );
    assert.equal(
      new Set(renderedFacts).size,
      renderedFacts.length,
      `${adapter.surfaceId}: duplicate rendered fact`,
    );
    assert.equal(
      candidates.every((candidate) => candidate.evidenceRefs.length > 0),
      true,
      adapter.surfaceId,
    );
  }
});

test("generic supplemental padding is empty for every complete page", () => {
  for (const candidates of Object.values(PAGE_SUPPLEMENTAL_CANDIDATES)) {
    assert.deepEqual(candidates, []);
  }
});

test("dashboard and agents never emit cache candidates", () => {
  for (const [adapter, bundle] of cases.filter(([adapter]) =>
    ["dashboard", "agents"].includes(adapter.surfaceId),
  )) {
    const serialized = JSON.stringify(composePageCandidates(adapter, bundle));
    assert.doesNotMatch(serialized, /cache/i, adapter.surfaceId);
  }
});

test("aipy cache usage is not observable from its registry mapping", () => {
  assert.equal(isCacheUsageObservable("aipy"), false);
});

test("invalid market cache timestamps do not become a zero-age candidate", () => {
  assert.equal(cacheAgeHoursFrom("not-a-timestamp", Date.now()), null);

  const marketCase = cases.find(([adapter]) => adapter.surfaceId === "market");
  assert.ok(marketCase);
  const [adapter, bundle] = marketCase;
  const withoutAge = {
    ...bundle,
    evidence: bundle.evidence.filter(
      (item) => item.id !== "market.cacheAgeHours",
    ),
  };
  const candidates = composePageCandidates(adapter, withoutAge);
  assert.equal(
    candidates.some((candidate) => candidate.id === "market.cache-age"),
    false,
  );
});
