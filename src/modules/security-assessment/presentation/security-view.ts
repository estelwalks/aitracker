import type { Locale } from "../../../lib/i18n/locale";

export const SECURITY_RISK_KINDS = [
  "remote_execution",
  "command_injection",
  "data_exfiltration",
  "secret_access",
  "persistence",
  "destructive",
  "obfuscation",
  "privilege_escalation",
  "sensitive_file_access",
  "network_abuse",
  "prompt_injection",
] as const;

export type SecurityRiskKind = (typeof SECURITY_RISK_KINDS)[number];
export type SecurityScanMode = "quick" | "full";
export type SecurityScanCycle = "hourly" | "daily" | "weekly";
export type SecurityScanScope = "all";

export interface SecurityScanScheduleView {
  readonly enabled: boolean;
  readonly cycle: SecurityScanCycle;
  /** "HH:MM" (24h) local wall-clock time; ignored for hourly. */
  readonly time: string;
  readonly scope: SecurityScanScope;
  readonly notify: boolean;
}
export type SecurityScanPhase =
  | "idle"
  | "running"
  | "cancelling"
  | "complete"
  | "partial"
  | "failed"
  | "cancelled"
  | "model-required";
export type SecurityVerdict = "allow" | "warn" | "block" | "unknown";
export type SecuritySeverity = "critical" | "high" | "medium" | "low";
export type SecurityBranchName =
  "static" | "ruleReview" | "singleFileAnalysis" | "multiFileAnalysis";
export type SecurityBranchStatus = "complete" | "skipped" | "failed";

export interface SecuritySkillView {
  readonly skillRef: string;
  readonly name: string;
  readonly agents: readonly string[];
  readonly modifiedAt: string;
  readonly source: "discovered" | "selected";
}

export interface SecurityProgressView {
  readonly discovered: number;
  readonly queued: number;
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly percent: number;
}

export interface SecurityScanStateView {
  readonly scanId: string | null;
  readonly status: SecurityScanPhase;
  readonly mode: SecurityScanMode | null;
  readonly trigger: "manual" | "automatic" | null;
  readonly locale: Locale | null;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly progress: SecurityProgressView;
  readonly currentSkill?: string;
  readonly resultIds: readonly string[];
}

export interface SecurityFindingView {
  readonly id: string;
  readonly kind: SecurityRiskKind;
  readonly severity: SecuritySeverity;
  readonly source: "static" | "model";
  readonly kindDisplay: string;
  readonly severityDisplay: string;
  readonly ruleName: string;
  readonly message: string;
  readonly remediation: string;
  readonly path: string;
  readonly line?: number;
  readonly excerpt?: string;
  readonly reasoning?: string;
}

export interface SecurityBranchView {
  readonly name: SecurityBranchName;
  readonly status: SecurityBranchStatus;
  readonly detail?: string;
}

export interface SecuritySkippedFileView {
  readonly path: string;
  readonly reasonCode:
    | "unavailable"
    | "symlink"
    | "depth-limit"
    | "file-limit"
    | "skill-size-limit"
    | "file-size-limit"
    | "binary"
    | "scanner-skip";
  readonly reason: string;
}

export type SecuritySkippedReasonCode =
  | "fileUnavailable"
  | "symbolicLink"
  | "depthLimit"
  | "fileLimit"
  | "skillSizeLimit"
  | "fileSizeLimit"
  | "binaryFile"
  | "scannerSkip"
  | "unknown";

export interface SecurityReportView {
  readonly status: "complete" | "partial";
  readonly mode: SecurityScanMode;
  readonly verdict: SecurityVerdict;
  readonly riskScore: number;
  readonly rulesVersion: string;
  readonly engineVersion: string;
  readonly locale: Locale;
  readonly scannedFiles: number;
  readonly threatLevel: "critical" | "high" | "medium" | "low" | "none";
  readonly threatLevelDisplay: string;
  readonly summary: string;
  readonly findings: readonly SecurityFindingView[];
  readonly branches: readonly SecurityBranchView[];
  readonly skippedFiles: readonly SecuritySkippedFileView[];
  readonly errorCode?: string;
}

export interface SecurityHistoryView {
  readonly id: string;
  readonly scanId: string;
  readonly skillRef: string;
  readonly skillName: string;
  readonly mode: SecurityScanMode;
  readonly trigger: "manual" | "automatic";
  readonly locale: Locale;
  readonly status: "complete" | "partial" | "failed" | "skipped" | "cancelled";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly report?: SecurityReportView;
  readonly errorCode?: string;
}

export interface SecurityModelConfigView {
  readonly configured: boolean;
  readonly provider: "openai" | "anthropic";
  readonly endpoint: string;
  readonly apiKeyConfigured: boolean;
  readonly liteModel: string;
  readonly proModel: string;
  readonly timeoutMs: number;
  readonly contextWindowTokens?: number;
  readonly maxAgentTurns: number;
  readonly encryptionAvailable: boolean;
}

export interface SecurityRuntimeCapabilityView {
  readonly activeDefense: false;
  readonly capability: "detection-only";
  readonly monitorAvailable: true;
  readonly evidence: "local-static-and-model-analysis";
  readonly cancellation: "between-skills";
  readonly riskKinds: readonly SecurityRiskKind[];
}

export interface SecurityTotals {
  readonly total: number;
  readonly safe: number;
  readonly warn: number;
  readonly danger: number;
  readonly unknown: number;
  readonly failed: number;
  readonly skipped: number;
  readonly findings: number;
  readonly files: number;
}

export const EMPTY_SECURITY_PROGRESS: SecurityProgressView = {
  discovered: 0,
  queued: 0,
  started: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  percent: 0,
};

export const EMPTY_SECURITY_TOTALS: SecurityTotals = {
  total: 0,
  safe: 0,
  warn: 0,
  danger: 0,
  unknown: 0,
  failed: 0,
  skipped: 0,
  findings: 0,
  files: 0,
};

export function summarizeReports(
  history: readonly SecurityHistoryView[],
  progress?: SecurityProgressView,
): SecurityTotals {
  const totals = history.reduce<SecurityTotals>(
    (result, item) => ({
      total: result.total + 1,
      safe: result.safe + (securityHistoryEntryIsSafe(item) ? 1 : 0),
      warn: result.warn + (item.report?.verdict === "warn" ? 1 : 0),
      danger: result.danger + (item.report?.verdict === "block" ? 1 : 0),
      unknown:
        result.unknown +
        (item.report?.verdict === "unknown" ||
        !item.report ||
        (item.report.verdict === "allow" && !securityHistoryEntryIsSafe(item))
          ? 1
          : 0),
      failed: result.failed + (item.status === "failed" ? 1 : 0),
      skipped:
        result.skipped +
        (item.status === "skipped" ? 1 : 0) +
        (item.report?.skippedFiles.length ?? 0),
      findings: result.findings + (item.report?.findings.length ?? 0),
      files: result.files + (item.report?.scannedFiles ?? 0),
    }),
    EMPTY_SECURITY_TOTALS,
  );
  return {
    ...totals,
    total: Math.max(totals.total, progress?.discovered ?? 0),
    failed: Math.max(totals.failed, progress?.failed ?? 0),
    skipped: Math.max(totals.skipped, progress?.skipped ?? 0),
  };
}

export function securityHistoryEntryIsSafe(item: SecurityHistoryView): boolean {
  return (
    item.status === "complete" &&
    item.report?.status === "complete" &&
    item.report.verdict === "allow" &&
    item.report.skippedFiles.length === 0 &&
    !item.report.branches.some((branch) => branch.status === "failed")
  );
}

export function skippedReasonCode(
  skipped: Pick<SecuritySkippedFileView, "reason" | "reasonCode">,
): SecuritySkippedReasonCode {
  const stable: Record<
    SecuritySkippedFileView["reasonCode"],
    SecuritySkippedReasonCode
  > = {
    unavailable: "fileUnavailable",
    symlink: "symbolicLink",
    "depth-limit": "depthLimit",
    "file-limit": "fileLimit",
    "skill-size-limit": "skillSizeLimit",
    "file-size-limit": "fileSizeLimit",
    binary: "binaryFile",
    "scanner-skip": "scannerSkip",
  };
  if (skipped.reasonCode in stable) return stable[skipped.reasonCode];
  const normalized = skipped.reason.trim().toLowerCase();
  const known: Record<string, SecuritySkippedReasonCode> = {
    "file became unavailable": "fileUnavailable",
    "symbolic link was not scanned": "symbolicLink",
    "maximum directory depth exceeded": "depthLimit",
    "maximum file count exceeded": "fileLimit",
    "maximum skill size exceeded": "skillSizeLimit",
    "binary file": "binaryFile",
  };
  return known[normalized] ?? "unknown";
}

export function latestHistory(
  history: readonly SecurityHistoryView[],
): SecurityHistoryView | null {
  return (
    [...history].sort(
      (left, right) =>
        Date.parse(right.finishedAt) - Date.parse(left.finishedAt),
    )[0] ?? null
  );
}

export function latestScanEntries(
  history: readonly SecurityHistoryView[],
): readonly SecurityHistoryView[] {
  const latest = latestHistory(history);
  return latest == null
    ? []
    : history.filter((item) => item.scanId === latest.scanId);
}

export function reportNeedsLocaleRefresh(
  report: Pick<SecurityReportView, "locale">,
  locale: Locale,
): boolean {
  return report.locale !== locale;
}

export function isScanActive(status: SecurityScanPhase): boolean {
  return status === "running" || status === "cancelling";
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}
