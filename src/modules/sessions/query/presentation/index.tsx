import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import {
  Dot,
  EmptyState,
  PageHeader,
  Panel,
  TTButton,
} from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import { toUiError } from "../../../../lib/errors";
import { formatCostLabel } from "../../../../lib/pricing/cost-label";
import type { MessageKey } from "../../../../lib/i18n/messages";
import { refreshSessionsQuery } from "../api.server";
import type {
  SessionFilter,
  SessionPage,
  SessionSummary,
  SessionSource,
  SessionStatus,
} from "../../contracts";
export { getSessionsQuery } from "../api.server";

const SOURCE_META: Record<
  string,
  { label: string; dot: string; color: string }
> = {
  "claude-code": { label: "Claude Code", dot: "bg-ok", color: "text-ok" },
  codex: { label: "Codex", dot: "bg-sky-500", color: "text-sky-500" },
  grok: { label: "Grok", dot: "bg-violet-500", color: "text-violet-500" },
};
const RANGE_OPTIONS: Array<{
  key: NonNullable<SessionFilter["range"]>;
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

function formatDuration(ms: number) {
  if (ms <= 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function SessionsPage({ initial }: { initial: SessionPage }) {
  const { t, format } = useI18n();
  const [summary, setSummary] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [source, setSource] = useState<SessionSource | "all">("all");
  const [status, setStatus] = useState<SessionStatus | "all">("all");
  const [projectId, setProjectId] = useState("all");
  const [range, setRange] =
    useState<NonNullable<SessionFilter["range"]>>("all");
  const filter: SessionFilter = {
    keyword: keyword.trim() || undefined,
    source: source === "all" ? undefined : source,
    status: status === "all" ? undefined : status,
    projectId: projectId === "all" ? undefined : projectId,
    range,
  };
  const [appliedFilter, setAppliedFilter] = useState(filter);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => setAppliedFilter({ ...filter }),
      250,
    );
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [keyword, source, status, projectId, range]);
  useEffect(() => {
    let cancelled = false;
    void getSessionsQuerySafe(appliedFilter)
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch(() => {
        /* Keep the previous snapshot when a filter read fails. */
      });
    return () => {
      cancelled = true;
    };
  }, [appliedFilter]);
  const projectOptions = useMemo(
    () =>
      [
        ...new Set(
          summary.sessions.map((session) => session.projectKey).filter(Boolean),
        ),
      ].sort(),
    [summary.sessions],
  );
  const totals = useMemo(
    () =>
      summary.sessions.reduce(
        (total, session) => ({
          tokens: total.tokens + session.totals.totalTokens,
          turns: total.turns + session.turns,
          cost: {
            knownUsd: total.cost.knownUsd + session.cost.knownUsd,
            estimatedUsd: total.cost.estimatedUsd + session.cost.estimatedUsd,
            cacheSavingsUsd:
              total.cost.cacheSavingsUsd + session.cost.cacheSavingsUsd,
            pricedEvents: total.cost.pricedEvents + session.cost.pricedEvents,
            estimatedEvents:
              total.cost.estimatedEvents + session.cost.estimatedEvents,
            unknownEvents:
              total.cost.unknownEvents + session.cost.unknownEvents,
            unknownModels: [
              ...new Set([
                ...total.cost.unknownModels,
                ...session.cost.unknownModels,
              ]),
            ],
            complete: total.cost.complete && session.cost.complete,
          },
        }),
        {
          tokens: 0,
          turns: 0,
          cost: {
            knownUsd: 0,
            estimatedUsd: 0,
            cacheSavingsUsd: 0,
            pricedEvents: 0,
            estimatedEvents: 0,
            unknownEvents: 0,
            unknownModels: [] as string[],
            complete: true,
          },
        },
      ),
    [summary.sessions],
  );
  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      setSummary(await refreshSessionsQuery(appliedFilter));
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
          value={format.formatNumber(summary.sessions.length)}
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
              setRange(
                event.target.value as NonNullable<SessionFilter["range"]>,
              )
            }
            className="tt-input h-8 text-[13px]"
          >
            {RANGE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
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

async function getSessionsQuerySafe(filter: SessionFilter) {
  const { getSessionsQuery } = await import("../api.server");
  return getSessionsQuery(filter);
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
function SessionRow({ session }: { session: SessionSummary }) {
  const { t, format } = useI18n();
  const meta = SOURCE_META[session.source] ?? {
    label: session.source,
    dot: "bg-muted-foreground",
    color: "text-muted-foreground",
  };
  const statusMeta = STATUS_META[session.status];
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
            {formatCostLabel(t, format, {
              ...session.cost,
              unknownModels: [...session.cost.unknownModels],
            })}
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
      {session.statusReason != null && (
        <div className="w-full text-[10px] text-muted-foreground/70">
          {t("sessions.row.statusReason")} {session.statusReason}
        </div>
      )}
    </li>
  );
}
