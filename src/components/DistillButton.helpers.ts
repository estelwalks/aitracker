import { toast } from "sonner";

import { useI18n } from "../lib/i18n/context.tsx";
import { getMessage } from "../lib/i18n/messages.ts";
import { zh } from "../lib/i18n/locales/zh-CN";

type DistillT = ReturnType<typeof useI18n>["t"];

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
  const zhT: DistillT = (key, params) =>
    getMessage(zh, key, params as Record<string, string | number> | undefined);
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
