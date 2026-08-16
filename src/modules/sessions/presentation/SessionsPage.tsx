import { Link } from "@tanstack/react-router";
import { ChevronRight, RefreshCw, Search, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Card,
  ChipTabs,
  EmptyState,
  MetricGrid,
  PageBar,
  TTButton,
} from "../../../components/tt.tsx";
import { toUiError } from "../../../lib/errors.ts";
import { useI18n } from "../../../lib/i18n/context.tsx";
import { sourceLabel } from "../../../lib/local-usage/presentation.ts";
import { formatCostLabel } from "../../../lib/pricing/cost-label.ts";
import { refreshSessionsQuery, getSessionsQuery } from "../query.ts";
import type {
  SessionCostSummary,
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
  { value: "all", labelKey: "common.all" },
  { value: "7d", labelKey: "sessions.range.d7" },
  { value: "30d", labelKey: "sessions.range.d30" },
  { value: "90d", labelKey: "sessions.range.d90" },
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

function aggregateCost(
  sessions: readonly SessionSummary[],
): SessionCostSummary {
  return sessions.reduce<SessionCostSummary>(
    (total, session) => ({
      knownUsd: total.knownUsd + session.cost.knownUsd,
      estimatedUsd: total.estimatedUsd + session.cost.estimatedUsd,
      cacheSavingsUsd: total.cacheSavingsUsd + session.cost.cacheSavingsUsd,
      pricedEvents: total.pricedEvents + session.cost.pricedEvents,
      estimatedEvents: total.estimatedEvents + session.cost.estimatedEvents,
      unknownEvents: total.unknownEvents + session.cost.unknownEvents,
      unknownModels: [
        ...new Set([...total.unknownModels, ...session.cost.unknownModels]),
      ],
      complete: total.complete && session.cost.complete,
    }),
    {
      knownUsd: 0,
      estimatedUsd: 0,
      cacheSavingsUsd: 0,
      pricedEvents: 0,
      estimatedEvents: 0,
      unknownEvents: 0,
      unknownModels: [],
      complete: true,
    },
  );
}

/**
 * Real local-session list. Filtering, pagination and refresh all call the
 * server query facade; no prototype fixtures or client-generated records are
 * used here.
 */
export function SessionsPage({ initial }: { initial: SessionPage }) {
  const { t, format } = useI18n();
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
  const totals = useMemo(() => {
    const sessions = page.sessions;
    return {
      tokens: sessions.reduce(
        (total, session) => total + session.totals.totalTokens,
        0,
      ),
      turns: sessions.reduce((total, session) => total + session.turns, 0),
      cost: aggregateCost(sessions),
    };
  }, [page.sessions]);

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
      <PageBar
        title={t("sessions.pageHeader")}
        summary={`${t("sessions.summary.count")} ${format.formatNumber(page.total)} · ${t("common.lastUpdatedAt", { time: format.formatDateTime(page.generatedAt, false) })}`}
      >
        <TTButton
          onClick={refresh}
          disabled={loading}
          title={t("common.refresh")}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? t("sessions.refreshing") : t("common.refresh")}
        </TTButton>
      </PageBar>

      <p className="text-[13px] text-muted-foreground">
        {t("sessions.pageHeaderDesc")}
      </p>

      <MetricGrid
        items={[
          {
            label: t("sessions.summary.count"),
            v: format.formatNumber(page.total),
            sub: t("sessions.panelTitle"),
          },
          {
            label: t("sessions.summary.tokens"),
            v: format.formatTokens(totals.tokens),
            sub: t("sessions.row.time"),
          },
          {
            label: t("sessions.summary.cost"),
            v: formatCostLabel(t, format, totals.cost),
            sub: t("sessions.hint"),
          },
          {
            label: t("sessions.summary.turns"),
            v: format.formatNumber(totals.turns),
            sub: t("sessions.row.turns"),
          },
        ]}
      />

      <Card title={t("sessions.panelTitle")} desc={t("sessions.hint")}>
        <div className="border-b border-border/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-52 flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={keywordInput}
                onChange={(event) =>
                  changeFilter(() => setKeywordInput(event.target.value))
                }
                placeholder={t("sessions.searchPlaceholder")}
                aria-label={t("sessions.searchPlaceholder")}
                className="h-9 w-full rounded-lg bg-surface-2/70 pr-3 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
              />
            </label>
            <select
              value={projectId}
              onChange={(event) =>
                changeFilter(() => setProjectId(event.target.value))
              }
              aria-label={t("sessions.project.all")}
              className="h-9 max-w-52 rounded-lg bg-surface-2/70 px-2.5 text-[12px] outline-none focus:ring-2 focus:ring-primary/30"
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
              className="h-9 rounded-lg bg-surface-2/70 px-2.5 text-[12px] outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="all">{t("sessions.status.all")}</option>
              {Object.entries(STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {t(meta.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ChipTabs
              value={range}
              onChange={(value) => changeFilter(() => setRange(value))}
              options={RANGE_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
            />
            <span className="h-5 w-px bg-border" />
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
        </div>

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
          <ul className="divide-y divide-border/60">
            {page.sessions.map((session) => (
              <SessionRow
                key={`${session.source}:${session.sessionId}:${session.startedAt}`}
                session={session}
              />
            ))}
          </ul>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
          <span className="tt-num text-[11px] text-muted-foreground">
            {t("sessions.pagination.summary", {
              page: format.formatNumber(page.page),
              totalPages: format.formatNumber(page.totalPages),
              total: format.formatNumber(page.total),
            })}
          </span>
          <div className="flex items-center gap-2">
            <TTButton
              size="sm"
              disabled={loading || page.page <= 1}
              onClick={() =>
                setPage((current) => ({ ...current, page: current.page - 1 }))
              }
            >
              {t("sessions.pagination.previous")}
            </TTButton>
            <TTButton
              size="sm"
              disabled={loading || page.page >= page.totalPages}
              onClick={() =>
                setPage((current) => ({ ...current, page: current.page + 1 }))
              }
            >
              {t("sessions.pagination.next")}
            </TTButton>
          </div>
        </footer>
      </Card>
    </div>
  );
}

function SessionRow({ session }: { session: SessionSummary }) {
  const { t, format } = useI18n();
  const status = STATUS_META[session.status];
  const detailAvailable = session.sessionId !== "unavailable";
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
