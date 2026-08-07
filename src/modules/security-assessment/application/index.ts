import type {
  AssetAssessment,
  AssetFinding,
  AssetVerdict,
  PublishGate,
  SecurityAssessmentInput,
  SecurityAssessmentModuleContract,
} from "../contracts";
export interface SecurityAssessmentApplication {
  readonly contract: SecurityAssessmentModuleContract;
}

const verdictMap: Record<AssetVerdict, AssetVerdict> = {
  clean: "clean",
  suspicious: "suspicious",
  dangerous: "dangerous",
  unknown: "unknown",
};

const OPAQUE_PART = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function safeRef(
  value: string,
  prefix: "asset:" | "asset-hash:" | "rule-pack:",
): string {
  const part = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  return `${prefix}${OPAQUE_PART.test(part) ? part : "unknown"}`;
}

const assetKinds = new Set(["skill", "package", "knowledge", "distillation"]);
const findingSeverities = new Set(["high", "medium", "low"]);

function opaqueFinding(index: number): AssetFinding {
  const key = String(index + 1).padStart(4, "0");
  return {
    ref: `finding:${key}`,
    evidenceRef: `evidence:${key}`,
    severity: "medium",
    status: "active",
  };
}

/** Projects scanner metadata into a safe, renderer-compatible assessment. */
export function createAssetAssessment(
  input: SecurityAssessmentInput,
): AssetAssessment {
  const findingCount = Number.isFinite(input.findingCount)
    ? Math.max(0, Math.floor(input.findingCount))
    : 0;
  const verdict = verdictMap[input.verdict] ?? "unknown";
  const severities = input.findingSeverities ?? [];
  const assetRef = safeRef(
    input.assetRef,
    "asset:",
  ) as SecurityAssessmentInput["assetRef"];
  const assetHashRef = input.assetHashRef
    ? (safeRef(input.assetHashRef, "asset-hash:") as `asset-hash:${string}`)
    : undefined;
  const assetKind = assetKinds.has(input.assetKind)
    ? input.assetKind
    : "knowledge";
  const ruleVersion = OPAQUE_PART.test(input.ruleVersion)
    ? input.ruleVersion
    : "unknown";
  return {
    assessmentRef: `assessment:${assetRef.slice("asset:".length)}`,
    assetRef,
    ...(assetHashRef ? { assetHashRef } : {}),
    assetKind,
    verdict,
    findings: Array.from({ length: findingCount }, (_, index) => ({
      ...opaqueFinding(index),
      ...(findingSeverities.has(severities[index] ?? "")
        ? { severity: severities[index] }
        : {}),
    })),
    ruleVersion: {
      version: ruleVersion || "unknown",
      provenance: input.ruleProvenance ?? "unknown",
      ...(input.rulePackRef
        ? {
            rulePackRef: safeRef(
              input.rulePackRef,
              "rule-pack:",
            ) as `rule-pack:${string}`,
          }
        : {}),
    },
    assessedAt: input.assessedAt ?? new Date().toISOString(),
    evidenceCount: findingCount,
  };
}

/**
 * Publish/distribution is fail-closed: only a clean assessment can pass.
 * Assessment is required even for assets with no findings because an absent
 * scan must not be interpreted as safe.
 */
export function evaluatePublishGate(
  assessment: AssetAssessment | undefined,
): PublishGate {
  if (!assessment)
    return {
      decision: "blocked",
      reason: "assessment-required",
      verdict: "unknown",
    };
  const allowed = assessment.verdict === "clean";
  return {
    decision: allowed ? "allowed" : "blocked",
    reason: allowed ? "assessment-clean" : `assessment-${assessment.verdict}`,
    assessmentRef: assessment.assessmentRef,
    verdict: assessment.verdict,
  };
}

export function canPublish(assessment: AssetAssessment | undefined): boolean {
  return evaluatePublishGate(assessment).decision === "allowed";
}
