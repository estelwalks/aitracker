import type { ReactNode } from "react";
import {
  FileCode2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Wrench,
} from "lucide-react";

import { TTButton } from "../../../../components/tt";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import { useSecurityLlmReview } from "../use-security-llm-review";
import type { SecurityLlmReviewConfidence } from "../../llm-review.contracts";
import {
  securityReportEvidenceState,
  severityCounts,
  skippedReasonCode,
  type SecurityBranchName,
  type SecurityBranchStatus,
  type SecurityFindingView,
  type SecurityHistoryView,
  type SecuritySeverity,
  type SecuritySkippedReasonCode,
  type SecurityVerdict,
} from "../security-view";

const verdictKeys: Record<SecurityVerdict, MessageKey> = {
  allow: "security.center.verdict.allow",
  warn: "security.center.verdict.warn",
  block: "security.center.verdict.block",
  unknown: "security.center.verdict.unknown",
};

const verdictClasses: Record<SecurityVerdict, string> = {
  allow: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  block: "border-danger/30 bg-danger/10 text-danger",
  unknown: "border-border text-muted-foreground",
};

const branchNameKeys: Record<SecurityBranchName, MessageKey> = {
  static: "security.center.branch.static",
  ruleReview: "security.center.branch.ruleReview",
  singleFileAnalysis: "security.center.branch.singleFileAnalysis",
  multiFileAnalysis: "security.center.branch.multiFileAnalysis",
};

const branchStatusKeys: Record<SecurityBranchStatus, MessageKey> = {
  complete: "security.center.branch.complete",
  skipped: "security.center.branch.skipped",
  failed: "security.center.branch.failed",
};

const severityColors: Record<SecuritySeverity, string> = {
  critical: "var(--danger)",
  high: "var(--danger)",
  medium: "var(--warn)",
  low: "var(--ok)",
};

const severityLabelKeys: Record<SecuritySeverity, MessageKey> = {
  critical: "security.center.severity.critical",
  high: "security.center.severity.high",
  medium: "security.center.severity.medium",
  low: "security.center.severity.low",
};

const llmConfidenceKeys: Record<SecurityLlmReviewConfidence, MessageKey> = {
  low: "security.center.llm.confidenceLow",
  medium: "security.center.llm.confidenceMedium",
  high: "security.center.llm.confidenceHigh",
};

const skipReasonKeys: Record<SecuritySkippedReasonCode, MessageKey> = {
  fileUnavailable: "security.center.skipReason.fileUnavailable",
  symbolicLink: "security.center.skipReason.symbolicLink",
  depthLimit: "security.center.skipReason.depthLimit",
  fileLimit: "security.center.skipReason.fileLimit",
  skillSizeLimit: "security.center.skipReason.skillSizeLimit",
  fileSizeLimit: "security.center.skipReason.fileSizeLimit",
  binaryFile: "security.center.skipReason.binaryFile",
  scannerSkip: "security.center.skipReason.scannerSkip",
  unknown: "security.center.skipReason.unknown",
};

/**
 * 单 Skill 安全报告弹窗：与 V3.0 原型 SkillReportModal 对齐。
 *
 * 数据全部来自该 Skill 历史条目的真实扫描报告（SecurityReportView），
 * 不发起任何额外请求。score 为安全分（100=安全，来自 computeScore），
 * 直接展示不复位。Footer 的「重新检测此 Skill」走真实单 Skill 重扫接口。
 */
export function SkillReportModal({
  entry,
  dimensions,
  onClose,
  onRescan,
}: {
  entry: SecurityHistoryView;
  dimensions: number;
  onClose: () => void;
  onRescan?: (entry: SecurityHistoryView) => void;
}) {
  const { t } = useI18n();
  const report = entry.report;
  const llm = useSecurityLlmReview(entry);
  const evidenceState = securityReportEvidenceState(entry);
  const incomplete = evidenceState === "incomplete";
  const missingRiskDetails = evidenceState === "risk-details-unavailable";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto rounded-2xl bg-card p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4 pr-10 text-left">
          <DialogTitle className="text-[15px] font-semibold tracking-tight">
            {t("security.report.title", { name: entry.skillName })}
          </DialogTitle>
        </DialogHeader>

        {report == null ? (
          <p className="px-5 py-12 text-center font-mono text-[12px] text-muted-foreground">
            {t("security.center.history.noReport")}
          </p>
        ) : (
          <>
            <div className="space-y-4 px-5 py-4">
              <ScoreHeader
                score={report.riskScore}
                verdict={report.verdict}
                partial={incomplete}
                counts={severityCounts(report)}
                dimensions={dimensions}
              />

              {report.findings.length === 0 ? (
                <div
                  className={`flex items-center justify-center gap-2 py-8 font-mono text-[12px] ${
                    incomplete || missingRiskDetails
                      ? "text-amber-500"
                      : "text-muted-foreground"
                  }`}
                >
                  {incomplete || missingRiskDetails ? (
                    <TriangleAlert className="size-4" />
                  ) : (
                    <ShieldCheck className="size-4 text-ok" />
                  )}
                  {incomplete
                    ? t("security.center.result.incompleteNoFindings")
                    : missingRiskDetails
                      ? t("security.center.result.riskDetailsUnavailable")
                      : t("security.center.result.noFindings")}
                </div>
              ) : (
                <div className="space-y-3">
                  {report.findings.map((finding) => (
                    <FindingCard key={finding.id} finding={finding} />
                  ))}
                </div>
              )}

              {report.summary && (
                <section>
                  <h4 className="font-mono text-[10.5px] font-semibold text-muted-foreground uppercase">
                    {t("security.center.result.summary")}
                  </h4>
                  <p className="mt-1.5 rounded-xl bg-surface-2/50 px-3.5 py-2.5 text-[12.5px] leading-relaxed">
                    {report.summary}
                  </p>
                </section>
              )}

              {(llm.review != null || llm.canRequest || llm.degraded) && (
                <section className="rounded-xl bg-surface px-4 py-4 ring-1 ring-border/50">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-mono text-[10.5px] font-semibold text-muted-foreground uppercase">
                      {t("security.center.llm.title")}
                    </h4>
                    <span className="rounded-sm border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                      {t("security.center.llm.disclaimer")}
                    </span>
                  </div>

                  {llm.review == null ? (
                    <div className="mt-2.5 space-y-2">
                      {llm.degraded && (
                        <p className="text-[12px] text-muted-foreground">
                          {t("security.center.llm.failed")}
                        </p>
                      )}
                      <TTButton
                        variant="ghost"
                        size="sm"
                        onClick={llm.request}
                        disabled={llm.loading || !llm.canRequest}
                      >
                        <Sparkles className="size-3.5" />
                        {llm.loading
                          ? t("security.center.llm.loading")
                          : t("security.center.llm.trigger")}
                      </TTButton>
                    </div>
                  ) : (
                    <div className="mt-2.5 space-y-2.5">
                      <p className="text-[12.5px] leading-relaxed">
                        {llm.review.summary}
                      </p>
                      {llm.review.dimensions.length > 0 && (
                        <ul className="space-y-1.5">
                          {llm.review.dimensions.map((dimension) => (
                            <li
                              key={dimension.kind}
                              className="flex items-start gap-2"
                            >
                              <span className="mt-0.5 shrink-0 rounded-sm bg-surface-2 px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                                {dimension.kind}
                              </span>
                              <span className="text-[12px] leading-relaxed">
                                {dimension.analysis}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted-foreground">
                        <span>
                          {t("security.center.llm.confidence")}:{" "}
                          {t(llmConfidenceKeys[llm.review.confidence])}
                        </span>
                        {llm.review.modelLabel && (
                          <span>
                            {t("security.center.llm.modelLabel", {
                              label: llm.review.modelLabel,
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {report.branches.length > 0 && (
                <section>
                  <h4 className="font-mono text-[10.5px] font-semibold text-muted-foreground uppercase">
                    {t("security.center.result.branches")}
                  </h4>
                  <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                    {report.branches.map((branch) => (
                      <li
                        key={branch.name}
                        className="rounded-lg bg-surface-2/60 px-3 py-2 text-[11.5px]"
                      >
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {t(branchNameKeys[branch.name])}
                          </span>
                          <span
                            className={
                              branch.status === "complete"
                                ? "text-ok"
                                : branch.status === "failed"
                                  ? "text-danger"
                                  : "text-muted-foreground"
                            }
                          >
                            {t(branchStatusKeys[branch.status])}
                          </span>
                        </div>
                        {branch.status === "failed" && branch.detail && (
                          <span className="mt-1 block break-all text-[10px] text-danger">
                            {branch.detail}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {report.skippedFiles.length > 0 && (
                <section>
                  <h4 className="font-mono text-[10.5px] font-semibold text-muted-foreground uppercase">
                    {t("security.center.result.skippedFiles")}
                  </h4>
                  <ul className="mt-1.5 space-y-1">
                    {report.skippedFiles.map((file) => (
                      <li
                        key={`${file.path}-${file.reasonCode}`}
                        className="flex items-baseline gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-[11.5px]"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                          {file.path}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {t(skipReasonKeys[skippedReasonCode(file)])}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <DialogFooter className="border-t border-border/60 px-5 py-3">
              {onRescan && (
                <TTButton variant="ghost" onClick={() => onRescan(entry)}>
                  <RotateCcw className="size-3.5" />
                  {t("security.center.task.rescan")}
                </TTButton>
              )}
              <TTButton onClick={onClose}>
                {t("security.center.autoScan.close")}
              </TTButton>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScoreHeader({
  score,
  verdict,
  partial,
  counts,
  dimensions,
}: {
  score: number;
  verdict: SecurityVerdict;
  partial: boolean;
  counts: Record<SecuritySeverity, number>;
  dimensions: number;
}) {
  const { t } = useI18n();
  const severityLabels: SecuritySeverity[] = [
    "critical",
    "high",
    "medium",
    "low",
  ];
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl bg-surface px-4 py-4 ring-1 ring-border/50">
      <div>
        <div className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
          {t("security.center.reportModal.securityScore")}
        </div>
        <div className="tt-num mt-1 text-3xl leading-none font-semibold">
          {score}
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">
            / 100
          </span>
        </div>
      </div>
      <span
        className={`rounded-sm border px-1.5 py-px text-[10px] ${verdictClasses[verdict]}`}
      >
        {t(verdictKeys[verdict])}
      </span>
      {partial && (
        <span className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-500">
          {t("security.center.result.statusPartial")}
        </span>
      )}
      <div className="ml-auto flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        {severityLabels.map((severity) => (
          <span key={severity} className="inline-flex items-center gap-1.5">
            <span
              className="size-1.5 rounded-full"
              style={{ background: severityColors[severity] }}
            />
            {t(severityLabelKeys[severity])} {counts[severity]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          {t("security.center.reportModal.coveredDimensions", {
            count: dimensions,
          })}
        </span>
      </div>
    </div>
  );
}

function FindingCard({ finding }: { finding: SecurityFindingView }) {
  const { t } = useI18n();
  const f = finding;
  return (
    <article className="rounded-xl bg-surface px-4 py-4 ring-1 ring-border/50">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-sm border px-1.5 py-px font-mono text-[10px] tracking-wide"
          style={{ borderColor: severityColors[f.severity] }}
        >
          {f.severityDisplay}
        </span>
        <span className="text-[13px] font-semibold">{f.ruleName}</span>
        <span className="text-[12px] text-muted-foreground">
          {f.kindDisplay}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/80">
          {f.id}
        </span>
      </div>
      <dl className="mt-3 space-y-2.5">
        <DefRow label={t("security.center.reportModal.description")}>
          <dd className="mt-0.5 text-[12.5px] leading-relaxed">{f.message}</dd>
        </DefRow>
        <DefRow label={t("security.center.result.remediation")}>
          <dd className="mt-0.5 flex items-start gap-1.5 text-[12.5px] leading-relaxed">
            <Wrench className="mt-0.5 size-3 shrink-0 text-ok" />
            {f.remediation}
          </dd>
        </DefRow>
        <DefRow label={t("security.center.reportModal.location")}>
          <dd className="mt-0.5 flex items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground">
            <FileCode2 className="size-3 shrink-0" />
            {f.path}
            {f.line != null
              ? ` · ${t("security.center.result.line", { line: f.line })}`
              : ""}
          </dd>
        </DefRow>
        {f.excerpt && (
          <DefRow label={t("security.center.reportModal.code")}>
            <dd className="mt-1 overflow-x-auto rounded-sm border border-border bg-surface-2/50 px-3 py-2">
              <code className="font-mono text-[11.5px] whitespace-pre text-foreground/90">
                {f.excerpt}
              </code>
            </dd>
          </DefRow>
        )}
      </dl>
    </article>
  );
}

function DefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      {children}
    </div>
  );
}
