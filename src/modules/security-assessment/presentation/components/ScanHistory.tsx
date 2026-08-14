import { useMemo, useState } from "react";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  FileText,
  Lightbulb,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import {
  aggregateScanTasks,
  type SecurityBranchName,
  type SecurityBranchStatus,
  type SecurityHistoryView,
  type SecurityScanTaskView,
  type SecuritySeverity,
  type SecurityVerdict,
} from "../security-view";
import { ChipTabs, SecurityCard } from "./SecurityCard";

type StateFilter = "all" | "safe" | "unsafe";
type TimeFilter = "24h" | "7d" | "30d" | "all";

const timeSpans: Record<TimeFilter, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  all: Number.POSITIVE_INFINITY,
};

const historyStatusKeys: Record<SecurityHistoryView["status"], MessageKey> = {
  complete: "security.center.result.statusComplete",
  partial: "security.center.result.statusPartial",
  failed: "security.center.result.statusFailed",
  skipped: "security.center.result.statusSkipped",
  cancelled: "security.center.result.statusCancelled",
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

const verdictKeys: Record<SecurityVerdict, MessageKey> = {
  allow: "security.center.verdict.allow",
  warn: "security.center.verdict.warn",
  block: "security.center.verdict.block",
  unknown: "security.center.verdict.unknown",
};

const severityColors: Record<SecuritySeverity, string> = {
  critical: "var(--danger)",
  high: "var(--danger)",
  medium: "var(--warn)",
  low: "var(--ok)",
};

export function ScanHistory({
  entries,
  onOpenTask,
}: {
  entries: readonly SecurityHistoryView[];
  onOpenTask?: (task: SecurityScanTaskView) => void;
}) {
  const { t, format } = useI18n();
  const [state, setState] = useState<StateFilter>("all");
  const [span, setSpan] = useState<TimeFilter>("7d");
  const [open, setOpen] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState<string | null>(null);
  const now = Date.now();
  const list = useMemo(
    () =>
      aggregateScanTasks(entries).filter((group) => {
        if (now - Date.parse(group.finishedAt) > timeSpans[span]) return false;
        return state === "all" || (state === "safe" ? group.safe : !group.safe);
      }),
    [entries, now, span, state],
  );

  return (
    <SecurityCard
      title={t("security.center.history.title")}
      description={t("security.center.history.count", { count: list.length })}
      action={
        <ChipTabs
          value={span}
          onChange={setSpan}
          options={[
            { value: "24h", label: t("security.center.history.day") },
            { value: "7d", label: t("security.center.history.week") },
            { value: "30d", label: t("security.center.history.month") },
            { value: "all", label: t("security.center.history.all") },
          ]}
        />
      }
    >
      <div className="px-5 pb-4">
        <ChipTabs
          value={state}
          onChange={setState}
          options={[
            { value: "all", label: t("security.center.history.all") },
            { value: "safe", label: t("security.center.history.safe") },
            { value: "unsafe", label: t("security.center.history.unsafe") },
          ]}
        />
      </div>

      {list.length === 0 ? (
        <p className="px-5 pb-10 text-center font-mono text-[12px] text-muted-foreground">
          {t("security.center.history.empty")}
        </p>
      ) : (
        <div className="border-t border-border/60">
          {list.map((group) => {
            const totals = group.totals;
            const safe = group.safe;
            const expanded = open === group.scanId;
            const reportShown = reportOpen === group.scanId;
            const latestEntry = [...group.entries].sort(
              (left, right) =>
                Date.parse(right.finishedAt) - Date.parse(left.finishedAt),
            )[0];
            return (
              <div
                key={group.scanId}
                className="border-b border-border/40 last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : group.scanId)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="tt-num w-[124px] shrink-0 font-mono text-[11px] text-muted-foreground">
                    {format.formatDateTime(group.finishedAt, false)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {group.entries.length > 1
                      ? t("security.center.history.scopeAll")
                      : t("security.center.history.scopeSingle")}
                  </span>
                  <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
                    <Boxes className="size-3" />
                    {totals.total}
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px]"
                    style={{ color: safe ? "var(--ok)" : "var(--danger)" }}
                  >
                    {safe ? (
                      <ShieldCheck className="size-3" />
                    ) : (
                      <ShieldX className="size-3" />
                    )}
                    {safe
                      ? t("security.center.history.safe")
                      : t("security.center.history.unsafe")}
                  </span>
                  <ChevronDown
                    className={`size-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
                {expanded && (
                  <div className="space-y-2 bg-surface-2/40 px-5 pt-1 pb-4">
                    <p className="font-mono text-[10.5px] text-muted-foreground">
                      {t("security.center.history.covered", {
                        skills: totals.total,
                        safe: totals.safe,
                        unsafe:
                          totals.warn +
                          totals.danger +
                          totals.unknown +
                          totals.failed,
                      })}
                    </p>
                    {group.entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg bg-card px-3.5 py-3 text-[11.5px]"
                      >
                        <span className="min-w-[140px] flex-1 font-medium">
                          {entry.skillName}
                        </span>
                        <span
                          className={
                            entry.status === "complete"
                              ? "text-ok"
                              : entry.status === "failed"
                                ? "text-danger"
                                : "text-warn"
                          }
                        >
                          {t(historyStatusKeys[entry.status])}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {t("security.center.history.generatedLocale", {
                            locale: entry.locale,
                          })}
                        </span>
                        {entry.errorCode && (
                          <span className="w-full break-all text-[10.5px] text-danger">
                            {entry.errorCode}
                          </span>
                        )}
                      </div>
                    ))}

                    <div className="flex justify-end gap-2 pt-1">
                      {onOpenTask && (
                        <button
                          type="button"
                          onClick={() => onOpenTask(group)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[11.5px] font-medium transition-colors hover:bg-accent hover:text-foreground"
                        >
                          {t("security.center.task.viewDetails")}
                          <ChevronRight className="size-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setReportOpen(reportShown ? null : group.scanId)
                        }
                        className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[11.5px] font-medium transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <FileText className="size-3.5" />
                        {t("security.center.history.viewReport")}
                        <ChevronDown
                          className={`size-3.5 text-muted-foreground transition-transform ${reportShown ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>

                    {reportShown && latestEntry && (
                      <ReportPanel entry={latestEntry} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SecurityCard>
  );
}

function ReportPanel({ entry }: { entry: SecurityHistoryView }) {
  const { t } = useI18n();
  const report = entry.report;

  if (!report) {
    return (
      <p className="rounded-xl bg-card px-4 py-3 font-mono text-[11.5px] text-muted-foreground">
        {t("security.center.history.noReport")}
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-xl bg-card p-4 shadow-[var(--elev-1)]">
      <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
        {t("security.center.history.reportSummary", {
          verdict: t(verdictKeys[report.verdict]),
          score: report.riskScore,
          threat: report.threatLevelDisplay,
          files: report.scannedFiles,
          rules: report.rulesVersion,
        })}
      </p>

      <div>
        <h4 className="font-mono text-[10.5px] font-semibold text-muted-foreground uppercase">
          {t("security.center.history.reportBranches")}
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
      </div>

      <div>
        <h4 className="font-mono text-[10.5px] font-semibold text-muted-foreground uppercase">
          {t("security.center.history.reportFindings")}
        </h4>
        {report.findings.length === 0 ? (
          <p className="mt-1.5 font-mono text-[11.5px] text-ok">
            {t("security.center.result.noFindings")}
          </p>
        ) : (
          <div className="mt-1.5 space-y-2">
            {report.findings.map((finding) => (
              <div
                key={finding.id}
                className="rounded-lg bg-surface-2/60 px-3.5 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded-full bg-card px-2 py-0.5 font-mono text-[10px]"
                    style={{ color: severityColors[finding.severity] }}
                  >
                    {finding.severityDisplay}
                  </span>
                  <span className="rounded-full bg-card px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {finding.kindDisplay}
                  </span>
                  <span className="min-w-0 flex-1 break-all text-[11.5px] font-medium">
                    {finding.path}
                    {finding.line != null
                      ? ` · ${t("security.center.result.line", {
                          line: finding.line,
                        })}`
                      : ""}
                  </span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-foreground/85">
                  {finding.message}
                </p>
                <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
                  {t("security.center.result.remediation")}：
                  {finding.remediation}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
