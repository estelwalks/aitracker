import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  FolderOpen,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageHeader, Panel, StatusBadge, TTButton } from "../components/tt";
import { toUiError } from "../lib/errors";
import { useI18n } from "../lib/i18n/context";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import {
  filterAllLabel,
  severityLabels,
  sourceLabels,
  verdictLabels,
} from "../lib/security/labels";
import {
  consumeDailyScan,
  DAILY_SCAN_LIMIT,
  readDailyScanCount,
  seedDailyCountFromPlatform,
} from "../lib/security/daily-limit";
import { readLocalSkillFile } from "../lib/security/input-validation";
import {
  clearSecurityHistory,
  loadSecurityHistory,
  saveSecurityHistory,
  trimReportForHistory,
} from "../lib/security/history";
import { formatDuration, getSecurityStats } from "../lib/security/presentation";
import {
  SECURITY_RULE_KINDS,
  SECURITY_RULES_VERSION,
} from "../lib/security/rules";
import {
  scanSecurityFilesWithProgress,
  type SecurityReport,
  type SecuritySeverity,
} from "../lib/security/scanner";

export const Route = createFileRoute("/security")({
  loader: ({ location }) => ({
    locale: resolveLocaleFromSearch(location.search),
  }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.security",
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "security.pageDescription",
        ),
      },
    ],
  }),
  component: SecurityPage,
});

type VerdictFilter = "全部" | "安全" | "可疑" | "危险";
type ScanPhase = "空闲" | "扫描中" | "已完成";

const SCAN_STEPS = ["读取本地 SKILL.md", ...SECURITY_RULE_KINDS];

const severityClass: Record<SecuritySeverity, string> = {
  高危: "text-danger",
  中危: "text-warn",
  低危: "text-muted-foreground",
};

function verdictClass(verdict: SecurityReport["verdict"]): string {
  return verdict === "危险"
    ? "text-danger"
    : verdict === "可疑"
      ? "text-warn"
      : "text-ok";
}

function verdictTone(
  verdict: SecurityReport["verdict"],
): "ok" | "warn" | "danger" {
  return verdict === "危险" ? "danger" : verdict === "可疑" ? "warn" : "ok";
}

function SecurityPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<ScanPhase>("空闲");
  const [completedSteps, setCompletedSteps] = useState(0);
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [source, setSource] = useState<{
    name: string;
    content: string;
  } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [history, setHistory] = useState<SecurityReport[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("全部");
  const [used, setUsed] = useState(() =>
    typeof window === "undefined" ? 0 : readDailyScanCount(window.localStorage),
  );
  const { t, format } = useI18n();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      await seedDailyCountFromPlatform();
      const [reports] = await Promise.all([loadSecurityHistory()]);
      if (cancelled) return;
      setUsed(readDailyScanCount(window.localStorage));
      setHistory(reports);
      setHistoryLoaded(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const remaining = Math.max(0, DAILY_SCAN_LIMIT - used);
  const stats = useMemo(() => getSecurityStats(history), [history]);
  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return history.filter((item) => {
      if (verdictFilter !== "全部" && item.verdict !== verdictFilter)
        return false;
      return !query || item.targetName.toLowerCase().includes(query);
    });
  }, [history, historyQuery, verdictFilter]);

  const runScan = async (files: FileList) => {
    if (files.length === 0 || phase === "扫描中") return;
    try {
      // 读取、文件名及 100MB 校验都发生在额度消费之前。
      const selected = await readLocalSkillFile(files);
      const nextUsed = consumeDailyScan(window.localStorage);
      setUsed(nextUsed);
      setPhase("扫描中");
      setCompletedSteps(1);
      setReport(null);
      setSource(null);
      setShowSource(false);
      const startedAt = performance.now();
      const next = await scanSecurityFilesWithProgress(
        [{ name: selected.name, content: selected.content }],
        [],
        ({ completedDimensions }) => setCompletedSteps(completedDimensions + 1),
      );
      const completedReport = {
        ...next,
        targetName: selected.targetName,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
      const nextHistory = [completedReport, ...history];
      setReport(completedReport);
      setSource({ name: selected.name, content: selected.content });
      setHistory(nextHistory);
      setPhase("已完成");
      void saveSecurityHistory(nextHistory.map(trimReportForHistory));
      toast.success(
        t("security.toast.scanDone", {
          verdict: t(verdictLabels[completedReport.verdict]),
        }),
      );
    } catch (error) {
      setPhase("空闲");
      setCompletedSteps(0);
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    }
  };

  const resetReport = () => {
    if (!window.confirm(t("security.confirm.deleteReport"))) return;
    setReport(null);
    setSource(null);
    setShowSource(false);
    setPhase("空闲");
    setCompletedSteps(0);
  };

  const clearHistory = async () => {
    if (!window.confirm(t("security.confirm.clearHistory"))) return;
    setHistory([]);
    await clearSecurityHistory();
    toast.success(t("security.toast.historyCleared"));
  };

  const progress = Math.round((completedSteps / SCAN_STEPS.length) * 100);
  const statCards = [
    {
      label: t("security.stats.scanned"),
      value: format.formatNumber(stats.scanned),
      className: "",
    },
    {
      label: t(verdictLabels["安全"]),
      value: format.formatNumber(stats.safe),
      className: "text-ok",
    },
    {
      label: t(verdictLabels["可疑"]),
      value: format.formatNumber(stats.suspicious),
      className: "text-warn",
    },
    {
      label: t(verdictLabels["危险"]),
      value: format.formatNumber(stats.dangerous),
      className: "text-danger",
    },
    {
      label: t("security.stats.averageDuration"),
      value:
        stats.scanned === 0 ? "—" : formatDuration(stats.averageDurationMs),
      className: "",
    },
    {
      label: t("security.stats.rulesVersion"),
      value: `v${SECURITY_RULES_VERSION}`,
      className: "",
    },
  ];

  return (
    <>
      <PageHeader
        title={t("security.pageHeader")}
        desc={t("security.pageHeaderDesc")}
      />

      <div className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {statCards.map((card) => (
          <div key={card.label} className="bg-surface-1 px-3 py-2.5">
            <div className="tt-label text-[11px] text-muted-foreground">
              {card.label}
            </div>
            <div
              className={`tt-num mt-1 text-lg leading-none ${card.className}`}
            >
              {card.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-3 rounded-sm border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted-foreground">
        {t("security.rulesNotice", { version: SECURITY_RULES_VERSION })}
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void runScan(event.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-sm border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging
            ? "border-primary bg-primary/10"
            : "border-border-strong bg-surface-1"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          className="hidden"
          onChange={(event) =>
            event.target.files && void runScan(event.target.files)
          }
        />
        <input
          ref={(element) => {
            directoryInputRef.current = element;
            element?.setAttribute("webkitdirectory", "");
            element?.setAttribute("directory", "");
          }}
          type="file"
          multiple
          className="hidden"
          onChange={(event) =>
            event.target.files && void runScan(event.target.files)
          }
        />
        <Upload className="size-7 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">
          {t("security.dropzone.title")}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {t("security.dropzone.hint")}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground/80">
          {t("security.dropzone.tccHint")}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <TTButton
            disabled={phase === "扫描中" || remaining === 0}
            onClick={() => fileInputRef.current?.click()}
          >
            {t("security.dropzone.selectFile")}
          </TTButton>
          <TTButton
            disabled={phase === "扫描中" || remaining === 0}
            onClick={() => directoryInputRef.current?.click()}
          >
            <FolderOpen className="size-3.5" />{" "}
            {t("security.dropzone.selectFolder")}
          </TTButton>
        </div>
        <p className="tt-num mt-3 text-[11px] text-muted-foreground">
          {t("security.dropzone.remaining", {
            remaining: format.formatNumber(remaining),
            limit: format.formatNumber(DAILY_SCAN_LIMIT),
          })}
        </p>
      </div>

      {phase === "扫描中" && (
        <Panel
          className="mb-3"
          title={t("security.scanning.title", { progress })}
        >
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-primary transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <ol className="mt-3 grid gap-1 text-[12px] sm:grid-cols-2 lg:grid-cols-3">
            {SCAN_STEPS.map((step, index) => {
              const done = index < completedSteps;
              const current = index === completedSteps;
              const label = index === 0 ? t("security.scanSteps.read") : step;
              return (
                <li
                  key={step}
                  className={`flex items-center gap-2 ${done ? "text-ok" : current ? "text-foreground" : "text-muted-foreground/50"}`}
                >
                  {done ? (
                    <Check className="size-3.5" />
                  ) : (
                    <span className="tt-num grid size-3.5 place-items-center rounded-full border text-[9px]">
                      {index + 1}
                    </span>
                  )}
                  {label}
                </li>
              );
            })}
          </ol>
        </Panel>
      )}

      {report && (
        <SecurityReportPanel
          report={report}
          source={source}
          showSource={showSource}
          onDelete={resetReport}
          onToggleSource={() => {
            if (!source) {
              toast.message(t("security.toast.noSource"));
              return;
            }
            setShowSource((visible) => !visible);
          }}
        />
      )}

      <Panel
        title={t("security.history.title")}
        className="mt-3"
        action={
          history.length > 0 ? (
            <TTButton
              size="sm"
              variant="ghost"
              disabled={!historyLoaded}
              onClick={() => void clearHistory()}
            >
              <Trash2 className="size-3.5" /> {t("security.history.clear")}
            </TTButton>
          ) : undefined
        }
      >
        {!historyLoaded ? (
          <p className="text-[13px] text-muted-foreground">
            {t("security.history.loading")}
          </p>
        ) : history.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {t("security.history.empty")}
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder={t("security.history.searchPlaceholder")}
                  className="h-7 w-full rounded-sm border border-border bg-surface-2 pl-7 pr-2 text-[12px] outline-none focus:border-primary"
                />
              </label>
              {(["全部", "安全", "可疑", "危险"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setVerdictFilter(value)}
                  className={`h-7 rounded-sm border px-2 text-[11px] ${verdictFilter === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
                >
                  {value === "全部"
                    ? t(filterAllLabel)
                    : t(verdictLabels[value])}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-border">
              {filteredHistory.map((item, index) => (
                <li key={`${item.scannedAt}-${index}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setReport(item);
                      setSource(null);
                      setShowSource(false);
                      setPhase("已完成");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="flex w-full items-center gap-3 py-2 text-left text-[13px] hover:bg-accent/40"
                  >
                    <span className="tt-num text-muted-foreground">
                      {format.formatDateTime(item.scannedAt, false)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.targetName}
                    </span>
                    <span className="tt-num hidden text-[11px] text-muted-foreground sm:inline">
                      {formatDuration(item.durationMs)}
                    </span>
                    <StatusBadge tone={verdictTone(item.verdict)}>
                      {t(verdictLabels[item.verdict])}
                    </StatusBadge>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {t("security.history.showing", {
                shown: format.formatNumber(filteredHistory.length),
                total: format.formatNumber(history.length),
              })}
            </p>
          </>
        )}
      </Panel>
    </>
  );
}

function SecurityReportPanel({
  report,
  source,
  showSource,
  onDelete,
  onToggleSource,
}: {
  report: SecurityReport;
  source: { name: string; content: string } | null;
  showSource: boolean;
  onDelete: () => void;
  onToggleSource: () => void;
}) {
  const { t, format } = useI18n();
  const VerdictIcon =
    report.verdict === "危险"
      ? ShieldX
      : report.verdict === "可疑"
        ? ShieldAlert
        : ShieldCheck;
  const riskByKind = new Map(
    SECURITY_RULE_KINDS.map((kind) => [
      kind,
      report.risks.filter((risk) => risk.kind === kind),
    ]),
  );
  const preview =
    source && source.content.length > 200_000
      ? `${source.content.slice(0, 200_000)}\n\n${t("security.report.sourceTruncated")}`
      : source?.content;

  return (
    <Panel
      className="mb-3"
      title={t("security.report.title", { name: report.targetName })}
      action={
        <div className="flex gap-1">
          <TTButton size="sm" variant="ghost" onClick={onToggleSource}>
            <Eye className="size-3.5" /> {t("security.report.viewSource")}
          </TTButton>
          <TTButton size="sm" variant="danger" onClick={onDelete}>
            <Trash2 className="size-3.5" /> {t("common.delete")}
          </TTButton>
        </div>
      }
    >
      <div
        className={`flex flex-wrap items-center gap-2 ${verdictClass(report.verdict)}`}
      >
        <VerdictIcon className="size-6" />
        <span className="text-sm font-semibold">
          {t("security.report.verdictLabel", {
            verdict: t(verdictLabels[report.verdict]),
          })}
        </span>
        <span className="tt-num text-lg font-semibold">{report.riskScore}</span>
        <span className="text-[11px] text-muted-foreground">
          {t("security.report.riskScore")}
        </span>
        <span className="ml-auto text-[12px]">
          {t("security.report.riskHits", {
            count: format.formatNumber(report.risks.length),
            duration: formatDuration(report.durationMs),
          })}
        </span>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        {t("security.privacy.statement")}
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full"
          style={{
            width: `${report.riskScore}%`,
            background:
              report.riskScore >= 70
                ? "var(--color-danger)"
                : report.riskScore >= 30
                  ? "var(--color-warn)"
                  : "var(--color-ok)",
          }}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {SECURITY_RULE_KINDS.map((kind, index) => {
          const risks = riskByKind.get(kind) ?? [];
          const worst = risks.some((risk) => risk.severity === "高危")
            ? "text-danger"
            : risks.length > 0
              ? "text-warn"
              : "text-ok";
          return (
            <div
              key={kind}
              className="rounded-sm border border-border bg-surface-2 p-2"
            >
              <div className="tt-num text-[10px] text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="mt-1 text-[12px]">{kind}</div>
              <div className={`mt-1 text-[11px] ${worst}`}>
                {risks.length === 0
                  ? t("security.report.pass")
                  : t("security.report.hits", {
                      count: format.formatNumber(risks.length),
                    })}
              </div>
            </div>
          );
        })}
      </div>

      {report.risks.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-sm border border-ok/30 bg-ok/10 p-3 text-[13px] text-ok">
          <Check className="size-4" />
          {t("security.report.noRisks")}
        </div>
      ) : (
        <div className="mt-4">
          <div className="tt-label mb-2">
            {t("security.report.riskDetails")}
          </div>
          <ul className="space-y-2">
            {report.risks.map((risk, index) => (
              <li
                key={`${risk.file}-${risk.line}-${risk.ruleName}-${index}`}
                className="rounded-sm border border-border bg-surface-2 p-3 text-[13px]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <AlertTriangle
                    className={`size-3.5 ${severityClass[risk.severity]}`}
                  />
                  <span className="font-medium">{risk.kind}</span>
                  <StatusBadge
                    tone={
                      risk.severity === "高危"
                        ? "danger"
                        : risk.severity === "中危"
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {t(severityLabels[risk.severity] ?? "common.unknown")}
                  </StatusBadge>
                  <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t(sourceLabels[risk.source] ?? "common.unknown")} ·{" "}
                    {risk.ruleName}
                  </span>
                  <span className="tt-num ml-auto text-[11px] text-muted-foreground">
                    {risk.file}:{risk.line}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{risk.message}</p>
                <pre className="tt-num mt-2 overflow-x-auto rounded-sm bg-background p-2 text-[11px]">
                  {risk.excerpt}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 rounded-sm border border-border bg-surface-2 p-3 text-[13px]">
        <div className="tt-label mb-1">{t("security.report.reviewTitle")}</div>
        <p className="text-muted-foreground">
          {report.verdict === "安全"
            ? t("security.review.safe")
            : report.verdict === "可疑"
              ? t("security.review.suspicious")
              : t("security.review.dangerous")}
        </p>
      </div>
      {showSource && source && (
        <div className="mt-4 rounded-sm border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[12px]">
            <span>
              {t("security.report.sourceTitle", { name: source.name })}
            </span>
            <button
              type="button"
              onClick={onToggleSource}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <pre className="max-h-96 overflow-auto p-3 text-[11px] leading-5">
            {preview}
          </pre>
        </div>
      )}
    </Panel>
  );
}
