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
  head: () => ({
    meta: [
      { title: "安全检测 · TrustTools V3.0" },
      {
        name: "description",
        content: "仅在本地解析 SKILL.md 的 11 维静态安全检测。",
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
      toast.success(`本地扫描完成：${completedReport.verdict}`);
    } catch (error) {
      setPhase("空闲");
      setCompletedSteps(0);
      toast.error(error instanceof Error ? error.message : "无法读取所选文件");
    }
  };

  const resetReport = () => {
    if (!window.confirm("删除当前报告并重置扫描器？历史记录将保留。")) return;
    setReport(null);
    setSource(null);
    setShowSource(false);
    setPhase("空闲");
    setCompletedSteps(0);
  };

  const clearHistory = async () => {
    if (!window.confirm("清除近 30 天的全部检测历史？此操作不可恢复。")) return;
    setHistory([]);
    await clearSecurityHistory();
    toast.success("已清除检测历史");
  };

  const progress = Math.round((completedSteps / SCAN_STEPS.length) * 100);
  const statCards = [
    { label: "累计扫描", value: String(stats.scanned), className: "" },
    { label: "安全", value: String(stats.safe), className: "text-ok" },
    { label: "可疑", value: String(stats.suspicious), className: "text-warn" },
    { label: "危险", value: String(stats.dangerous), className: "text-danger" },
    {
      label: "平均耗时",
      value:
        stats.scanned === 0 ? "—" : formatDuration(stats.averageDurationMs),
      className: "",
    },
    { label: "规则库版本", value: `v${SECURITY_RULES_VERSION}`, className: "" },
  ];

  return (
    <>
      <PageHeader
        title="安全检测"
        desc="仅支持 SKILL.md 与 Skill 文件夹 · 11 个安全维度本地静态扫描"
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
        内置规则库 v{SECURITY_RULES_VERSION}，随 TrustTools
        应用更新；当前没有远端规则库更新通道，因此不会发起网络请求或显示伪造的更新成功状态。
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
          拖入 SKILL.md 或 Skill 文件夹以开始扫描
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          仅支持 SKILL.md / 含 SKILL.md 的目录 · 单文件最大 100MB ·
          本地解析，不上传源码
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <TTButton
            disabled={phase === "扫描中" || remaining === 0}
            onClick={() => fileInputRef.current?.click()}
          >
            选择 SKILL.md
          </TTButton>
          <TTButton
            disabled={phase === "扫描中" || remaining === 0}
            onClick={() => directoryInputRef.current?.click()}
          >
            <FolderOpen className="size-3.5" /> 选择文件夹
          </TTButton>
        </div>
        <p className="tt-num mt-3 text-[11px] text-muted-foreground">
          今日剩余 {remaining} / {DAILY_SCAN_LIMIT} 次
        </p>
      </div>

      {phase === "扫描中" && (
        <Panel className="mb-3" title={`本地扫描中 · ${progress}%`}>
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
                  {step}
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
              toast.message("此历史报告未保存源码；请重新选择本地文件查看。 ");
              return;
            }
            setShowSource((visible) => !visible);
          }}
        />
      )}

      <Panel
        title="检测历史（近 30 天）"
        className="mt-3"
        action={
          history.length > 0 ? (
            <TTButton
              size="sm"
              variant="ghost"
              disabled={!historyLoaded}
              onClick={() => void clearHistory()}
            >
              <Trash2 className="size-3.5" /> 清除历史
            </TTButton>
          ) : undefined
        }
      >
        {!historyLoaded ? (
          <p className="text-[13px] text-muted-foreground">正在加载检测历史…</p>
        ) : history.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">尚未执行扫描。</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder="搜索检测名称…"
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
                  {value}
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
                      {new Date(item.scannedAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.targetName}
                    </span>
                    <span className="tt-num hidden text-[11px] text-muted-foreground sm:inline">
                      {formatDuration(item.durationMs)}
                    </span>
                    <StatusBadge tone={verdictTone(item.verdict)}>
                      {item.verdict}
                    </StatusBadge>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">
              展示 {filteredHistory.length} / {history.length} 条
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
      ? `${source.content.slice(0, 200_000)}\n\n… 已省略其余本地内容（未上传）`
      : source?.content;

  return (
    <Panel
      className="mb-3"
      title={`安全报告 · ${report.targetName}`}
      action={
        <div className="flex gap-1">
          <TTButton size="sm" variant="ghost" onClick={onToggleSource}>
            <Eye className="size-3.5" /> 查看源码
          </TTButton>
          <TTButton size="sm" variant="danger" onClick={onDelete}>
            <Trash2 className="size-3.5" /> 删除
          </TTButton>
        </div>
      }
    >
      <div
        className={`flex flex-wrap items-center gap-2 ${verdictClass(report.verdict)}`}
      >
        <VerdictIcon className="size-6" />
        <span className="text-sm font-semibold">
          综合判定：{report.verdict}
        </span>
        <span className="tt-num text-lg font-semibold">{report.riskScore}</span>
        <span className="text-[11px] text-muted-foreground">
          / 100 风险评分
        </span>
        <span className="ml-auto text-[12px]">
          {report.risks.length} 项命中 · {formatDuration(report.durationMs)}
        </span>
      </div>
      <p className="mt-2 text-[12px] text-muted-foreground">
        结论仅来自本地静态规则；未上传 SKILL.md、代码片段或命中详情。
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
                {risks.length === 0 ? "通过" : `${risks.length} 项命中`}
              </div>
            </div>
          );
        })}
      </div>

      {report.risks.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-sm border border-ok/30 bg-ok/10 p-3 text-[13px] text-ok">
          <Check className="size-4" />
          11 个维度均未命中静态风险规则。
        </div>
      ) : (
        <div className="mt-4">
          <div className="tt-label mb-2">非通过项详情</div>
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
                    {risk.severity}
                  </StatusBadge>
                  <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {risk.source} · {risk.ruleName}
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
        <div className="tt-label mb-1">综合审查意见</div>
        <p className="text-muted-foreground">
          {report.verdict === "安全"
            ? "当前静态规则未发现风险；静态扫描不能替代对 Skill 行为和来源的人工审阅。"
            : report.verdict === "可疑"
              ? "发现需人工确认的静态风险信号；建议在安装前审阅上述命中行及其上下文。"
              : "发现高危静态风险信号；建议不要安装或执行此 Skill，完成独立人工审查后再决定。"}
        </p>
      </div>
      {showSource && source && (
        <div className="mt-4 rounded-sm border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[12px]">
            <span>本地源：{source.name}</span>
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
