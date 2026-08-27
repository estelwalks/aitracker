import { type ReactNode } from "react";
import { X } from "lucide-react";

import { useI18n } from "../../../lib/i18n/context";

/**
 * 记忆模块统一弹层（V3.0 原型 Modal 骨架）：标题栏 + 滚动体 + 底部操作区。
 * MemoryForm 与删除确认共用，保证两处弹层视觉一致。
 */
export function MemoryModal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border-strong bg-card shadow-2xl shadow-black/60">
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="text-[13px] font-medium tracking-wide">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="aitracker-scroll min-h-0 flex-1 overflow-auto p-4">
          {children}
        </div>
        {footer && (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
