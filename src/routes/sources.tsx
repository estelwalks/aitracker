import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Dot, EmptyState, PageHeader, Panel, TTButton } from "../components/tt";
import {
  getUsageSources,
  refreshUsageSources,
  type UsageSourceEntry,
  type UsageSourceStatus,
  type UsageSourcesSummary,
} from "../lib/local-usage/get-usage-sources";

export const Route = createFileRoute("/sources")({
  loader: () => getUsageSources(),
  head: () => ({
    meta: [
      { title: "数据来源 · AITracker V3.0" },
      {
        name: "description",
        content: "查看本机各 AI 工具的安装探测状态与日志采集情况。",
      },
    ],
  }),
  component: SourcesPage,
});

const STATUS_META: Record<
  UsageSourceStatus,
  { label: string; dot: string; color: string }
> = {
  "has-data": { label: "有数据", dot: "bg-ok", color: "text-ok" },
  "no-logs": { label: "无日志", dot: "bg-warn", color: "text-warn" },
  "not-installed": {
    label: "未安装",
    dot: "bg-muted-foreground/40",
    color: "text-muted-foreground",
  },
};

const STATUS_FILTERS: Array<{ key: UsageSourceStatus | "all"; label: string }> =
  [
    { key: "all", label: "全部" },
    { key: "has-data", label: "有数据" },
    { key: "no-logs", label: "无日志" },
    { key: "not-installed", label: "未安装" },
  ];

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const date = new Date(iso);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "—";
  }
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-sm border border-border bg-surface p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tt-num mt-1 text-lg font-semibold text-foreground">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

function SourcesPage() {
  const initial = Route.useLoaderData() as UsageSourcesSummary;
  const [summary, setSummary] = useState<UsageSourcesSummary>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<UsageSourceStatus | "all">(
    "all",
  );

  const statusCounts = useMemo(() => {
    const counts = {
      "has-data": 0,
      "no-logs": 0,
      "not-installed": 0,
    } as Record<UsageSourceStatus, number>;
    for (const entry of summary.entries) counts[entry.status] += 1;
    return counts;
  }, [summary]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return summary.entries.filter((entry) => {
      if (statusFilter !== "all" && entry.status !== statusFilter) return false;
      if (kw && !entry.nameZh.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [summary.entries, keyword, statusFilter]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const next = await refreshUsageSources();
      setSummary(next);
      toast.success("重新扫描完成");
    } catch {
      toast.error("重新扫描失败，请重试");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title="数据来源"
          desc={`27 个 AI 工具的探测状态 · 更新于 ${formatDateTime(summary.generatedAt)}`}
        />
        <TTButton onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "扫描中" : "重新扫描"}
        </TTButton>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        <SummaryCard
          label="已接入 / 总探测"
          value={`${summary.totals.connectedCount} / ${summary.totals.toolCount}`}
        />
        <SummaryCard label="采集事件总数" value={summary.totals.eventCount} />
        <SummaryCard
          label="未采集工具"
          value={summary.totals.notInstalledCount}
        />
        <SummaryCard label="无日志工具" value={summary.totals.noLogsCount} />
        <SummaryCard label="异常行数" value={summary.totals.malformedCount} />
      </div>

      <Panel
        className="mt-3"
        title="工具探测状态"
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索工具名称"
                className="tt-input h-8 w-44 pl-8 text-[13px]"
              />
            </div>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((filter) => {
            const active = statusFilter === filter.key;
            const count =
              filter.key === "all"
                ? summary.entries.length
                : statusCounts[filter.key];
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setStatusFilter(filter.key)}
                className={`tt-num inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[12px] transition-colors ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground"
                }`}
              >
                {filter.label}
                <span className="text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="没有匹配的工具"
            desc="调整筛选条件或搜索关键词后重试。"
          />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((entry) => (
              <SourceRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function SourceRow({ entry }: { entry: UsageSourceEntry }) {
  const meta = STATUS_META[entry.status];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 py-2.5 text-[13px]">
      <div className="flex min-w-[140px] flex-1 items-center gap-2">
        <Dot className={meta.dot} />
        <span className="font-medium text-foreground">{entry.nameZh}</span>
      </div>

      <span className={`tt-num text-[12px] ${meta.color}`}>{meta.label}</span>

      {entry.status === "has-data" && (
        <span className="tt-num text-[11px] text-muted-foreground">
          采集事件 {entry.events.toLocaleString()}
          {entry.malformedLines > 0 && (
            <span className="text-warn"> · 异常 {entry.malformedLines}</span>
          )}
        </span>
      )}

      <span className="tt-num text-[11px] text-muted-foreground">
        {formatDateTime(entry.lastScannedAt)}
      </span>

      {entry.status === "not-installed" && (
        <a
          href={`https://duckduckgo.com/?q=${encodeURIComponent(`${entry.nameZh} AI coding tool download`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-primary hover:underline"
        >
          下载安装 ↗
        </a>
      )}

      <span className="tt-num hidden w-full text-[10px] text-muted-foreground/70 lg:block">
        {entry.paths.join(" · ") || "—"}
      </span>
    </li>
  );
}
