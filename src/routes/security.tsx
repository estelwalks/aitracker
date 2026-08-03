import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  FolderOpen,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
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
  scanSecurityFiles,
  type SecurityInputFile,
  type SecurityReport,
  type SecuritySeverity,
} from "../lib/security/scanner";
import {
  requestAiSecurityReview,
  requestSecurityArchiveScan,
} from "../lib/security/server-fns";
import { useAITrackerSettings } from "../lib/settings/store";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "安全检测 · AITracker V3.0" },
      {
        name: "description",
        content: "对用户选择的本地文件执行真实静态安全规则扫描。",
      },
    ],
  }),
  component: SecurityPage,
});

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_FILES = 100;
const MAX_ARCHIVE_SIZE = 20 * 1024 * 1024;

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
  const { settings } = useAITrackerSettings();
  const [used, setUsed] = useState(() =>
    typeof window === "undefined" ? 0 : readDailyScanCount(window.localStorage),
  );

  const runScan = async (files: FileList | File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const count = consumeDailyScan(window.localStorage);
      setUsed(count);
      const selected = Array.from(files);
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

      let next: SecurityReport;
      if (archives.length === 1) {
        const archive = archives[0];
        if (!archive) throw new Error("未找到压缩包");
        if (archive.size > MAX_ARCHIVE_SIZE)
          throw new Error("压缩包不能超过 20 MB");
        const result = await requestSecurityArchiveScan({
          data: {
            name: archive.name,
            base64: await readFileAsBase64(archive),
            userRules: settings.securityRules,
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
        next = scanSecurityFiles(inputs, settings.securityRules);
        if (aiReviewEnabled) {
          next.aiReview = await requestAiSecurityReview({ data: next.risks });
        }
        setArchiveSummary(null);
      }

      setReport(next);
      setHistory((current) => [next, ...current].slice(0, 10));
      toast.success(
        `扫描完成：${next.verdict}，发现 ${next.risks.length} 项风险`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "扫描失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="本地安全扫描"
        title="安全检测"
        desc="文本文件由浏览器本地扫描；tar 压缩包仅发送到本机 Server Function 安全解包，不上传外网"
        status={
          <StatusBadge tone={used >= DAILY_SCAN_LIMIT ? "warn" : "ok"}>
            <Dot
              className={`size-1 ${used >= DAILY_SCAN_LIMIT ? "bg-warn" : "bg-ok"}`}
            />
            今日 {used}/{DAILY_SCAN_LIMIT} 次
          </StatusBadge>
        }
      />

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
          文本最多 100 个、单文件 2MB；支持单个 20MB 内的 .tar /
          .tar.gz，明确拒绝 .zip
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <TTButton
            disabled={busy || used >= DAILY_SCAN_LIMIT}
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件
          </TTButton>
          <TTButton
            disabled={busy || used >= DAILY_SCAN_LIMIT}
            onClick={() => directoryInputRef.current?.click()}
          >
            <FolderOpen className="size-3.5" /> 选择目录
          </TTButton>
          <TTButton
            disabled={busy || used >= DAILY_SCAN_LIMIT}
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

      <Panel className="mt-3" title="本次页面检测历史">
        {history.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">尚未执行扫描。</p>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((item, index) => (
              <li
                key={`${item.scannedAt}-${index}`}
                className="flex items-center gap-3 py-2 text-[13px]"
              >
                <span className="tt-num text-muted-foreground">
                  {new Date(item.scannedAt).toLocaleTimeString("zh-CN")}
                </span>
                <span>{item.filesScanned} 个文件</span>
                <span className="ml-auto">{item.risks.length} 项风险</span>
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
              </li>
            ))}
          </ul>
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
    <Panel className="mt-3" title={`安全报告 · ${report.filesScanned} 个文件`}>
      <div className={`flex items-center gap-2 ${verdictClass}`}>
        <VerdictIcon className="size-5" />
        <span className="text-sm font-semibold">
          综合判定：{report.verdict}
        </span>
        <span className="ml-auto text-xs">{report.risks.length} 项风险</span>
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
