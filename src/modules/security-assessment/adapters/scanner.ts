import type { SecurityReport } from "../../../lib/security/scanner.ts";
import type { ScanSkillReport } from "skill-scanner";
import { createAssetAssessment } from "../application/index.ts";
import type { AssetAssessment, AssetKind, AssetRef } from "../contracts.ts";

const verdictMap: Record<
  SecurityReport["verdict"],
  AssetAssessment["verdict"]
> = {
  安全: "clean",
  可疑: "suspicious",
  危险: "dangerous",
};

/**
 * Public verdict port for the existing local scanner. The scanner remains the
 * owner of rule execution; this adapter deliberately discards files, lines,
 * excerpts, rule names and messages before crossing the feature boundary.
 */
export function assessmentFromSecurityReport(input: {
  readonly assetRef: AssetRef;
  readonly assetKind: AssetKind;
  readonly report: SecurityReport;
}): AssetAssessment {
  return createAssetAssessment({
    assetRef: input.assetRef,
    assetKind: input.assetKind,
    verdict: verdictMap[input.report.verdict] ?? "unknown",
    findingCount: input.report.risks.length,
    findingSeverities: input.report.risks.map((risk) =>
      risk.severity === "高危"
        ? "high"
        : risk.severity === "中危"
          ? "medium"
          : "low",
    ),
    ruleVersion: input.report.rulesVersion,
    ruleProvenance: "builtin",
    rulePackRef: `rule-pack:${input.report.rulesVersion}`,
    assessedAt: input.report.scannedAt,
  });
}

/** Privacy-safe projection for the Node security-engine report. */
export function assessmentFromSkillScannerReport(input: {
  readonly assetRef: AssetRef;
  readonly assetKind: AssetKind;
  readonly report: ScanSkillReport;
  readonly assessedAt: string;
}): AssetAssessment {
  const verdict: AssetAssessment["verdict"] =
    input.report.status === "partial" || input.report.verdict === "unknown"
      ? "unknown"
      : input.report.verdict === "block"
        ? "dangerous"
        : input.report.findings.length > 0 || input.report.verdict === "warn"
          ? "suspicious"
          : "clean";
  return createAssetAssessment({
    assetRef: input.assetRef,
    assetKind: input.assetKind,
    verdict,
    findingCount: input.report.findings.length,
    findingSeverities: input.report.findings.map((finding) =>
      finding.severity === "critical" || finding.severity === "high"
        ? "high"
        : finding.severity === "medium"
          ? "medium"
          : "low",
    ),
    ruleVersion: input.report.rulesVersion,
    ruleProvenance: "builtin",
    rulePackRef: `rule-pack:${input.report.rulesVersion}`,
    assessedAt: input.assessedAt,
  });
}
