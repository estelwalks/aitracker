import type { MessageKey } from "../lib/i18n/schema";
import { useI18n } from "../lib/i18n/context";

/**
 * Retryable error panel for lazy route data fetches (P2-16): a failed loader
 * must never leave a permanent skeleton. Mirrors the DashboardPage error
 * pattern so every route uses the same visual + retry affordance.
 */
export function LoadErrorPanel({
  titleKey,
  descriptionKey,
  onRetry,
}: {
  titleKey: MessageKey;
  descriptionKey: MessageKey;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <section
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
    >
      <div className="space-y-1">
        <h1 className="font-medium">{t(titleKey)}</h1>
        <p className="text-sm text-muted-foreground">{t(descriptionKey)}</p>
      </div>
      <button
        type="button"
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        onClick={onRetry}
      >
        {t("common.retry")}
      </button>
    </section>
  );
}
