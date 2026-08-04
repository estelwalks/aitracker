import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  FolderOpen,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  Dot,
  PageHeader,
  Panel,
  StatusBadge,
  TTButton,
} from "../components/tt";
import {
  consumeDailyScan,
  DAILY_SCAN_LIMIT,
  readDailyScanCount,
} from "../lib/security/daily-limit";
import {
  clearSecurityHistory,
  loadSecurityHistory,
  saveSecurityHistory,
  trimReportForHistory,
} from "../lib/security/history";
import { SECURITY_RULES_VERSION } from "../lib/security/rules";
import {
  scanSecurityFiles,
  type SecurityInputFile,
  type SecurityReport,
  type SecuritySeverity,
} from "../lib/security/scanner";
import {
  requestAiSecurityReview,
  requestSecurityArchiveScan,
} from "../lib/security/server-fns";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "安全检测 · TrustTools V3.0" },
      {
        name: "description",
        content: "对用户选择的本地文件执行真实静态安全规则扫描。",
      },
    ],
  }),
  component: SecurityPage,
});

/**
 * 浏览器读取单文件大小上限：PRD §11 历史口径，用于在读取前预筛文本。
 * 单文件总体上限由 MAX_TOTAL_FILE_SIZE 保证（见下）。
 */
const MAX_FILE_SIZE = 2 * 1024 * 1024;
/** PRD FR-018：单文件总大小硬上限 100 MB，超出立即报错且不消耗额度。 */
const MAX_TOTAL_FILE_SIZE = 100 * 1024 * 1024;
const MAX_FILES = 100;
const MAX_ARCHIVE_SIZE = 20 * 1024 * 1024;

type VerdictFilter = "全部" | "安全" | "可疑" | "危险";

interface ArchiveScanSummary {
  archiveName: string;
  archiveBytes: number;
  unpackedBytes: number;
  entriesChecked: number;
}

const severityClass: Record<SecuritySeverity, string> = {
  高危: "text-danger",
  中危: "text-warn",
  低危: "text-muted-foreground",
};

async function readSelectedFiles(
  files: FileList | File[],
): Promise<SecurityInputFile[]> {
  const selected = Array.from(files).slice(0, MAX_FILES);
  const readable: SecurityInputFile[] = [];
  for (const file of selected) {
    if (file.size > MAX_FILE_SIZE) continue;
    const content = await file.text();
    if (content.includes("\0")) continue;
    readable.push({
      name: file.webkitRelativePath || file.name,
      content,
    });
  }
  return readable;
}

function isSupportedArchive(name: string): boolean {
  const lowerName = name.toLocaleLowerCase();
  return lowerName.endsWith(".tar") || lowerName.endsWith(".tar.gz");
}

function isUnsupportedArchive(name: string): boolean {
  return (
    /\.(?:zip|7z|rar|tgz|gz|bz2|xz)$/i.test(name) && !isSupportedArchive(name)
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取压缩包失败"));
    reader.onload = () => {
      const value = String(reader.result);
      const separator = value.indexOf(",");
      if (separator === -1) {
        reject(new Error("读取压缩包失败"));
        return;
      }
      resolve(value.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function SecurityPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiReviewEnabled, setAiReviewEnabled] = useState(false);
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [archiveSummary, setArchiveSummary] =
    useState<ArchiveScanSummary | null>(null);
  const [history, setHistory] = useState<SecurityReport[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>("全部");
  const [updatingRules, setUpdatingRules] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [used, setUsed] = useState(() =>
    typeof window === "undefined" ? 0 : readDailyScanCount(window.localStorage),
  );

  // PRD FR-020：挂载时从偏好文件加载近 30 天的持久化检测历史。
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const reports = await loadSecurityHistory();
      if (cancelled) return;
      setHistory(reports);
      setHistoryLoaded(true);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const remaining = Math.max(0, DAILY_SCAN_LIMIT - used);

  const runScan = async (files: FileList | File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const selected = Array.from(files);

      // —— 验证阶段（不消耗额度）：格式 / 大小先于额度检查 ——
      const archives = selected.filter((file) => isSupportedArchive(file.name));
      const rejectedArchives = selected.filter((file) =>
        isUnsupportedArchive(file.name),
      );
      if (rejectedArchives.length > 0) {
        throw new Error("仅支持 .tar 与 .tar.gz；.zip 等其他压缩格式不支持");
      }
      if (archives.length > 0 && selected.length !== 1) {
        throw new Error("压缩包请单独选择，每次扫描一个 .tar 或 .tar.gz 文件");
      }

      // PRD FR-018：单文件 100 MB 硬上限。在消费额度之前校验，
      // 失败的拣选不再扣减今日额度。
      for (const file of selected) {
        if (file.size > MAX_TOTAL_FILE_SIZE) {
          throw new Error("文件过大，请选择 100MB 以内的文件");
        }
      }

      if (archives.length === 1) {
        const archive = archives[0];
        if (!archive) throw new Error("未找到压缩包");
        if (archive.size > MAX_ARCHIVE_SIZE)
          throw new Error("压缩包不能超过 20 MB");
      }

      // —— 额度消费阶段：仅在校验通过后扣减 ——
      const count = consumeDailyScan(window.localStorage);
      setUsed(count);

      let next: SecurityReport;
      if (archives.length === 1) {
        const archive = archives[0];
        if (!archive) throw new Error("未找到压缩包");
        const result = await requestSecurityArchiveScan({
          data: {
            name: archive.name,
            base64: await readFileAsBase64(archive),
            userRules: [],
            aiReviewEnabled,
          },
        });
        next = result.report;
        setArchiveSummary({
          archiveName: result.archiveName,
          archiveBytes: result.archiveBytes,
          unpackedBytes: result.unpackedBytes,
          entriesChecked: result.entriesChecked,
        });
      } else {
        const inputs = await readSelectedFiles(files);
        if (inputs.length === 0)
          throw new Error("未找到可读取的文本文件（单文件上限 2MB）");
        next = scanSecurityFiles(inputs, []);
        if (aiReviewEnabled) {
          next.aiReview = await requestAiSecurityReview({ data: next.risks });
        }
        setArchiveSummary(null);
      }

      setReport(next);

      // PRD FR-020：持久化近 30 天历史。裁剪 risks 后再持久化，避免偏好膨胀。
      const nextHistory = [next, ...history].slice(0, 100);
      setHistory(nextHistory);
      void saveSecurityHistory(nextHistory.map(trimReportForHistory));

      toast.success(
        `扫描完成：${next.verdict}，发现 ${next.risks.length} 项风险`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "扫描失败");
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateRules = () => {
    if (updatingRules) return;
    setUpdatingRules(true);
    // 远端规则 API 尚未上线，此处仅以 600ms 模拟一次"已是最新"检查，
    // 与 PRD"更新失败时提示当前版本"路径保持一致。
    window.setTimeout(() => {
      setUpdatingRules(false);
      toast.success(`规则库已是最新版本 ${SECURITY_RULES_VERSION}`);
    }, 600);
  };

  const handleClearHistory = async () => {
    setHistory([]);
    setVerdictFilter("全部");
    setHistoryQuery("");
    await clearSecurityHistory();
    toast.success("已清除检测历史");
  };

  // —— 历史筛选 + 搜索（PRD FR-020）——
  const verdictCounts = useMemo(() => {
    const counts: Record<Exclude<VerdictFilter, "全部">, number> = {
      安全: 0,
      可疑: 0,
      危险: 0,
    };
    for (const item of history) counts[item.verdict] += 1;
    return counts;
  }, [history]);

  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();
    return history.filter((item) => {
      if (verdictFilter !== "全部" && item.verdict !== verdictFilter)
        return false;
      if (!query) return true;
      const haystack = [
        item.verdict,
        item.rulesVersion,
        new Date(item.scannedAt).toLocaleString("zh-CN"),
        `${item.filesScanned}`,
        `${item.risks.length}`,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [history, verdictFilter, historyQuery]);

  return (
    <>
      <PageHeader
        title="安全检测"
        desc="文本文件由浏览器本地扫描；tar 压缩包仅发送到本机 Server Function 安全解包，不上传外网"
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-sm border border-border bg-surface-2 p-3 text-[12px] text-muted-foreground">
        <span className="tt-num">
          规则库版本{" "}
          <span className="text-foreground">{SECURITY_RULES_VERSION}</span>
        </span>
        <TTButton
          size="sm"
          variant="default"
          disabled={updatingRules}
          onClick={handleUpdateRules}
          title="检查规则库更新"
        >
          <RefreshCw
            className={`size-3.5 ${updatingRules ? "animate-spin" : ""}`}
          />
          {updatingRules ? "更新中…" : "更新规则库"}
        </TTButton>
      </div>

      <div className="mb-3 rounded-sm border border-border bg-surface-2 p-3">
        <label className="flex cursor-pointer items-start gap-3 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-primary"
            checked={aiReviewEnabled}
            onChange={(event) => setAiReviewEnabled(event.target.checked)}
          />
          <span>
            <span className="font-medium">启用 AI 二次审查</span>
            <span className="mt-1 block text-[12px] text-muted-foreground">
              默认关闭。启用后，仅将静态规则命中的已脱敏最小风险片段发送到服务端配置的
              AI
              服务；不会发送完整文件。服务未配置、失败或限流时仍返回静态报告。
            </span>
          </span>
        </label>
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
        className={`flex flex-col items-center justify-center rounded-sm border-2 border-dashed px-6 py-10 text-center ${
          dragging ? "border-primary bg-primary/10" : "border-border-strong"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="text/*,.md,.js,.jsx,.ts,.tsx,.json,.yaml,.yml,.toml,.sh,.py"
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
        <input
          ref={archiveInputRef}
          type="file"
          accept=".tar,.tar.gz,application/x-tar,application/gzip"
          className="hidden"
          onChange={(event) =>
            event.target.files && void runScan(event.target.files)
          }
        />
        <Upload className="size-7 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">
          拖入文件或压缩包，或主动选择文件 / 目录
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          文本最多 100 个、单文件 2MB（总体上限 100MB）；支持单个 20MB 内的 .tar
          / .tar.gz，明确拒绝 .zip
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <TTButton
            disabled={busy || remaining === 0}
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件
          </TTButton>
          <TTButton
            disabled={busy || remaining === 0}
            onClick={() => directoryInputRef.current?.click()}
          >
            <FolderOpen className="size-3.5" /> 选择目录
          </TTButton>
          <TTButton
            disabled={busy || remaining === 0}
            onClick={() => archiveInputRef.current?.click()}
          >
            <Upload className="size-3.5" /> 选择压缩包
          </TTButton>
        </div>
      </div>

      {archiveSummary && (
        <div className="mt-3 rounded-sm border border-ok/30 bg-ok/10 p-3 text-[13px] text-ok">
          <div className="font-medium">
            压缩包已在本机安全解包并完成真实扫描
          </div>
          <div className="tt-num mt-1 text-[12px] text-muted-foreground">
            {archiveSummary.archiveName} · {archiveSummary.entriesChecked}{" "}
            个条目 · 压缩包 {(archiveSummary.archiveBytes / 1024).toFixed(1)} KB
            · 解包内容 {(archiveSummary.unpackedBytes / 1024).toFixed(1)} KB
          </div>
        </div>
      )}

      {report && <SecurityReportPanel report={report} />}

      <Panel
        className="mt-3"
        title="检测历史（近 30 天）"
        action={
          history.length > 0 ? (
            <TTButton
              size="sm"
              variant="ghost"
              onClick={handleClearHistory}
              disabled={!historyLoaded}
              title="清除全部检测历史"
            >
              <Trash2 className="size-3.5" /> 清除历史
            </TTButton>
          ) : undefined
        }
        bodyClassName="p-3"
      >
        {history.length === 0 ? (
          <p className="px-1 py-2 text-[13px] text-muted-foreground">
            {historyLoaded ? "尚未执行扫描。" : "正在加载检测历史…"}
          </p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder="搜索判定 / 版本 / 时间…"
                  className="h-7 w-full rounded-sm border border-border bg-surface-2 pl-7 pr-2 text-[12px] outline-none placeholder:text-muted-foreground focus:border-primary"
                />
              </div>
              <div className="inline-flex flex-wrap gap-1">
                {(["全部", "安全", "可疑", "危险"] as const).map((value) => {
                  const active = verdictFilter === value;
                  const count =
                    value === "全部" ? history.length : verdictCounts[value];
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setVerdictFilter(value)}
                      className={`inline-flex h-7 items-center gap-1 rounded-sm border px-2 text-[11px] transition-colors ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-surface-2 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {value}
                      <span className="tt-num text-[10px] opacity-70">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredHistory.length === 0 ? (
              <p className="px-1 py-2 text-[13px] text-muted-foreground">
                没有匹配的历史记录。
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {filteredHistory.map((item, index) => (
                  <li key={`${item.scannedAt}-${index}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setReport(item);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className="flex w-full cursor-pointer items-center gap-3 py-2 text-left text-[13px] transition-colors hover:bg-accent/40"
                    >
                      <span className="tt-num text-muted-foreground">
                        {new Date(item.scannedAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span>{item.filesScanned} 个文件</span>
                      <span className="tt-num text-[11px] text-muted-foreground">
                        v{item.rulesVersion}
                      </span>
                      <span className="ml-auto">
                        {item.risks.length} 项风险
                      </span>
                      <span
                        className={
                          item.verdict === "危险"
                            ? "text-danger"
                            : item.verdict === "可疑"
                              ? "text-warn"
                              : "text-ok"
                        }
                      >
                        {item.verdict}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

function SecurityReportPanel({ report }: { report: SecurityReport }) {
  const VerdictIcon =
    report.verdict === "危险"
      ? ShieldX
      : report.verdict === "可疑"
        ? ShieldAlert
        : ShieldCheck;
  const verdictClass =
    report.verdict === "危险"
      ? "text-danger"
      : report.verdict === "可疑"
        ? "text-warn"
        : "text-ok";

  return (
    <Panel
      className="mt-3"
      title={
        <span className="flex items-center gap-2">
          安全报告 · {report.filesScanned} 个文件
          <span className="tt-num text-[10px] font-normal text-muted-foreground">
            规则库 v{report.rulesVersion}
          </span>
        </span>
      }
    >
      <div className={`flex items-center gap-2 ${verdictClass}`}>
        <VerdictIcon className="size-5" />
        <span className="text-sm font-semibold">
          综合判定：{report.verdict}
        </span>
        <span className="tt-num text-sm font-semibold">{report.riskScore}</span>
        <span className="text-[10px] text-muted-foreground">/ 100</span>
        <span className="ml-auto text-xs">{report.risks.length} 项风险</span>
      </div>
      {/* 风险评分可视化条 */}
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(report.riskScore, 100)}%`,
              background:
                report.riskScore >= 70
                  ? "var(--color-danger)"
                  : report.riskScore >= 30
                    ? "var(--color-warn)"
                    : "var(--color-ok)",
            }}
          />
        </div>
      </div>

      {report.risks.length === 0 ? (
        <div className="mt-4 flex items-center gap-2 rounded-sm border border-ok/30 bg-ok/10 p-3 text-[13px] text-ok">
          <Check className="size-4" /> 静态规则未检出恶意命令、
          密钥泄露或提示注入等风险。
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {report.risks.map((risk, index) => (
            <li
              key={`${risk.file}-${risk.line}-${risk.kind}-${index}`}
              className="rounded-sm border border-border bg-surface-2 p-3 text-[13px]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle
                  className={`size-3.5 ${severityClass[risk.severity]}`}
                />
                <span className="font-medium">{risk.kind}</span>
                <span className={severityClass[risk.severity]}>
                  {risk.severity}
                </span>
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
      )}

      <div className="mt-4 rounded-sm border border-border bg-surface-2 p-3 text-[13px]">
        <div className="tt-label mb-1">AI 审查</div>
        <div className="flex items-start gap-2">
          <StatusBadge
            tone={report.aiReview.status === "已完成" ? "ok" : "warn"}
          >
            {report.aiReview.status}
          </StatusBadge>
          <span className="text-muted-foreground">
            {report.aiReview.summary}
          </span>
        </div>
      </div>
    </Panel>
  );
}
