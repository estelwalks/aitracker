import { useMemo, useState } from "react";
import { Boxes, ChevronDown, ShieldCheck, ShieldX } from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import {
  securityHistoryEntryIsSafe,
  summarizeReports,
  type SecurityHistoryView,
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

interface HistoryGroup {
  scanId: string;
  finishedAt: string;
  mode: SecurityHistoryView["mode"];
  trigger: SecurityHistoryView["trigger"];
  entries: SecurityHistoryView[];
}

const historyStatusKeys: Record<SecurityHistoryView["status"], MessageKey> = {
  complete: "security.center.result.statusComplete",
  partial: "security.center.result.statusPartial",
  failed: "security.center.result.statusFailed",
  skipped: "security.center.result.statusSkipped",
  cancelled: "security.center.result.statusCancelled",
};

function groupsOf(entries: readonly SecurityHistoryView[]): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  for (const entry of entries) {
    const current = groups.get(entry.scanId);
    if (current) {
      current.entries.push(entry);
      if (Date.parse(entry.finishedAt) > Date.parse(current.finishedAt))
        current.finishedAt = entry.finishedAt;
    } else {
      groups.set(entry.scanId, {
        scanId: entry.scanId,
        finishedAt: entry.finishedAt,
        mode: entry.mode,
        trigger: entry.trigger,
        entries: [entry],
      });
    }
  }
  return [...groups.values()].sort(
    (left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt),
  );
}

export function ScanHistory({
  entries,
}: {
  entries: readonly SecurityHistoryView[];
}) {
  const { t, format } = useI18n();
  const [state, setState] = useState<StateFilter>("all");
  const [span, setSpan] = useState<TimeFilter>("7d");
  const [open, setOpen] = useState<string | null>(null);
  const now = Date.now();
  const list = useMemo(
    () =>
      groupsOf(entries).filter((group) => {
        if (now - Date.parse(group.finishedAt) > timeSpans[span]) return false;
        const totals = summarizeReports(group.entries);
        const safe =
          group.entries.length > 0 &&
          group.entries.every(securityHistoryEntryIsSafe);
        return state === "all" || (state === "safe" ? safe : !safe);
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
            const totals = summarizeReports(group.entries);
            const safe =
              group.entries.length > 0 &&
              group.entries.every(securityHistoryEntryIsSafe);
            const expanded = open === group.scanId;
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
                        <span className="font-mono text-muted-foreground">
                          {entry.mode}
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
