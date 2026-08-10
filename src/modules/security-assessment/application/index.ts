import type {
  AssetAssessment,
  AssetFinding,
  AssetVerdict,
  PublishGate,
  SecurityAssessmentInput,
  SecurityAssessmentModuleContract,
  AssessmentHistorySummary,
  ScanRequest,
} from "../contracts";
import { err, ok, type Result } from "../../../shared/result.ts";
export interface SecurityAssessmentApplication {
  readonly contract: SecurityAssessmentModuleContract;
}

export type SecurityAssessmentInputErrorCode =
  | "errors.security.invalidScanRequest"
  | "errors.security.selectionRequired"
  | "errors.security.unauthorizedSelection";

const SELECTION_REF = /^selection:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ASSET_REF = /^asset:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ASSET_KINDS = new Set(["skill", "package", "knowledge", "distillation"]);

/** Validates the renderer-facing scan command without ever accepting a path. */
export function parseScanRequest(
  value: unknown,
): Result<ScanRequest, SecurityAssessmentInputErrorCode> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return err("errors.security.invalidScanRequest");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some(
      (key) => !["assetRef", "assetKind", "selectionRef"].includes(key),
    )
  )
    return err("errors.security.invalidScanRequest");
  if (typeof input.assetRef !== "string" || !ASSET_REF.test(input.assetRef))
    return err("errors.security.invalidScanRequest");
  if (typeof input.assetKind !== "string" || !ASSET_KINDS.has(input.assetKind))
    return err("errors.security.invalidScanRequest");
  if (typeof input.selectionRef !== "string" || input.selectionRef.length === 0)
    return err("errors.security.selectionRequired");
  if (!SELECTION_REF.test(input.selectionRef))
    return err("errors.security.unauthorizedSelection");
  return ok({
    assetRef: input.assetRef as ScanRequest["assetRef"],
    assetKind: input.assetKind as ScanRequest["assetKind"],
    selectionRef: input.selectionRef as ScanRequest["selectionRef"],
  });
}

export function assessmentHistorySummary(
  assessment: AssetAssessment,
): AssessmentHistorySummary {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of assessment.findings) counts[finding.severity] += 1;
  return {
    assessmentRef: assessment.assessmentRef,
    assetRef: assessment.assetRef,
    assetKind: assessment.assetKind,
    verdict: assessment.verdict,
    findingCounts: { ...counts, total: assessment.findings.length },
    ruleVersion: assessment.ruleVersion,
    evidenceCount: assessment.evidenceCount,
    lastScannedAt: assessment.assessedAt,
  };
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
