/**
 * Page-insight evidence adapter for the `skills` surface.
 *
 * Evidence sources (O(1) snapshot read — never a scan, never a path):
 *  - unified Skill snapshot: skill count, installed-agent count, outdated count
 *
 * Fact keys are the canonical `insights.page.skills.*` vocabulary declared by
 * `PAGE_RULE_IDS` (M1).
 */
import {
  assertEntityId,
  emptyBundle,
  freshnessOf,
  metricEvidence,
  metricValue,
} from "../../app/insights/evidence-util.server.ts";
import type {
  InsightCandidate,
  InsightEvidenceBundle,
  InsightScope,
  PageInsightAdapter,
} from "../insights/page/contracts.ts";

function composeSkillsCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const count = metricValue(bundle, "skills.count");
  const enabled = metricValue(bundle, "skills.enabled");
  const candidates: InsightCandidate[] = [];
  if (count != null && count > 0) {
    candidates.push({
      id: "skills.local",
      severity: "info",
      factKey: "insights.page.skills.skills-local",
      factParams: { count },
      evidenceRefs: ["skills.count"],
      allowedActionIds: ["open_skills"],
      actionId: "open_skills",
    });
    if (enabled != null) {
      candidates.push({
        id: "skills.enabled",
        severity: "info",
        factKey: "insights.page.skills.skills-enabled",
        factParams: { count: enabled },
        evidenceRefs: ["skills.enabled"],
        allowedActionIds: ["open_skills"],
        actionId: "open_skills",
      });
    }
    candidates.push({
      id: "skills.sync",
      severity: "info",
      factKey: "insights.page.skills.skills-sync",
      factParams: {},
      evidenceRefs: ["skills.count"],
      allowedActionIds: ["open_skills"],
      actionId: "open_skills",
    });
    candidates.push({
      id: "skills.specific",
      severity: "info",
      factKey: "insights.page.skills.skills-specific",
      factParams: {},
      evidenceRefs: ["skills.count"],
      allowedActionIds: ["open_skills"],
      actionId: "open_skills",
    });
  }
  return candidates;
}

export const skillsInsightAdapter: PageInsightAdapter = {
  surfaceId: "skills",
  adapterVersion: 2,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const { skillSnapshot } = await getCompositionRoot();
    await skillSnapshot.ensureHydrated();
    const latest = skillSnapshot.readLatest();
    const snapshot = latest.data;

    if (snapshot == null) {
      return emptyBundle("skills", scope, observedAt, true);
    }

    const freshness = freshnessOf(snapshot.generatedAt, nowMs);
    const outdated = snapshot.skills.reduce(
      (total, skill) =>
        total +
        skill.installations.filter(
          (installation) => installation.updateStatus === "available",
        ).length,
      0,
    );
    const installedAgents = Object.values(snapshot.agents).filter(
      (agent) => agent.installed,
    ).length;
    const enabled = snapshot.skills.filter(
      (skill) => skill.installations.length > 0,
    ).length;

    return {
      surfaceId: "skills" as const,
      scope,
      observedAt,
      evidence: [
        metricEvidence(
          "skills.count",
          snapshot.skills.length,
          observedAt,
          freshness,
          "count",
        ),
        metricEvidence(
          "skills.agents",
          installedAgents,
          observedAt,
          freshness,
          "count",
        ),
        metricEvidence(
          "skills.outdated",
          outdated,
          observedAt,
          freshness,
          "count",
        ),
        metricEvidence(
          "skills.enabled",
          enabled,
          observedAt,
          freshness,
          "count",
        ),
      ],
    };
  },
  composeCandidates: composeSkillsCandidates,
};
