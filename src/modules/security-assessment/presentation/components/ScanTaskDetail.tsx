import {
  Boxes,
  Clock,
  FileText,
  Layers,
  Lightbulb,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { useI18n } from "../../../../lib/i18n/context";
import type {
  SecurityHistoryView,
  SecurityScanTaskView,
} from "../security-view";
import { RelativeTime } from "./RelativeTime";

/**
 * 扫描任务详情弹窗：与 V3.0 原型 ScanTaskDetail 对齐。
 *
 * 一次「任务」= 同一 scanId 的一组真实历史条目（aggregateScanTask），
 * 展示汇总统计 + 风险明细；每项可跳转到对应 Skill 的真实报告弹窗。
 */
export function ScanTaskDetail({
  task,
  dimensions,
  onClose,
  onOpenReport,
}: {
  task: SecurityScanTaskView;
  dimensions: number;
  onClose: () => void;
  onOpenReport: (entry: SecurityHistoryView) => void;
}) {
  const { t, format } = useI18n();
  const unsafe =
    task.totals.warn +
    task.totals.danger +
    task.totals.unknown +
    task.totals.failed;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto rounded-2xl bg-card p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4 pr-10 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-[14px] font-semibold tracking-tight">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{
                background: task.safe ? "var(--ok)" : "var(--danger)",
              }}
            />
            {t("security.center.task.title")}
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              · {t("security.center.task.done")} ·{" "}
              <RelativeTime iso={task.finishedAt} />
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Cell
              icon={Clock}
              label={t("security.center.task.startTime")}
              value={format.formatDateTime(task.startedAt, false)}
            />
            <Cell
              icon={Boxes}
              label={t("security.center.task.coveredSkills")}
              value={`${task.totals.total} ${t("security.center.metrics.unit")}`}
            />
            <Cell
              icon={ShieldCheck}
              label={t("security.center.metrics.safe")}
              value={`${task.totals.safe} ${t("security.center.metrics.unit")}`}
              color="var(--ok)"
            />
            <Cell
              icon={ShieldX}
              label={t("security.center.metrics.unsafe")}
              value={`${unsafe} ${t("security.center.metrics.unit")}`}
              color={unsafe ? "var(--danger)" : undefined}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-surface-2 px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Layers className="size-3" strokeWidth={1.8} />
              {t("security.center.task.dimensions")} {dimensions}
            </span>
            <span>
              {t("security.center.task.scope")}：
              {task.scope === "all"
                ? t("security.center.history.scopeAll")
                : t("security.center.history.scopeSingle")}
            </span>
            <span>
              {t("security.center.task.taskId")}：{task.scanId}
            </span>
          </div>

          <div>
            <h4 className="text-[12.5px] font-semibold">
              {t("security.center.task.riskDetails", {
                count: task.findings.length,
              })}
            </h4>
            {task.findings.length === 0 ? (
              <p className="mt-2 rounded-lg bg-surface-2 px-3.5 py-4 text-center font-mono text-[12px] text-ok">
                {t("security.center.task.noFindings")}
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {task.findings.map((finding, index) => {
                  const source = task.entries.find(
                    (entry) => entry.id === finding.entryId,
                  );
                  const danger = finding.tone === "danger";
                  return (
                    <div
                      key={`${finding.entryId}-${index}`}
                      className="rounded-lg bg-surface-2 px-3.5 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full bg-card px-2 py-0.5 font-mono text-[10px] ${
                            danger ? "text-danger" : "text-amber-500"
                          }`}
                        >
                          {t("security.center.unsafe.vulnerable")}
                        </span>
                        <span className="text-[12.5px] font-medium">
                          {finding.skillName}
                        </span>
                        {source && (
                          <button
                            type="button"
                            onClick={() => onOpenReport(source)}
                            className="ml-auto inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 font-mono text-[10.5px] text-primary transition-opacity hover:opacity-85"
                          >
                            <FileText className="size-3" />
                            {t("security.center.task.openReport")}
                          </button>
                        )}
                      </div>
                      {finding.issue && (
                        <p className="mt-1.5 text-[12px] text-foreground/85">
                          {finding.issue}
                        </p>
                      )}
                      {finding.advice && (
                        <p className="mt-1 flex items-start gap-1.5 text-[12px] text-muted-foreground">
                          <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
                          {finding.advice}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Cell({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-lg bg-surface px-3.5 py-3">
      <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70 uppercase">
        <Icon className="size-3" strokeWidth={1.8} />
        <span className="truncate">{label}</span>
      </div>
      <div
        className="tt-num mt-1.5 font-mono text-[15px] leading-none font-bold"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
