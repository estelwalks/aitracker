import { useEffect, useRef, useState } from "react";
import { Check, Copy, Printer } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Segmented, TTButton } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";

const DRAFT_PREFIX = "tt.report.draft.";

/**
 * Report draft editor. The body is user-authored markdown persisted to this
 * browser only (localStorage) with a 30s autosave; the server's report bodies
 * never cross this boundary. Export offers copy and print (PDF).
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
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const dirty = useRef(false);

  // Autosave: every 30s while the dialog is open, plus immediately when
  // closing. Polling lives in the component effect (routes may not use
  // setInterval at the top level per the architecture gate).
  useEffect(() => {
    const persist = () => {
      if (!dirty.current) return;
      try {
        window.localStorage.setItem(DRAFT_PREFIX + reportId, body);
        dirty.current = false;
        setSavedAt(new Date().toLocaleTimeString());
      } catch {
        // localStorage unavailable — draft is best-effort
      }
    };
    const timer = window.setInterval(persist, 30_000);
    return () => {
      window.clearInterval(timer);
      persist();
    };
  }, [body, reportId]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body || title);
      toast.success(t("common.reports.editor.copy"));
    } catch {
      toast.error(t("common.failed"));
    }
  }

  function handlePrint() {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(
      `<pre style="font:12px/1.6 ui-monospace,monospace;padding:2rem;white-space:pre-wrap">${body.replace(/</g, "&lt;")}</pre>`,
    );
    win.document.close();
    win.focus();
    win.print();
  }

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
            <TTButton size="sm" variant="ghost" onClick={handleCopy}>
              <Copy className="size-3.5" />
              {t("common.reports.editor.copy")}
            </TTButton>
            <TTButton size="sm" variant="ghost" onClick={handlePrint}>
              <Printer className="size-3.5" />
              {t("common.reports.editor.print")}
            </TTButton>
            <TTButton
              size="sm"
              variant="primary"
              onClick={() => {
                void handleCopy();
              }}
            >
              {t("common.reports.editor.exportMd")}
            </TTButton>
          </div>
        </div>

        {mode === "edit" ? (
          <textarea
            value={body}
            onChange={(event) => {
              dirty.current = true;
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
