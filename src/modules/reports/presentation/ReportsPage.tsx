import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { CalendarDays, FileText } from "lucide-react";
import { toast } from "sonner";

import { JarvisInsight } from "../../../components/JarvisInsight";
import {
  Dot,
  EmptyState,
  Panel,
  StatusBadge,
  TTButton,
} from "../../../components/tt";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import type { MessageKey } from "../../../lib/i18n/messages";
import {
  addPeriods,
  dayKeyOf,
  periodContains,
  periodKeyOf,
  periodStartDate,
  sumPeriodDensity,
  type PeriodGranularity,
} from "../period.ts";
import { generateReportNow } from "../server-fns.ts";
import { ArchiveBand, type ArchiveBlock } from "./ArchiveBand.tsx";
import { PeriodCalendar } from "./PeriodCalendar.tsx";
import { QuickNotes } from "./QuickNotes.tsx";
import { ReportBodyCard } from "./ReportBodyCard.tsx";
import { ReportSchedule } from "./ReportSchedule.tsx";
import type {
  ReportListItem,
  ReportQueryViewModel,
  ReportUiStatus,
} from "./index.ts";

const TIMELINE_WINDOW = 8;
const GRANULARITIES: readonly PeriodGranularity[] = ["day", "week", "month"];

const STATUS_TONE: Record<
  ReportUiStatus,
  "neutral" | "primary" | "ok" | "warn" | "danger"
> = {
  draft: "warn",
  running: "primary",
  "waiting-approval": "warn",
  failed: "danger",
  published: "ok",
  stale: "neutral",
};

const STATUS_LABEL_KEY: Record<ReportUiStatus, MessageKey> = {
  draft: "common.status.waitingApproval",
  running: "common.status.running",
  "waiting-approval": "common.status.waitingApproval",
  failed: "common.status.failed",
  published: "common.status.fresh",
  stale: "common.status.stale",
};

function definitionFor(
  granularity: PeriodGranularity,
): "reports.daily" | "reports.weekly" {
  // Only daily/weekly definitions exist; month browsing generates the weekly
  // review (a monthly definition is a follow-up).
  return granularity === "day" ? "reports.daily" : "reports.weekly";
}

/**
 * /reports (简报与记忆) aligned with the V3.0 prototype: Jarvis insight card →
 * sticky history archive band → ReportSchedule → report header (period label +
 * real session/token/cost stats + today/week/month shortcut + "立即生成" +
 * PeriodCalendar) → inline body card → quick notes.
 *
 * All figures come from the server read model: `feed.density` aggregates real
 * sessions by day (via the composition root's sessions port), report/run counts
 * come from persisted documents/runs, and the archived dots map each period to
 * a persisted report. Generation stays LLM-gated (`feed.offline`/`disabled`);
 * without a configured model the buttons are disabled with an honest hint.
 */
export function ReportsPage({ initial }: { initial: ReportQueryViewModel }) {
  const { t, format } = useI18n();
  const router = useRouter();
  const feed = initial.feed;
  const reports = feed.reports;
  const offline = feed.offline;
  const disabled = feed.disabled;
  const generateBlocked = offline || disabled;
  const generateHint = generateBlocked
    ? t("common.reports.generateHint")
    : undefined;

  const [now] = useState(() => new Date());
  const [granularity, setGranularity] = useState<PeriodGranularity>("day");
  const [selectedKey, setSelectedKey] = useState<string>(() =>
    periodKeyOf("day", new Date()),
  );
  const [windowOffset, setWindowOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [generating, setGenerating] = useState(false);

  /** A report is "archived" in the period containing its generatedAt. */
  const archivedByGranularity = useMemo(() => {
    const result: Record<PeriodGranularity, Set<string>> = {
      day: new Set(),
      week: new Set(),
      month: new Set(),
    };
    for (const report of reports) {
      if (!report.generatedAt) continue;
      const date = new Date(report.generatedAt);
      if (Number.isNaN(date.getTime())) continue;
      for (const granularityItem of GRANULARITIES) {
        result[granularityItem].add(periodKeyOf(granularityItem, date));
      }
    }
    return result;
  }, [reports]);

  const periodLabel = (
    granularityItem: PeriodGranularity,
    key: string,
  ): string => {
    const start = periodStartDate(granularityItem, key);
    if (!start) return key;
    if (granularityItem === "month") {
      return format.formatDate(start, { year: "numeric", month: "long" });
    }
    if (granularityItem === "week") {
      return format.formatDate(start, { month: "2-digit", day: "2-digit" });
    }
    return format.formatDate(start);
  };

  const blocks: readonly ArchiveBlock[] = useMemo(() => {
    const endKey = addPeriods(granularity, selectedKey, windowOffset);
    const startKey = addPeriods(granularity, endKey, -(TIMELINE_WINDOW - 1));
    const out: ArchiveBlock[] = [];
    for (let index = 0; index < TIMELINE_WINDOW; index += 1) {
      const key = addPeriods(granularity, startKey, index);
      const metric = sumPeriodDensity(feed.density, granularity, key);
      out.push({
        key,
        label: periodLabel(granularity, key),
        count: metric.count,
        archived: archivedByGranularity[granularity].has(key),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, selectedKey, windowOffset, feed.density, reports, format]);

  const activeReport: ReportListItem | undefined = useMemo(() => {
    for (const report of reports) {
      if (!report.generatedAt) continue;
      if (
        periodContains(
          granularity,
          selectedKey,
          dayKeyOf(new Date(report.generatedAt)),
        )
      ) {
        return report;
      }
    }
    return undefined;
  }, [reports, granularity, selectedKey]);

  const periodMetric = useMemo(
    () => sumPeriodDensity(feed.density, granularity, selectedKey),
    [feed.density, granularity, selectedKey],
  );

  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return [];
    return reports.filter(
      (report) =>
        report.title.toLocaleLowerCase().includes(query) ||
        report.kind.includes(query),
    );
  }, [search, reports]);

  const insightLines = useMemo(() => {
    const lines: string[] = [];
    if (feed.reportCount > 0) {
      lines.push(
        t("reports.insight.reports", {
          count: format.formatNumber(feed.reportCount),
        }),
      );
    }
    if (feed.runCount > 0) {
      lines.push(
        t("reports.insight.runs", {
          count: format.formatNumber(feed.runCount),
        }),
      );
    }
    if (feed.density.total > 0) {
      lines.push(
        t("reports.insight.sessions", {
          count: format.formatNumber(feed.density.total),
        }),
      );
    }
    if (generateBlocked) {
      lines.push(t("reports.insight.modelNotConfigured"));
    }
    if (lines.length === 0) lines.push(t("reports.insight.empty"));
    return lines;
  }, [
    feed.reportCount,
    feed.runCount,
    feed.density.total,
    generateBlocked,
    t,
    format,
  ]);

  const selectGranularity = (next: PeriodGranularity) => {
    const reference = periodStartDate(granularity, selectedKey) ?? now;
    setGranularity(next);
    setSelectedKey(periodKeyOf(next, reference));
    setWindowOffset(0);
  };

  const selectPeriod = (key: string) => {
    setSelectedKey(key);
    setWindowOffset(0);
    setShowCalendar(false);
  };

  const openReportPeriod = (report: ReportListItem) => {
    if (!report.generatedAt) return;
    const date = new Date(report.generatedAt);
    const next = report.kind === "weekly" ? "week" : "day";
    setGranularity(next);
    setSelectedKey(periodKeyOf(next, date));
    setWindowOffset(0);
    setSearch("");
    setShowCalendar(false);
  };

  const handleGenerate = async () => {
    if (generateBlocked || generating) return;
    setGenerating(true);
    try {
      const result = await generateReportNow({
        data: { definitionId: definitionFor(granularity) },
      });
      if (result.triggered) {
        toast.success(t("common.success"));
        await router.invalidate();
      } else {
        toast.error(t("common.failed"));
      }
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <div className="mb-3">
        <JarvisInsight
          title={t("reports.insight.title")}
          lines={insightLines}
          rotateLabel={t("insights.rotate")}
          dotsLabel={t("insights.dots")}
        />
      </div>

      {(offline || disabled) && (
        <div className="mb-3 rounded-sm border border-border bg-surface px-3 py-2 text-[12px] text-muted-foreground">
          {offline ? t("common.status.offline") : t("common.status.disabled")}
          {disabled && ` · ${t("common.reports.generateHint")}`}
        </div>
      )}

      <ArchiveBand
        granularity={granularity}
        onGranularity={selectGranularity}
        search={search}
        onSearch={setSearch}
        blocks={blocks}
        selectedKey={selectedKey}
        onSelect={selectPeriod}
        onPrev={() => setWindowOffset((value) => value - TIMELINE_WINDOW)}
        onNext={() => setWindowOffset((value) => value + TIMELINE_WINDOW)}
      />

      <ReportSchedule />

      <section className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight">
              {periodLabel(granularity, selectedKey)}
            </h2>
            <p className="tt-num mt-0.5 font-mono text-[11px] text-muted-foreground">
              {t("reports.header.sessions", { count: periodMetric.count })}
              {" · "}
              {t("reports.header.tokens", {
                tokens: format.formatTokens(periodMetric.tokens),
              })}
              {" · "}
              {t("reports.header.cost", {
                cost: format.formatUsd(periodMetric.knownUsd),
              })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCalendar((value) => !value)}
              aria-expanded={showCalendar}
              title={t("reports.calendar.toggle")}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-colors ${
                showCalendar
                  ? "bg-surface-2 text-foreground"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <CalendarDays className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => selectPeriod(periodKeyOf(granularity, now))}
              className="rounded-full bg-surface-2 px-3 py-1.5 font-mono text-[11px] transition-opacity hover:opacity-80"
            >
              {granularity === "day"
                ? t("reports.header.goToday")
                : granularity === "week"
                  ? t("reports.header.goWeek")
                  : t("reports.header.goMonth")}
            </button>
            <TTButton
              variant="primary"
              disabled={generateBlocked || generating}
              title={generateBlocked ? generateHint : undefined}
              onClick={() => void handleGenerate()}
            >
              <FileText className="size-3.5" />
              {generating
                ? t("reports.header.generating")
                : t("reports.header.generate")}
            </TTButton>
          </div>
        </div>

        {showCalendar && (
          <div className="relative mt-3 z-10">
            <PeriodCalendar
              granularity={granularity}
              selectedKey={selectedKey}
              density={feed.density}
              now={now}
              onSelect={selectPeriod}
            />
          </div>
        )}
      </section>

      {search.trim() ? (
        <Panel className="mt-3" title={t("reports.body.reportList")}>
          {searchResults.length === 0 ? (
            <EmptyState
              title={t("reports.body.noMatch")}
              desc={t("reports.body.noReports")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {searchResults.map((report) => (
                <ReportRow
                  key={report.reportId ?? report.runId ?? report.definitionId}
                  report={report}
                  onOpen={() => openReportPeriod(report)}
                />
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <>
          <ReportBodyCard
            report={activeReport}
            sessionCount={periodMetric.count}
            generateBlocked={generateBlocked}
            generateHint={generateHint}
            onGenerate={() => void handleGenerate()}
            onRegenerate={() => void handleGenerate()}
          />
          <QuickNotes />
        </>
      )}
    </>
  );
}

function ReportRow({
  report,
  onOpen,
}: {
  report: ReportListItem;
  onOpen: () => void;
}) {
  const { t, format } = useI18n();
  const tone = STATUS_TONE[report.status];
  return (
    <li
      className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1.5 px-1 py-3 text-[13px] transition-colors hover:bg-surface-2/50"
      onClick={onOpen}
    >
      <div className="flex w-full items-center gap-2">
        <Dot className="bg-primary" />
        <span className="truncate font-medium text-foreground">
          {report.title}
        </span>
        <StatusBadge tone={tone}>
          {t(STATUS_LABEL_KEY[report.status])}
        </StatusBadge>
      </div>
      <div className="flex w-full flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {t(
            report.kind === "weekly"
              ? "common.reports.kindWeekly"
              : "common.reports.kindDaily",
          )}
          {report.templateVersion !== undefined && (
            <> · v{report.templateVersion}</>
          )}
        </span>
        {report.generatedAt && (
          <span className="tt-num">
            {format.formatDateTime(report.generatedAt, false)}
          </span>
        )}
        {report.errorCode && (
          <span className="text-danger">{report.errorCode}</span>
        )}
      </div>
    </li>
  );
}
