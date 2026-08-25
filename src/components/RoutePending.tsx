import { useI18n } from "../lib/i18n/context";

/**
 * Router-wide pending UI. It appears only after a short delay, so cached
 * navigation stays visually instant while slower first visits acknowledge the
 * click instead of looking unresponsive.
 */
export function RoutePending() {
  const { t } = useI18n();
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      aria-label={t("common.loading")}
      className="space-y-5 py-1"
    >
      <div className="h-7 w-44 animate-pulse rounded bg-surface-2" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-32 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-32 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-32 animate-pulse rounded-lg bg-surface-2" />
      </div>
      <div className="h-72 animate-pulse rounded-lg bg-surface-2" />
    </section>
  );
}
