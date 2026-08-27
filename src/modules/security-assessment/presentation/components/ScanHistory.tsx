import { useMemo, useState } from "react";
import {
  Boxes,
  ChevronRight,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import {
  aggregateScanTasks,
  detectedRiskCount,
  unresolvedScanCount,
  type SecurityHistoryView,
  type SecurityScanTaskView,
} from "../security-view";
import { ChipTabs, SecurityCard } from "./SecurityCard";
import { RelativeTime } from "./RelativeTime";

type StateFilter = "all" | "safe" | "unsafe";
type TimeFilter = "24h" | "7d" | "30d" | "all";

const timeSpans: Record<TimeFilter, number> = {
  "24h": 24 * 3_600_000,
  "7d": 7 * 24 * 3_600_000,
  "30d": 30 * 24 * 3_600_000,
  all: Number.POSITIVE_INFINITY,
};

/**
 * 扫描历史与原型保持一致：历史行只负责打开任务详情，Skill 名称和
 * 「Skill 扫描报告」入口统一在任务详情弹窗中展示，避免行内展开造成
 * 与原型不同的卡片高度和交互层级。
 */
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
            {
              value: "unsafe",
              label: t("security.center.history.needsReview"),
            },
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
            const unsafe = detectedRiskCount(totals);
            const unresolved = unresolvedScanCount(totals);
            const safe = group.safe;
            return (
              <div
                key={group.scanId}
                className="border-b border-border/40 last:border-b-0"
              >
                <button
                  type="button"
                  onClick={() => onOpenTask?.(group)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="aitracker-num w-[104px] shrink-0 font-mono text-[11.5px] text-muted-foreground">
                    {format.formatDateTime(group.finishedAt, false)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {group.scope === "all"
                      ? t("security.center.history.scopeAll")
                      : t("security.center.history.scopeSingle")}
                  </span>
                  <span className="hidden items-center gap-3 font-mono text-[10.5px] text-muted-foreground sm:flex">
                    <span className="inline-flex items-center gap-1">
                      <Boxes className="size-3" /> {totals.total}
                    </span>
                    <RelativeTime iso={group.finishedAt} />
                  </span>
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px]"
                    style={{
                      color: safe
                        ? "var(--ok)"
                        : unsafe > 0
                          ? "var(--danger)"
                          : "var(--warn)",
                    }}
                  >
                    {safe ? (
                      <ShieldCheck className="size-3" />
                    ) : unsafe > 0 ? (
                      <ShieldX className="size-3" />
                    ) : (
                      <TriangleAlert className="size-3" />
                    )}
                    {safe
                      ? t("security.center.history.safe")
                      : unsafe > 0
                        ? `${t("security.center.history.unsafe")} · ${unsafe}`
                        : `${t("security.center.history.needsReview")} · ${unresolved}`}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-primary">
                    {t("security.center.task.viewDetails")}
                    <ChevronRight className="size-3.5" />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </SecurityCard>
  );
}
