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
export type SecurityScanScope = "all" | "agent" | "dir";

export interface SecurityScanScheduleView {
  readonly enabled: boolean;
  readonly cycle: SecurityScanCycle;
  /** "HH:MM" (24h) local wall-clock time; ignored for hourly. */
  readonly time: string;
  readonly scope: SecurityScanScope;
  /** Skill-agent names to include when scope === "agent" (empty ⇒ no targets). */
  readonly agents: readonly string[];
  /** Absolute skill root directory prefix when scope === "dir" (null ⇒ no targets). */
  readonly dir: string | null;
  readonly notify: boolean;
}

export interface SecurityScanRunView {
  readonly scanId: string;
  readonly mode: SecurityScanMode;
  readonly trigger: "manual" | "automatic";
  readonly locale: Locale;
  readonly status:
    "queued" | "running" | "complete" | "partial" | "failed" | "cancelled";
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly discoveredCount: number;
  readonly queuedCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly errorCode?: string;
}

export interface SecurityScanScheduleStatusView {
  readonly lastRun: SecurityScanRunView | null;
  readonly nextRunAt: string | null;
  readonly pending: boolean;
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
  /** Stable content hash of the scanned skill — the dedup key across install copies and re-scans. */
  readonly contentHash?: string;
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

/** Only explicit warn/block verdicts are detected risks. */
export function detectedRiskCount(totals: SecurityTotals): number {
  return totals.warn + totals.danger;
}

/** Unknown and failed scans require review but are not evidence of risk. */
export function unresolvedScanCount(totals: SecurityTotals): number {
  return totals.unknown + totals.failed;
}

/**
 * Deduplicate history to one entry per unique skill, keyed by the stable
 * content hash (`report.contentHash`). The same skill installed under two
 * roots, or re-scanned unchanged, shares one content hash, so statistics count
 * each skill once — consistent with skill management, which already dedups by
 * skill name. Entries without a content hash (failed/older scans) are kept
 * as-is since they cannot be reliably mapped to a skill's content.
 */
export function dedupeHistoryByContentHash(
  history: readonly SecurityHistoryView[],
): SecurityHistoryView[] {
  const latestByKey = new Map<string, SecurityHistoryView>();
  const withoutHash: SecurityHistoryView[] = [];
  for (const entry of history) {
    const key = entry.report?.contentHash;
    if (!key) {
      withoutHash.push(entry);
      continue;
    }
    const previous = latestByKey.get(key);
    if (
      previous &&
      Date.parse(previous.finishedAt) >= Date.parse(entry.finishedAt)
    ) {
      continue;
    }
    latestByKey.set(key, entry);
  }
  return [...withoutHash, ...latestByKey.values()];
}

export function summarizeReports(
  history: readonly SecurityHistoryView[],
  progress?: SecurityProgressView,
): SecurityTotals {
  const totals = dedupeHistoryByContentHash(history).reduce<SecurityTotals>(
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

export type SecurityReportEvidenceState =
  "findings" | "clean" | "incomplete" | "risk-details-unavailable";

/** Keeps an empty findings array from contradicting the report verdict/status. */
export function securityReportEvidenceState(
  item: SecurityHistoryView,
): SecurityReportEvidenceState {
  const report = item.report;
  if (report?.findings.length) return "findings";
  if (
    item.status !== "complete" ||
    report?.status !== "complete" ||
    report?.verdict === "unknown"
  )
    return "incomplete";
  if (report.verdict === "warn" || report.verdict === "block")
    return "risk-details-unavailable";
  return "clean";
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

/**
 * Task/report aggregation helpers for the prototype-aligned scan UI.
 *
 * The page has no on-demand per-skill report endpoint: a scan task's
 * per-skill findings live inside each history entry's embedded `report`.
 * These helpers shape history entries into the task view the UI consumes
 * (unsafe list, scan-task detail modal, report modal). All pure functions —
 * no i18n, no React.
 */

export type RelativeTimeUnit = "just" | "minute" | "hour" | "day";

export interface SecurityTaskFindingView {
  /** Source history entry id, so the UI can jump back to that skill's report. */
  readonly entryId: string;
  readonly skillName: string;
  readonly tone: "danger" | "warn";
  /** Finding-level severity, or null for entry-level (no-report) rows. */
  readonly severity: SecuritySeverity | null;
  readonly severityDisplay: string;
  readonly kindDisplay: string;
  readonly issue: string;
  readonly advice: string;
}

export interface SecurityScanTaskView {
  readonly scanId: string;
  /** Min of entries' startedAt. */
  readonly startedAt: string;
  /** Max of entries' finishedAt. */
  readonly finishedAt: string;
  readonly trigger: "manual" | "automatic";
  readonly scope: "all" | "single";
  readonly status: "complete" | "partial" | "failed";
  readonly safe: boolean;
  readonly entries: readonly SecurityHistoryView[];
  readonly totals: SecurityTotals;
  readonly findings: readonly SecurityTaskFindingView[];
}

export function countScanTasks(
  history: readonly SecurityHistoryView[],
): number {
  return new Set(history.map((entry) => entry.scanId)).size;
}

export function unsafeEntries(
  entries: readonly SecurityHistoryView[],
): SecurityHistoryView[] {
  return entries.filter(
    (item) =>
      item.report?.verdict === "warn" || item.report?.verdict === "block",
  );
}

/** block verdict reads as high-risk; warn verdict reads as a warning. */
export function unsafeVerdictTone(
  item: SecurityHistoryView,
): "danger" | "warn" {
  return item.report?.verdict === "block" ? "danger" : "warn";
}

/** Deduplicated, human-readable risk-dimension names for a report. */
export function hitDimensionsOf(item: SecurityHistoryView): readonly string[] {
  return [
    ...new Set(
      (item.report?.findings ?? [])
        .map((finding) => finding.kindDisplay)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

export function severityCounts(
  report: SecurityReportView,
): Record<SecuritySeverity, number> {
  const counts: Record<SecuritySeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const finding of report.findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

/**
 * Aggregate one scan's history entries (which must share a single scanId)
 * into the task view the detail modal consumes. Failed/incomplete entries stay
 * visible through task status and totals, but never become fabricated risks.
 */
export function aggregateScanTask(
  entries: readonly SecurityHistoryView[],
): SecurityScanTaskView {
  const startedAt = entries.reduce(
    (latest, entry) => Math.min(latest, Date.parse(entry.startedAt)),
    Number.POSITIVE_INFINITY,
  );
  const finishedAt = entries.reduce(
    (latest, entry) => Math.max(latest, Date.parse(entry.finishedAt)),
    0,
  );
  const totals = summarizeReports(entries);
  const anyFailed = entries.some((entry) => entry.status === "failed");
  const allComplete = entries.every(
    (entry) =>
      entry.status === "complete" &&
      entry.report?.status === "complete" &&
      !entry.errorCode,
  );

  const findings: SecurityTaskFindingView[] = [];
  for (const entry of entries) {
    const report = entry.report;
    if (
      report == null ||
      (report.findings.length === 0 &&
        report.verdict !== "warn" &&
        report.verdict !== "block")
    )
      continue;
    const tone = unsafeVerdictTone(entry);
    if (report && report.findings.length > 0) {
      for (const finding of report.findings) {
        findings.push({
          entryId: entry.id,
          skillName: entry.skillName,
          tone,
          severity: finding.severity,
          severityDisplay: finding.severityDisplay,
          kindDisplay: finding.kindDisplay,
          issue: finding.message,
          advice: finding.remediation,
        });
      }
    } else {
      findings.push({
        entryId: entry.id,
        skillName: entry.skillName,
        tone,
        severity: null,
        severityDisplay: "",
        kindDisplay: "",
        issue:
          entry.errorCode ?? report.summary ?? report.threatLevelDisplay ?? "",
        advice: "",
      });
    }
  }

  return {
    scanId: entries[0]?.scanId ?? "",
    startedAt: Number.isFinite(startedAt)
      ? new Date(startedAt).toISOString()
      : "",
    finishedAt: new Date(finishedAt).toISOString(),
    trigger: entries[0]?.trigger ?? "manual",
    scope: entries.length > 1 ? "all" : "single",
    status: anyFailed ? "failed" : allComplete ? "complete" : "partial",
    safe: entries.length > 0 && entries.every(securityHistoryEntryIsSafe),
    entries,
    totals,
    findings,
  };
}

export function aggregateScanTasks(
  history: readonly SecurityHistoryView[],
): readonly SecurityScanTaskView[] {
  const groups = new Map<string, SecurityHistoryView[]>();
  for (const entry of history) {
    const group = groups.get(entry.scanId);
    if (group) {
      group.push(entry);
    } else {
      groups.set(entry.scanId, [entry]);
    }
  }
  return [...groups.values()]
    .map(aggregateScanTask)
    .sort(
      (left, right) =>
        Date.parse(right.finishedAt) - Date.parse(left.finishedAt),
    );
}

export function relativeTimeParts(
  iso: string,
  now: number,
): { unit: RelativeTimeUnit; value: number } {
  const minutes = Math.floor(Math.max(0, now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return { unit: "just", value: 0 };
  if (minutes < 60) return { unit: "minute", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hour", value: hours };
  return { unit: "day", value: Math.floor(hours / 24) };
}
