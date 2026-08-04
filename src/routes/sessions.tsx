import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search, Terminal } from "lucide-react";
import { toast } from "sonner";

import { Dot, EmptyState, PageHeader, Panel, TTButton } from "../components/tt";
import {
  getLocalSessions,
  refreshLocalSessions,
} from "../lib/local-sessions/server-fns";
import { formatCost } from "../lib/pricing";
import type {
  SessionFilter,
  SessionRecord,
  SessionSource,
  SessionStatus,
  SessionSummary,
} from "../lib/local-sessions/types";

export const Route = createFileRoute("/sessions")({
  loader: () => getLocalSessions({ data: {} }),
  head: () => ({
    meta: [
      { title: "会话恢复 · TrustTools V3.0" },
      {
        name: "description",
        content: "浏览本地历史会话并一键复制恢复命令。",
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

const RANGE_OPTIONS: Array<{ key: SessionFilter["range"]; label: string }> = [
  { key: "all", label: "全部" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "90d", label: "近 90 天" },
];

const STATUS_OPTIONS: Array<{
  key: SessionStatus | "all";
  label: string;
}> = [
  { key: "all", label: "全部状态" },
  { key: "available", label: "可恢复" },
  { key: "interrupted", label: "异常中断" },
  { key: "lost", label: "已标记丢失" },
  { key: "unavailable", label: "命令不可用" },
];

const STATUS_META: Record<SessionStatus, { label: string; className: string }> =
  {
    available: {
      label: "可恢复",
      className: "border-ok/30 bg-ok/10 text-ok",
    },
    interrupted: {
      label: "异常中断",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-600",
    },
    lost: {
      label: "已标记丢失",
      className: "border-rose-500/30 bg-rose-500/10 text-rose-600",
    },
    unavailable: {
      label: "命令不可用",
      className: "border-border bg-muted text-muted-foreground",
    },
  };

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${rest}m`;
}

function formatDateTime(iso: string): string {
  try {
    const date = new Date(iso);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  } catch {
    return iso;
  }
}

function SessionsPage() {
  const initial = Route.useLoaderData() as SessionSummary;
  const [summary, setSummary] = useState<SessionSummary>(initial);
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
      toast.success("会话列表已刷新");
    } catch {
      toast.error("刷新失败，请重试");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title="会话恢复"
          desc="浏览本地历史会话并一键复制恢复命令"
        />
        <TTButton onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "刷新中" : "刷新"}
        </TTButton>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCard label="会话条数" value={totals.count} />
        <SummaryCard label="Token 合计" value={formatTokens(totals.tokens)} />
        <SummaryCard label="费用合计" value={formatCost(totals.cost, "CNY")} />
        <SummaryCard label="轮次合计" value={totals.turns} />
      </div>

      <Panel className="mt-3" title="本地会话">
        <p className="mb-3 text-[11px] text-muted-foreground">
          当前仅支持恢复 Claude Code、Codex 与
          Grok；费用按本地模型定价表估算，未知价格会明确标注。
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索标题 / 项目 / 模型 / sessionId"
              className="tt-input h-8 w-56 pl-8 text-[13px]"
            />
          </div>
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="tt-input h-8 text-[13px]"
          >
            <option value="all">全部项目</option>
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
                {option.label}
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
            <option value="all">全部工具</option>
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
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {summary.sessions.length === 0 ? (
          <EmptyState
            title="没有匹配的会话"
            desc="调整筛选条件或搜索关键词后重试。"
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
      toast.success("已复制恢复命令");
    } catch {
      toast.error("复制失败，请手动复制");
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
          {session.title || "(未命名会话)"}
        </span>
        <span
          title={session.statusReason ?? undefined}
          className={`rounded-full border px-1.5 py-0.5 text-[10px] ${statusMeta.className}`}
        >
          {statusMeta.label}
        </span>
        <span className="ml-auto">
          <TTButton
            size="sm"
            onClick={handleCopy}
            disabled={!session.resumeSafe}
            title={
              session.resumeSafe
                ? "复制恢复命令"
                : "该会话 ID 不安全，无法生成恢复命令"
            }
          >
            <Terminal className="size-3.5" />
            {copied ? "已复制" : "复制恢复命令"}
          </TTButton>
        </span>
      </div>

      <div className="flex w-full flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          项目 <span className="text-foreground/80">{session.projectKey}</span>
        </span>
        {session.model && (
          <span>
            模型 <span className="text-foreground/80">{session.model}</span>
          </span>
        )}
        <span>
          时间{" "}
          <span className="tt-num text-foreground/80">
            {formatDateTime(session.startedAt)}
          </span>
        </span>
        <span>
          时长{" "}
          <span className="tt-num text-foreground/80">
            {formatDuration(session.durationMs)}
          </span>
        </span>
        <span>
          Token{" "}
          <span className="tt-num text-foreground/80">
            {formatTokens(session.totals.totalTokens)}
          </span>
        </span>
        <span>
          费用{" "}
          <span className="tt-num text-foreground/80">
            {formatCost(session.cost, "CNY")}
          </span>
        </span>
        <span>
          轮次{" "}
          <span className="tt-num text-foreground/80">{session.turns}</span>
        </span>
        <span>
          改动{" "}
          <span className="tt-num text-foreground/80">{session.editTurns}</span>
        </span>
      </div>

      {session.resumeSafe && (
        <div className="w-full text-[10px] text-muted-foreground/70">
          需在该目录下执行恢复命令：
          <span className="tt-num">{session.projectRef}</span>
        </div>
      )}
      {session.statusReason != null && (
        <div className="w-full text-[10px] text-muted-foreground/70">
          状态说明：{session.statusReason}
        </div>
      )}
    </li>
  );
}
