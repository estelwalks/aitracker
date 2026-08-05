import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Dot, EmptyState, PageHeader, Panel, TTButton } from "../components/tt";
import { useI18n } from "../lib/i18n/context";
import { catalogs, getMessage, type MessageKey } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { toUiError } from "../lib/errors";
import {
  getUsageSources,
  refreshUsageSources,
  type UsageSourceEntry,
  type UsageSourceStatus,
  type UsageSourcesSummary,
} from "../lib/local-usage/get-usage-sources";

export const Route = createFileRoute("/sources")({
  loader: ({ location }) =>
    getUsageSources().then((data) => ({
      ...data,
      locale: resolveLocaleFromSearch(location.search),
    })),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.sources",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "sources.metaDescription",
        ),
      },
    ],
  }),
  component: SourcesPage,
});

const STATUS_META: Record<
  UsageSourceStatus,
  { labelKey: MessageKey; dot: string; color: string }
> = {
  "has-data": {
    labelKey: "sources.status.hasData",
    dot: "bg-ok",
    color: "text-ok",
  },
  "no-logs": {
    labelKey: "sources.status.noLogs",
    dot: "bg-warn",
    color: "text-warn",
  },
  "not-installed": {
    labelKey: "sources.status.notInstalled",
    dot: "bg-muted-foreground/40",
    color: "text-muted-foreground",
  },
};

const STATUS_FILTERS: Array<{
  key: UsageSourceStatus | "all";
  labelKey: MessageKey;
}> = [
  { key: "all", labelKey: "common.all" },
  { key: "has-data", labelKey: "sources.status.hasData" },
  { key: "no-logs", labelKey: "sources.status.noLogs" },
  { key: "not-installed", labelKey: "sources.status.notInstalled" },
];

const LOG_PARSING_LABEL: Record<
  UsageSourceEntry["usageLogParsing"],
  MessageKey
> = {
  native: "sources.parsing.native",
  adapter: "sources.parsing.adapter",
  unsupported: "sources.parsing.unsupported",
};

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
  const { t, format } = useI18n();
  const [summary, setSummary] = useState<UsageSourcesSummary>(
    Route.useLoaderData(),
  );
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
      toast.success(t("sources.toast.rescanDone"));
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
          title={t("sources.pageHeader")}
          desc={t("sources.pageHeaderDesc", {
            count: format.formatNumber(summary.totals.toolCount),
            time: format.formatDateTime(summary.generatedAt, false),
          })}
        />
        <TTButton onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw
            className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? t("sources.scanning") : t("sources.rescan")}
        </TTButton>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
        <SummaryCard
          label={t("sources.summary.connected")}
          value={`${format.formatNumber(summary.totals.connectedCount)} / ${format.formatNumber(summary.totals.toolCount)}`}
        />
        <SummaryCard
          label={t("sources.summary.events")}
          value={format.formatNumber(summary.totals.eventCount)}
        />
        <SummaryCard
          label={t("sources.summary.notInstalled")}
          value={format.formatNumber(summary.totals.notInstalledCount)}
        />
        <SummaryCard
          label={t("sources.summary.noLogs")}
          value={format.formatNumber(summary.totals.noLogsCount)}
        />
        <SummaryCard
          label={t("sources.summary.malformed")}
          value={format.formatNumber(summary.totals.malformedCount)}
        />
      </div>

      <Panel
        className="mt-3"
        title={t("sources.panelTitle")}
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("sources.searchPlaceholder")}
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
                {t(filter.labelKey)}
                <span className="text-[10px] opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title={t("sources.empty.title")}
            desc={t("sources.empty.desc")}
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
  const { t, format } = useI18n();
  const meta = STATUS_META[entry.status];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 py-2.5 text-[13px]">
      <div className="flex min-w-[140px] flex-1 items-center gap-2">
        <Dot className={meta.dot} />
        <span className="font-medium text-foreground">{entry.nameZh}</span>
      </div>

      <span className={`tt-num text-[12px] ${meta.color}`}>
        {t(meta.labelKey)}
      </span>

      {entry.events > 0 && (
        <span className="tt-num text-[11px] text-muted-foreground">
          {t("sources.row.events", {
            count: format.formatNumber(entry.events),
          })}
        </span>
      )}

      <span className="tt-num text-[11px] text-muted-foreground">
        {t("sources.row.parsing", {
          label: t(LOG_PARSING_LABEL[entry.usageLogParsing]),
        })}
      </span>

      {entry.malformedLines > 0 && (
        <span className="tt-num text-[11px] text-warn">
          {t("sources.row.malformed", {
            count: format.formatNumber(entry.malformedLines),
          })}
        </span>
      )}

      <span className="tt-num text-[11px] text-muted-foreground">
        {entry.lastScannedAt
          ? format.formatDateTime(entry.lastScannedAt, false)
          : "—"}
      </span>

      {entry.status === "not-installed" && (
        <a
          href={`https://duckduckgo.com/?q=${encodeURIComponent(`${entry.nameZh} AI coding tool download`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-primary hover:underline"
        >
          {t("sources.row.download")}
        </a>
      )}

      <span className="tt-num hidden w-full text-[10px] text-muted-foreground/70 lg:block">
        {t("sources.row.paths", {
          paths: entry.paths.join(" · ") || "—",
        })}
      </span>
    </li>
  );
}
