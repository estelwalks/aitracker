import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  Boxes,
  ExternalLink,
  FolderOpen,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { BrandIcon } from "../../../../components/BrandIcon";
import { JarvisInsight } from "../../../../components/JarvisInsight";
import { EmptyState, TTButton } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import { toUiError } from "../../../../lib/errors";
import type { MessageKey } from "../../../../lib/i18n/messages";
import {
  composeSourcesInsights,
  resolveInsightLines,
} from "../../../../lib/page-insights";
import type { UsageLogParsing } from "../../../../lib/tools/catalog";
import { refreshSourcesQuery } from "../api.server";
import type {
  SourcesQueryEntry,
  SourcesQueryStatus,
  SourcesQuerySummary,
} from "./model";
import { SourceMigrationModal } from "./SourceMigrationModal";
export type {
  SourcesQueryEntry,
  SourcesQueryStatus,
  SourcesQuerySummary,
} from "./model";
export { toSourcesQuerySummary } from "./model";
export { getSourcesQuery } from "../api.server";

const STATUS_META: Record<
  SourcesQueryStatus,
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
  key: SourcesQueryStatus | "all";
  labelKey: MessageKey;
}> = [
  { key: "all", labelKey: "common.all" },
  { key: "has-data", labelKey: "sources.status.hasData" },
  { key: "no-logs", labelKey: "sources.status.noLogs" },
  { key: "not-installed", labelKey: "sources.status.notInstalled" },
];

const LOG_PARSING_LABEL: Record<UsageLogParsing, MessageKey> = {
  native: "sources.parsing.native",
  adapter: "sources.parsing.adapter",
  unsupported: "sources.parsing.unsupported",
};

const SURFACE_LABEL: Record<SourcesQueryEntry["toolSurface"], MessageKey> = {
  cli: "sources.type.cli",
  ide: "sources.type.ide",
  plugin: "sources.type.plugin",
  desktop: "sources.type.desktop",
};

export function SourcesPage({ initial }: { initial: SourcesQuerySummary }) {
  const { t, format, locale } = useI18n();
  const [summary, setSummary] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [migrationSource, setMigrationSource] =
    useState<SourcesQueryEntry | null>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<SourcesQueryStatus | "all">(
    "all",
  );
  const statusCounts = useMemo(() => {
    const counts = {
      "has-data": 0,
      "no-logs": 0,
      "not-installed": 0,
    } as Record<SourcesQueryStatus, number>;
    for (const entry of summary.entries) counts[entry.status] += 1;
    return counts;
  }, [summary.entries]);
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLocaleLowerCase();
    return summary.entries.filter(
      (entry) =>
        (statusFilter === "all" || entry.status === statusFilter) &&
        (!kw ||
          entry.name.toLocaleLowerCase().includes(kw) ||
          entry.paths.some((path) => path.toLocaleLowerCase().includes(kw))),
    );
  }, [summary.entries, keyword, statusFilter]);
  const insightLines = useMemo(
    () => resolveInsightLines(t, composeSourcesInsights(summary, locale)),
    [t, summary, locale],
  );

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      setSummary(await refreshSourcesQuery());
      toast.success(t("sources.toast.rescanDone"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-5 pb-12">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {t("sources.hubTitle")}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {t("sources.hubSummary", {
              connected: format.formatNumber(summary.totals.connectedCount),
              total: format.formatNumber(summary.totals.toolCount),
              events: format.formatNumber(summary.totals.eventCount),
              time: format.formatDateTime(summary.generatedAt, false),
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-8 items-center gap-1.5 rounded-full bg-surface-2 px-3">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("sources.searchToolOrPath")}
              aria-label={t("sources.searchToolOrPath")}
              className="w-40 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground"
            />
          </div>
          <TTButton onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw
              className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? t("sources.scanning") : t("sources.rescan")}
          </TTButton>
        </div>
      </header>

      <JarvisInsight
        title={t("insights.title")}
        lines={insightLines}
        rotateLabel={t("insights.rotate")}
        dotsLabel={t("insights.dots")}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-surface-2/60 px-3 py-2 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-ok" />
          {t("sources.status.hasData")} · {statusCounts["has-data"]}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-warn" />
          {t("sources.status.noLogs")} · {statusCounts["no-logs"]}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-muted-foreground/40" />
          {t("sources.status.notInstalled")} · {statusCounts["not-installed"]}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCard
          icon={<Boxes className="size-4" />}
          label={t("sources.summary.connected")}
          value={`${format.formatNumber(summary.totals.connectedCount)} / ${format.formatNumber(summary.totals.toolCount)}`}
          subtitle={t("sources.summary.detectedLocally")}
        />
        <SummaryCard
          icon={<FolderOpen className="size-4" />}
          label={t("sources.summary.events")}
          value={format.formatNumber(summary.totals.eventCount)}
          subtitle={t("sources.summary.allSources")}
        />
        <SummaryCard
          icon={<Search className="size-4" />}
          label={t("sources.summary.noLogs")}
          value={format.formatNumber(summary.totals.noLogsCount)}
          subtitle={t("sources.summary.missingLogs")}
        />
        <SummaryCard
          icon={<TriangleAlert className="size-4" />}
          label={t("sources.summary.malformed")}
          value={format.formatNumber(summary.totals.malformedCount)}
          subtitle={
            summary.totals.malformedCount > 0
              ? t("sources.summary.needsReview")
              : t("sources.summary.noAnomalies")
          }
          warn={summary.totals.malformedCount > 0}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
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
              className={`tt-num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-surface text-muted-foreground hover:text-foreground"}`}
            >
              {t(filter.labelKey)}
              <span className="text-[10px] opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <section className="tt-panel p-3">
        <header className="px-1 pb-3 text-[13px] font-medium tracking-[0.025em]">
          {t("sources.agentEcosystem", {
            count: format.formatNumber(filtered.length),
          })}
        </header>
        {filtered.length === 0 ? (
          <EmptyState
            title={t("sources.empty.title")}
            desc={t("sources.empty.desc")}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {filtered.map((entry) => (
              <SourceCard
                key={entry.id}
                entry={entry}
                onMigrate={() => setMigrationSource(entry)}
              />
            ))}
          </div>
        )}
      </section>

      {migrationSource !== null && (
        <SourceMigrationModal
          source={migrationSource}
          onClose={() => setMigrationSource(null)}
          onDone={handleRefresh}
        />
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  subtitle,
  warn = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  subtitle: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={warn ? "text-warn" : "text-primary"}>{icon}</span>
        {label}
      </div>
      <div
        className={`tt-num mt-1 text-lg font-semibold ${warn ? "text-warn" : "text-foreground"}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>
    </div>
  );
}

function SourceCard({
  entry,
  onMigrate,
}: {
  entry: SourcesQueryEntry;
  onMigrate: () => void;
}) {
  const { t, format } = useI18n();
  const meta = STATUS_META[entry.status];
  const hasPaths = entry.paths.length > 0;
  // 迁移按钮仅在工具确实有 Skill 根且存在 Skill 时可用。
  const canMigrate = entry.skillCount !== null && entry.skillCount > 0;

  return (
    <article className="rounded-xl bg-surface-2/60 p-3.5 transition-colors hover:bg-surface-2">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`size-1.5 shrink-0 rounded-sm ${meta.dot}`} />
          <BrandIcon name={entry.name} className="size-4 shrink-0" />
          <h2 className="truncate text-[13px] font-medium">{entry.name}</h2>
          <span className="shrink-0 rounded-sm border border-border px-1.5 py-px text-[10px] text-muted-foreground">
            {t(SURFACE_LABEL[entry.toolSurface])}
          </span>
        </div>
        <span className={`shrink-0 text-[11px] ${meta.color}`}>
          {t(meta.labelKey)}
        </span>
      </header>

      <div className="tt-num mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <FolderOpen className="size-3.5" />
          {t("sources.row.files", {
            read: format.formatNumber(entry.filesRead),
            considered: format.formatNumber(entry.filesConsidered),
          })}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Boxes className="size-3.5" />
          {entry.skillCount === null
            ? t("sources.row.skillsUnavailable")
            : t("sources.row.boundSkills", {
                count: format.formatNumber(entry.skillCount),
              })}
        </span>
        <span className={entry.malformedLines > 0 ? "text-warn" : ""}>
          {entry.malformedLines > 0 && (
            <TriangleAlert className="mr-1 inline size-3.5" />
          )}
          {t("sources.row.malformed", {
            count: format.formatNumber(entry.malformedLines),
          })}
        </span>
        <span>
          {t("sources.row.lastScan", {
            time: entry.lastScannedAt
              ? format.formatDateTime(entry.lastScannedAt, false)
              : "—",
          })}
        </span>
      </div>

      <div className="mt-2 border-t border-border pt-2 text-[12px] leading-relaxed text-muted-foreground">
        <span className="text-foreground/70">
          {t("sources.row.paths", { paths: "" })}
        </span>
        <span className="tt-num ml-1 break-all">
          {hasPaths
            ? entry.paths.join(" · ")
            : t("sources.row.pathsUnavailable")}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canMigrate}
          title={canMigrate ? undefined : t("sources.migrate.noSkills")}
          onClick={onMigrate}
          className={`inline-flex items-center gap-1.5 rounded-sm bg-foreground px-2.5 py-1.5 font-mono text-[11px] font-semibold text-background ${canMigrate ? "transition-opacity hover:opacity-90" : "cursor-not-allowed opacity-40"}`}
        >
          <ArrowLeftRight className="size-3.5" strokeWidth={2} />
          {t("sources.migrate.button")}
        </button>
        <span className="tt-num text-[10px] text-muted-foreground">
          {t("sources.row.parsing", {
            label: t(LOG_PARSING_LABEL[entry.usageLogParsing]),
          })}
        </span>
        {entry.officialDownloadUrl ? (
          <a
            href={entry.officialDownloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" />
            {t(
              entry.status === "not-installed"
                ? "sources.row.download"
                : "sources.row.official",
            )}
          </a>
        ) : (
          <span className="ml-auto text-[12px] text-muted-foreground">
            {t("sources.row.downloadUnavailable")}
          </span>
        )}
      </div>
    </article>
  );
}
