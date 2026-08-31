import { toast } from "sonner";

import { useI18n } from "../lib/i18n/context.tsx";
import { getMessage } from "../lib/i18n/messages.ts";
import { zh } from "../lib/i18n/locales/zh-CN";

type DistillT = ReturnType<typeof useI18n>["t"];

/**
 * Unified jump prompt after the distillation task is created: clearly inform that it will leave the current page and take a long time.
 * `t` Passed in by the caller to render in the current language; fallback to zh-CN if not passed.
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
