import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Image as ImageIcon,
  Search,
} from "lucide-react";

import {
  TokenPoster,
  type PosterData,
  type PosterPeriod,
} from "../components/TokenPoster";
import {
  Dot,
  EmptyState,
  PageHeader,
  Panel,
  Segmented,
  StatusBadge,
  TTButton,
} from "../components/tt";
import {
  buildContextBreakdown,
  getLocalUsageSnapshot,
} from "../lib/local-usage";
import type { LocalUsageContextBreakdownRow } from "../lib/local-usage/context-breakdown";
import {
  breakdownComposition,
  cacheRate,
  createEmptyUsageSnapshot,
  aggregateEventsByTime,
  aggregateUsageBySession,
  filterDailyUsage,
  filterUsageEvents,
  formatDateTime,
  formatEventTime,
  formatTokens,
  resolveUsageRange,
  shareOf,
  sourceLabel,
  type UsageTimeGrain,
  type UsagePeriod,
} from "../lib/local-usage/presentation";
import type {
  LocalUsageEvent,
  LocalUsageSnapshot,
  LocalUsageSource,
} from "../lib/local-usage";
import {
  aggregatePricedUsage,
  applyPricingSnapshot,
  estimateEventCost,
  estimateUsageCost,
  formatCost,
  formatMoney,
  totalsFromEvents,
  type Currency,
  type PricingSnapshot,
  type PricedUsageRow,
  type UsageDimension,
} from "../lib/pricing";
import { getPricingSnapshot } from "../lib/pricing/server-fns";

type Tab = UsageDimension;
type SortKey = "name" | "tokens" | "events" | "share" | "cache";

const PAGE_SIZE = 20;
const periodOptions: { value: UsagePeriod; label: string }[] = [
  { value: "today", label: "今日" },
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "year", label: "本年" },
  { value: "30d", label: "近 30 天" },
  { value: "custom", label: "自定义" },
];
const periodLabels: Partial<Record<UsagePeriod, string>> = {
  today: "今日",
  week: "本周",
  month: "本月",
  year: "本年",
  "30d": "近 30 天",
  custom: "自定义区间",
};
const tokenTypeLabels: Record<string, string> = {
  input: "输入",
  output: "输出",
  cacheRead: "缓存读取",
  cacheWrite: "缓存写入",
  reasoning: "推理",
};

export const Route = createFileRoute("/tokens")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: (["source", "project", "model", "tokenType"] as const).includes(
      search.tab as Tab,
    )
      ? (search.tab as Tab)
      : undefined,
  }),
  loader: async () => {
    try {
      const snapshot = await getLocalUsageSnapshot();
      const pricing = await getPricingSnapshot({
        data: [...new Set(snapshot.details.map((event) => event.model))],
      });
      return { snapshot, pricing, error: null };
    } catch (error) {
      return {
        snapshot: createEmptyUsageSnapshot(),
        pricing: null,
        error: error instanceof Error ? error.message : "本地数据读取失败",
      };
    }
  },
  head: () => ({
    meta: [
      { title: "Token 分析 · AITracker V3.0" },
      {
        name: "description",
        content: "基于本机受支持 AI 客户端日志的真实 Token 与费用分析。",
      },
    ],
  }),
  component: TokensPage,
});

function TokensPage() {
  const { snapshot, pricing, error } = Route.useLoaderData();
  applyPricingSnapshot(pricing);
  const { tab = "source" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  const [currency, setCurrency] = useState<Currency>("CNY");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [posterOpen, setPosterOpen] = useState(false);
  const [timeGrain, setTimeGrain] = useState<UsageTimeGrain>("day");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "tokens",
    dir: "desc",
  });

  const selectedRange = useMemo(
    () => resolveUsageRange(period, from, to),
    [period, from, to],
  );
  const periodEvents = useMemo(
    () => filterUsageEvents(snapshot.details, period, from, to),
    [snapshot.details, period, from, to],
  );
  const periodDaily = useMemo(
    () => filterDailyUsage(snapshot.daily, period, from, to),
    [snapshot.daily, period, from, to],
  );
  const totals = useMemo(() => totalsFromEvents(periodEvents), [periodEvents]);
  const cost = useMemo(() => estimateUsageCost(periodEvents), [periodEvents]);
  const rows = useMemo(
    () => aggregatePricedUsage(periodEvents, tab),
    [periodEvents, tab],
  );
  const sessionUsage = useMemo(
    () => aggregateUsageBySession(periodEvents),
    [periodEvents],
  );
  const timeBuckets = useMemo(
    () => aggregateEventsByTime(periodEvents, timeGrain),
    [periodEvents, timeGrain],
  );
  const visibleRows = useMemo(
    () =>
      sortRows(
        rows.filter((row) =>
          displayKey(row.key, tab).toLowerCase().includes(query.toLowerCase()),
        ),
        sort,
        totals.totalTokens,
      ),
    [query, rows, sort, tab, totals.totalTokens],
  );
  const filteredDetails = useMemo(
    () =>
      periodEvents.filter((event) =>
        [sourceLabel(event.source), event.model, event.project].some((value) =>
          value.toLowerCase().includes(query.toLowerCase()),
        ),
      ),
    [periodEvents, query],
  );
  const pageCount = Math.max(1, Math.ceil(filteredDetails.length / PAGE_SIZE));
  const pageEvents = filteredDetails.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const posterData = useMemo(
    () =>
      buildPosterData(
        period,
        periodEvents,
        periodDaily,
        selectedRange,
        currency,
      ),
    [currency, period, periodDaily, periodEvents, selectedRange],
  );

  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [period, query, tab, from, to, timeGrain]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  if (snapshot.mode === "empty") {
    return <EmptyTokens snapshot={snapshot} error={error} />;
  }

  const setTab = (nextTab: Tab) => navigate({ search: { tab: nextTab } });
  const firstColumn =
    tab === "project"
      ? "项目"
      : tab === "model"
        ? "模型"
        : tab === "tokenType"
          ? "Token 类型"
          : "AI 客户端";

  return (
    <>
      <PageHeader
        eyebrow="用量分析"
        title="Token 分析"
        desc={`${selectedRangeLabel(period, selectedRange)} · ${periodEvents.length.toLocaleString()} 个真实事件 · 更新于 ${formatDateTime(snapshot.generatedAt)}`}
        status={
          <StatusBadge tone="ok">
            <Dot className="size-1 bg-ok" /> 真实数据
          </StatusBadge>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={period}
            onChange={setPeriod}
            options={periodOptions}
          />
          <Segmented
            value={currency}
            onChange={setCurrency}
            options={[
              { value: "CNY", label: "人民币" },
              { value: "USD", label: "美元" },
            ]}
          />
          <TTButton onClick={() => setPosterOpen(true)}>
            <ImageIcon className="size-3.5" /> 生成海报
          </TTButton>
        </div>
      </PageHeader>

      {period === "custom" && (
        <Panel className="mt-3" title="自定义时间范围">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex gap-2 text-xs text-muted-foreground">
              <span className="self-center">开始</span>
              <input
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="h-8 rounded-sm border border-border bg-surface px-2 text-[13px] text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="flex gap-2 text-xs text-muted-foreground">
              <span className="self-center">结束</span>
              <input
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="h-8 rounded-sm border border-border bg-surface px-2 text-[13px] text-foreground outline-none focus:border-primary"
              />
            </label>
            <span className="text-xs text-muted-foreground">
              {selectedRangeHint(selectedRange)}
            </span>
          </div>
        </Panel>
      )}

      <div className="tt-panel grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
        <Summary label="总 Token" value={formatTokens(totals.totalTokens)} />
        <Summary label="输入 Token" value={formatTokens(totals.inputTokens)} />
        <Summary label="输出 Token" value={formatTokens(totals.outputTokens)} />
        <Summary
          label="缓存读取"
          value={formatTokens(totals.cachedInputTokens)}
        />
        <Summary
          label="缓存写入"
          value={formatTokens(totals.cacheCreationInputTokens)}
        />
        <Summary
          label="估算费用"
          value={formatCost(cost, currency)}
          note={
            cost.unknownEvents > 0
              ? `${cost.unknownEvents} 个事件价格未知`
              : "公开价估算"
          }
        />
      </div>

      {cost.unknownEvents > 0 && (
        <div className="mt-3 rounded-sm border border-warn/40 bg-warn/10 px-4 py-3 text-xs text-warn">
          费用仅统计可识别模型；{cost.unknownEvents.toLocaleString()} 个事件、共{" "}
          {cost.unknownModels.length.toLocaleString()} 个模型价格未知：
          {cost.unknownModels.slice(0, 5).join("、")}
          {cost.unknownModels.length > 5 ? " 等" : ""}。未知部分没有按 0
          元计入。
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "source", label: "按客户端" },
            { value: "model", label: "按模型" },
            { value: "project", label: "按项目" },
            { value: "tokenType", label: "按 Token 类型" },
          ]}
        />
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`筛选${firstColumn}或明细…`}
            className="h-8 w-64 rounded-sm border border-border bg-surface pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
      </div>

      <BreakdownTable
        rows={visibleRows}
        events={periodEvents}
        totalTokens={totals.totalTokens}
        firstColumn={firstColumn}
        tab={tab}
        currency={currency}
        sort={sort}
        setSort={setSort}
        expanded={expanded}
        setExpanded={setExpanded}
      />

      <TimeBreakdown
        buckets={timeBuckets}
        grain={timeGrain}
        totals={totals}
        currency={currency}
        cacheSavingsUsd={cost.cacheSavingsUsd}
        pricing={pricing}
        setGrain={setTimeGrain}
      />

      <DetailTable
        events={pageEvents}
        totalEvents={filteredDetails.length}
        page={page}
        pageCount={pageCount}
        currency={currency}
        setPage={setPage}
      />

      <Panel className="mt-3" title="会话下钻">
        {sessionUsage.available ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              仅按真实 `sessionId`
              聚合；不会读取正文，也不会根据时间、项目或模型推断会话。
              {sessionUsage.eventsWithoutSession > 0
                ? ` 当前仍有 ${sessionUsage.eventsWithoutSession.toLocaleString()} 个事件缺少真实 sessionId，未计入会话聚合。`
                : ""}
            </p>
            <div className="tt-xscroll">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="px-4 py-2.5 font-normal">sessionId</th>
                    <th className="px-4 py-2.5 text-right font-normal">事件</th>
                    <th className="px-4 py-2.5 text-right font-normal">
                      总 Token
                    </th>
                    <th className="px-4 py-2.5 text-right font-normal">输入</th>
                    <th className="px-4 py-2.5 text-right font-normal">输出</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionUsage.rows.map((row) => (
                    <tr
                      key={row.sessionId}
                      className="border-b border-border last:border-0"
                    >
                      <td className="tt-num px-4 py-2.5">{row.sessionId}</td>
                      <td className="tt-num px-4 py-2.5 text-right">
                        {row.events.toLocaleString()}
                      </td>
                      <td className="tt-num px-4 py-2.5 text-right">
                        {formatTokens(row.totalTokens)}
                      </td>
                      <td className="tt-num px-4 py-2.5 text-right">
                        {formatTokens(row.inputTokens)}
                      </td>
                      <td className="tt-num px-4 py-2.5 text-right">
                        {formatTokens(row.outputTokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            当前事件无真实
            sessionId，因此会话下钻不可用。页面不会根据时间、项目名或正文推断会话，也不会展示任何对话内容。
          </p>
        )}
      </Panel>

      {posterOpen && (
        <TokenPoster
          data={posterData}
          filePeriod={posterFilePeriod(period)}
          onClose={() => setPosterOpen(false)}
        />
      )}
    </>
  );
}

function Summary({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="tt-label">{label}</div>
      <div className="tt-num mt-1 truncate text-lg" title={value}>
        {value}
      </div>
      {note && (
        <div className="mt-1 truncate text-[10px] text-muted-foreground">
          {note}
        </div>
      )}
    </div>
  );
}

function BreakdownTable({
  rows,
  events,
  totalTokens,
  firstColumn,
  tab,
  currency,
  sort,
  setSort,
  expanded,
  setExpanded,
}: {
  rows: PricedUsageRow[];
  events: LocalUsageEvent[];
  totalTokens: number;
  firstColumn: string;
  tab: Tab;
  currency: Currency;
  sort: { key: SortKey; dir: "asc" | "desc" };
  setSort: (sort: { key: SortKey; dir: "asc" | "desc" }) => void;
  expanded: string | null;
  setExpanded: (key: string | null) => void;
}) {
  const columns: [SortKey, string][] = [
    ["name", firstColumn],
    ["tokens", "总 Token"],
    ["events", "事件"],
    ["share", "占比"],
    ["cache", "缓存输入占比"],
  ];
  const toggleSort = (key: SortKey) =>
    setSort({
      key,
      dir: sort.key === key && sort.dir === "desc" ? "asc" : "desc",
    });

  return (
    <Panel className="mt-3" bodyClassName="p-0">
      <div className="tt-xscroll">
        <table className="w-full min-w-[920px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
              {columns.map(([key, label], index) => (
                <th
                  key={key}
                  onClick={() => toggleSort(key)}
                  className={`cursor-pointer px-4 py-2.5 font-normal hover:text-foreground ${index > 0 ? "text-right" : ""}`}
                >
                  {label}
                  {sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
              <th className="px-4 py-2.5 text-right font-normal">估算费用</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowShare = shareOf(row.totalTokens, totalTokens);
              const isExpanded = expanded === row.key;
              return (
                <Fragment key={row.key}>
                  <tr
                    onClick={() => setExpanded(isExpanded ? null : row.key)}
                    className="cursor-pointer border-b border-border transition-colors hover:bg-accent/40"
                  >
                    <td className="flex items-center gap-1.5 px-4 py-2.5">
                      {isExpanded ? (
                        <ChevronDown className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      )}
                      <span
                        className="max-w-80 truncate"
                        title={displayKey(row.key, tab)}
                      >
                        {displayKey(row.key, tab)}
                      </span>
                    </td>
                    <td className="tt-num px-4 py-2.5 text-right">
                      {formatTokens(row.totalTokens)}
                    </td>
                    <td className="tt-num px-4 py-2.5 text-right">
                      {row.events.toLocaleString()}
                    </td>
                    <td className="tt-num px-4 py-2.5 text-right">
                      {rowShare.toFixed(1)}%
                    </td>
                    <td className="tt-num px-4 py-2.5 text-right">
                      {cacheRate(row).toFixed(1)}%
                    </td>
                    <td className="tt-num px-4 py-2.5 text-right">
                      {tab === "tokenType" && row.key === "reasoning"
                        ? "已含在输出计费"
                        : formatCost(row.cost, currency)}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="border-b border-border bg-surface-2/60">
                      <td colSpan={6} className="px-4 py-4">
                        {tab === "model" ? (
                          <ModelDrilldown
                            model={row.key}
                            events={events}
                            currency={currency}
                          />
                        ) : (
                          <TokenComposition row={row} currency={currency} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  当前筛选条件下没有数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ModelDrilldown({
  model,
  events,
  currency,
}: {
  model: string;
  events: LocalUsageEvent[];
  currency: Currency;
}) {
  const modelEvents = events.filter((event) => event.model === model);
  const providers = aggregatePricedUsage(modelEvents, "source");
  const projects = aggregatePricedUsage(modelEvents, "project");
  const sessions = aggregateUsageBySession(modelEvents);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium">模型真实下钻 · {model}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {modelEvents.length.toLocaleString()} 个真实事件 · Provider、项目与
            session 均来自本地日志
          </div>
        </div>
        <span className="tt-num text-[11px] text-muted-foreground">
          {formatCost(estimateUsageCost(modelEvents), currency)}
        </span>
      </div>

      <ContextBreakdown events={modelEvents} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DrilldownList
          title="客户端分布"
          rows={providers}
          currency={currency}
          formatLabel={(key) => sourceLabel(key as LocalUsageSource)}
        />
        <DrilldownList
          title="项目分布"
          rows={projects}
          currency={currency}
          formatLabel={(key) => key || "未标记项目"}
        />
      </div>

      <div className="rounded-sm border border-border bg-surface/50">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-[11px] font-medium">真实会话明细</span>
          <span className="tt-num text-[10px] text-muted-foreground">
            {sessions.available
              ? `${sessions.rows.length.toLocaleString()} 个 session`
              : "无真实 sessionId"}
          </span>
        </div>
        {sessions.available ? (
          <div className="tt-xscroll">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
                  <th className="px-3 py-2 font-normal">sessionId</th>
                  <th className="px-3 py-2 text-right font-normal">事件</th>
                  <th className="px-3 py-2 text-right font-normal">输入</th>
                  <th className="px-3 py-2 text-right font-normal">输出</th>
                  <th className="px-3 py-2 text-right font-normal">缓存读取</th>
                  <th className="px-3 py-2 text-right font-normal">总 Token</th>
                </tr>
              </thead>
              <tbody>
                {sessions.rows.slice(0, 10).map((session) => (
                  <tr
                    key={session.sessionId}
                    className="border-b border-border last:border-0"
                  >
                    <td
                      className="tt-num max-w-64 truncate px-3 py-2"
                      title={session.sessionId}
                    >
                      {session.sessionId}
                    </td>
                    <td className="tt-num px-3 py-2 text-right">
                      {session.events.toLocaleString()}
                    </td>
                    <td className="tt-num px-3 py-2 text-right">
                      {formatTokens(session.inputTokens)}
                    </td>
                    <td className="tt-num px-3 py-2 text-right">
                      {formatTokens(session.outputTokens)}
                    </td>
                    <td className="tt-num px-3 py-2 text-right">
                      {formatTokens(session.cachedInputTokens)}
                    </td>
                    <td className="tt-num px-3 py-2 text-right">
                      {formatTokens(session.totalTokens)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-3 py-4 text-[11px] text-muted-foreground">
            当前模型事件没有真实 sessionId，因此不推断或伪造会话；Provider
            和项目下钻仍可使用。
          </p>
        )}
      </div>
    </div>
  );
}

const contextCategoryLabels: Record<string, string> = {
  execution: "执行",
  planning: "规划",
  agent: "Agent",
  browser: "浏览器",
  mcp: "MCP",
  skills: "Skills",
  other: "其他",
};

function ContextBreakdown({ events }: { events: LocalUsageEvent[] }) {
  const context = useMemo(() => buildContextBreakdown(events), [events]);
  const hasContext = events.some(
    (event) =>
      event.context != null &&
      ((event.context.tools?.length ?? 0) > 0 ||
        (event.context.skills?.length ?? 0) > 0 ||
        (event.context.commands?.length ?? 0) > 0 ||
        event.context.textResponse === true),
  );

  if (!hasContext) {
    return (
      <div className="rounded-sm border border-border bg-surface/40 px-3 py-3 text-[11px] text-muted-foreground">
        该来源暂未提供上下文归因
      </div>
    );
  }

  const messages = findRow(context.categories, "messages");
  const toolCategories = context.categories.filter(
    (row) => row.key !== "messages",
  );
  const toolCalls = sumRows(toolCategories);
  const total = context.totals.totalTokens;

  return (
    <div className="rounded-sm border border-border bg-surface/40 px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium">上下文构成</div>
        <div className="text-[10px] text-muted-foreground">
          归因 Token 不重复计数；子项为 Tool calls 子集
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ContextBucket
          label="Messages"
          row={messages}
          total={total}
          tone="bg-primary"
        />
        <ContextBucket
          label="Tool calls"
          row={toolCalls}
          total={total}
          tone="bg-ok"
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span>
          Reasoning {formatTokens(context.totals.reasoningOutputTokens)} ·
          已包含在输出
        </span>
        <span>
          MCP servers {formatTokens(findRow(toolCategories, "mcp").totalTokens)}
        </span>
        <span>
          Skills {formatTokens(findRow(toolCategories, "skills").totalTokens)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ContextRows
          title="工具分类"
          rows={toolCategories}
          total={toolCalls.totalTokens}
          label={(key) => contextCategoryLabels[key] ?? key}
          showCalls
        />
        <ContextRows
          title="Top tools"
          rows={context.tools}
          total={toolCalls.totalTokens}
          showCalls
        />
      </div>

      {context.skills.length > 0 && (
        <ContextRows
          title="Skills"
          rows={context.skills}
          total={toolCalls.totalTokens}
          showCalls
        />
      )}
      {context.commands.length > 0 && (
        <ContextRows
          title="Commands（已脱敏）"
          rows={context.commands}
          total={toolCalls.totalTokens}
          showCalls
          note="仅展示安全签名，不展示命令参数和输出正文"
        />
      )}
    </div>
  );
}

function ContextBucket({
  label,
  row,
  total,
  tone,
}: {
  label: string;
  row: LocalUsageContextBreakdownRow;
  total: number;
  tone: string;
}) {
  const percentage = shareOf(row.totalTokens, total);
  return (
    <div className="rounded-sm border border-border bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${tone}`} />
          {label}
        </span>
        <span className="tt-num text-muted-foreground">
          {percentage.toFixed(1)}%
        </span>
      </div>
      <div className="tt-num mt-1 text-sm">{formatTokens(row.totalTokens)}</div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full ${tone}`}
          style={{ width: `${Math.min(100, percentage)}%` }}
        />
      </div>
    </div>
  );
}

function ContextRows({
  title,
  rows,
  total,
  label = (key) => key,
  showCalls = false,
  note,
}: {
  title: string;
  rows: LocalUsageContextBreakdownRow[];
  total: number;
  label?: (key: string) => string;
  showCalls?: boolean;
  note?: string;
}) {
  return (
    <div className="rounded-sm border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-[11px] font-medium">{title}</span>
        {note && (
          <span className="text-[10px] text-muted-foreground">{note}</span>
        )}
      </div>
      <div className="space-y-2 px-3 py-2">
        {rows.length === 0 ? (
          <div className="text-[10px] text-muted-foreground">暂无归因数据</div>
        ) : (
          rows.slice(0, 10).map((row) => {
            const percentage = shareOf(row.totalTokens, total);
            return (
              <div
                key={row.key}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-[11px]"
              >
                <div className="min-w-0">
                  <div className="truncate" title={label(row.key)}>
                    {label(row.key)}
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full bg-primary/80"
                      style={{ width: `${Math.min(100, percentage)}%` }}
                    />
                  </div>
                </div>
                {showCalls && (
                  <span className="text-[10px] text-muted-foreground">
                    {row.calls} 次
                  </span>
                )}
                <span className="tt-num text-right">
                  {formatTokens(row.totalTokens)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function findRow(rows: LocalUsageContextBreakdownRow[], key: string) {
  return (
    rows.find((row) => row.key === key) ?? {
      key,
      calls: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    }
  );
}

function sumRows(rows: LocalUsageContextBreakdownRow[]) {
  return rows.reduce(
    (total, row) => ({
      ...total,
      calls: total.calls + row.calls,
      inputTokens: total.inputTokens + row.inputTokens,
      cachedInputTokens: total.cachedInputTokens + row.cachedInputTokens,
      cacheCreationInputTokens:
        total.cacheCreationInputTokens + row.cacheCreationInputTokens,
      outputTokens: total.outputTokens + row.outputTokens,
      reasoningOutputTokens:
        total.reasoningOutputTokens + row.reasoningOutputTokens,
      totalTokens: total.totalTokens + row.totalTokens,
    }),
    findRow([], "tool_calls"),
  );
}

function DrilldownList({
  title,
  rows,
  currency,
  formatLabel,
}: {
  title: string;
  rows: PricedUsageRow[];
  currency: Currency;
  formatLabel: (key: string) => string;
}) {
  return (
    <div className="rounded-sm border border-border bg-surface/50">
      <div className="border-b border-border px-3 py-2 text-[11px] font-medium">
        {title}
      </div>
      <div className="divide-y divide-border">
        {rows.slice(0, 8).map((row) => (
          <div
            key={row.key}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 px-3 py-2"
          >
            <span className="truncate text-[11px]" title={formatLabel(row.key)}>
              {formatLabel(row.key)}
            </span>
            <span className="tt-num text-[11px]">
              {formatTokens(row.totalTokens)}
            </span>
            <span className="tt-num text-[10px] text-muted-foreground">
              {formatCost(row.cost, currency)}
            </span>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="px-3 py-4 text-[11px] text-muted-foreground">
            当前模型没有可聚合数据。
          </p>
        )}
      </div>
    </div>
  );
}

function TokenComposition({
  row,
  currency,
}: {
  row: PricedUsageRow;
  currency: Currency;
}) {
  const composition = breakdownComposition(row);
  const total = composition.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="tt-label">真实 Token 构成</div>
        <span className="text-[11px] text-muted-foreground">
          {formatCost(row.cost, currency)}
          {row.cost.unknownModels.length > 0
            ? ` · 未知模型：${row.cost.unknownModels.slice(0, 3).join("、")}`
            : ""}
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-surface">
        {composition.map((item) => (
          <span
            key={item.label}
            title={`${item.label} ${formatTokens(item.value)}`}
            style={{
              width: `${(item.value / total) * 100}%`,
              background: item.color,
            }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        {composition.map((item) => (
          <div
            key={item.label}
            className="rounded-sm border border-border bg-surface/50 px-3 py-2"
          >
            <div className="text-[11px] text-muted-foreground">
              {item.label}
            </div>
            <div className="tt-num mt-1">{formatTokens(item.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimeBreakdown({
  buckets,
  grain,
  totals,
  currency,
  cacheSavingsUsd,
  pricing,
  setGrain,
}: {
  buckets: ReturnType<typeof aggregateEventsByTime>;
  grain: UsageTimeGrain;
  totals: ReturnType<typeof totalsFromEvents>;
  currency: Currency;
  cacheSavingsUsd: number;
  pricing: PricingSnapshot | null;
  setGrain: (grain: UsageTimeGrain) => void;
}) {
  const chartData = buckets.map((bucket) => ({
    label: bucket.label,
    input: bucket.inputTokens,
    output: bucket.outputTokens,
    cacheRead: bucket.cachedInputTokens,
    cacheWrite: bucket.cacheCreationInputTokens,
    reasoning: bucket.reasoningOutputTokens,
  }));
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-4">
      <Panel
        className="xl:col-span-3"
        title={
          grain === "hour" ? "每小时 Token 类型分解" : "每日 Token 类型分解"
        }
        action={
          <Segmented
            value={grain}
            onChange={setGrain}
            options={[
              { value: "day", label: "按日" },
              { value: "hour", label: "按小时" },
            ]}
          />
        }
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatTokens}
                width={48}
                tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value) => `${Number(value).toLocaleString()} Token`}
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 5,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="input"
                stackId="usage"
                name="输入"
                fill="var(--color-chart-1)"
              />
              <Bar
                dataKey="output"
                stackId="usage"
                name="输出"
                fill="var(--color-chart-2)"
              />
              <Bar
                dataKey="cacheRead"
                stackId="usage"
                name="缓存读取"
                fill="var(--color-chart-3)"
              />
              <Bar
                dataKey="cacheWrite"
                stackId="usage"
                name="缓存写入"
                fill="var(--color-chart-5)"
              />
              <Bar
                dataKey="reasoning"
                stackId="usage"
                name="推理"
                fill="var(--color-chart-4)"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        {chartData.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            当前时间范围内没有可聚合事件。
          </p>
        )}
      </Panel>
      <div className="space-y-3">
        <Panel title="缓存效果">
          <div className="space-y-2 text-xs">
            <Fact
              label="缓存读取"
              value={formatTokens(totals.cachedInputTokens)}
            />
            <Fact
              label="缓存写入"
              value={formatTokens(totals.cacheCreationInputTokens)}
            />
            <Fact
              label="缓存输入占比"
              value={`${cacheRate(totals).toFixed(1)}%`}
            />
            <Fact
              label="估算节省"
              value={formatMoney(cacheSavingsUsd, currency)}
            />
          </div>
        </Panel>
        <Panel title="价格口径">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            美元按 LiteLLM 与厂商公开模型单价估算；人民币按最新 USD/CNY 参考汇率
            {pricing ? ` ${pricing.usdToCny.toFixed(4)}` : " 7.2000"}{" "}
            换算。汇率日期：
            {pricing?.exchangeRateDate ?? "离线回退"}。推理 Token 已包含在输出
            Token 计费中，不重复收费。
          </p>
        </Panel>
      </div>
    </div>
  );
}

function DetailTable({
  events,
  totalEvents,
  page,
  pageCount,
  currency,
  setPage,
}: {
  events: LocalUsageEvent[];
  totalEvents: number;
  page: number;
  pageCount: number;
  currency: Currency;
  setPage: (page: number) => void;
}) {
  return (
    <Panel
      className="mt-3"
      title={`事件明细 · 共 ${totalEvents.toLocaleString()} 条`}
      action={
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded-sm border border-border p-1 disabled:opacity-30"
            aria-label="上一页"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <span className="tt-num">
            第 {page} / {pageCount} 页
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage(page + 1)}
            className="rounded-sm border border-border p-1 disabled:opacity-30"
            aria-label="下一页"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      }
      bodyClassName="p-0"
    >
      <div className="tt-xscroll">
        <table className="w-full min-w-[1040px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
              <th className="px-4 py-2.5 font-normal">时间</th>
              <th className="px-4 py-2.5 font-normal">来源</th>
              <th className="px-4 py-2.5 font-normal">模型</th>
              <th className="px-4 py-2.5 font-normal">项目</th>
              <th className="px-4 py-2.5 text-right font-normal">输入</th>
              <th className="px-4 py-2.5 text-right font-normal">输出</th>
              <th className="px-4 py-2.5 text-right font-normal">缓存读取</th>
              <th className="px-4 py-2.5 text-right font-normal">缓存写入</th>
              <th className="px-4 py-2.5 text-right font-normal">估算费用</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => (
              <tr
                key={`${event.timestamp}-${event.model}-${index}`}
                className="border-b border-border last:border-0 hover:bg-accent/40"
              >
                <td className="tt-num px-4 py-2.5 text-muted-foreground">
                  {formatEventTime(event.timestamp)}
                </td>
                <td className="px-4 py-2.5">{sourceLabel(event.source)}</td>
                <td
                  className="tt-num max-w-48 truncate px-4 py-2.5"
                  title={event.model}
                >
                  {event.model}
                </td>
                <td
                  className="max-w-56 truncate px-4 py-2.5"
                  title={event.project}
                >
                  {event.project}
                </td>
                <td className="tt-num px-4 py-2.5 text-right">
                  {formatTokens(event.inputTokens)}
                </td>
                <td className="tt-num px-4 py-2.5 text-right">
                  {formatTokens(event.outputTokens)}
                </td>
                <td className="tt-num px-4 py-2.5 text-right">
                  {formatTokens(event.cachedInputTokens)}
                </td>
                <td className="tt-num px-4 py-2.5 text-right">
                  {formatTokens(event.cacheCreationInputTokens)}
                </td>
                <td className="tt-num px-4 py-2.5 text-right">
                  {formatCost(estimateEventCost(event), currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="tt-num">{value}</span>
    </div>
  );
}

function displayKey(key: string, tab: Tab) {
  if (tab === "source") return sourceLabel(key as LocalUsageSource);
  if (tab === "tokenType") return tokenTypeLabels[key] ?? key;
  return key;
}

function sortRows(
  rows: PricedUsageRow[],
  sort: { key: SortKey; dir: "asc" | "desc" },
  totalTokens: number,
) {
  const direction = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort.key === "name")
      return left.key.localeCompare(right.key) * direction;
    if (sort.key === "events") return (left.events - right.events) * direction;
    if (sort.key === "share") {
      return (
        (shareOf(left.totalTokens, totalTokens) -
          shareOf(right.totalTokens, totalTokens)) *
        direction
      );
    }
    if (sort.key === "cache")
      return (cacheRate(left) - cacheRate(right)) * direction;
    return (left.totalTokens - right.totalTokens) * direction;
  });
}

function buildPosterData(
  period: UsagePeriod,
  events: LocalUsageEvent[],
  daily: LocalUsageSnapshot["daily"],
  range: ReturnType<typeof resolveUsageRange>,
  currency: Currency,
): PosterData {
  const totals = totalsFromEvents(events);
  const cost = estimateUsageCost(events);
  const providers = aggregatePricedUsage(events, "source");
  const models = aggregatePricedUsage(events, "model");
  return {
    periodLabel: periodLabels[period] ?? period,
    rangeLabel: selectedRangeLabel(period, range),
    tokens: totals.totalTokens,
    costLabel: formatCost(cost, currency),
    savedLabel: formatMoney(cost.cacheSavingsUsd, currency),
    hitRate: cacheRate(totals),
    trend: daily.map((row) => row.totalTokens),
    providers: providers.map((row) => ({
      name: sourceLabel(row.key as LocalUsageSource),
      value: row.totalTokens,
    })),
    models: models.slice(0, 3).map((row) => ({
      name: row.key,
      tokens: formatTokens(row.totalTokens),
      pct: shareOf(row.totalTokens, totals.totalTokens),
    })),
    unknownPriceModels: cost.unknownModels.length,
  };
}

function selectedRangeLabel(
  period: UsagePeriod,
  range: ReturnType<typeof resolveUsageRange>,
) {
  if (!range.valid) return selectedRangeHint(range);
  if (range.from == null || range.to == null)
    return periodLabels[period] ?? period;
  return range.from === range.to ? range.from : `${range.from} 至 ${range.to}`;
}

function selectedRangeHint(range: ReturnType<typeof resolveUsageRange>) {
  if (range.reason === "missing-boundary")
    return "请选择完整的开始和结束日期。";
  if (range.reason === "reversed-range") return "开始日期不能晚于结束日期。";
  if (range.reason === "invalid-boundary") return "日期格式无效。";
  return "筛选结果将按本地时间边界计算。";
}

function posterFilePeriod(period: UsagePeriod): PosterPeriod {
  if (
    period === "today" ||
    period === "week" ||
    period === "month" ||
    period === "year"
  ) {
    return period;
  }
  if (period === "custom" || period === "7d" || period === "30d") return period;
  return "custom";
}

function EmptyTokens({
  snapshot,
  error,
}: {
  snapshot: LocalUsageSnapshot;
  error: string | null;
}) {
  return (
    <>
      <PageHeader
        eyebrow="用量分析"
        title="Token 分析"
        desc={`更新于 ${formatDateTime(snapshot.generatedAt)}`}
        status={<StatusBadge tone="warn">暂无数据</StatusBadge>}
      />
      <EmptyState
        icon={<Database className="size-8" />}
        title="未发现本地日志"
        desc={
          error
            ? `真实数据读取失败：${error}`
            : "未在本机发现任何受支持客户端的可解析使用日志，不会混用演示数据。"
        }
      />
    </>
  );
}
