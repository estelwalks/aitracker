import type { CandidateOutput } from "../../distillation/contracts.ts";
import { evaluatePublishGate } from "../application/index.ts";
import type { AssetAssessment, PublishGate } from "../contracts.ts";

/**
 * Distillation remains candidate-first: generation is allowed, but promotion
 * into Skill/Knowledge distribution must pass this same security gate.
 */
export function gateForDistillationCandidate(
  candidate: Pick<CandidateOutput, "kind">,
  assessment: AssetAssessment | undefined,
): PublishGate {
  const expectedKind = candidate.kind === "skill" ? "skill" : "distillation";
  if (!assessment) return evaluatePublishGate(undefined);
  if (assessment.verdict === "unknown") return evaluatePublishGate(assessment);
  if (assessment.assetKind !== expectedKind) {
    return {
      decision: "blocked",
      reason: "assessment-mismatch",
      assessmentRef: assessment.assessmentRef,
      verdict: assessment.verdict,
    };
  }
  return evaluatePublishGate(assessment);
}
