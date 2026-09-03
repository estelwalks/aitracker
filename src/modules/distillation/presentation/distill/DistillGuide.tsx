import { HelpCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { useI18n } from "../../../../lib/i18n/context";

export const DISTILL_GUIDE_KEY = "tt.distill.guide";

const STEPS = [
  {
    titleKey: "distill.guideStep1",
    descKey: "distill.guideStep1Desc",
  },
  {
    titleKey: "distill.guideStep2",
    descKey: "distill.guideStep2Desc",
  },
  {
    titleKey: "distill.guideStep3",
    descKey: "distill.guideStep3Desc",
  },
  {
    titleKey: "distill.guideStep4",
    descKey: "distill.guideStep4Desc",
  },
] as const;

/**
 * 首次进入引导覆盖层,覆盖当前视口,chart-1 模糊 blob、
 * HelpCircle 图标、两段介绍、2 列步骤网格 + 开始使用 CTA。遮罩可点击关闭;
 * 关闭后写入 SQLite 不再自动弹出,可在标题栏点「?」重看。
 */
export function DistillGuide({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto rounded-2xl bg-card p-7 shadow-2xl shadow-black/60">
        <div
          className="pointer-events-none absolute -top-24 right-0 size-64 rounded-full opacity-[0.18] blur-3xl"
          style={{ background: "var(--chart-1)" }}
        />
        <DialogHeader className="relative flex-row items-center gap-2 space-y-0 text-left">
          <HelpCircle
            className="size-4 shrink-0"
            style={{ color: "var(--chart-1)" }}
          />
          <DialogTitle className="text-[14px] font-semibold tracking-tight">
            {t("distill.guideTitle")}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="relative mt-3 text-[13px] leading-relaxed text-foreground">
          {t("distill.guideIntro1")}
        </DialogDescription>
        <p className="relative mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          {t("distill.guideIntro2")}
        </p>
        <ol className="relative mt-4 grid gap-2 sm:grid-cols-2">
          {STEPS.map((step, index) => (
            <li
              key={step.titleKey}
              className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5"
            >
              <span
                className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full font-mono text-[10px]"
                style={{
                  background:
                    "color-mix(in oklab, var(--chart-1) 18%, transparent)",
                  color: "var(--chart-1)",
                }}
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px]">{t(step.titleKey)}</span>
                <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                  {t(step.descKey)}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <div className="relative mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 font-mono text-[11.5px] text-background transition-opacity hover:opacity-90"
          >
            {t("distill.guideStart")}
          </button>
          <span className="font-mono text-[10.5px] text-muted-foreground">
            {t("distill.guideReopenHint")}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
