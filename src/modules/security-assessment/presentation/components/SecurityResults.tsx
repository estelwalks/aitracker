import { useState } from "react";
import {
  AlertTriangle,
  Boxes,
  ChevronDown,
  FileWarning,
  RotateCcw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import {
  reportNeedsLocaleRefresh,
  skippedReasonCode,
  type SecurityBranchStatus,
  type SecurityHistoryView,
  type SecuritySeverity,
  type SecurityVerdict,
} from "../security-view";
import { SecurityCard } from "./SecurityCard";

const verdictKeys: Record<SecurityVerdict, MessageKey> = {
  allow: "security.center.verdict.allow",
  warn: "security.center.verdict.warn",
  block: "security.center.verdict.block",
  unknown: "security.center.verdict.unknown",
};
const severityKeys: Record<SecuritySeverity, MessageKey> = {
  critical: "security.center.severity.critical",
  high: "security.center.severity.high",
  medium: "security.center.severity.medium",
  low: "security.center.severity.low",
};
const branchStatusKeys: Record<SecurityBranchStatus, MessageKey> = {
  complete: "security.center.branch.complete",
  skipped: "security.center.branch.skipped",
  failed: "security.center.branch.failed",
};

function verdictTone(verdict: SecurityVerdict): string {
  if (verdict === "block") return "var(--danger)";
  if (verdict === "warn" || verdict === "unknown") return "var(--warn)";
  return "var(--ok)";
}

function scoreTone(score: number): string {
  if (score >= 80) return "var(--ok)";
  if (score >= 60) return "var(--warn)";
  return "var(--danger)";
}

function itemIsPartial(item: SecurityHistoryView): boolean {
  return (
    item.status === "partial" ||
    item.report?.status === "partial" ||
    item.report?.branches.some((branch) => branch.status === "failed") ===
      true ||
    (item.report?.skippedFiles.length ?? 0) > 0
  );
}

export function SecurityResults({
  entries,
  dimensions,
  onRescan,
}: {
  entries: readonly SecurityHistoryView[];
  dimensions: number;
  onRescan: (entry: SecurityHistoryView) => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState<string | null>(entries[0]?.id ?? null);
  const findings = entries.reduce(
    (count, item) => count + (item.report?.findings.length ?? 0),
    0,
  );
  const hasPartial = entries.some(itemIsPartial);
  const hasFailed = entries.some((item) => item.status === "failed");

  return (
    <SecurityCard
      title={t("security.center.result.title")}
      description={
        entries.length
          ? t("security.center.result.description", {
              skills: entries.length,
              findings,
            })
          : undefined
      }
    >
      {entries.length === 0 ? (
        <div className="px-6 pb-10 text-center">
          <ShieldCheck
            className="mx-auto size-8 text-muted-foreground"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-[13px] font-medium">
            {t("security.center.result.noReportTitle")}
          </p>
          <p className="mx-auto mt-1 max-w-lg text-[12px] text-muted-foreground">
            {t("security.center.result.noReportDesc")}
          </p>
        </div>
      ) : (
        <>
          {hasPartial && (
            <div className="mx-5 mb-3 flex items-start gap-2 rounded-xl bg-warn/10 px-3.5 py-3 text-[12px] text-warn">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {t("security.center.result.partialNotice")}
            </div>
          )}
          {hasFailed && (
            <div className="mx-5 mb-3 flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-3 text-[12px] text-danger">
              <ShieldX className="mt-0.5 size-4 shrink-0" />
              {t("security.center.result.failedNotice")}
            </div>
          )}
          {!hasPartial &&
            !hasFailed &&
            findings === 0 &&
            entries.every((item) => item.report?.verdict === "allow") && (
              <p className="px-5 pb-4 text-center font-mono text-[12px] text-ok">
                {t("security.center.result.allPassed", {
                  skills: entries.length,
                  dimensions,
                })}
              </p>
            )}

          <div className="border-t border-border/60">
            {entries.map((item) => {
              const report = item.report;
              const expanded = open === item.id;
              const mismatch = report
                ? reportNeedsLocaleRefresh(report, locale)
                : item.locale !== locale;
              const verdict = report?.verdict ?? "unknown";
              return (
                <div
                  key={item.id}
                  className="border-b border-border/50 last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : item.id)}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-surface-2/60"
                  >
                    <Boxes className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-[160px] flex-1 truncate text-[12.5px] font-medium">
                      {item.skillName}
                    </span>
                    <span
                      className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px]"
                      style={{ color: verdictTone(verdict) }}
                    >
                      {t(verdictKeys[verdict])}
                    </span>
                    {report && (
                      <span
                        className="tt-num font-mono text-[11px] font-bold"
                        style={{ color: scoreTone(report.riskScore) }}
                      >
                        {t("security.center.result.score")} {report.riskScore}
                      </span>
                    )}
                    <span className="font-mono text-[10.5px] text-muted-foreground">
                      {report?.findings.length ?? 0}{" "}
                      {t("security.center.result.findings")}
                    </span>
                    <ChevronDown
                      className={`size-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  {expanded && (
                    <div className="space-y-3 bg-surface-2/35 px-5 pt-1 pb-5">
                      {mismatch && (
                        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warn/25 bg-warn/10 px-3.5 py-3 text-[12px] text-warn">
                          <AlertTriangle className="size-4 shrink-0" />
                          <span className="min-w-0 flex-1">
                            {t("security.center.result.localeMismatch")}
                          </span>
                          <span className="font-mono text-[10px]">
                            {t("security.center.history.generatedLocale", {
                              locale: item.locale,
                            })}
                          </span>
                          <button
                            type="button"
                            onClick={() => onRescan(item)}
                            className="inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-3 py-1.5 font-medium"
                          >
                            <RotateCcw className="size-3.5" />{" "}
                            {t("security.center.result.rerunLocale")}
                          </button>
                        </div>
                      )}

                      {report ? (
                        <>
                          <div className="rounded-xl bg-card px-3.5 py-3">
                            <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-muted-foreground">
                              <span>
                                {t("security.center.result.files")}:{" "}
                                {report.scannedFiles}
                              </span>
                              <span>Engine {report.engineVersion}</span>
                              <span>Rules {report.rulesVersion}</span>
                              <span>
                                {t("security.center.history.generatedLocale", {
                                  locale: report.locale,
                                })}
                              </span>
                            </div>
                            <p className="mt-2 text-[12.5px] leading-relaxed">
                              {report.summary}
                            </p>
                          </div>

                          <div>
                            <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                              {t("security.center.result.branches")}
                            </h3>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                              {report.branches.map((branch) => (
                                <div
                                  key={branch.name}
                                  className="rounded-lg bg-card px-3 py-2.5 text-[11px]"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">
                                      {t(
                                        `security.center.branch.${branch.name}`,
                                      )}
                                    </span>
                                    <span
                                      className={
                                        branch.status === "failed"
                                          ? "text-danger"
                                          : branch.status === "skipped"
                                            ? "text-warn"
                                            : "text-ok"
                                      }
                                    >
                                      {t(branchStatusKeys[branch.status])}
                                    </span>
                                  </div>
                                  {branch.detail && (
                                    <p className="mt-1 break-words text-[10.5px] text-muted-foreground">
                                      {branch.detail}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>

                          {report.skippedFiles.length > 0 && (
                            <div>
                              <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-warn uppercase">
                                <FileWarning className="size-3.5" />
                                {t("security.center.result.skippedFiles")}
                              </h3>
                              <div className="space-y-1.5">
                                {report.skippedFiles.map((file) => (
                                  <div
                                    key={`${file.path}:${file.reason}`}
                                    className="grid gap-1 rounded-lg bg-warn/8 px-3 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                                  >
                                    <code className="break-all text-warn">
                                      {file.path}
                                    </code>
                                    <span className="text-muted-foreground">
                                      {t(
                                        `security.center.skipReason.${skippedReasonCode(file)}`,
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="space-y-2">
                            {report.findings.map((finding) => (
                              <article
                                key={finding.id}
                                className="rounded-xl bg-card px-3.5 py-3"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${finding.severity === "critical" || finding.severity === "high" ? "bg-danger/10 text-danger" : finding.severity === "medium" ? "bg-warn/10 text-warn" : "bg-surface-2 text-muted-foreground"}`}
                                  >
                                    {t(severityKeys[finding.severity])}
                                  </span>
                                  <span className="text-[12px] font-medium">
                                    {finding.kindDisplay}
                                  </span>
                                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                                    {finding.source === "static"
                                      ? t(
                                          "security.center.result.findingSourceStatic",
                                        )
                                      : t(
                                          "security.center.result.findingSourceModel",
                                        )}
                                  </span>
                                  <code className="ml-auto text-[10px] text-muted-foreground">
                                    {finding.path}
                                    {finding.line ? `:${finding.line}` : ""}
                                  </code>
                                </div>
                                <p className="mt-2 text-[12px] leading-relaxed">
                                  {finding.message}
                                </p>
                                {finding.excerpt && (
                                  <pre className="tt-scroll mt-2 overflow-x-auto rounded-lg bg-background/70 p-2 font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
                                    {finding.excerpt}
                                  </pre>
                                )}
                                <p className="mt-2 text-[11.5px] text-muted-foreground">
                                  <span className="font-medium text-foreground">
                                    {t("security.center.result.remediation")}:
                                  </span>{" "}
                                  {finding.remediation}
                                </p>
                              </article>
                            ))}
                            {report.findings.length === 0 && (
                              <p className="py-4 text-center font-mono text-[11px] text-ok">
                                {t("security.center.result.noFindings")}
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl bg-danger/8 px-3.5 py-3 text-[12px] text-danger">
                          {item.errorCode ??
                            t("security.center.result.errorUnavailable")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </SecurityCard>
  );
}
