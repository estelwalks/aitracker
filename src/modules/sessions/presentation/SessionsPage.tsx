import { useNavigate } from "@tanstack/react-router";
import { MessagesSquare, Sparkles, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { InsightCard } from "../../insights/index.ts";
import {
  EmptyState,
  Pagination,
  SearchInput,
  Segmented,
} from "../../../components/tt.tsx";
import { BrandIcon, brandColorOf } from "../../../components/BrandIcon.tsx";
import { useI18n } from "../../../lib/i18n/context.tsx";
import { sourceLabel } from "../../../lib/local-usage/presentation.ts";
import { getSessionsQuery } from "../query.ts";
import type {
  SessionFilter,
  SessionPage,
  SessionStatus,
  SessionSummary,
} from "../contracts.ts";
import { ResumeSessionButton } from "./ResumeSessionButton.tsx";

const RANGE_OPTIONS: Array<{
  value: NonNullable<SessionFilter["range"]>;
  labelKey:
    | "common.all"
    | "sessions.range.d7"
    | "sessions.range.d30"
    | "sessions.range.d90";
}> = [
  { value: "7d", labelKey: "sessions.range.d7" },
  { value: "30d", labelKey: "sessions.range.d30" },
  { value: "90d", labelKey: "sessions.range.d90" },
  { value: "all", labelKey: "common.all" },
];

const STATUS_META: Record<
  SessionStatus,
  {
    labelKey:
      | "sessions.status.available"
      | "sessions.status.interrupted"
      | "sessions.status.lost"
      | "sessions.status.unavailable";
    className: string;
  }
> = {
  available: {
    labelKey: "sessions.status.available",
    className: "border-ok/30 bg-ok/10 text-ok",
  },
  interrupted: {
    labelKey: "sessions.status.interrupted",
    className: "border-warn/30 bg-warn/10 text-warn",
  },
  lost: {
    labelKey: "sessions.status.lost",
    className: "border-danger/30 bg-danger/10 text-danger",
  },
  unavailable: {
    labelKey: "sessions.status.unavailable",
    className: "border-border bg-surface-2 text-muted-foreground",
  },
};

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Local `YYYY-MM-DD` key so sessions group by the viewer's own day. */
function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Real local-session list. Filtering and pagination call the
 * server query facade; no prototype fixtures or client-generated records are
 * used here. Layout mirrors the V3.0 prototype: Jarvis hero, three
 * period-scoped stat cards, a filter rail, and date-grouped session rows.
 */
export function SessionsPage({ initial }: { initial: SessionPage }) {
  const { t, format } = useI18n();
  const [page, setPage] = useState(initial);
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState<string | "all">("all");
  const [range, setRange] =
    useState<NonNullable<SessionFilter["range"]>>("30d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const firstRequest = useRef(true);
  const pageSize = initial.pageSize || 25;

  useEffect(() => {
    const timer = window.setTimeout(() => setKeyword(keywordInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [keywordInput]);

  const filter = useMemo<SessionFilter>(
    () => ({
      ...(keyword ? { keyword } : {}),
      ...(source === "all" ? {} : { source }),
      ...(range === "all" ? {} : { range }),
    }),
    [keyword, range, source],
  );
  const request = useMemo(
    () => ({
      filter,
      page: page.page,
      pageSize,
      sort: { field: "startedAt" as const, direction: "desc" as const },
    }),
    [filter, page.page, pageSize],
  );

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    void getSessionsQuery({ data: request })
      .then((next) => {
        if (!cancelled) setPage(next);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  // 稳定的源列表：以初始（未过滤）页为准，只增不减——选中某个 agent 后
  // 其它 agent tab 不会被隐藏（agent 是切换/筛选，不是单选后隐藏其它）。
  const [initialSources] = useState(() => [
    ...new Set(
      initial.sources ?? initial.sessions.map((session) => session.source),
    ),
  ]);
  const sources = useMemo(
    () =>
      [
        ...new Set([...initialSources, ...page.sessions.map((s) => s.source)]),
      ].sort((a, b) => sourceLabel(a).localeCompare(sourceLabel(b))),
    [initialSources, page.sessions],
  );
  const totals = useMemo(
    () => ({
      turns: page.sessions.reduce((total, session) => total + session.turns, 0),
    }),
    [page.sessions],
  );

  /** Range label for the stat-card hint, matching the active time filter. */
  const rangeLabel = useMemo(() => {
    switch (range) {
      case "7d":
        return t("sessions.range.d7");
      case "30d":
        return t("sessions.range.d30");
      case "90d":
        return t("sessions.range.d90");
      default:
        return t("common.all");
    }
  }, [range, t]);

  const stats = useMemo(
    () => [
      {
        label: t("sessions.summary.count"),
        value: format.formatNumber(page.total),
        hint: t("sessions.summary.countHint", { range: rangeLabel }),
        icon: MessagesSquare,
      },
      {
        label: t("sessions.summary.tools"),
        value: format.formatNumber(sources.length),
        hint: t("sessions.summary.toolsHint"),
        icon: Wrench,
      },
      {
        label: t("sessions.summary.turns"),
        value: format.formatNumber(totals.turns),
        hint: t("sessions.summary.turnsHint"),
        icon: Sparkles,
      },
    ],
    [format, page.total, rangeLabel, sources.length, t, totals.turns],
  );

  /** Local-day groups, in page order (startedAt desc); counts are per page. */
  const groups = useMemo(() => {
    const todayKey = localDateKey(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayKey = localDateKey(yesterdayDate);
    const ordered: Array<{ dateKey: string; sessions: SessionSummary[] }> = [];
    const index = new Map<string, number>();
    for (const session of page.sessions) {
      const dateKey = localDateKey(new Date(session.startedAt));
      let slot = index.get(dateKey);
      if (slot === undefined) {
        slot = ordered.length;
        index.set(dateKey, slot);
        ordered.push({ dateKey, sessions: [] });
      }
      ordered[slot].sessions.push(session);
    }
    return ordered.map((group) => ({
      ...group,
      label: format.formatDate(group.sessions[0].startedAt, {
        weekday: "short",
      }),
      suffix:
        group.dateKey === todayKey
          ? t("sessions.group.today")
          : group.dateKey === yesterdayKey
            ? t("sessions.group.yesterday")
            : null,
    }));
  }, [format, page.sessions, t]);

  const changeFilter = (change: () => void) => {
    change();
    setPage((current) => ({ ...current, page: 1 }));
  };

  return (
    <div className="space-y-4 pb-12">
      <InsightCard
        surfaceId="chats"
        variant="hero"
        title={t("insights.title")}
        dotsLabel={t("insights.dots")}
      />

      {/* 周期口径卡片：会话数 / 工具数 / 轮次数（与原型一致的 3 卡条） */}
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/60 bg-card">
        {stats.map((card, index) => (
          <div
            key={card.label}
            className={`px-4 py-3.5 ${index > 0 ? "border-l border-border/60" : ""}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] tracking-[0.08em] text-foreground/75 uppercase">
                {card.label}
              </span>
              <card.icon
                className="size-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.8}
              />
            </div>
            <div className="tt-num tt-text-metric mt-2 font-mono leading-none font-black tracking-tight">
              {card.value}
            </div>
            <div className="mt-1.5 truncate text-[11px] text-muted-foreground/70">
              {card.hint}
            </div>
          </div>
        ))}
      </div>

      {/* 筛选栏：搜索 + 时间 + 工具 */}
      <section className="space-y-3">
        <div className="tt-panel flex flex-wrap items-center gap-2 p-2">
          <SearchInput
            value={keywordInput}
            onChange={(value) => changeFilter(() => setKeywordInput(value))}
            placeholder={t("sessions.searchPlaceholder")}
            ariaLabel={t("sessions.searchPlaceholder")}
            className="min-w-0 flex-1"
          />
          <Segmented
            value={range}
            onChange={(value) => changeFilter(() => setRange(value))}
            options={RANGE_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
          />
        </div>

        <div
          className="tt-xscroll flex items-center gap-2 overflow-x-auto px-1 pb-1"
          role="group"
          aria-label={t("sessions.summary.tools")}
        >
          {["all", ...sources].map((value) => {
            const active = source === value;
            const label =
              value === "all" ? t("sessions.source.all") : sourceLabel(value);
            const color =
              value === "all" ? "var(--color-primary)" : brandColorOf(label);

            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  changeFilter(() =>
                    setSource(value === source ? "all" : value),
                  )
                }
                className={`relative inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors ${
                  active ? "bg-surface-2" : "bg-card hover:bg-surface-2"
                }`}
                style={
                  active
                    ? {
                        background: `linear-gradient(180deg, color-mix(in oklab, ${color} 14%, transparent), transparent 72%), var(--color-surface-2)`,
                      }
                    : undefined
                }
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-x-2 bottom-0 h-0.5 origin-left rounded-full transition-transform duration-200 ${
                    active ? "scale-x-100" : "scale-x-0"
                  }`}
                  style={{ background: color }}
                />
                {value !== "all" ? (
                  <span
                    className="flex size-6 items-center justify-center rounded-md"
                    style={{ background: `${color}1f` }}
                  >
                    <BrandIcon
                      name={label}
                      className="size-3.5"
                      color={color}
                    />
                  </span>
                ) : null}
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 按本地日期分组的会话记录；分页保留，组内为当前页会话 */}
      <div className="min-w-0 space-y-5">
        {error ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium">{t("common.pageLoadFailed")}</p>
          </div>
        ) : page.sessions.length === 0 ? (
          <EmptyState
            title={t("sessions.empty.title")}
            desc={t("sessions.empty.desc")}
          />
        ) : (
          groups.map((group) => (
            <section key={group.dateKey}>
              <div className="mb-3 flex items-center gap-2 text-[12px] text-muted-foreground">
                <span className="text-[13px] font-semibold text-foreground">
                  {group.label}
                  {group.suffix ? ` · ${group.suffix}` : ""}
                </span>
                <span className="rounded-full bg-surface-2 px-2 py-px text-[10px]">
                  {t("sessions.group.count", {
                    count: format.formatNumber(group.sessions.length),
                  })}
                </span>
              </div>
              <ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card">
                {group.sessions.map((session) => (
                  <SessionRow
                    key={`${session.source}:${session.sessionId}:${session.startedAt}`}
                    session={session}
                    sourceFilter={source === "all" ? undefined : source}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {!error && page.total > 0 ? (
        <Pagination
          page={page.page}
          pageCount={page.totalPages}
          onChange={(next) =>
            setPage((current) => ({ ...current, page: next }))
          }
          prevLabel={t("sessions.pagination.previous")}
          nextLabel={t("sessions.pagination.next")}
          rangeLabel={t("sessions.pagination.summary", {
            page: format.formatNumber(page.page),
            totalPages: format.formatNumber(page.totalPages),
            total: format.formatNumber(page.total),
          })}
        />
      ) : null}
    </div>
  );
}

function SessionRow({
  session,
  sourceFilter,
}: {
  session: SessionSummary;
  sourceFilter?: string;
}) {
  const { t, format } = useI18n();
  const navigate = useNavigate();
  const status = STATUS_META[session.status];
  const detailAvailable = session.sessionId !== "unavailable";
  const openDetail = () => {
    if (!detailAvailable) return;
    void navigate({
      to: "/chats/$id",
      params: { id: session.sessionId },
      search: sourceFilter ? { source: sourceFilter } : {},
    });
  };

  return (
    <li
      className={`group flex items-center gap-x-4 px-4 py-3.5 transition-colors hover:bg-surface-2/60 ${
        detailAvailable
          ? "cursor-pointer focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
          : ""
      }`}
      role={detailAvailable ? "link" : undefined}
      tabIndex={detailAvailable ? 0 : undefined}
      aria-label={
        detailAvailable
          ? session.title || t("sessions.row.untitled")
          : undefined
      }
      onClick={(event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("a,button,input,select,textarea")
        ) {
          return;
        }
        openDetail();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openDetail();
      }}
    >
      {/* 左侧：来源/状态 + 标题 + 项目·时间·时长·轮次·Token 元数据 */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <BrandIcon
            name={sourceLabel(session.source)}
            className="size-3.5 shrink-0"
          />
          <span className="text-[11px] font-medium text-primary">
            {sourceLabel(session.source)}
          </span>
          <span
            title={session.statusReason ?? undefined}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${status.className}`}
          >
            {t(status.labelKey)}
          </span>
        </div>
        <p
          className={`mt-1 truncate text-[13px] font-medium text-foreground ${
            detailAvailable ? "transition-colors group-hover:text-primary" : ""
          }`}
        >
          {session.title || t("sessions.row.untitled")}
        </p>
        <div className="tt-num mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
          <span>{session.projectKey}</span>
          <span aria-hidden="true">·</span>
          <span>{format.formatTime(session.startedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatDuration(session.durationMs)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {t("sessions.row.turnsShort", {
              count: format.formatNumber(session.turns),
            })}
          </span>
          <span aria-hidden="true">·</span>
          <span>{format.formatTokens(session.totals.totalTokens)}</span>
          {session.model ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{session.model}</span>
            </>
          ) : null}
          {session.statusReason ? <span>{session.statusReason}</span> : null}
        </div>
      </div>
      {/* 右侧：恢复对话/命令行按钮 */}
      <div className="flex shrink-0 items-center gap-2">
        {session.resumeAvailable ? (
          <ResumeSessionButton session={session} />
        ) : null}
      </div>
    </li>
  );
}
