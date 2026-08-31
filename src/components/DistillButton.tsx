import { Brain } from "lucide-react";

import { useI18n } from "../lib/i18n/context.tsx";
import { AITrackerButton } from "./aitracker.tsx";

/**
 * Globally unified "Distillation" button: session list, session details, and segment distillation all use the same form and copy.
 * When no content is selected, it will be grayed out and a consistent prompt will be given.
 */
export function DistillButton({
  count,
  onClick,
  size = "md",
  noun,
  unit,
  className = "",
}: {
  count: number;
  onClick: () => void;
  size?: "sm" | "md";
  noun?: string;
  unit?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const off = count === 0;
  const resolvedNoun = noun ?? t("distill.button.noun");
  const title = off
    ? t("distill.button.tooltipEmpty", { noun: resolvedNoun })
    : t("distill.button.tooltipReady", {
        count,
        unit: unit ?? t("distill.button.unit"),
        noun: resolvedNoun,
      });
  return (
    <AITrackerButton
      size={size}
      variant={off ? "default" : "primary"}
      disabled={off}
      className={className}
      title={title}
      onClick={onClick}
    >
      <Brain className="size-3.5" />
      {t("distill.button.label")}
    </AITrackerButton>
  );
}
