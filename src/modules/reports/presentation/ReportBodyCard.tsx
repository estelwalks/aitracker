import { useEffect, useRef, useState } from "react";
import { Check, Copy, FileText, Printer, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

import {
  EmptyState,
  Segmented,
  StatusBadge,
  TTButton,
} from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import type { MessageKey } from "../../../lib/i18n/messages";
import { getReportBody } from "../server-fns.ts";
import type { ReportListItem, ReportUiStatus } from "./index.ts";
import { useDraftAutosave, useReportActions } from "./report-actions.ts";

const DRAFT_PREFIX = "tt.report.draft.";

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

function readDraft(reportId: string): string | null {
  try {
    return window.localStorage.getItem(DRAFT_PREFIX + reportId);
  } catch {
    return null;
  }
}

/**
 * 正文内联卡 (inline report body). With no report for the selected period it
 * renders an empty state + "生成草稿"; with one it renders the Markdown card
 * with preview/edit tabs and the shared copy / print / export-md actions
 * (reused from `useReportActions`). Edits are user-authored drafts persisted to
 * this browser only (localStorage, 30s autosave); the server's generated body
 * is fetched read-only via `getReportBody` and never overwritten.
 */
export function ReportBodyCard({
  report,
  generateBlocked,
  generateHint,
  onGenerate,
  onRegenerate,
}: {
  report?: ReportListItem;
  generateBlocked: boolean;
  generateHint?: string;
  onGenerate: () => void;
  onRegenerate: () => void;
}) {
  const { t, format } = useI18n();
  const reportId = report?.reportId;
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [body, setBody] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!reportId) {
      setBody("");
      setLoading(false);
      return;
    }
    const draft = readDraft(reportId);
    if (draft !== null) {
      setBody(draft);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setBody("");
    getReportBody({ data: { reportId } })
      .then((content) => {
        if (cancelled) return;
        setBody(content?.body ?? "");
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const title = report?.title ?? "";
  const dirtyRef = useRef(false);
  const { copy, print, exportMd } = useReportActions(body, title);
  const { savedAt, flush } = useDraftAutosave(
    reportId ? DRAFT_PREFIX + reportId : "",
    body,
    dirtyRef,
  );

  const handleSave = () => {
    flush();
    toast.success(t("reports.body.save"));
  };

  if (!report) {
    return (
      <EmptyState
        icon={<FileText className="size-5" />}
        title={t("reports.body.emptyTitle")}
        desc={t("reports.body.emptyDesc")}
        actions={
          <TTButton
            variant="primary"
            disabled={generateBlocked}
            title={generateBlocked ? generateHint : undefined}
            onClick={onGenerate}
          >
            <FileText className="size-3.5" />
            {t("reports.body.draft")}
          </TTButton>
        }
      />
    );
  }

  const tone = STATUS_TONE[report.status];

  return (
    <section className="tt-panel mt-3 flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="truncate text-[13px] font-medium tracking-[0.025em]">
            {title || t("common.reports.pageTitle")}
          </h2>
          <StatusBadge tone={tone}>
            {t(STATUS_LABEL_KEY[report.status])}
          </StatusBadge>
          {report.generatedAt && (
            <span className="tt-num text-[11px] text-muted-foreground">
              {format.formatDateTime(report.generatedAt, false)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "preview", label: t("common.reports.editor.preview") },
              { value: "edit", label: t("common.reports.editor.edit") },
            ]}
          />
          <div className="flex items-center gap-2">
            {savedAt && (
              <span className="inline-flex items-center gap-1 text-[11px] text-ok">
                <Check className="size-3" />
                {t("common.reports.editor.autosaved")} · {savedAt}
              </span>
            )}
            {mode === "edit" && (
              <TTButton size="sm" variant="primary" onClick={handleSave}>
                <Save className="size-3.5" />
                {t("reports.body.save")}
              </TTButton>
            )}
            <TTButton
              size="sm"
              variant="default"
              disabled={generateBlocked}
              title={generateBlocked ? generateHint : undefined}
              onClick={onRegenerate}
            >
              <RefreshCw className="size-3.5" />
              {t("reports.body.regenerate")}
            </TTButton>
            <TTButton size="sm" variant="ghost" onClick={() => void copy()}>
              <Copy className="size-3.5" />
              {t("common.reports.editor.copy")}
            </TTButton>
            <TTButton size="sm" variant="ghost" onClick={print}>
              <Printer className="size-3.5" />
              {t("common.reports.editor.print")}
            </TTButton>
            <TTButton size="sm" variant="ghost" onClick={exportMd}>
              {t("common.reports.editor.exportMd")}
            </TTButton>
          </div>
        </div>
      </header>

      <div className="border-t border-border p-5">
        {loading ? (
          <p className="py-10 text-center text-[12px] text-muted-foreground">
            {t("common.loading")}
          </p>
        ) : mode === "edit" ? (
          <textarea
            value={body}
            onChange={(event) => {
              dirtyRef.current = true;
              setBody(event.target.value);
            }}
            spellCheck={false}
            placeholder={t("common.reports.editor.draftHint")}
            className="min-h-72 w-full resize-y rounded-lg border border-border bg-surface-2/60 px-3 py-2.5 font-mono text-[12.5px] leading-5 outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
          />
        ) : (
          <div className="tt-md tt-scroll min-h-72 overflow-y-auto rounded-lg border border-border bg-surface-2/60 px-3 py-2.5">
            {body ? (
              <pre className="font-mono text-[12.5px] leading-5 whitespace-pre-wrap">
                {body}
              </pre>
            ) : (
              <p className="py-10 text-center text-[12px] text-muted-foreground">
                {t("common.reports.editor.draftHint")}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
