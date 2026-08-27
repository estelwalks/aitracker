import { Link } from "@tanstack/react-router";
import { History, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../../../lib/i18n/context.tsx";
import { sourceLabel } from "../../../lib/local-usage/presentation.ts";
import type { SessionSummary } from "../contracts.ts";
import { getSessionsQuery } from "../query.ts";

interface SidebarItem {
  sessionId: string;
  title: string;
  source: string;
  /** ISO date key (`YYYY-MM-DD`) used for grouping. */
  dateKey: string;
  /** Localized date label (from the full timestamp, not the group key). */
  dateLabel: string;
  /** Localized start time label. */
  timeLabel: string;
  projectKey: string;
}

function projectItem(
  session: SessionSummary,
  format: ReturnType<typeof useI18n>["format"],
): SidebarItem {
  return {
    sessionId: session.sessionId,
    title: session.title,
    source: session.source,
    dateKey: session.startedAt.slice(0, 10),
    dateLabel: format.formatDate(session.startedAt),
    timeLabel: format.formatDateTime(session.startedAt, false),
    projectKey: session.projectKey,
  };
}

/**
 * Session-history sidebar (prototype ChatHistorySidebar). Metadata only —
 * title / source / date / project — never conversation content. Hidden below
 * the xl breakpoint; the data comes from the public sessions query facade.
 */
export function ChatHistorySidebar({
  activeId,
  source,
}: {
  activeId: string;
  source?: string;
}) {
  const { t, format } = useI18n();
  const [items, setItems] = useState<SidebarItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getSessionsQuery({
      data: {
        ...(source ? { filter: { source } } : {}),
        pageSize: 100,
        sort: { field: "startedAt", direction: "desc" },
      },
    })
      .then((page) => {
        if (cancelled) return;
        setItems(page.sessions.map((session) => projectItem(session, format)));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [format, source]);

  const groups = useMemo(() => {
    const keyword = q.trim().toLocaleLowerCase();
    const filtered = keyword
      ? items.filter(
          (item) =>
            item.title.toLocaleLowerCase().includes(keyword) ||
            item.projectKey.toLocaleLowerCase().includes(keyword) ||
            item.source.toLocaleLowerCase().includes(keyword),
        )
      : items;
    const map = new Map<string, SidebarItem[]>();
    for (const item of filtered) {
      const bucket = map.get(item.dateKey) ?? [];
      bucket.push(item);
      map.set(item.dateKey, bucket);
    }
    return Array.from(map.entries()).sort((left, right) =>
      left[0] < right[0] ? 1 : -1,
    );
  }, [items, q]);

  return (
    <aside className="hidden w-[248px] shrink-0 xl:block">
      <div className="sticky top-14 flex max-h-[calc(100vh-72px)] flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2.5 text-[12px] text-muted-foreground">
          <History className="size-3.5 text-primary" />
          <span className="text-foreground">
            {t("sessions.transcript.historyTitle")}
          </span>
          <span className="aitracker-num ml-auto">
            {format.formatNumber(items.length)}
          </span>
        </div>

        <div className="border-b border-border/60 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t("sessions.transcript.historySearch")}
              aria-label={t("sessions.transcript.historySearch")}
              className="h-8 w-full rounded-md border border-border bg-surface-2/70 pr-2 pl-7 text-[12px] outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
        </div>

        <div className="aitracker-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {failed ? (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              {t("sessions.transcript.historyUnavailable")}
            </p>
          ) : items.length === 0 && !failed ? (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              {t("sessions.transcript.historyLoading")}
            </p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              {t("sessions.transcript.historyEmpty")}
            </p>
          ) : (
            groups.map(([dateKey, group]) => (
              <div key={dateKey} className="mb-3 last:mb-0">
                <p className="aitracker-num px-1.5 pb-1 text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
                  {group[0]?.dateLabel ?? dateKey}
                </p>
                <div className="space-y-0.5">
                  {group.map((item) => {
                    const active = item.sessionId === activeId;
                    return (
                      <Link
                        key={item.sessionId}
                        to="/chats/$id"
                        params={{ id: item.sessionId }}
                        search={source ? { source } : {}}
                        title={item.title}
                        className={`flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors ${
                          active
                            ? "bg-surface-2 text-foreground"
                            : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] leading-tight">
                            {item.title || t("sessions.row.untitled")}
                          </span>
                          <span className="aitracker-num mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {item.timeLabel} · {item.projectKey}
                          </span>
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
