import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { TTButton } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import { MemoryModal } from "./memory-modal";
import type { MemoryCreateInput, MemoryEntry, MemoryType } from "./index";

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * P6-T6-05: the memory editor is loaded on demand (React.lazy) so the shared
 * shell never carries the form. It mirrors the V3.0 prototype EditModal:
 * "是什么" 类型 chips + 一句话标题 + 说明，底部 取消 / 导出 MD / 保存。
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
  const [type, setType] = useState<MemoryType>(item?.type ?? "task");
  const [title, setTitle] = useState(item?.title ?? "");
  // 完整正文（FR-014）：编辑蒸馏记忆时展示完整产物，而非 160 字符摘要片段。
  const [body, setBody] = useState(item?.body ?? item?.summary ?? "");
  const editingExisting = item != null;
  const ok = title.trim().length > 0 && body.trim().length > 0;

  const save = () =>
    onSubmit({
      type,
      title: title.trim(),
      body: body.trim(),
    });

  const exportMd = () => {
    const safeName = (title.trim() || "memory")
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 60);
    const frontmatter = [
      "---",
      `type: ${type}`,
      `title: ${title.replace(/\n/g, " ") || "memory"}`,
      "---",
      "",
      body.trim(),
    ].join("\n");
    download(`${safeName || "memory"}.md`, frontmatter);
    toast.success(t("memory.exportMd"));
  };

  return (
    <MemoryModal
      title={editingExisting ? t("memory.editTitle") : t("memory.add")}
      onClose={onClose}
      footer={
        <>
          <TTButton onClick={onClose} disabled={busy}>
            {t("memory.cancel")}
          </TTButton>
          {editingExisting && (
            <TTButton onClick={exportMd} disabled={busy}>
              <Download className="size-3.5" />
              {t("memory.exportMd")}
            </TTButton>
          )}
          <TTButton variant="primary" onClick={save} disabled={!ok || busy}>
            {t("memory.form.save")}
          </TTButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <div className="tt-label mb-1.5">{t("memory.form.type")}</div>
          <div className="flex flex-wrap gap-1.5">
            {(["profile", "task"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                onClick={() => setType(candidate)}
                className={`rounded-sm border px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                  type === candidate
                    ? "border-primary bg-primary/10"
                    : "border-border bg-surface"
                }`}
              >
                <span className="font-medium">
                  {candidate === "profile"
                    ? t("memory.typeProfile")
                    : t("memory.typeTask")}
                </span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">
                  {candidate === "profile"
                    ? t("memory.form.typeProfileDesc")
                    : t("memory.form.typeTaskDesc")}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="tt-label mb-1.5">{t("memory.form.title")}</div>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={256}
            placeholder={t("memory.form.titlePlaceholder")}
            className="h-8 w-full rounded-sm border border-border bg-surface-2 px-2 text-[13px] outline-none focus:border-primary"
          />
        </div>

        <div>
          <div className="tt-label mb-1.5">{t("memory.form.body")}</div>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={9}
            maxLength={24000}
            placeholder={t("memory.form.bodyPlaceholder")}
            className="min-h-[180px] w-full rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-[13px] leading-relaxed outline-none focus:border-primary"
          />
        </div>
      </div>
    </MemoryModal>
  );
}
