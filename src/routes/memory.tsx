import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FileText, Folder, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, PageHeader, Panel, StatusBadge, TTButton } from "../components/tt";
import { getLocalMemory } from "../lib/local-memory/server-fns";
import type { MemorySnapshot } from "../lib/local-memory/types";
import { useAITrackerSettings } from "../lib/settings/store";

export const Route = createFileRoute("/memory")({
  loader: () => getLocalMemory({ data: { customPaths: [], includeDefaults: true } }),
  head: () => ({
    meta: [
      { title: "记忆 · AITracker V3.0" },
      { name: "description", content: "发现并只读聚合本机 Markdown 记忆文件。" },
    ],
  }),
  component: MemoryPage,
});

const PAGE_SIZE = 8;

function MemoryPage() {
  const initial = Route.useLoaderData();
  const { settings, loaded } = useAITrackerSettings();
  const [snapshot, setSnapshot] = useState<MemorySnapshot>(initial);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("全部");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);

  const refresh = async (quiet = false) => {
    setBusy(true);
    try {
      const next = await getLocalMemory({
        data: {
          customPaths: settings.memoryDirectories,
          includeDefaults: settings.memoryAutoDiscover,
        },
      });
      setSnapshot(next);
      if (!quiet) toast.success(`已读取 ${next.entries.length} 个本地 Markdown 文件`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "记忆扫描失败");
    } finally {
      setBusy(false);
    }
  };

  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    snapshot.entries.forEach((entry) =>
      counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1),
    );
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [snapshot.entries]);

  const list = useMemo(() => {
    const normalizedQuery = query.toLowerCase();
    return snapshot.entries.filter(
      (entry) =>
        (source === "全部" || entry.source === source) &&
        [entry.title, entry.summary, entry.content, entry.path].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        ),
    );
  }, [query, snapshot.entries, source]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const shown = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <PageHeader
        eyebrow="本地记忆"
        title="记忆"
        desc="真实读取 CLAUDE.md、AGENTS.md 等本地 Markdown；页面内全文搜索，只读不改写"
        status={<StatusBadge tone="ok">{snapshot.entries.length} 个文件</StatusBadge>}
      >
        <TTButton disabled={busy} onClick={() => refresh()}>
          <RefreshCw className={`size-3.5 ${busy ? "animate-spin" : ""}`} /> 刷新
        </TTButton>
      </PageHeader>

      <div className="relative mb-3">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="搜索标题、摘要、正文或路径…"
          className="h-9 w-full rounded-sm border border-border bg-surface pl-9 text-[13px] outline-none focus:border-primary"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(180px,24%)_minmax(0,1fr)]">
        <Panel title="来源" bodyClassName="p-2">
          <button
            onClick={() => {
              setSource("全部");
              setPage(1);
            }}
            className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] ${
              source === "全部" ? "bg-accent" : "hover:bg-accent/50"
            }`}
          >
            <Folder className="size-3.5 text-muted-foreground" /> 全部
            <span className="tt-num ml-auto text-[11px]">{snapshot.entries.length}</span>
          </button>
          {sources.map(([name, count]) => (
            <button
              key={name}
              onClick={() => {
                setSource(name);
                setPage(1);
              }}
              className={`mt-0.5 flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] ${
                source === name ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <FileText className="size-3.5 text-muted-foreground" /> {name}
              <span className="tt-num ml-auto text-[11px]">{count}</span>
            </button>
          ))}
          <div className="mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
            已检查 {snapshot.scannedPaths.length} 个入口
            {snapshot.warnings.length > 0 && ` · ${snapshot.warnings.length} 个路径无法读取`}
          </div>
        </Panel>

        <div className="space-y-3">
          {shown.length === 0 ? (
            <EmptyState
              title="未发现匹配的记忆文件"
              desc="可在设置中添加文件或目录的绝对路径，也支持 ~/ 开头的路径。"
              actions={
                <Link to="/settings">
                  <TTButton variant="primary">配置记忆目录</TTButton>
                </Link>
              }
            />
          ) : (
            shown.map((entry) => (
              <article
                key={entry.id}
                onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                className="tt-panel cursor-pointer p-4 hover:border-primary/40"
              >
                <h3 className="text-[13px] font-medium">{entry.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {expanded === entry.id ? entry.content : entry.summary}
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>{new Date(entry.modifiedAt).toLocaleString("zh-CN")}</span>
                  <span>来源：{entry.source}</span>
                  <span>项目：{entry.project}</span>
                  <span className="tt-num break-all">{entry.path}</span>
                </div>
              </article>
            ))
          )}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <TTButton size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
                上一页
              </TTButton>
              <span className="tt-num text-xs">
                {page} / {pages}
              </span>
              <TTButton size="sm" disabled={page === pages} onClick={() => setPage(page + 1)}>
                下一页
              </TTButton>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
