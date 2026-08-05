import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, Terminal } from "lucide-react";
import { toast } from "sonner";

import { Dot, EmptyState, PageHeader, Panel, TTButton } from "../components/tt";
import { useI18n } from "../lib/i18n/context";
import { catalogs, getMessage, type MessageKey } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { toUiError } from "../lib/errors";
import { formatCostLabel } from "../lib/pricing/cost-label";
import {
  getLocalSessions,
  refreshLocalSessions,
} from "../lib/local-sessions/server-fns";
import type {
  SessionFilter,
  SessionRecord,
  SessionSource,
  SessionStatus,
  SessionSummary,
} from "../lib/local-sessions/types";

export const Route = createFileRoute("/sessions")({
  loader: ({ location }) =>
    getLocalSessions({ data: {} }).then((data) => ({
      ...data,
      locale: resolveLocaleFromSearch(location.search),
    })),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.sessions",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "sessions.metaDescription",
        ),
      },
    ],
  }),
  component: SessionsPage,
});

const SOURCE_META: Record<
  SessionSource,
  { label: string; dot: string; color: string }
> = {
  "claude-code": { label: "Claude Code", dot: "bg-ok", color: "text-ok" },
  codex: { label: "Codex", dot: "bg-sky-500", color: "text-sky-500" },
  grok: { label: "Grok", dot: "bg-violet-500", color: "text-violet-500" },
};

const RANGE_OPTIONS: Array<{
  key: SessionFilter["range"];
  labelKey: MessageKey;
}> = [
  { key: "all", labelKey: "common.all" },
  { key: "7d", labelKey: "sessions.range.d7" },
  { key: "30d", labelKey: "sessions.range.d30" },
  { key: "90d", labelKey: "sessions.range.d90" },
];

const STATUS_OPTIONS: Array<{
  key: SessionStatus | "all";
  labelKey: MessageKey;
}> = [
  { key: "all", labelKey: "sessions.status.all" },
  { key: "available", labelKey: "sessions.status.available" },
  { key: "interrupted", labelKey: "sessions.status.interrupted" },
  { key: "lost", labelKey: "sessions.status.lost" },
  { key: "unavailable", labelKey: "sessions.status.unavailable" },
];

const STATUS_META: Record<
  SessionStatus,
  { labelKey: MessageKey; className: string }
> = {
  available: {
    labelKey: "sessions.status.available",
    className: "border-ok/30 bg-ok/10 text-ok",
  },
  interrupted: {
    labelKey: "sessions.status.interrupted",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  },
  lost: {
    labelKey: "sessions.status.lost",
    className: "border-rose-500/30 bg-rose-500/10 text-rose-600",
  },
  unavailable: {
    labelKey: "sessions.status.unavailable",
    className: "border-border bg-muted text-muted-foreground",
  },
};

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${rest}m`;
}

function SessionsPage() {
  const { t, format } = useI18n();
  const [summary, setSummary] = useState<SessionSummary>(Route.useLoaderData());
  const [refreshing, setRefreshing] = useState(false);

  // Filter state (applied server-side via the filter param).
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState<SessionSource | "all">("all");
  const [status, setStatus] = useState<SessionStatus | "all">("all");
  const [projectId, setProjectId] = useState<string>("all");
  const [range, setRange] = useState<SessionFilter["range"]>("all");

  const filter: SessionFilter = {
    keyword: keyword.trim() || undefined,
    source: source === "all" ? undefined : source,
    status: status === "all" ? undefined : status,
    projectId: projectId === "all" ? undefined : projectId,
    range,
  };

  // Debounced/server-applied filter: refetch whenever a non-keyword filter
  // changes; keyword is debounced to avoid a request per keystroke.
  const [appliedFilter, setAppliedFilter] = useState<SessionFilter>(filter);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setAppliedFilter((prev) => {
        if (
          prev.keyword === filter.keyword &&
          prev.source === filter.source &&
          prev.status === filter.status &&
          prev.projectId === filter.projectId &&
          prev.range === filter.range
        ) {
          return prev;
        }
        return { ...filter };
      });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, source, status, projectId, range]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getLocalSessions({ data: appliedFilter });
        if (!cancelled) setSummary(next);
      } catch {
        /* keep previous data on filter failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appliedFilter]);

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const session of summary.sessions) {
      if (session.projectKey) set.add(session.projectKey);
    }
    return [...set].sort();
  }, [summary.sessions]);

  const totals = useMemo(() => {
    let tokens = 0;
    let turns = 0;
    let knownUsd = 0;
    let cacheSavingsUsd = 0;
    let pricedEvents = 0;
    let unknownEvents = 0;
    const unknownModels = new Set<string>();
    for (const session of summary.sessions) {
      tokens += session.totals.totalTokens;
      turns += session.turns;
      knownUsd += session.cost.knownUsd;
      cacheSavingsUsd += session.cost.cacheSavingsUsd;
      pricedEvents += session.cost.pricedEvents;
      unknownEvents += session.cost.unknownEvents;
      for (const model of session.cost.unknownModels) unknownModels.add(model);
    }
    return {
      count: summary.sessions.length,
      tokens,
      turns,
      cost: {
        knownUsd,
        cacheSavingsUsd,
        pricedEvents,
        unknownEvents,
        unknownModels: [...unknownModels].sort(),
        complete: unknownEvents === 0,
      },
    };
  }, [summary.sessions]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const next = await refreshLocalSessions({ data: appliedFilter });
      setSummary(next);
      toast.success(t("sessions.toast.refreshed"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={t("sessions.pageHeader")}
          desc={t("sessions.pageHeaderDesc")}
        />
        <TTButton onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? t("sessions.refreshing") : t("common.refresh")}
        </TTButton>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCard
          label={t("sessions.summary.count")}
          value={format.formatNumber(totals.count)}
        />
        <SummaryCard
          label={t("sessions.summary.tokens")}
          value={format.formatTokens(totals.tokens)}
        />
        <SummaryCard
          label={t("sessions.summary.cost")}
          value={formatCostLabel(t, format, totals.cost)}
        />
        <SummaryCard
          label={t("sessions.summary.turns")}
          value={format.formatNumber(totals.turns)}
        />
      </div>

      <Panel className="mt-3" title={t("sessions.panelTitle")}>
        <p className="mb-3 text-[11px] text-muted-foreground">
          {t("sessions.hint")}
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("sessions.searchPlaceholder")}
              className="tt-input h-8 w-56 pl-8 text-[13px]"
            />
          </div>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="tt-input h-8 text-[13px]"
          >
            <option value="all">{t("sessions.project.all")}</option>
            {projectOptions.map((project) => (
              <option key={project} value={project}>
                {project}
              </option>
            ))}
          </select>
          <select
            value={range}
            onChange={(event) =>
              setRange(event.target.value as SessionFilter["range"])
            }
            className="tt-input h-8 text-[13px]"
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.key ?? "all"} value={option.key ?? "all"}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
          <select
            value={source}
            onChange={(event) =>
              setSource(event.target.value as SessionSource | "all")
            }
            className="tt-input h-8 text-[13px]"
          >
            <option value="all">{t("sessions.source.all")}</option>
            <option value="claude-code">Claude Code</option>
            <option value="codex">Codex</option>
            <option value="grok">Grok</option>
          </select>
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as SessionStatus | "all")
            }
            className="tt-input h-8 text-[13px]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>

        {summary.sessions.length === 0 ? (
          <EmptyState
            title={t("sessions.empty.title")}
            desc={t("sessions.empty.desc")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {summary.sessions.map((session) => (
              <SessionRow
                key={`${session.source}:${session.sessionId}`}
                session={session}
              />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-sm border border-border bg-surface p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tt-num mt-1 text-lg font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

function SessionRow({ session }: { session: SessionRecord }) {
  const { t, format } = useI18n();
  const [copied, setCopied] = useState(false);
  const meta = SOURCE_META[session.source];
  const statusMeta = STATUS_META[session.status];
  const fullCommand =
    session.resumeSafe && session.resumeCommand
      ? `cd ${session.projectRef} && ${session.resumeCommand}`
      : null;

  async function handleCopy() {
    if (!fullCommand) return;
    try {
      await navigator.clipboard.writeText(fullCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_600);
      toast.success(t("sessions.toast.copied"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 py-3 text-[13px]">
      <div className="flex w-full items-center gap-2">
        <Dot className={meta.dot} />
        <span className={`text-[12px] font-medium ${meta.color}`}>
          {meta.label}
        </span>
        <span className="truncate font-medium text-foreground">
          {session.title || t("sessions.row.untitled")}
        </span>
        <span
          title={session.statusReason ?? undefined}
          className={`rounded-full border px-1.5 py-0.5 text-[10px] ${statusMeta.className}`}
        >
          {t(statusMeta.labelKey)}
        </span>
        <span className="ml-auto">
          <TTButton
            size="sm"
            onClick={handleCopy}
            disabled={!session.resumeSafe}
            title={
              session.resumeSafe
                ? t("sessions.row.copy")
                : t("sessions.row.copyUnsafe")
            }
          >
            <Terminal className="size-3.5" />
            {copied ? t("sessions.row.copied") : t("sessions.row.copy")}
          </TTButton>
        </span>
      </div>

      <div className="flex w-full flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {t("sessions.row.project")}{" "}
          <span className="text-foreground/80">{session.projectKey}</span>
        </span>
        {session.model && (
          <span>
            {t("sessions.row.model")}{" "}
            <span className="text-foreground/80">{session.model}</span>
          </span>
        )}
        <span>
          {t("sessions.row.time")}{" "}
          <span className="tt-num text-foreground/80">
            {format.formatDateTime(session.startedAt, false)}
          </span>
        </span>
        <span>
          {t("sessions.row.duration")}{" "}
          <span className="tt-num text-foreground/80">
            {formatDuration(session.durationMs)}
          </span>
        </span>
        <span>
          Token{" "}
          <span className="tt-num text-foreground/80">
            {format.formatTokens(session.totals.totalTokens)}
          </span>
        </span>
        <span>
          {t("sessions.row.cost")}{" "}
          <span className="tt-num text-foreground/80">
            {formatCostLabel(t, format, session.cost)}
          </span>
        </span>
        <span>
          {t("sessions.row.turns")}{" "}
          <span className="tt-num text-foreground/80">
            {format.formatNumber(session.turns)}
          </span>
        </span>
        <span>
          {t("sessions.row.edits")}{" "}
          <span className="tt-num text-foreground/80">
            {format.formatNumber(session.editTurns)}
          </span>
        </span>
      </div>

      {session.resumeSafe && (
        <div className="w-full text-[10px] text-muted-foreground/70">
          {t("sessions.row.resumeDirHint")}
          <span className="tt-num">{session.projectRef}</span>
        </div>
      )}
      {session.statusReason != null && (
        <div className="w-full text-[10px] text-muted-foreground/70">
          {t("sessions.row.statusReason")} {session.statusReason}
        </div>
      )}
    </li>
  );
}
