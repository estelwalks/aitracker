import { HelpCircle, X } from "lucide-react";

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
 * Enter the boot overlay for the first time, align prototype 779-839: absolute coverage content area, chart-1 fuzzy blob,
 * HelpCircle icon, two-paragraph introduction, 2-column steps grid + get started with CTA. The mask can be clicked to close;
 * Writing to SQLite will no longer automatically pop up after closing. You can click "?" in the title bar to re-read.
 */
export function DistillGuide({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center p-6 pt-16"
      role="dialog"
      aria-modal="true"
      aria-label={t("distill.guideTitle")}
    >
      <div
        className="aitracker-overlay absolute inset-0 rounded-xl backdrop-blur-md"
        onClick={onClose}
      />
      <section className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-card p-7 shadow-2xl shadow-black/60">
        <div
          className="pointer-events-none absolute -top-24 right-0 size-64 rounded-full opacity-[0.18] blur-3xl"
          style={{ background: "var(--chart-1)" }}
        />
        <header className="relative flex items-center gap-2">
          <HelpCircle className="size-4" style={{ color: "var(--chart-1)" }} />
          <h2 className="text-[14px] font-semibold tracking-tight">
            {t("distill.guideTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg p-1 text-muted-foreground hover:text-foreground"
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </button>
        </header>
        <p className="relative mt-3 text-[13px] leading-relaxed">
          {t("distill.guideIntro1")}
        </p>
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
      </section>
    </div>
  );
}
