import { Brain } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "../lib/i18n/context.tsx";
import { getMessage } from "../lib/i18n/messages.ts";
import { zh } from "../lib/i18n/locales/zh-CN";
import { TTButton } from "./tt.tsx";

type DistillT = ReturnType<typeof useI18n>["t"];

/** zh fallback so callers without a live `t` (module-level helpers) still get text. */
const zhT: DistillT = (key, params) =>
  getMessage(zh, key, params as Record<string, string | number> | undefined);

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

/**
 * 蒸馏任务创建后的统一跳转提示：明确告知会离开当前页面、耗时较长。
 * `t` 由调用方传入以按当前语言渲染；未传时回退到 zh-CN。
 */
export function notifyDistillStarted(opts: {
  sessions: number;
  minutes: number;
  onGo: () => void;
  t?: DistillT;
}) {
  const t = opts.t ?? zhT;
  toast.warning(t("distill.notify.title"), {
    duration: 6000,
    description: t("distill.notify.desc", {
      sessions: opts.sessions,
      minutes: opts.minutes,
    }),
    action: { label: t("distill.notify.go"), onClick: opts.onGo },
  });
  opts.onGo();
}
