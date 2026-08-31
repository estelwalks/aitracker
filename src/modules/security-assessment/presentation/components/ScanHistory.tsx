import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Boxes,
  ChevronRight,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import { Pagination } from "../../../../components/aitracker";
import { STANDARD_PAGE_SIZE } from "../../../../lib/pagination";
import {
  aggregateScanTasks,
  detectedRiskCount,
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
 * The scan history is consistent with the prototype: the history line is only responsible for opening task details, Skill name and
 * The "Skill Scan Report" entrance is uniformly displayed in the task details pop-up window to avoid in-line expansion.
 * Different card heights and interaction levels than the prototype.
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
  const [page, setPage] = useState(1);
  const now = Date.now();
  const list = useMemo(
    () =>
      aggregateScanTasks(entries).filter((group) => {
        if (now - Date.parse(group.finishedAt) > timeSpans[span]) return false;
        if (state === "all") return true;
        if (state === "safe") return group.safe || group.unchanged;
        return detectedRiskCount(group.totals) > 0;
      }),
    [entries, now, span, state],
  );
  const pageCount = Math.max(1, Math.ceil(list.length / STANDARD_PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const pageRows = list.slice(
    (currentPage - 1) * STANDARD_PAGE_SIZE,
    currentPage * STANDARD_PAGE_SIZE,
  );
  const rangeStart =
    list.length === 0 ? 0 : (currentPage - 1) * STANDARD_PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * STANDARD_PAGE_SIZE, list.length);

  return (
    <SecurityCard
      title={t("security.center.history.title")}
      description={t("security.center.history.count", { count: list.length })}
      action={
        <ChipTabs
          value={span}
          onChange={(value) => {
            setSpan(value);
            setPage(1);
          }}
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
          onChange={(value) => {
            setState(value);
            setPage(1);
          }}
          options={[
            { value: "all", label: t("security.center.history.all") },
            { value: "safe", label: t("security.center.history.safe") },
            {
              value: "unsafe",
              label: t("security.center.history.unsafe"),
            },
          ]}
        />
      </div>

      {list.length === 0 ? (
        <p className="px-5 pb-10 text-center font-mono text-[12px] text-muted-foreground">
          {t("security.center.history.empty")}
        </p>
      ) : (
        <>
          <div className="border-t border-border/60">
            {pageRows.map((group) => {
              const totals = group.totals;
              const unsafe = detectedRiskCount(totals);
              const safe = group.safe;
              const unchanged = group.unchanged;
              const failed = group.status === "failed" && unsafe === 0;
              return (
                <div
                  key={group.scanId}
                  className="border-b border-border/40 last:border-b-0"
                >
                  <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 text-left transition-colors hover:bg-surface-2">
                    <span className="aitracker-num w-[104px] shrink-0 font-mono text-[11.5px] text-muted-foreground">
                      {format.formatDateTime(group.finishedAt, false)}
                    </span>
                    {group.scope === "all" ? (
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                        {t("security.center.history.scopeAll")}
                      </span>
                    ) : (
                      <Link
                        to="/skills"
                        search={{ skill: group.entries[0]?.skillName }}
                        className="min-w-0 flex-1 truncate text-[12.5px] font-medium transition-colors hover:text-primary hover:underline"
                      >
                        {t("security.center.history.scopeSingleNamed", {
                          name:
                            group.entries[0]?.skillName ??
                            t("security.center.history.scopeSingle"),
                        })}
                      </Link>
                    )}
                    <span className="hidden items-center gap-3 font-mono text-[10.5px] text-muted-foreground sm:flex">
                      <span className="inline-flex items-center gap-1">
                        <Boxes className="size-3" /> {totals.total}
                      </span>
                      <RelativeTime iso={group.finishedAt} />
                    </span>
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10.5px]"
                      style={{
                        color:
                          safe || unchanged
                            ? "var(--ok)"
                            : failed
                              ? "var(--warn)"
                              : "var(--danger)",
                      }}
                    >
                      {unchanged ? (
                        <RefreshCw className="size-3" />
                      ) : safe ? (
                        <ShieldCheck className="size-3" />
                      ) : failed ? (
                        <AlertTriangle className="size-3" />
                      ) : (
                        <ShieldX className="size-3" />
                      )}
                      {unchanged
                        ? t("security.center.history.safeReused", {
                            count: totals.skipped,
                          })
                        : safe
                          ? totals.skipped > 0
                            ? t("security.center.history.safeReused", {
                                count: totals.skipped,
                              })
                            : t("security.center.history.safe")
                          : failed
                            ? t("security.center.status.failed")
                            : `${t("security.center.history.unsafe")} · ${unsafe}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => onOpenTask?.(group)}
                      className="inline-flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-primary"
                    >
                      {t("security.center.task.viewDetails")}
                      <ChevronRight className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            onChange={setPage}
            rangeLabel={t("security.center.history.range", {
              start: format.formatNumber(rangeStart),
              end: format.formatNumber(rangeEnd),
              total: format.formatNumber(list.length),
            })}
          />
        </>
      )}
    </SecurityCard>
  );
}
