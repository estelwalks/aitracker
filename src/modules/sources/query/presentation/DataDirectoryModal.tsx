import { FolderOpen, Undo2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { DesktopApi } from "../../../../../electron/contracts";
import { AITrackerButton } from "../../../../components/aitracker";
import { Input } from "../../../../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { toUiError } from "../../../../lib/errors";
import { useI18n } from "../../../../lib/i18n/context";
import { getToolDataDirectory, setToolDataDirectory } from "../server-fns";
import type { SourcesQueryEntry } from "./model";

function desktopDirectoryPicker(): DesktopApi | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { desktopApi?: DesktopApi }).desktopApi ?? null;
}

const KNOWN_SERVER_ERRORS = new Set([
  "not-absolute",
  "not-a-directory",
  "unknown-tool",
  "tool-not-configurable",
]);

/**
 * Sources "设置数据目录" modal.
 *
 * Two equally supported input paths:
 * 1. a manual directory input (leading `~` expands to the home directory),
 *    which is the reliable way to reach hidden directories such as
 *    `~/.hermes` that the native dialog hides on macOS; and
 * 2. the native folder dialog (macOS/Windows).
 *
 * The value is persisted server-side in `tool_data_roots` and echoed back to
 * this modal only — it never appears in summaries, snapshots or exports.
 */
export function DataDirectoryModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: SourcesQueryEntry;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const picker = desktopDirectoryPicker();
  const [current, setCurrent] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    getToolDataDirectory({ data: { toolId: entry.id } })
      .then((result) => {
        if (!mounted) return;
        setCurrent(result.dataDir);
        setInputValue(result.dataDir ?? "");
      })
      .catch(() => {
        if (mounted) setCurrent(null);
      });
    return () => {
      mounted = false;
    };
  }, [entry.id]);

  const persist = async (dataDir: string | null, successKey: string) => {
    setBusy(true);
    try {
      await setToolDataDirectory({
        data: { toolId: entry.id, dataDir },
      });
      setCurrent(dataDir);
      setInputValue(dataDir ?? "");
      toast.success(t(successKey as never));
      await onSaved();
      onClose();
    } catch (error) {
      const ui = toUiError(error);
      const message =
        error instanceof Error && KNOWN_SERVER_ERRORS.has(error.message)
          ? "sources.dataDir.invalid"
          : null;
      toast.error(ui ? t(ui.code, ui.params) : t(message ?? "common.error"));
    } finally {
      setBusy(false);
    }
  };

  const chooseDirectory = async () => {
    if (picker == null) {
      toast.error(t("sources.dataDir.unavailable"));
      return;
    }
    const path = await picker.selectToolDataDirectory();
    if (path == null) return; // cancelled by the user
    await persist(path, "sources.dataDir.saved");
  };

  const applyManualInput = async () => {
    const value = inputValue.trim();
    if (value.length === 0) return;
    await persist(value, "sources.dataDir.saved");
  };

  const manualChanged = inputValue.trim() !== (current ?? "").trim();

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("sources.dataDir.modalTitle", { name: entry.name })}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-[13px] leading-relaxed text-muted-foreground">
          <p>{t("sources.dataDir.modalDesc")}</p>
          <div className="rounded-lg border border-border bg-surface-2/60 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
              {t("sources.dataDir.current")}
            </div>
            <div className="aitracker-num mt-1 break-all font-mono text-[12px] text-foreground">
              {current ?? t("sources.dataDir.none")}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground/70">
              {t("sources.dataDir.manual")}
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && manualChanged && !busy) {
                    void applyManualInput();
                  }
                }}
                placeholder={t("sources.dataDir.placeholder")}
                className="font-mono text-[12px]"
              />
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              {t("sources.dataDir.manualHint")}
            </p>
          </div>
        </div>
        <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {current != null && (
              <AITrackerButton
                variant="default"
                size="sm"
                disabled={busy}
                onClick={() => persist(null, "sources.dataDir.cleared")}
              >
                <Undo2 className="mr-1.5 size-3.5" />
                {t("sources.dataDir.clear")}
              </AITrackerButton>
            )}
            <AITrackerButton
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onClose}
            >
              <X className="mr-1.5 size-3.5" />
              {t("sources.dataDir.cancel")}
            </AITrackerButton>
          </div>
          <div className="flex items-center gap-2">
            <AITrackerButton
              variant="default"
              size="sm"
              disabled={busy || !manualChanged}
              onClick={() => void applyManualInput()}
            >
              {t("sources.dataDir.apply")}
            </AITrackerButton>
            <AITrackerButton
              variant="primary"
              size="sm"
              disabled={busy || picker == null}
              onClick={chooseDirectory}
            >
              <FolderOpen className="mr-1.5 size-3.5" />
              {t("sources.dataDir.choose")}
            </AITrackerButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
