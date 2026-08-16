import { useRef, useState } from "react";
import { Check, Copy, Printer } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Segmented, TTButton } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import { useDraftAutosave, useReportActions } from "./report-actions.ts";

const DRAFT_PREFIX = "tt.report.draft.";

/**
 * Report draft editor (kept as a standalone dialog for callers that prefer a
 * modal; the inline page uses `ReportBodyCard`). The body is user-authored
 * markdown persisted to this browser only (localStorage) with a 30s autosave;
 * the server's report bodies are never overwritten. Copy / print / export reuse
 * the shared `useReportActions` helpers.
 */
export function ReportEditor({
  reportId,
  title,
  kindLabel,
  onClose,
}: {
  reportId: string;
  title: string;
  kindLabel: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"preview" | "edit">("edit");
  const [body, setBody] = useState<string>(() => {
    try {
      return window.localStorage.getItem(DRAFT_PREFIX + reportId) ?? "";
    } catch {
      return "";
    }
  });
  const dirtyRef = useRef(false);
  const { copy, print, exportMd } = useReportActions(body, title);
  // The hook's cleanup persists the latest draft on unmount (dialog close).
  const { savedAt } = useDraftAutosave(DRAFT_PREFIX + reportId, body, dirtyRef);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            <span className="tt-num font-mono text-[11px] font-normal text-muted-foreground">
              {kindLabel}
            </span>
          </DialogTitle>
          <DialogDescription>
            {t("common.reports.editor.draftNote")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
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
            <TTButton size="sm" variant="ghost" onClick={() => void copy()}>
              <Copy className="size-3.5" />
              {t("common.reports.editor.copy")}
            </TTButton>
            <TTButton size="sm" variant="ghost" onClick={print}>
              <Printer className="size-3.5" />
              {t("common.reports.editor.print")}
            </TTButton>
            <TTButton size="sm" variant="primary" onClick={exportMd}>
              {t("common.reports.editor.exportMd")}
            </TTButton>
          </div>
        </div>

        {mode === "edit" ? (
          <textarea
            value={body}
            onChange={(event) => {
              dirtyRef.current = true;
              setBody(event.target.value);
            }}
            spellCheck={false}
            placeholder={t("common.reports.editor.draftHint")}
            className="min-h-72 flex-1 resize-none rounded-lg border border-border bg-surface-2/60 px-3 py-2.5 font-mono text-[12.5px] leading-5 outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
          />
        ) : (
          <div className="tt-md tt-scroll min-h-72 flex-1 overflow-y-auto rounded-lg border border-border bg-surface-2/60 px-3 py-2.5">
            <pre className="font-mono text-[12.5px] leading-5 whitespace-pre-wrap">
              {body || t("common.reports.editor.draftHint")}
            </pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
