import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Boxes,
  ExternalLink,
  FolderOpen,
  Search,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { BrandIcon } from "../../../../components/BrandIcon";
import { InsightCard } from "../../../insights/page/presentation/insight-card";
import {
  Card,
  ChipTabs,
  EmptyState,
  MetricGrid,
} from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import { toUiError } from "../../../../lib/errors";
import type { MessageKey } from "../../../../lib/i18n/messages";
import { getSourcesQuery, refreshSourcesQuery } from "../server-fns";
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
export { getSourcesQuery };

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
    labelKey: "sources.status.noLogsCard",
    dot: "bg-warn",
    color: "text-warn",
  },
  "not-installed": {
    labelKey: "sources.status.notInstalledCard",
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

const SURFACE_LABEL: Record<SourcesQueryEntry["toolSurface"], MessageKey> = {
  cli: "sources.type.cli",
  ide: "sources.type.ide",
  plugin: "sources.type.plugin",
  desktop: "sources.type.desktop",
};

type MigrationSourceSelection = {
  source: SourcesQueryEntry;
  installedTargetAgents: readonly string[];
};

export function SourcesPage({ initial }: { initial: SourcesQuerySummary }) {
  const { t, format } = useI18n();
  const [summary, setSummary] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [migrationSource, setMigrationSource] =
    useState<MigrationSourceSelection | null>(null);
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
  const installedSkillAgents = useMemo(
    () =>
      Array.from(
        new Set(
          summary.entries
            .filter(
              (entry) =>
                entry.status !== "not-installed" && entry.skillAgent != null,
            )
            .map((entry) => entry.skillAgent!),
        ),
      ),
    [summary.entries],
  );
  const filtered = useMemo(() => {
    return summary.entries.filter(
      (entry) => statusFilter === "all" || entry.status === statusFilter,
    );
  }, [summary.entries, statusFilter]);
  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const beforeSkillCounts = new Map(
        summary.entries.map((entry) => [entry.id, entry.skillCount]),
      );
      // The migration response is intentionally non-blocking. Read the latest
      // known projection now, then keep polling until the Skill snapshot
      // changes instead of relying on the Usage/Installation timestamp.
      const initial = await refreshSourcesQuery();
      setSummary(initial);
      toast.success(t("sources.toast.rescanStarted"));
      const hasSkillCountChanged = (next: SourcesQuerySummary) =>
        next.entries.some(
          (entry) => entry.skillCount !== beforeSkillCounts.get(entry.id),
        );
      if (hasSkillCountChanged(initial)) {
        toast.success(t("sources.toast.rescanDone"));
        return;
      }
      const startedAt = Date.now();
      const poll = async () => {
        if (Date.now() - startedAt > 600_000) return;
        try {
          const next = await getSourcesQuery();
          setSummary(next);
          if (hasSkillCountChanged(next)) {
            toast.success(t("sources.toast.rescanDone"));
            return;
          }
        } catch {
          // transient; retry on the next tick
        }
        window.setTimeout(() => void poll(), 15_000);
      };
      window.setTimeout(() => void poll(), 15_000);
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-4 pb-12">
      <InsightCard
        surfaceId="sources"
        variant="hero"
        title={t("insights.title")}
        dotsLabel={t("insights.dots")}
        rotateLabel={t("insights.rotate")}
      />

      <MetricGrid
        items={[
          {
            icon: Boxes,
            label: t("sources.summary.connected"),
            v: format.formatNumber(summary.totals.connectedCount),
            right: (
              <span className="tt-num flex items-baseline gap-1 font-mono text-[13px] text-muted-foreground">
                <span aria-hidden="true">/</span>
                <span>{format.formatNumber(summary.totals.toolCount)}</span>
              </span>
            ),
            sub: t("sources.summary.detectedLocally"),
          },
          {
            icon: FolderOpen,
            label: t("sources.summary.events"),
            v: format.formatNumber(summary.totals.eventCount),
            sub: t("sources.summary.allSources"),
          },
          {
            icon: Search,
            label: t("sources.summary.noLogs"),
            v: format.formatNumber(summary.totals.noLogsCount),
            sub: t("sources.summary.missingLogs"),
          },
          {
            icon: TriangleAlert,
            label: t("sources.summary.malformed"),
            v: format.formatNumber(summary.totals.malformedCount),
            sub:
              summary.totals.malformedCount > 0
                ? t("sources.summary.needsReview")
                : t("sources.summary.noAnomalies"),
            color:
              summary.totals.malformedCount > 0 ? "var(--warn)" : undefined,
          },
        ]}
      />

      <ChipTabs
        value={statusFilter}
        onChange={(value) => {
          setStatusFilter(value);
        }}
        options={STATUS_FILTERS.map((filter) => ({
          value: filter.key,
          label: `${t(filter.labelKey)} ${format.formatNumber(filter.key === "all" ? summary.entries.length : statusCounts[filter.key])}`,
        }))}
      />

      <Card
        title={t("sources.agentEcosystem", {
          count: format.formatNumber(filtered.length),
        })}
        bodyClassName="px-3 pb-3"
      >
        {filtered.length === 0 ? (
          <EmptyState
            title={t("sources.empty.title")}
            desc={t("sources.empty.desc")}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {filtered.map((entry) => {
              const installedTargetAgents = installedSkillAgents.filter(
                (agent) => agent !== entry.skillAgent,
              );
              return (
                <SourceCard
                  key={entry.id}
                  entry={entry}
                  hasInstalledTargets={installedTargetAgents.length > 0}
                  onMigrate={() =>
                    setMigrationSource({
                      source: entry,
                      installedTargetAgents,
                    })
                  }
                />
              );
            })}
          </div>
        )}
      </Card>

      {migrationSource !== null && (
        <SourceMigrationModal
          source={migrationSource.source}
          installedTargetAgents={migrationSource.installedTargetAgents}
          onClose={() => setMigrationSource(null)}
          onDone={handleRefresh}
        />
      )}
    </div>
  );
}

function SourceCard({
  entry,
  hasInstalledTargets,
  onMigrate,
}: {
  entry: SourcesQueryEntry;
  hasInstalledTargets: boolean;
  onMigrate: () => void;
}) {
  const { t, format } = useI18n();
  const meta = STATUS_META[entry.status];
  const hasPaths = entry.paths.length > 0;
  // 迁移按钮仅在工具确实已安装、有 Skill 根且存在 Skill 时可用。未安装的
  // 工具（例如残留 ~/.cursor 目录但没有 Cursor 本体）不允许一键迁移。
  const canMigrate =
    entry.status !== "not-installed" &&
    hasInstalledTargets &&
    entry.skillCount !== null &&
    entry.skillCount > 0;

  return (
    <article
      data-testid={`source-card-${entry.id}`}
      className="flex min-h-[184px] flex-col rounded-xl bg-surface-2/60 p-3.5 transition-colors hover:bg-surface-2"
    >
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

      <div className="mt-auto flex min-h-9 flex-wrap items-center gap-2 pt-2">
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
        {entry.officialDownloadUrl ? (
          <a
            href={entry.officialDownloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" />
            {t("sources.row.official")}
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
