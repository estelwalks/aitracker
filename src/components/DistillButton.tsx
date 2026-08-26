import { Brain } from "lucide-react";

import { useI18n } from "../lib/i18n/context.tsx";
import { TTButton } from "./tt.tsx";

/**
 * 全局统一的「蒸馏」按钮：会话列表、会话详情、片段蒸馏均使用同一形态与文案。
 * 未选择内容时置灰，并给出一致的提示。
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
    <TTButton
      size={size}
      variant={off ? "default" : "primary"}
      disabled={off}
      className={className}
      title={title}
      onClick={onClick}
    >
      <Brain className="size-3.5" />
      {t("distill.button.label")}
    </TTButton>
  );
}
