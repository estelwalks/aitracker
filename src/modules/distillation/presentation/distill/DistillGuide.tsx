import { Sparkles } from "lucide-react";

import { Panel } from "../../../../components/tt";
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
 * First-run guide overlay (V3.0 prototype). Covers the content area with a
 * centred card explaining the four-step distillation flow: 选素材 → 跑蒸馏 →
 * 存为 Skill → 同步到工具. Steps use the prototype's chart-1 numbered circles
 * and a foreground CTA. Dismissal is recorded in localStorage so it shows once
 * per browser/install.
 */
export function DistillGuide({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t("distill.guideTitle")}
    >
      <div className="fixed inset-0 bg-background/85 backdrop-blur-sm" />
      <Panel
        className="relative w-full max-w-md shadow-2xl"
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            {t("distill.guideTitle")}
          </span>
        }
      >
        <ol className="space-y-4">
          {STEPS.map((step, index) => (
            <li key={step.titleKey} className="flex items-start gap-3">
              <span
                className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full font-mono text-[10px] font-semibold"
                style={{
                  background:
                    "color-mix(in oklab, var(--chart-1) 18%, transparent)",
                  color: "var(--chart-1)",
                }}
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <span className="block text-[13px] font-medium">
                  {t(step.titleKey)}
                </span>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {t(step.descKey)}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 font-mono text-[11.5px] font-semibold text-background transition-opacity hover:opacity-90"
          >
            {t("distill.guideStart")}
          </button>
        </div>
      </Panel>
    </div>
  );
}
