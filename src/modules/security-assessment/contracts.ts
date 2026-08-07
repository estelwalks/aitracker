export const securityAssessmentModuleId = "security-assessment" as const;
export type SecurityAssessmentModuleId = typeof securityAssessmentModuleId;

/** Opaque references that may cross a feature boundary. They are never paths. */
export type AssetRef = `asset:${string}`;
export type AssessmentRef = `assessment:${string}`;
export type FindingRef = `finding:${string}`;
export type EvidenceRef = `evidence:${string}`;
export type AssetHashRef = `asset-hash:${string}`;
export type SelectionRef = `selection:${string}`;
export type ScanJobRef = `scan-job:${string}`;

export type AssetKind = "skill" | "package" | "knowledge" | "distillation";
export type AssetVerdict = "clean" | "suspicious" | "dangerous" | "unknown";
export type FindingSeverity = "high" | "medium" | "low";

/** Only stable metadata is public. Rule implementation details remain private. */
export interface RuleVersion {
  readonly version: string;
  readonly provenance: "builtin" | "local" | "unknown";
  readonly rulePackRef?: `rule-pack:${string}`;
}

export interface AssetFinding {
  readonly ref: FindingRef;
  readonly severity: FindingSeverity;
  readonly status: "active" | "resolved";
  /** Opaque evidence identifier; never line, file, excerpt or source content. */
  readonly evidenceRef: EvidenceRef;
}

export interface AssetAssessment {
  readonly assessmentRef: AssessmentRef;
  readonly assetRef: AssetRef;
  readonly assetHashRef?: AssetHashRef;
  readonly assetKind: AssetKind;
  readonly verdict: AssetVerdict;
  readonly findings: readonly AssetFinding[];
  readonly ruleVersion: RuleVersion;
  readonly assessedAt: string;
  readonly evidenceCount: number;
}

export type PublishGateDecision = "allowed" | "blocked";
export type PublishGateReason =
  | "assessment-clean"
  | "assessment-suspicious"
  | "assessment-dangerous"
  | "assessment-unknown"
  | "assessment-required"
  | "assessment-mismatch";

export interface PublishGate {
  readonly decision: PublishGateDecision;
  readonly reason: PublishGateReason;
  readonly assessmentRef?: AssessmentRef;
  readonly verdict: AssetVerdict;
}

export interface SecurityAssessmentPort {
  assess(input: SecurityAssessmentInput): AssetAssessment;
}

/** Server-only input accepted by the scanner adapter. It contains no source. */
export interface SecurityAssessmentInput {
  readonly assetRef: AssetRef;
  readonly assetHashRef?: AssetHashRef;
  readonly assetKind: AssetKind;
  readonly verdict: AssetVerdict;
  readonly findingCount: number;
  readonly findingSeverities?: readonly FindingSeverity[];
  readonly ruleVersion: string;
  readonly ruleProvenance?: "builtin" | "local" | "unknown";
  readonly assessedAt?: string;
  readonly rulePackRef?: `rule-pack:${string}`;
}

export interface SecurityAssessmentModuleContract {
  readonly module: SecurityAssessmentModuleId;
  readonly schemaVersion: 1;
}

/** Browser input. A selection ref is issued by the local/server picker; it is
 * deliberately not a filesystem path, URL, upload, or source-content field. */
export interface ScanRequest {
  readonly assetRef: AssetRef;
  readonly assetKind: AssetKind;
  readonly selectionRef: SelectionRef;
}

export interface ScanJobRequest {
  readonly jobRef: ScanJobRef;
  readonly taskId: string;
  readonly assetRef: AssetRef;
  readonly assetKind: AssetKind;
  readonly selectionRef: SelectionRef;
  readonly requestedAt: string;
}

export type ScanJobStatus = "queued" | "running" | "succeeded" | "failed";

/** Public job result. No source, path, command, line, excerpt or raw error. */
export interface ScanJobResult {
  readonly jobRef: ScanJobRef;
  readonly status: ScanJobStatus;
  readonly assessment?: AssetAssessment;
  readonly errorCode?: `errors.${string}`;
  readonly finishedAt?: string;
}

export interface AssessmentFindingCounts {
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly total: number;
}

/** History projection suitable for the renderer; evidence remains opaque. */
export interface AssessmentHistorySummary {
  readonly assessmentRef: AssessmentRef;
  readonly assetRef: AssetRef;
  readonly assetKind: AssetKind;
  readonly verdict: AssetVerdict;
  readonly findingCounts: AssessmentFindingCounts;
  readonly ruleVersion: RuleVersion;
  readonly evidenceCount: number;
  readonly lastScannedAt: string;
}
