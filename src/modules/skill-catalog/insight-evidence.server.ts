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
} from "../insights/index.ts";

function composeSkillsCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const count = metricValue(bundle, "skills.count");
  const enabled = metricValue(bundle, "skills.enabled");
  const agents = metricValue(bundle, "skills.agents");
  const outdated = metricValue(bundle, "skills.outdated");
  const unassigned = metricValue(bundle, "skills.unassigned");
  const candidates: InsightCandidate[] = [];
  for (const [id, value, key, ref, param] of [
    ["inventory", count, "skills-guide-inventory", "skills.count", "count"],
    [
      "enabled",
      enabled,
      "skills-guide-enablement",
      "skills.enabled",
      "enabled",
    ],
    ["agents", agents, "skills-guide-coverage", "skills.agents", "agents"],
    [
      "outdated",
      outdated,
      "skills-guide-updates",
      "skills.outdated",
      "outdated",
    ],
    [
      "unassigned",
      unassigned,
      "skills-guide-safety",
      "skills.unassigned",
      "unassigned",
    ],
  ] as const) {
    if (value == null) continue;
    candidates.push({
      id: `skills.${id}`,
      severity: id === "outdated" && value > 0 ? "attention" : "info",
      factKey: `insights.page.skills.${key}`,
      factParams: { [param]: value },
      evidenceRefs: [ref],
      allowedActionIds: ["open_skills"],
      actionId: "open_skills",
    });
  }
  return candidates;
}

export const skillsInsightAdapter: PageInsightAdapter = {
  surfaceId: "skills",
  adapterVersion: 3,
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
    const unassigned = Math.max(0, snapshot.skills.length - enabled);

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
        metricEvidence(
          "skills.unassigned",
          unassigned,
          observedAt,
          freshness,
          "count",
        ),
      ],
    };
  },
  composeCandidates: composeSkillsCandidates,
};
