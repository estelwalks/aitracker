import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  PenLine,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { ChunkErrorBoundary } from "../../../components/ChunkErrorBoundary";
import { InsightCard } from "../../insights/index.ts";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import {
  getPreference,
  removePreference,
} from "../../../lib/preferences/client.ts";
import {
  addPeriods,
  dayKeyOf,
  periodContains,
  periodKeyOf,
  periodStartDate,
  sumPeriodDensity,
  type PeriodGranularity,
} from "../period.ts";
import {
  generateReportNow,
  getReportBody,
  saveReportBody,
} from "../server-fns.ts";
import { ReportSchedule } from "./ReportSchedule.tsx";
import { useDraftAutosave, useReportActions } from "./report-actions.ts";
import { MarkdownView } from "./markdown.tsx";
import type { ReportListItem, ReportQueryViewModel } from "./index.ts";

// P6-T6-05: the period calendar only expands when the user clicks its toggle,
// so it stays an on-demand chunk with an error fallback.
const PeriodCalendar = lazy(() =>
  import("./PeriodCalendar.tsx").then((module) => ({
    default: module.PeriodCalendar,
  })),
);

const WEEKDAY_SUFFIX = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const KINDS: {
  k: PeriodGranularity;
  labelKey: "reports.kind.day" | "reports.kind.week" | "reports.kind.month";
  hintKey:
    "reports.kind.dayHint" | "reports.kind.weekHint" | "reports.kind.monthHint";
}[] = [
  { k: "day", labelKey: "reports.kind.day", hintKey: "reports.kind.dayHint" },
  {
    k: "week",
    labelKey: "reports.kind.week",
    hintKey: "reports.kind.weekHint",
  },
  {
    k: "month",
    labelKey: "reports.kind.month",
    hintKey: "reports.kind.monthHint",
  },
];

type GenerationFailureKey =
  | "reports.body.generationFailed"
  | "reports.body.generationTimedOut"
  | "reports.body.generationCancelled"
  | "reports.body.generationLimitReached";

function generationFailureKey(errorCode?: string): GenerationFailureKey {
  switch (errorCode) {
    case "errors.reports.timeout":
      return "reports.body.generationTimedOut";
    case "errors.reports.cancelled":
      return "reports.body.generationCancelled";
    case "errors.reports.budgetExceeded":
      return "reports.body.generationLimitReached";
    default:
      return "reports.body.generationFailed";
  }
}

const mdKey = (key: string) => `tt.report.${key}.md`;

/** Mirror of the prototype's `Period` shape, derived from a period key. */
interface PeriodModel {
  readonly kind: PeriodGranularity;
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly short: string;
}

function periodModel(
  granularity: PeriodGranularity,
  key: string,
  t: ReturnType<typeof useI18n>["t"],
): PeriodModel {
  const start = periodStartDate(granularity, key);
  const safeStart = start ?? new Date();
  const year = safeStart.getFullYear();
  const month = safeStart.getMonth() + 1;
  const day = safeStart.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (granularity === "day") {
    return {
      kind: granularity,
      key,
      from: key,
      to: key,
      label: `${year}年${month}月${day}日 · ${WEEKDAY_SUFFIX[safeStart.getDay()]}`,
      short: `${month}/${day}`,
    };
  }
  if (granularity === "week") {
    const monday = start ?? safeStart;
    const sunday = new Date(
      monday.getFullYear(),
      monday.getMonth(),
      monday.getDate() + 6,
    );
    const from = dayKeyOf(monday);
    const to = dayKeyOf(sunday);
    const suffix = t("reports.period.weekSuffix");
    return {
      kind: granularity,
      key,
      from,
      to,
      label: `${year}年 ${month}/${day} – ${sunday.getMonth() + 1}/${sunday.getDate()} ${suffix}`,
      short: `${month}/${day}周`,
    };
  }
  const lastDay = new Date(year, month, 0).getDate();
  return {
    kind: granularity,
    key,
    from: `${key}-01`,
    to: `${key}-${pad(lastDay)}`,
    label: `${year} 年 ${month} 月`,
    short: `${year}-${pad(month)}`,
  };
}

function isFuturePeriod(
  granularity: PeriodGranularity,
  key: string,
  now: Date,
): boolean {
  const start = periodStartDate(granularity, key);
  return start ? start.getTime() > now.getTime() : true;
}

function definitionFor(
  granularity: PeriodGranularity,
): "reports.daily" | "reports.weekly" {
  // Only daily/weekly definitions exist; week/month browsing generates the
  // weekly review (a monthly definition is a follow-up).
  return granularity === "day" ? "reports.daily" : "reports.weekly";
}

/**
 * /reports (日报 / 周报) faithfully mirrors the V3.0 prototype layout:
 * hero JarvisInsight → ReportSchedule → sticky archive bar (日报/周报/月报
 * segmented + period pills with real session counts and a saved-dot + archive
 * search) → report body card (period label + real session/token/cost stats +
 * "立即生成" + PeriodCalendar + "今天/本周/本月") → inline preview/edit Markdown
 * editor → rewrite confirm modal.
 *
 * All figures come from the server read model: `feed.density` aggregates real
 * sessions by day, report/run counts come from persisted documents/runs, and
 * each archived pill maps to a persisted report. Generation stays real
 * (`generateReportNow`). Without a model profile the generation entry point
 * becomes a setup CTA. Edits are user-authored drafts
 * kept in this browser (`tt.report.<period>.md`, 30s autosave), the
 * server's persisted bodies stay read-only.
 */
export function ReportsPage({ initial }: { initial: ReportQueryViewModel }) {
  const { t, format } = useI18n();
  const router = useRouter();
  const feed = initial.feed;
  const offline = feed.offline;
  const generateBlocked = feed.disabled || offline;

  const [now] = useState(() => new Date());
  const [kind, setKind] = useState<PeriodGranularity>("day");
  const [selectedKey, setSelectedKey] = useState<string>(() =>
    periodKeyOf("day", new Date()),
  );
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [body, setBody] = useState("");
  const [askRewrite, setAskRewrite] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generationFailure, setGenerationFailure] =
    useState<GenerationFailureKey | null>(null);
  const [preferredReport, setPreferredReport] = useState<{
    selection: string;
    reportId: string;
  } | null>(null);
  const dirtyRef = useRef(false);

  /** Timeline of periods ending at "now" (newest → oldest), filling the bar. */
  const periods = useMemo(() => {
    const span = kind === "day" ? 9 : kind === "week" ? 8 : 12;
    const anchor = periodKeyOf(kind, now);
    const out: PeriodModel[] = [];
    for (let index = 0; index < span; index += 1) {
      const key = addPeriods(kind, anchor, -index);
      out.push(periodModel(kind, key, t));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, now]);

  const period = periodModel(kind, selectedKey, t);
  const periodMetric = useMemo(
    () => sumPeriodDensity(feed.density, kind, selectedKey),
    [feed.density, kind, selectedKey],
  );

  /** A report is "archived" in the period containing its generatedAt. */
  const reportInPeriod = (key: string): ReportListItem | undefined => {
    const preferred = kind === "day" ? "daily" : "weekly";
    let fallback: ReportListItem | undefined;
    for (const report of feed.reports) {
      if (!report.generatedAt) continue;
      if (periodContains(kind, key, dayKeyOf(new Date(report.generatedAt)))) {
        if (report.kind === preferred) return report;
        fallback ??= report;
      }
    }
    return fallback;
  };

  const selection = `${kind}:${selectedKey}`;
  const activeReport =
    preferredReport?.selection === selection
      ? (feed.reports.find(
          (report) => report.reportId === preferredReport.reportId,
        ) ?? reportInPeriod(selectedKey))
      : reportInPeriod(selectedKey);

  const filteredPeriods = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return periods;
    return periods.filter((item) => {
      const hasReport = feed.reports.some(
        (report) =>
          report.generatedAt &&
          periodContains(
            kind,
            item.key,
            dayKeyOf(new Date(report.generatedAt)),
          ) &&
          report.title.toLocaleLowerCase().includes(q),
      );
      return (
        item.label.toLocaleLowerCase().includes(q) ||
        item.from.includes(q) ||
        item.short.toLocaleLowerCase().includes(q) ||
        hasReport
      );
    });
  }, [periods, query, kind, feed.reports]);

  /* Load the body for the selected period: saved draft first, else the
     persisted report body (read-only from the server). */
  useEffect(() => {
    setMode("preview");
    dirtyRef.current = false;
    const report = activeReport;
    let cancelled = false;
    void getPreference(mdKey(selectedKey))
      .then(async (saved) => {
        if (typeof saved === "string") return saved;
        if (!report?.reportId) return "";
        return (
          (await getReportBody({ data: { reportId: report.reportId } }))
            ?.body ?? ""
        );
      })
      .then((nextBody) => {
        if (!cancelled) setBody(nextBody);
      })
      .catch(() => {
        if (!cancelled) setBody("");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, activeReport?.reportId]);

  const { exportMd } = useReportActions(
    body,
    activeReport?.title ?? period.label,
  );
  const { savedAt: autoSavedAt, flush } = useDraftAutosave(
    mdKey(selectedKey),
    body,
    dirtyRef,
  );
  const savedAtLabel = autoSavedAt ? autoSavedAt.slice(0, 5) : null;

  const handleSave = async () => {
    if (!activeReport?.reportId) {
      toast.error(t("common.failed"));
      return;
    }
    try {
      const result = await saveReportBody({
        data: { reportId: activeReport.reportId, body },
      });
      if (!result.saved) {
        toast.error(t("common.failed"));
        return;
      }
      dirtyRef.current = false;
      void removePreference(mdKey(selectedKey));
      flush();
      toast.success(t("reports.body.save"));
    } catch {
      toast.error(t("common.failed"));
    }
  };

  const switchKind = (next: PeriodGranularity) => {
    setGenerationFailure(null);
    setKind(next);
    setSelectedKey(periodKeyOf(next, now));
  };

  const selectPeriod = (key: string) => {
    setGenerationFailure(null);
    setSelectedKey(key);
  };

  const doGenerate = async () => {
    if (generating) return;
    setGenerationFailure(null);
    setGenerating(true);
    try {
      const result = await generateReportNow({
        data: {
          definitionId: definitionFor(kind),
          granularity: kind,
          periodKey: selectedKey,
        },
      });
      if (!result.triggered || !result.reportId) {
        const failureKey = generationFailureKey(result.errorCode);
        setGenerationFailure(failureKey);
        toast.error(t(failureKey));
        return;
      }

      const content = await getReportBody({
        data: { reportId: result.reportId },
      });
      if (!content?.body.trim()) {
        const failureKey = generationFailureKey(result.errorCode);
        setGenerationFailure(failureKey);
        toast.error(t(failureKey));
        return;
      }

      // A period-scoped browser edit belongs to the previous report. It must
      // not shadow the freshly generated server draft.
      void removePreference(mdKey(selectedKey));
      setPreferredReport({ selection, reportId: result.reportId });
      setMode("preview");
      dirtyRef.current = false;
      setBody(content.body);
      setGenerationFailure(null);
      toast.success(t("common.success"));
      await router.invalidate();
    } catch (error) {
      const ui = toUiError(error);
      const failureKey = generationFailureKey(ui?.code);
      setGenerationFailure(failureKey);
      toast.error(t(failureKey));
    } finally {
      setGenerating(false);
    }
  };

  const nextKey = addPeriods(kind, selectedKey, 1);
  const prevKey = addPeriods(kind, selectedKey, -1);
  return (
    <div className="space-y-4 pb-12">
      <InsightCard
        surfaceId="reports"
        variant="hero"
        title={t("reports.insight.title")}
        dotsLabel={t("reports.insight.dots")}
      />

      <div className="space-y-4">
        <ReportSchedule />

        {/* 顶部：归档筛选 + 当前周期操作（V3.0 原型） */}
        <section className="sticky top-14 z-10 rounded-xl bg-card p-2.5 shadow-[0_10px_24px_-18px_rgba(0,0,0,0.7)] ring-1 ring-border/60 backdrop-blur">
          <div className="flex flex-wrap items-center gap-2">
            <div className="aitracker-seg shrink-0">
              {KINDS.map((item) => (
                <button
                  key={item.k}
                  type="button"
                  onClick={() => switchKind(item.k)}
                  className={`aitracker-seg-item ${kind === item.k ? "aitracker-seg-on" : ""}`}
                  title={t(item.hintKey)}
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>

            {/* 最近几期：紧凑药丸 */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <button
                type="button"
                onClick={() => selectPeriod(prevKey)}
                className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 hover:opacity-80"
                aria-label={t("reports.archive.prev")}
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <div className="flex min-w-0 flex-1 items-center justify-between gap-1">
                {filteredPeriods.map((item) => {
                  const n = sumPeriodDensity(
                    feed.density,
                    kind,
                    item.key,
                  ).count;
                  const has = Boolean(reportInPeriod(item.key));
                  const active = item.key === selectedKey;
                  const f = item.from;
                  const big =
                    kind === "day"
                      ? `${Number(f.slice(5, 7))}/${Number(f.slice(8, 10))}`
                      : kind === "month"
                        ? `${Number(f.slice(5, 7))}月`
                        : `${Number(f.slice(5, 7))}/${Number(f.slice(8, 10))}–${Number(item.to.slice(5, 7))}/${Number(item.to.slice(8, 10))}`;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => selectPeriod(item.key)}
                      title={item.label}
                      className={`relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-1.5 py-1.5 font-mono text-[11px] transition-colors ${
                        active
                          ? "bg-surface-2 font-semibold text-foreground ring-1 ring-border"
                          : "text-muted-foreground hover:bg-surface-2/55"
                      } ${n || has ? "" : "opacity-45"}`}
                    >
                      <span className="aitracker-num truncate whitespace-nowrap">
                        {big}
                      </span>
                      {has && (
                        <span className="size-2 shrink-0 rounded-full bg-ok ring-2 ring-ok/20" />
                      )}
                    </button>
                  );
                })}
                {filteredPeriods.length === 0 && (
                  <span className="px-2 text-[11.5px] text-muted-foreground">
                    {t("reports.archive.noMatch")}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => selectPeriod(nextKey)}
                disabled={isFuturePeriod(kind, nextKey, now)}
                className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 hover:opacity-80 disabled:opacity-35"
                aria-label={t("reports.archive.next")}
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>

            <div className="flex w-[190px] shrink-0 items-center gap-2 rounded-full bg-surface-2 px-2.5 py-1.5">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("reports.archive.search")}
                className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="shrink-0 text-muted-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </section>

        {/* 报告主体：周期信息 + 操作 + 编辑器合并为一张卡 */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-xl bg-card p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[13px] font-semibold tracking-tight">
                  {period.label}
                </h2>
                <span className="aitracker-num mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground">
                  {t("reports.header.sessions", {
                    count: periodMetric.count,
                  })}
                  {" · "}
                  {t("reports.header.tokens", {
                    tokens: format.formatTokens(periodMetric.tokens),
                  })}
                  {" · "}
                  {t("reports.header.cost", {
                    cost: format.formatUsd(periodMetric.knownUsd),
                  })}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <ChunkErrorBoundary>
                  <Suspense
                    fallback={
                      <span className="h-8 rounded-lg bg-surface-2/70 px-2.5" />
                    }
                  >
                    <PeriodCalendar
                      granularity={kind}
                      selectedKey={selectedKey}
                      density={feed.density}
                      now={now}
                      onSelect={selectPeriod}
                    />
                  </Suspense>
                </ChunkErrorBoundary>
                <button
                  type="button"
                  onClick={() => selectPeriod(periodKeyOf(kind, now))}
                  className="rounded-full bg-surface-2 px-3 py-1.5 font-mono text-[11px] hover:opacity-80"
                >
                  {kind === "day"
                    ? t("reports.header.goToday")
                    : kind === "week"
                      ? t("reports.header.goWeek")
                      : t("reports.header.goMonth")}
                </button>
              </div>
            </div>

            {generating && (
              <div
                className="mt-3 rounded-xl border border-border/70 bg-surface-2/55 px-4 py-3"
                aria-live="polite"
                aria-busy="true"
              >
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <RefreshCw className="size-3.5 animate-spin" />
                  {t("reports.body.generationProgressTitle")}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("reports.body.generationProgressDesc")}
                </p>
                <div
                  role="progressbar"
                  aria-label={t("reports.body.generationProgressTitle")}
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-border/70"
                >
                  <div
                    className="h-full w-full animate-pulse rounded-full"
                    style={{ background: "var(--chart-1)" }}
                  />
                </div>
              </div>
            )}

            {!generating && generationFailure && (
              <div
                className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-danger/35 bg-danger/5 px-4 py-3"
                role="alert"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-danger">
                    {t("reports.body.generationFailureTitle")}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t(generationFailure)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void doGenerate()}
                  disabled={generateBlocked}
                  className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-2 text-[12px] font-medium disabled:opacity-40"
                >
                  <RefreshCw className="size-3.5" />
                  {t("reports.body.retryGeneration")}
                </button>
              </div>
            )}

            {!body ? (
              <div className="mt-3 border-t border-border/60 px-6 py-16 text-center">
                <PenLine
                  className="mx-auto size-6 text-muted-foreground"
                  strokeWidth={1.6}
                />
                <p className="mt-3 text-[12.5px] text-muted-foreground">
                  {t("reports.body.emptyTitle")}
                </p>
                {!generationFailure &&
                  (offline ? (
                    <Link
                      to="/settings"
                      search={{ section: "model" }}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-warn/15 px-4 py-2 text-[12px] font-semibold text-warn transition-colors hover:bg-warn/25"
                    >
                      <Sparkles className="size-3.5" />
                      {t("reports.insight.modelNotConfigured")}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void doGenerate()}
                      disabled={generating || generateBlocked}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
                      style={{ background: "var(--chart-1)" }}
                    >
                      {generating ? (
                        <>
                          <RefreshCw className="size-3.5 animate-spin" />
                          {t("reports.header.generating")}
                        </>
                      ) : (
                        <>
                          <Sparkles className="size-3.5" />
                          {t("reports.body.draft")}
                        </>
                      )}
                    </button>
                  ))}
              </div>
            ) : (
              <>
                <div className="mb-3 mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                  <div className="inline-flex items-center gap-1 rounded-xl bg-surface p-1">
                    {[
                      {
                        m: "preview" as const,
                        label: t("common.reports.editor.preview"),
                        icon: Eye,
                      },
                      {
                        m: "edit" as const,
                        label: t("common.reports.editor.edit"),
                        icon: PenLine,
                      },
                    ].map((option) => (
                      <button
                        key={option.m}
                        type="button"
                        onClick={() => setMode(option.m)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
                          mode === option.m
                            ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <option.icon className="size-3.5" />
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {mode === "edit" && (
                    <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
                      {savedAtLabel
                        ? t("reports.body.savedAt", { time: savedAtLabel })
                        : t("reports.body.unsaved")}
                    </span>
                  )}
                </div>

                {mode === "edit" ? (
                  <textarea
                    value={body}
                    onChange={(event) => {
                      dirtyRef.current = true;
                      setBody(event.target.value);
                    }}
                    spellCheck={false}
                    className="aitracker-scroll min-h-[460px] w-full resize-y rounded-xl bg-surface-2 p-4 font-mono text-[12.5px] leading-7 outline-none"
                  />
                ) : (
                  <div className="aitracker-scroll min-h-[460px] rounded-xl bg-surface-2/40 px-5 py-4">
                    <MarkdownView source={body} />
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {mode === "edit" && (
                    <button
                      type="button"
                      onClick={handleSave}
                      className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold text-white"
                      style={{ background: "var(--chart-1)" }}
                    >
                      <Save className="size-3.5" /> {t("reports.body.save")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setAskRewrite(true)}
                    disabled={!periodMetric.count || generating}
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-2 text-[12px] disabled:opacity-40"
                  >
                    <RefreshCw className="size-3.5" />{" "}
                    {t("reports.body.regenerate")}
                  </button>
                  <button
                    type="button"
                    onClick={exportMd}
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3.5 py-2 text-[12px]"
                  >
                    <Download className="size-3.5" />{" "}
                    {t("reports.body.exportMarkdown")}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {askRewrite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          onClick={() => setAskRewrite(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-sm rounded-xl bg-card p-5"
          >
            <div className="mb-2 flex items-center">
              <h3 className="text-[13.5px] font-semibold tracking-tight">
                {t("reports.body.rewriteTitle")}
              </h3>
              <button
                type="button"
                onClick={() => setAskRewrite(false)}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {t("reports.body.rewriteDesc", { count: periodMetric.count })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAskRewrite(false)}
                className="rounded-full bg-surface-2 px-4 py-2 text-[12px]"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAskRewrite(false);
                  void doGenerate();
                }}
                className="rounded-full px-4 py-2 text-[12px] font-semibold text-white"
                style={{ background: "var(--chart-1)" }}
              >
                {t("reports.body.rewriteConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
