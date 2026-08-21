import assert from "node:assert/strict";
import test from "node:test";

import {
  type InsightActionId,
  type InsightCandidate,
  type InsightEvidence,
  type InsightEvidenceBundle,
  type InsightSurfaceId,
} from "../../modules/insights/page/contracts.ts";
import { INSIGHT_ACTIONS } from "../../modules/insights/page/action-registry.ts";

const INSIGHT_ACTION_IDS = Object.keys(
  INSIGHT_ACTIONS,
) as readonly InsightActionId[];
import {
  dashboardInsightAdapter,
  widgetInsightAdapter,
} from "../../modules/dashboard/insight-evidence.server.ts";
import {
  agentsInsightAdapter,
  trackerInsightAdapter,
} from "../../modules/usage/insight-evidence.server.ts";
import { distillInsightAdapter } from "../../modules/distillation/insight-evidence.server.ts";
import { reportsInsightAdapter } from "../../modules/reports/insight-evidence.server.ts";
import { memoryInsightAdapter } from "../../modules/knowledge/insight-evidence.server.ts";
import { securityInsightAdapter } from "../../modules/security-assessment/insight-evidence.server.ts";
import { skillsInsightAdapter } from "../../modules/skill-catalog/insight-evidence.server.ts";
import {
  chatsInsightAdapter,
  chatDetailInsightAdapter,
} from "../../modules/sessions/insight-evidence.server.ts";
import { sourcesInsightAdapter } from "../../modules/sources/insight-evidence.server.ts";
import { marketInsightAdapter } from "../../lib/local-market/insight-evidence.server.ts";
import { settingsInsightAdapter } from "../../modules/settings/insight-evidence.server.ts";
import type { PageInsightAdapter } from "../../modules/insights/page/contracts.ts";

const OBSERVED_AT = "2024-06-01T12:00:00.000Z";
const SECRET_RE = /apiKey|Bearer|password|secret|credential/i;
const PATH_RE = /^(?:\/|[A-Za-z]:[\\/]|\\)/;

function ev(
  id: string,
  value: string | number | boolean,
  kind: InsightEvidence["kind"] = "metric",
  freshness: InsightEvidence["freshness"] = "fresh",
): InsightEvidence {
  return {
    id,
    kind,
    value,
    observedAt: OBSERVED_AT,
    freshness,
    sensitivity: "aggregate",
  };
}

function bundle(
  surfaceId: InsightSurfaceId,
  evidence: readonly InsightEvidence[],
  partial = false,
): InsightEvidenceBundle {
  return {
    surfaceId,
    scope: {},
    observedAt: OBSERVED_AT,
    evidence,
    ...(partial ? { partial: true } : {}),
  };
}

function assertEvidenceSafe(items: readonly InsightEvidence[]): void {
  for (const item of items) {
    assert.match(item.id, /^[A-Za-z0-9._:-]{1,120}$/, "evidence id opaque");
    if (typeof item.value === "string") {
      assert.doesNotMatch(item.value, PATH_RE, `${item.id} must not be a path`);
      assert.doesNotMatch(
        item.value,
        SECRET_RE,
        `${item.id} must not carry a secret`,
      );
    }
  }
}

function assertCandidatesValid(
  bundleValue: InsightEvidenceBundle,
  candidates: readonly InsightCandidate[],
): void {
  assert.ok(Array.isArray(candidates));
  const evidenceIds = new Set(bundleValue.evidence.map((item) => item.id));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    assert.ok(
      !seen.has(candidate.id),
      `duplicate candidate id ${candidate.id}`,
    );
    seen.add(candidate.id);
    assert.ok(
      candidate.severity === "info" ||
        candidate.severity === "attention" ||
        candidate.severity === "risk",
      `${candidate.id} severity valid`,
    );
    for (const ref of candidate.evidenceRefs) {
      assert.ok(evidenceIds.has(ref), `${candidate.id} ref ${ref} exists`);
    }
    if (candidate.actionId !== undefined) {
      assert.ok(
        INSIGHT_ACTION_IDS.includes(candidate.actionId),
        `${candidate.id} action valid`,
      );
      assert.ok(
        candidate.allowedActionIds.includes(candidate.actionId),
        `${candidate.id} action allowed`,
      );
    }
    for (const [key, value] of Object.entries(candidate.factParams)) {
      if (typeof value === "number") {
        const fromEvidence = candidate.evidenceRefs.some((ref: string) => {
          const item = bundleValue.evidence.find((e) => e.id === ref);
          return item != null && item.value === value;
        });
        assert.ok(
          fromEvidence,
          `${candidate.id} param ${key}=${value} must come from evidence`,
        );
      } else if (typeof value === "string") {
        assert.doesNotMatch(
          value,
          PATH_RE,
          `${candidate.id} param ${key} path`,
        );
        assert.doesNotMatch(
          value,
          SECRET_RE,
          `${candidate.id} param ${key} secret`,
        );
      }
    }
  }
}

interface AdapterFixture {
  readonly adapter: PageInsightAdapter;
  /** Evidence that should trigger at least one actionable candidate. */
  readonly healthy: readonly InsightEvidence[];
  /** Optional risk-state fixture (should produce a `risk` candidate). */
  readonly risk?: readonly InsightEvidence[];
}

const FIXTURES: readonly AdapterFixture[] = [
  {
    adapter: dashboardInsightAdapter,
    healthy: [
      ev("dashboard.securityAssessed", 12),
      ev("dashboard.securityRisk", 0),
      ev("dashboard.events", 30),
      ev("dashboard.tokens", 200_000),
      ev("dashboard.sessions", 5),
      ev("dashboard.topSource", "claude-code", "status"),
      ev("dashboard.topShareRate", 63),
      ev("dashboard.lowCacheSource", "codex", "status"),
      ev("dashboard.lowCacheRate", 12),
    ],
    risk: [
      ev("dashboard.securityAssessed", 12),
      ev("dashboard.securityRisk", 3),
    ],
  },
  {
    adapter: widgetInsightAdapter,
    healthy: [
      ev("dashboard.securityRisk", 0),
      ev("dashboard.sessions", 5),
      ev("dashboard.lowCacheSource", "codex", "status"),
      ev("dashboard.lowCacheRate", 12),
    ],
    risk: [ev("dashboard.securityRisk", 2), ev("dashboard.sessions", 5)],
  },
  {
    adapter: trackerInsightAdapter,
    healthy: [
      ev("tracker.tokens", 100_000, "metric"),
      ev("tracker.events", 30),
      ev("tracker.topSource", "claude-code", "status"),
      ev("tracker.lowCacheSource", "codex", "status"),
      ev("tracker.lowCacheRate", 12, "metric"),
      ev("tracker.wasteLeaderName", "claude-code", "status"),
      ev("tracker.wasteLeaderRate", 42),
      ev("tracker.topModel", "claude-sonnet", "status"),
      ev("tracker.topProject", "~/demo", "status"),
      ev("tracker.suggestCount", 2),
    ],
  },
  {
    adapter: agentsInsightAdapter,
    healthy: [
      ev("agents.activeSources", 4),
      ev("agents.totalSources", 8),
      ev("agents.availableSources", 5),
      ev("agents.inactiveSources", 4),
      ev("agents.sessions", 3),
      ev("agents.events", 30),
      ev("agents.tokens", 200_000),
      ev("agents.topSource", "claude-code", "status"),
      ev("agents.topShareRate", 63),
    ],
  },
  {
    adapter: distillInsightAdapter,
    healthy: [
      ev("distill.waiting", 2),
      ev("distill.quotaRemaining", 5),
      ev("distill.quotaUsedRate", 75),
      ev("distill.knowledge", 3),
    ],
    risk: [
      ev("distill.waiting", 0),
      ev("distill.quotaRemaining", 0),
      ev("distill.quotaUsedRate", 100),
    ],
  },
  {
    adapter: reportsInsightAdapter,
    healthy: [
      ev("reports.total", 4),
      ev("reports.latestTime", OBSERVED_AT, "status"),
    ],
  },
  {
    adapter: memoryInsightAdapter,
    healthy: [
      ev("memory.count", 9),
      ev("memory.approved", 5),
      ev("memory.unsafe", 0),
    ],
  },
  {
    adapter: securityInsightAdapter,
    healthy: [
      ev("security.assessed", 20),
      ev("security.discovered", 20),
      ev("security.risky", 0),
      ev("security.clean", 20),
      ev("security.failed", 0),
      ev("security.scanTime", OBSERVED_AT, "status"),
      ev("security.coverageRate", 80),
    ],
    risk: [
      ev("security.assessed", 20),
      ev("security.discovered", 20),
      ev("security.risky", 3),
      ev("security.clean", 17),
      ev("security.failed", 1),
      ev("security.scanTime", OBSERVED_AT, "status"),
    ],
  },
  {
    adapter: skillsInsightAdapter,
    healthy: [
      ev("skills.count", 7),
      ev("skills.agents", 3),
      ev("skills.outdated", 1),
      ev("skills.enabled", 4),
    ],
  },
  {
    adapter: marketInsightAdapter,
    healthy: [
      ev("market.installed", 3),
      ev("market.cachedTotal", 40),
      ev("market.updates", 1),
    ],
  },
  {
    adapter: chatsInsightAdapter,
    healthy: [
      ev("chats.total", 11),
      ev("chats.sources", 4),
      ev("chats.recoverable", 6),
      ev("chats.topSource", "claude-code", "status"),
    ],
  },
  {
    adapter: chatDetailInsightAdapter,
    healthy: [
      ev("chat-detail.turns", 24),
      ev("chat-detail.tokens", 40_000),
      ev("chat-detail.recoverable", true, "availability"),
    ],
  },
  {
    adapter: sourcesInsightAdapter,
    healthy: [
      ev("sources.total", 8),
      ev("sources.connected", 5),
      ev("sources.available", 5),
      ev("sources.gaps", 3),
      ev("sources.malformed", 2),
    ],
  },
  {
    adapter: settingsInsightAdapter,
    healthy: [
      ev("settings.profiles", 1),
      ev("settings.profileReady", true, "availability"),
      ev("settings.tasksEnabled", 4),
    ],
  },
];

for (const fixture of FIXTURES) {
  const surfaceId = fixture.adapter.surfaceId;

  test(`${surfaceId}: healthy candidates are contract-valid`, () => {
    const bundleValue = bundle(surfaceId, fixture.healthy);
    const candidates = fixture.adapter.composeCandidates(bundleValue);
    assertEvidenceSafe(bundleValue.evidence);
    assertCandidatesValid(bundleValue, candidates);
    assert.ok(
      candidates.length >= 1,
      "healthy state must produce >= 1 candidate",
    );
  });

  test(`${surfaceId}: empty bundle degrades honestly`, () => {
    const bundleValue = bundle(surfaceId, [], true);
    const candidates = fixture.adapter.composeCandidates(bundleValue);
    assertCandidatesValid(bundleValue, candidates);
  });

  if (fixture.risk) {
    test(`${surfaceId}: risk fixture surfaces a risk candidate`, () => {
      const bundleValue = bundle(surfaceId, fixture.risk!);
      const candidates = fixture.adapter.composeCandidates(bundleValue);
      assertEvidenceSafe(bundleValue.evidence);
      assertCandidatesValid(bundleValue, candidates);
      assert.ok(
        candidates.some((candidate) => candidate.severity === "risk"),
        "risk fixture must surface a risk candidate",
      );
    });
  }

  test(`${surfaceId}: stale/partial evidence stays contract-valid`, () => {
    const staleEvidence = fixture.healthy.map((item) =>
      item.kind === "metric" || item.kind === "status"
        ? { ...item, freshness: "stale" as const }
        : item,
    );
    const bundleValue = bundle(surfaceId, staleEvidence, true);
    const candidates = fixture.adapter.composeCandidates(bundleValue);
    assertCandidatesValid(bundleValue, candidates);
  });
}
