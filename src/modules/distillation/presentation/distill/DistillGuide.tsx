import { ClipboardList, FolderOpen, Save, Sparkles } from "lucide-react";

import { Panel, TTButton } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";

export const DISTILL_GUIDE_KEY = "tt.distill.guide";

const STEPS = [
  {
    icon: FolderOpen,
    titleKey: "distill.guideStep1",
    descKey: "distill.guideStep1Desc",
  },
  {
    icon: Sparkles,
    titleKey: "distill.guideStep2",
    descKey: "distill.guideStep2Desc",
  },
  {
    icon: ClipboardList,
    titleKey: "distill.guideStep3",
    descKey: "distill.guideStep3Desc",
  },
  {
    icon: Save,
    titleKey: "distill.guideStep4",
    descKey: "distill.guideStep4Desc",
  },
] as const;

/**
 * First-run guide overlay (V3.0 prototype). Covers the content area with a
 * centred card explaining the four-step distillation flow. Dismissal is
 * recorded in localStorage so it shows once per browser/install.
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
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-foreground">
                <step.icon className="size-3.5" />
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-[13px] font-medium">
                    {t(step.titleKey)}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                  {t(step.descKey)}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex justify-end">
          <TTButton variant="primary" onClick={onClose}>
            {t("distill.guideStart")}
          </TTButton>
        </div>
      </Panel>
    </div>
  );
}
