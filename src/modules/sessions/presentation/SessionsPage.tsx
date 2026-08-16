import { Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  ChevronRight,
  Hash,
  MessagesSquare,
  RefreshCw,
  Sparkles,
  Terminal,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  DistillButton,
  notifyDistillStarted,
} from "../../../components/DistillButton.tsx";
import { JarvisInsight } from "../../../components/JarvisInsight.tsx";
import {
  ChipTabs,
  EmptyState,
  Pagination,
  SearchInput,
  Segmented,
  TTButton,
} from "../../../components/tt.tsx";
import { toUiError } from "../../../lib/errors.ts";
import { useI18n } from "../../../lib/i18n/context.tsx";
import { sourceLabel } from "../../../lib/local-usage/presentation.ts";
import { formatCostLabel } from "../../../lib/pricing/cost-label.ts";
import { refreshSessionsQuery, getSessionsQuery } from "../query.ts";
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
 * Real local-session list. Filtering, pagination and refresh all call the
 * server query facade; no prototype fixtures or client-generated records are
 * used here. Layout mirrors the V3.0 prototype: Jarvis hero, three
 * period-scoped stat cards, a filter rail, and date-grouped session rows.
 */
export function SessionsPage({ initial }: { initial: SessionPage }) {
  const { t, format } = useI18n();
  const navigate = useNavigate();
  const [page, setPage] = useState(initial);
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState<string | "all">("all");
  const [projectId, setProjectId] = useState("all");
  const [status, setStatus] = useState<SessionStatus | "all">("all");
  const [range, setRange] =
    useState<NonNullable<SessionFilter["range"]>>("all");
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
      ...(projectId === "all" ? {} : { projectId }),
      ...(status === "all" ? {} : { status }),
      ...(range === "all" ? {} : { range }),
    }),
    [keyword, projectId, range, source, status],
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

  const sources = useMemo(
    () =>
      [...new Set(page.sessions.map((session) => session.source))].sort(
        (a, b) => sourceLabel(a).localeCompare(sourceLabel(b)),
      ),
    [page.sessions],
  );
  const projects = useMemo(
    () =>
      [...new Set(page.sessions.map((session) => session.projectKey))].sort(),
    [page.sessions],
  );
  const totals = useMemo(
    () => ({
      turns: page.sessions.reduce((total, session) => total + session.turns, 0),
    }),
    [page.sessions],
  );

  /**
   * Real-data insight lines for the Jarvis hero (no fabricated figures):
   * total comes from the server page counter, the rest aggregate the visible
   * page's sessions. Rotated by the shared card; hidden when empty.
   */
  const insightLines = useMemo(() => {
    if (page.total === 0) return [];
    const sessions = page.sessions;
    const toolCount = new Set(sessions.map((session) => session.source)).size;
    const turnCount = sessions.reduce(
      (total, session) => total + session.turns,
      0,
    );
    const resumable = sessions.filter(
      (session) => session.resumeAvailable,
    ).length;
    return [
      t("sessions.insight.total", { count: page.total }),
      t("sessions.insight.sources", { count: toolCount }),
      t("sessions.insight.turns", { count: turnCount }),
      t("sessions.insight.resumable", { count: resumable }),
    ].filter((line) => line.length > 0);
  }, [page.sessions, page.total, t]);

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

  async function refresh() {
    if (loading) return;
    setLoading(true);
    setError(false);
    try {
      const next = await refreshSessionsQuery({ data: request });
      setPage(next);
      toast.success(t("sessions.toast.refreshed"));
    } catch (caught) {
      setError(true);
      const ui = toUiError(caught);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 pb-12">
      <JarvisInsight
        title={t("insights.title")}
        lines={insightLines}
        rotateLabel={t("insights.rotate")}
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
              <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70 uppercase">
                {card.label}
              </span>
              <card.icon
                className="size-3.5 shrink-0 text-muted-foreground"
                strokeWidth={1.8}
              />
            </div>
            <div className="tt-num mt-2 font-mono text-[22px] leading-none font-black tracking-tight">
              {card.value}
            </div>
            <div className="mt-1.5 truncate text-[11px] text-muted-foreground/80">
              {card.hint}
            </div>
          </div>
        ))}
      </div>

      {/* 筛选栏：搜索 + 时间 + 项目/状态 + 刷新 + 蒸馏（刷新与批量蒸馏在右侧） */}
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
          <select
            value={projectId}
            onChange={(event) =>
              changeFilter(() => setProjectId(event.target.value))
            }
            aria-label={t("sessions.project.all")}
            className="h-[28px] shrink-0 rounded-full bg-surface-2/70 px-3 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">{t("sessions.project.all")}</option>
            {projects.map((project) => (
              <option key={project} value={project}>
                {project}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) =>
              changeFilter(() =>
                setStatus(event.target.value as SessionStatus | "all"),
              )
            }
            aria-label={t("sessions.status.all")}
            className="h-[28px] shrink-0 rounded-full bg-surface-2/70 px-3 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">{t("sessions.status.all")}</option>
            {Object.entries(STATUS_META).map(([value, meta]) => (
              <option key={value} value={value}>
                {t(meta.labelKey)}
              </option>
            ))}
          </select>
          <TTButton
            size="sm"
            onClick={refresh}
            disabled={loading}
            title={t("common.refresh")}
            className="ml-auto"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
            <span className="sr-only">{t("common.refresh")}</span>
          </TTButton>
          <DistillButton
            size="md"
            count={page.total}
            onClick={() =>
              notifyDistillStarted({
                sessions: page.total,
                minutes: Math.max(
                  1,
                  Math.round((60_000 + page.total * 20_000) / 60_000),
                ),
                t,
                onGo: () => void navigate({ to: "/distill" }),
              })
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-1">
          <ChipTabs
            value={source}
            onChange={(value) => changeFilter(() => setSource(value))}
            options={[
              { value: "all", label: t("sessions.source.all") },
              ...sources.map((value) => ({
                value,
                label: sourceLabel(value),
              })),
            ]}
          />
        </div>
      </section>

      {/* 按本地日期分组的会话记录；分页保留，组内为当前页会话 */}
      <div className="min-w-0 space-y-5">
        {error ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium">{t("common.pageLoadFailed")}</p>
            <TTButton className="mt-3" onClick={refresh}>
              {t("common.retry")}
            </TTButton>
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

function SessionRow({ session }: { session: SessionSummary }) {
  const { t, format } = useI18n();
  const navigate = useNavigate();
  const status = STATUS_META[session.status];
  const detailAvailable = session.sessionId !== "unavailable";
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  /** Copies the privacy-safe opaque session id; commands/paths never leave the server. */
  async function copyHash() {
    try {
      if (navigator.clipboard?.writeText == null) throw new Error("no-clip");
      await navigator.clipboard.writeText(session.sessionId);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
      toast.success(t("sessions.toast.hashCopied"));
    } catch {
      toast.error(t("common.error"));
    }
  }

  return (
    <li className="group flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-colors hover:bg-surface-2/60">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Terminal className="size-3.5 shrink-0 text-primary" />
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
        <p className="mt-1 truncate text-[13px] font-medium text-foreground">
          {session.title || t("sessions.row.untitled")}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
          <span>{session.projectKey}</span>
          {session.model ? <span>{session.model}</span> : null}
          <span>{format.formatDateTime(session.startedAt, false)}</span>
          <span>{formatDuration(session.durationMs)}</span>
          {session.statusReason ? <span>{session.statusReason}</span> : null}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-x-4 text-right sm:gap-x-6">
        <Metric
          value={format.formatTokens(session.totals.totalTokens)}
          label="Token"
        />
        <Metric
          value={formatCostLabel(t, format, session.cost)}
          label={t("sessions.row.cost")}
        />
        <Metric
          value={format.formatNumber(session.turns)}
          label={t("sessions.row.turns")}
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ResumeSessionButton session={session} />
        {detailAvailable ? (
          <button
            type="button"
            onClick={copyHash}
            title={session.sessionId}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-mono text-[11px] transition-colors ${
              copied
                ? "text-primary"
                : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Hash className="size-3.5" />
            )}
            {copied ? t("sessions.row.copiedHash") : t("sessions.row.copyHash")}
          </button>
        ) : null}
        <DistillButton
          size="sm"
          count={1}
          onClick={() =>
            notifyDistillStarted({
              sessions: 1,
              minutes: 1,
              t,
              onGo: () => void navigate({ to: "/distill" }),
            })
          }
        />
        {detailAvailable ? (
          <Link
            to="/chats/$id"
            params={{ id: session.sessionId }}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            {t("sessions.action.open")}
            <ChevronRight className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-12">
      <div className="tt-num max-w-24 truncate text-[12px] font-semibold text-foreground">
        {value}
      </div>
      <div className="font-mono text-[9px] text-muted-foreground">{label}</div>
    </div>
  );
}
