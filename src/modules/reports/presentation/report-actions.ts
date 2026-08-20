import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "../../../lib/i18n/context";

/**
 * Shared clipboard and Markdown export actions. The reports page only uses
 * export; the transcript report dialog also offers clipboard copy.
 */
export function useReportActions(
  body: string,
  fallbackTitle: string,
): {
  copy: () => Promise<void>;
  exportMd: () => void;
} {
  const { t } = useI18n();

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(body || fallbackTitle);
      toast.success(t("common.reports.editor.copy"));
    } catch {
      toast.error(t("common.failed"));
    }
  }, [body, fallbackTitle, t]);

  const exportMd = useCallback(() => {
    const safeName = (fallbackTitle || "report")
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 60);
    const blob = new Blob([body || fallbackTitle], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName || "report"}.md`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(t("common.reports.editor.exportMd"));
  }, [body, fallbackTitle, t]);

  return { copy, exportMd };
}

/**
 * 30s localStorage draft autosave (browser-only). The server's persisted report
 * bodies are never overwritten — drafts stay in this browser under the given
 * key. `dirtyRef` is set by the caller on every keystroke; every 30s the hook
 * persists the latest body (read via a ref so the interval closure never goes
 * stale), `flush` persists immediately (the "保存" button), and the cleanup
 * persists once more on unmount.
 */
export function useDraftAutosave(
  draftKey: string,
  body: string,
  dirtyRef: { current: boolean },
): {
  savedAt: string | null;
  flush: () => void;
} {
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const bodyRef = useRef(body);
  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  const persist = useCallback(() => {
    if (!dirtyRef.current) return;
    try {
      window.localStorage.setItem(draftKey, bodyRef.current);
      dirtyRef.current = false;
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      // localStorage unavailable — draft is best-effort
    }
  }, [draftKey, dirtyRef]);

  useEffect(() => {
    const timer = window.setInterval(persist, 30_000);
    return () => {
      window.clearInterval(timer);
      persist();
    };
  }, [persist]);

  return { savedAt, flush: persist };
}
