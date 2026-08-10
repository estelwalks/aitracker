import type {
  SecurityRuleKind,
  UserSecurityRule,
} from "../../../lib/security/rules";
import {
  scanSecurityFilesWithProgress,
  type LocalScanProgress,
  type SecurityReport,
} from "../../../lib/security/scanner";
import {
  clearSecurityHistory,
  loadSecurityHistory,
  saveSecurityHistory,
  trimReportForHistory,
} from "../../../lib/security/history";
import {
  readLocalSkillFile,
  type LocalSkillFile,
} from "../../../lib/security/input-validation";
import {
  consumeDailyScan,
  DAILY_SCAN_LIMIT,
  readDailyScanCount,
  seedDailyCountFromPlatform,
} from "../../../lib/security/daily-limit";

export type SecuritySelectionRef = `selection:${string}`;
export type SecurityVerdict = SecurityReport["verdict"];
export type SecuritySeverity = "高危" | "中危" | "低危";

export interface SecurityRiskResult {
  readonly kind: SecurityRuleKind;
  readonly severity: SecuritySeverity;
  readonly source: "内置规则" | "用户规则";
}

/** Renderer-safe assessment report. Source paths, lines, excerpts and messages are intentionally absent. */
export interface SecurityAssessmentReport {
  readonly selectionRef: SecuritySelectionRef;
  readonly targetLabel: "SKILL.md";
  readonly scannedAt: string;
  readonly filesScanned: number;
  readonly risks: readonly SecurityRiskResult[];
  readonly verdict: SecurityVerdict;
  readonly riskScore: number;
  readonly durationMs: number;
  readonly rulesVersion: string;
  readonly truncated?: boolean;
}

export interface SecurityAssessmentSelection {
  readonly selectionRef: SecuritySelectionRef;
  readonly file: LocalSkillFile;
}

function selectionRef(): SecuritySelectionRef {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `selection:${uuid ?? "local"}`;
}

function toPublicReport(
  report: SecurityReport,
  ref = selectionRef(),
): SecurityAssessmentReport {
  return {
    selectionRef: ref,
    targetLabel: "SKILL.md",
    scannedAt: report.scannedAt,
    filesScanned: report.filesScanned,
    risks: report.risks.map(({ kind, severity, source }) => ({
      kind,
      severity,
      source,
    })),
    verdict: report.verdict,
    riskScore: report.riskScore,
    durationMs: report.durationMs,
    rulesVersion: report.rulesVersion,
    ...(report.truncated ? { truncated: true } : {}),
  };
}

function toStorageReport(report: SecurityAssessmentReport): SecurityReport {
  return {
    scannedAt: report.scannedAt,
    targetName: "SKILL.md",
    filesScanned: report.filesScanned,
    risks: report.risks.map((risk) => ({
      ...risk,
      ruleName: risk.kind,
      file: "selection",
      line: 0,
      message: "安全规则命中",
      excerpt: "",
    })),
    verdict: report.verdict,
    riskScore: report.riskScore,
    durationMs: report.durationMs,
    rulesVersion: report.rulesVersion,
    ...(report.truncated ? { truncated: true } : {}),
  };
}

export async function selectSkillFile(
  files: FileList | File[],
): Promise<SecurityAssessmentSelection> {
  return {
    selectionRef: selectionRef(),
    file: await readLocalSkillFile(files),
  };
}

export async function scanSelection(
  selection: SecurityAssessmentSelection,
  onProgress?: (progress: LocalScanProgress) => void,
  userRules: UserSecurityRule[] = [],
): Promise<SecurityAssessmentReport> {
  const report = await scanSecurityFilesWithProgress(
    [{ name: "SKILL.md", content: selection.file.content }],
    userRules,
    onProgress,
  );
  return toPublicReport(report, selection.selectionRef);
}

export async function loadAssessmentHistory(): Promise<
  SecurityAssessmentReport[]
> {
  const reports = await loadSecurityHistory();
  return reports.map((report) => toPublicReport(report));
}

export async function saveAssessmentHistory(
  reports: readonly SecurityAssessmentReport[],
): Promise<void> {
  await saveSecurityHistory(
    reports.map(toStorageReport).map(trimReportForHistory),
  );
}

export {
  clearSecurityHistory,
  consumeDailyScan,
  DAILY_SCAN_LIMIT,
  readDailyScanCount,
  seedDailyCountFromPlatform,
};
