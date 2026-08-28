import { writeFileSync } from "node:fs";
import type { ScanSkillReport } from "../types.js";

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Renders a deterministic, dependency-free human summary (uses the report's already-localized fields). */
export function renderSummary(report: ScanSkillReport): string {
  const lines: string[] = [];
  lines.push(`skill-scanner: mode=${report.mode} status=${report.status} verdict=${report.verdict}`);
  lines.push(`riskScore=${report.riskScore}/100 threatLevel=${report.threatLevel} (${report.threatLevelDisplay})`);
  lines.push(`scannedFiles=${report.scannedFiles}${report.skippedFiles.length > 0 ? ` skipped=${report.skippedFiles.length}` : ""} locale=${report.locale}`);
  lines.push(`tokenUsage=${report.tokenUsage.status} requests=${report.tokenUsage.requestCount} reported=${report.tokenUsage.reportedRequestCount} input=${report.tokenUsage.inputTokens} output=${report.tokenUsage.outputTokens} total=${report.tokenUsage.totalTokens} cachedInput=${report.tokenUsage.cachedInputTokens}`);
  lines.push(report.summary);
  const categories = Object.entries(report.categories);
  if (categories.length > 0) {
    lines.push("categories:");
    for (const [kind, bucket] of categories) lines.push(`  ${bucket.display} (${kind}): count=${bucket.count} highest=${bucket.highestSeverity}`);
  }
  const top = [...report.findings]
    .sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || (b.weight - a.weight))
    .slice(0, 10);
  if (top.length > 0) {
    lines.push("top findings:");
    for (const finding of top) lines.push(`  [${finding.severity}] ${finding.kindDisplay}: ${finding.ruleName} (${finding.path}${finding.line ? `:${finding.line}` : ""})`);
  } else {
    lines.push("findings: none");
  }
  return lines.join("\n");
}

export function renderJson(report: ScanSkillReport): string {
  return JSON.stringify(report, null, 2);
}

export function writeOutput(filePath: string, text: string): void {
  writeFileSync(filePath, `${text}\n`, "utf-8");
}
