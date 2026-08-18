import { useState } from "react";

import { TTButton } from "../../../components/tt";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useI18n } from "../../../lib/i18n/context";
import { TYPE_COLORS } from "./memory-meta";
import type { MemoryCreateInput, MemoryEntry, MemoryType } from "./index";

/**
 * P6-T6-05: the memory editor is loaded on demand (React.lazy) so the shared
 * shell never carries the form. It renders only when the user creates or
 * edits a memory entry.
 */
export function MemoryForm({
  item,
  busy,
  onClose,
  onSubmit,
}: {
  item: MemoryEntry | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: MemoryCreateInput) => void;
}) {
  const { t } = useI18n();
  const [type, setType] = useState<MemoryType>(item?.type ?? "profile");
  const [title, setTitle] = useState(item?.title ?? "");
  const [body, setBody] = useState(item?.summary ?? "");
  const [source, setSource] = useState(item?.source ?? "Claude Code");
  const [project, setProject] = useState(item?.project ?? "");
  const ok = title.trim().length > 0 && body.trim().length > 0;
  const editingExisting = item != null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editingExisting ? t("memory.editTitle") : t("memory.add")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {editingExisting ? (
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                style={{
                  background: `color-mix(in oklab, ${TYPE_COLORS[item.type]} 16%, transparent)`,
                  color: TYPE_COLORS[item.type],
                }}
              >
                {item.type === "profile"
                  ? t("memory.typeProfile")
                  : t("memory.typeTask")}
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {item.type === "profile"
                  ? t("memory.form.typeProfileDesc")
                  : t("memory.form.typeTaskDesc")}
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {(["profile", "task"] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  onClick={() => setType(candidate)}
                  className="rounded-lg px-3 py-1.5 text-[12px] transition-colors"
                  style={
                    type === candidate
                      ? {
                          background: `color-mix(in oklab, ${TYPE_COLORS[candidate]} 16%, transparent)`,
                          color: TYPE_COLORS[candidate],
                        }
                      : undefined
                  }
                >
                  {candidate === "profile"
                    ? t("memory.typeProfile")
                    : t("memory.typeTask")}
                </button>
              ))}
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {type === "profile"
                  ? t("memory.form.typeProfileDesc")
                  : t("memory.form.typeTaskDesc")}
              </span>
            </div>
          )}

          <label className="block space-y-1">
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {t("memory.form.title")}
            </span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={256}
              placeholder={t("memory.form.titlePlaceholder")}
              className="w-full rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {t("memory.form.body")}
            </span>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={5}
              maxLength={4000}
              placeholder={t("memory.form.bodyPlaceholder")}
              className="w-full resize-y rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-6 outline-none"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {t("memory.form.source")}
              </span>
              <input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                maxLength={128}
                placeholder={t("memory.form.sourcePlaceholder")}
                className="w-full rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] outline-none"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {t("memory.form.project")}
              </span>
              <input
                value={project}
                onChange={(event) => setProject(event.target.value)}
                maxLength={128}
                placeholder={t("memory.form.projectPlaceholder")}
                className="w-full rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] outline-none"
              />
            </label>
          </div>
        </div>
        <DialogFooter>
          <TTButton variant="ghost" onClick={onClose} disabled={busy}>
            {t("memory.cancel")}
          </TTButton>
          <button
            type="button"
            disabled={!ok || busy}
            onClick={() =>
              onSubmit({
                type,
                title: title.trim(),
                body: body.trim(),
                source: source.trim() || "manual",
                ...(project.trim() ? { project: project.trim() } : {}),
              })
            }
            className="rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            {t("memory.form.save")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
