import type { ReactNode } from "react";
import {
  FileCode2,
  RotateCcw,
  ShieldCheck,
  ShieldX,
  Wrench,
} from "lucide-react";

import { AITrackerButton } from "../../../../components/aitracker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import {
  severityCounts,
  securityHistoryEntryHasDetectedRisk,
  skippedReasonCode,
  type SecurityBranchName,
  type SecurityBranchStatus,
  type SecurityFindingView,
  type SecurityHistoryView,
  type SecuritySeverity,
  type SecuritySkippedReasonCode,
  type SecurityTokenUsageView,
} from "../security-view";

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
 * Single-Skill security report modal aligned with the reference design.
 *
 * The data all comes from the real scan report (SecurityReportView) of the Skill's historical entries.
 * No additional requests are initiated. score is the safety score (100=safe, from computeScore),
 * Direct display without reset. Footer's "Recheck this Skill" implements a real single Skill rescan interface.
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
  const unsafe = securityHistoryEntryHasDetectedRisk(entry);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto rounded-2xl bg-card p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4 pr-10 text-left">
          <DialogTitle className="text-[15px] font-semibold tracking-tight">
            {t("security.report.title", { name: entry.skillName })}
          </DialogTitle>
        </DialogHeader>

        {report == null ? (
          <>
            <div className="px-5 py-10 text-center">
              <Wrench className="mx-auto size-8 text-warn" />
              <p className="mt-3 text-[14px] font-semibold text-warn">
                {t("security.center.status.failed")}
              </p>
              <p className="mt-2 font-mono text-[12px] text-muted-foreground">
                {t("security.center.history.noReport")}
              </p>
              {entry.errorCode && (
                <p className="mt-2 font-mono text-[10.5px] text-muted-foreground">
                  {t("security.center.result.errorUnavailable")}
                </p>
              )}
            </div>
            <DialogFooter className="border-t border-border/60 px-5 py-3">
              {onRescan && (
                <AITrackerButton
                  variant="ghost"
                  onClick={() => onRescan(entry)}
                >
                  <RotateCcw className="size-3.5" />
                  {t("security.center.task.rescan")}
                </AITrackerButton>
              )}
              <AITrackerButton onClick={onClose}>
                {t("security.center.autoScan.close")}
              </AITrackerButton>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 px-5 py-4">
              <ScoreHeader
                score={report.riskScore}
                unsafe={unsafe}
                counts={severityCounts(report)}
                dimensions={dimensions}
              />

              {report.findings.length === 0 ? (
                <div
                  className={`flex items-center justify-center gap-2 py-8 font-mono text-[12px] ${
                    unsafe ? "text-danger" : "text-muted-foreground"
                  }`}
                >
                  {unsafe ? (
                    <ShieldX className="size-4" />
                  ) : (
                    <ShieldCheck className="size-4 text-ok" />
                  )}
                  {unsafe
                    ? t("security.center.result.riskDetailsUnavailable")
                    : t("security.center.result.noFindings")}
                </div>
              ) : (
                <div className="space-y-3">
                  {report.findings.map((finding) => (
                    <FindingCard
                      key={finding.id}
                      finding={finding}
                      llmReviewed={
                        finding.source === "static" &&
                        finding.bypassVerification !== true &&
                        report.branches.some(
                          (branch) =>
                            branch.name === "ruleReview" &&
                            branch.status === "complete",
                        ) &&
                        (report.tokenUsage?.byBranch.ruleReview?.requestCount ??
                          0) > 0
                      }
                    />
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

              {report.tokenUsage && (
                <TokenUsageSection usage={report.tokenUsage} />
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
                <AITrackerButton
                  variant="ghost"
                  onClick={() => onRescan(entry)}
                >
                  <RotateCcw className="size-3.5" />
                  {t("security.center.task.rescan")}
                </AITrackerButton>
              )}
              <AITrackerButton onClick={onClose}>
                {t("security.center.autoScan.close")}
              </AITrackerButton>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ScoreHeader({
  score,
  unsafe,
  counts,
  dimensions,
}: {
  score: number;
  unsafe: boolean;
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
        <div className="aitracker-num aitracker-text-metric mt-1 leading-none font-semibold">
          {score}
          <span className="ml-1 font-mono text-[11px] text-muted-foreground">
            / 100
          </span>
        </div>
      </div>
      <span
        className={`rounded-sm border px-1.5 py-px text-[10px] ${
          unsafe
            ? "border-danger/30 bg-danger/10 text-danger"
            : "border-ok/30 bg-ok/10 text-ok"
        }`}
      >
        {t(
          unsafe
            ? "security.center.history.unsafe"
            : "security.center.history.safe",
        )}
      </span>
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

function FindingCard({
  finding,
  llmReviewed,
}: {
  finding: SecurityFindingView;
  llmReviewed: boolean;
}) {
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
        <DefRow label={t("security.center.reportModal.forensics")}>
          <dd className="mt-1.5 grid gap-2 sm:grid-cols-2">
            <EvidenceField
              label={t("security.center.reportModal.findingId")}
              value={f.id}
            />
            <EvidenceField
              label={t("security.center.reportModal.source")}
              value={t(
                f.source === "model"
                  ? "security.center.reportModal.sourceModel"
                  : llmReviewed
                    ? "security.center.reportModal.sourceStaticAndModel"
                    : "security.center.reportModal.sourceStatic",
              )}
            />
            {f.ruleId && (
              <EvidenceField
                label={t("security.center.reportModal.ruleId")}
                value={f.ruleId}
              />
            )}
            {f.cweId && (
              <EvidenceField
                label={t("security.center.reportModal.cweId")}
                value={f.cweId}
              />
            )}
            {f.fileHash && (
              <EvidenceField
                label={t("security.center.reportModal.fileHash")}
                value={f.fileHash}
                wide
              />
            )}
          </dd>
        </DefRow>
        {f.reasoning && (
          <DefRow label={t("security.center.reportModal.reasoning")}>
            <dd className="mt-0.5 text-[12.5px] leading-relaxed">
              {f.reasoning}
            </dd>
          </DefRow>
        )}
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

function EvidenceField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-lg bg-surface-2/60 px-3 py-2 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      <div className="font-mono text-[9.5px] text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 break-all font-mono text-[11px]">{value}</div>
    </div>
  );
}

function TokenUsageSection({ usage }: { usage: SecurityTokenUsageView }) {
  const { t, format } = useI18n();
  const metrics = [
    ["requests", usage.requestCount],
    ["inputTokens", usage.inputTokens],
    ["outputTokens", usage.outputTokens],
    ["totalTokens", usage.totalTokens],
    ["cachedTokens", usage.cachedInputTokens],
  ] as const;
  const statusKey =
    `security.center.reportModal.tokenStatus.${usage.status}` as MessageKey;
  return (
    <section className="rounded-xl bg-surface px-4 py-4 ring-1 ring-border/50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-mono text-[10.5px] font-semibold text-muted-foreground uppercase">
          {t("security.center.reportModal.tokenUsage")}
        </h4>
        <span className="rounded-sm border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground">
          {t(statusKey)}
        </span>
      </div>
      <dl className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {metrics.map(([key, value]) => (
          <div key={key} className="rounded-lg bg-surface-2/60 px-3 py-2">
            <dt className="font-mono text-[9.5px] text-muted-foreground">
              {t(`security.center.reportModal.${key}` as MessageKey)}
            </dt>
            <dd className="aitracker-num mt-0.5 text-[13px] font-semibold">
              {format.formatNumber(value)}
            </dd>
          </div>
        ))}
      </dl>
      {Object.keys(usage.byModel).length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {Object.entries(usage.byModel).map(([model, modelUsage]) => (
            <span
              key={model}
              className="rounded-md bg-surface-2 px-2 py-1 font-mono text-[10px] text-muted-foreground"
            >
              {model} · {format.formatNumber(modelUsage.totalTokens)} token
            </span>
          ))}
        </div>
      )}
    </section>
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
