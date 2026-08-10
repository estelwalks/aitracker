import type {
  OptimizationConfidence,
  OptimizationEvidence,
  OptimizationFinding,
  OptimizationInput,
  OptimizationRecommendation,
  OptimizationSeverity,
  OptimizationSnapshot,
  OptimizationThresholds,
} from "./contracts.ts";

const DEFAULT_THRESHOLDS: OptimizationThresholds = {
  highCostUsd: 10,
  minimumCacheTokens: 1_000,
  minimumCacheHitRate: 0.2,
  unknownProjectEvents: 3,
};

const SEVERITY_WEIGHT: Record<OptimizationSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function opaqueRef(value: string): string {
  let hash = 2166136261;
  for (const char of value)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `opaque-${(hash >>> 0).toString(16)}`;
}

function evidence(
  module: OptimizationEvidence["module"],
  value: string,
  observedAt: string,
): OptimizationEvidence {
  return { module, evidenceRef: opaqueRef(`${module}:${value}`), observedAt };
}

function impact(
  kind: OptimizationRecommendation["estimatedImpact"]["kind"],
  confidence: OptimizationConfidence,
  amountUsd?: number,
  unit: OptimizationRecommendation["estimatedImpact"]["unit"] = "usd",
): OptimizationRecommendation["estimatedImpact"] {
  return amountUsd === undefined
    ? { kind, confidence, unit }
    : { kind, confidence, amountUsd, unit };
}

function confidenceForCost(cost: {
  knownUsd: number;
  estimatedUsd: number;
  unknownEvents: number;
}): OptimizationConfidence {
  if (cost.unknownEvents > 0 && cost.knownUsd === 0 && cost.estimatedUsd === 0)
    return "unknown";
  if (cost.estimatedUsd > 0 || cost.unknownEvents > 0) return "estimated";
  return "exact";
}

function addFinding(
  findings: OptimizationFinding[],
  finding: OptimizationFinding,
): void {
  findings.push(finding);
}

/** Pure, privacy-safe diagnostics. It never mutates projects, skills, or external files. */
export function buildOptimizationSnapshot(
  input: OptimizationInput,
): OptimizationSnapshot {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const observedAt =
    input.observedAt ??
    input.usage?.generatedAt ??
    input.projects?.generatedAt ??
    new Date().toISOString();
  const findings: OptimizationFinding[] = [];

  for (const project of input.projects?.projects ?? []) {
    const costConfidence = confidenceForCost(project.cost);
    if (
      project.cost.knownUsd >= thresholds.highCostUsd ||
      project.cost.estimatedUsd >= thresholds.highCostUsd
    ) {
      const confidence =
        project.cost.knownUsd >= thresholds.highCostUsd
          ? "exact"
          : costConfidence;
      const ref = evidence("projects", project.id, observedAt);
      const recommendation: OptimizationRecommendation = {
        id: `recommendation:high-cost:${opaqueRef(project.id)}`,
        action: "review-project",
        priority: "high",
        rationale:
          "Review the project's model mix, request volume, and cache strategy before changing configuration.",
        evidenceRef: ref.evidenceRef,
        estimatedImpact: impact(
          "cost",
          confidence,
          confidence === "unknown"
            ? undefined
            : project.cost.knownUsd || project.cost.estimatedUsd,
        ),
      };
      addFinding(findings, {
        id: `finding:high-cost:${opaqueRef(project.id)}`,
        code: "high-cost",
        severity: "high",
        title: "Project cost is above the configured review threshold",
        rationale:
          confidence === "exact"
            ? "The exact priced subtotal exceeds the configured threshold."
            : "A reference estimate exceeds the configured threshold; treat the amount as non-billable guidance.",
        evidenceRef: ref.evidenceRef,
        estimatedImpact: recommendation.estimatedImpact,
        recommendation,
        // Keep project identity opaque at the public DTO boundary. The projects
        // read model may contain a canonical local path in its private identity.
        projectId: project.known ? opaqueRef(project.id) : undefined,
      });
    }

    const cacheTokens = project.tokens.cachedInputTokens;
    const inputTokens = project.tokens.inputTokens + cacheTokens;
    if (
      inputTokens >= thresholds.minimumCacheTokens &&
      cacheTokens / inputTokens < thresholds.minimumCacheHitRate
    ) {
      const ref = evidence("projects", `${project.id}:cache`, observedAt);
      const recommendation: OptimizationRecommendation = {
        id: `recommendation:cache:${opaqueRef(project.id)}`,
        action: "review-cache",
        priority: "medium",
        rationale:
          "Review prompt reuse and cache eligibility; no automatic prompt or provider changes are proposed.",
        evidenceRef: ref.evidenceRef,
        estimatedImpact: impact("efficiency", "unknown", undefined, "ratio"),
      };
      addFinding(findings, {
        id: `finding:cache:${opaqueRef(project.id)}`,
        code: "low-cache-hit-rate",
        severity: "medium",
        title: "Cache hit rate is below the configured threshold",
        rationale:
          "The observed cached-input ratio is lower than the configured threshold.",
        evidenceRef: ref.evidenceRef,
        estimatedImpact: recommendation.estimatedImpact,
        recommendation,
        projectId: project.known ? opaqueRef(project.id) : undefined,
      });
    }
  }

  const unknownEvents = input.usage?.totals
    ? input.usage.events - input.usage.totals.events
    : 0;
  const unknownModels =
    input.projects?.projects.reduce(
      (total, project) => total + project.cost.unknownEvents,
      0,
    ) ?? 0;
  if (unknownModels > 0 || unknownEvents > 0) {
    const ref = evidence(
      "pricing",
      `unknown:${unknownModels}:${unknownEvents}`,
      observedAt,
    );
    const recommendation: OptimizationRecommendation = {
      id: "recommendation:unknown-price",
      action: "review-pricing",
      priority: "medium",
      rationale:
        "Add or verify a model billing route before using cost comparisons; unknown prices are not ranked as savings.",
      evidenceRef: ref.evidenceRef,
      estimatedImpact: impact("coverage", "unknown", undefined, "events"),
    };
    addFinding(findings, {
      id: "finding:unknown-price",
      code: "unknown-price",
      severity: "medium",
      title: "Some usage has no reliable model price",
      rationale:
        "Pricing coverage is incomplete, so exact cost and savings cannot be inferred for these events.",
      evidenceRef: ref.evidenceRef,
      estimatedImpact: recommendation.estimatedImpact,
      recommendation,
    });
  }

  for (const duplicate of input.duplicateConfigurations ?? []) {
    if (duplicate.count < 2) continue;
    const ref = evidence("optimization", duplicate.key, observedAt);
    const recommendation: OptimizationRecommendation = {
      id: `recommendation:duplicate:${opaqueRef(duplicate.key)}`,
      action: "deduplicate-config",
      priority: "low",
      rationale:
        "Review repeated configuration entries and keep one canonical definition before distributing changes.",
      evidenceRef: ref.evidenceRef,
      estimatedImpact: impact("efficiency", "exact", undefined, "events"),
    };
    addFinding(findings, {
      id: `finding:duplicate:${opaqueRef(duplicate.key)}`,
      code: "duplicate-configuration",
      severity: "low",
      title: "Duplicate configuration entries were detected",
      rationale:
        "The same configuration identity appears more than once in the supplied summary.",
      evidenceRef: ref.evidenceRef,
      estimatedImpact: recommendation.estimatedImpact,
      recommendation,
    });
  }

  const unknownProject = input.projects?.projects.find(
    (project) => !project.known,
  );
  if (
    unknownProject &&
    unknownProject.eventCount >= thresholds.unknownProjectEvents
  ) {
    const ref = evidence("projects", unknownProject.id, observedAt);
    addFinding(findings, {
      id: "finding:project-anomaly:unknown",
      code: "project-anomaly",
      severity: "low",
      title: "Usage is concentrated in an unidentified project",
      rationale:
        "Several usage events could not be associated with a known project identity.",
      evidenceRef: ref.evidenceRef,
      estimatedImpact: impact("coverage", "exact", undefined, "projects"),
      projectId: undefined,
    });
  }

  findings.sort(
    (a, b) =>
      SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] ||
      a.id.localeCompare(b.id),
  );
  return { generatedAt: observedAt, findings };
}
