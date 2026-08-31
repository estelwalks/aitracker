import { useEffect, useState } from "react";
import type { Locale } from "../../../lib/i18n/locale.ts";
import { useI18n } from "../../../lib/i18n/context.tsx";
import { DashboardJarvisInsight } from "./dashboard-v2-sections.tsx";
import { DashboardTrendFallback, DashboardV2Page } from "./DashboardV2Page.tsx";
import { useDashboardSummary } from "./use-dashboard-summary.ts";

function DashboardInsightFallback() {
  return (
    <div className="dashboard-insight-hero min-h-[72px]" aria-hidden="true">
      <div className="relative flex min-w-0 items-center gap-4">
        <span className="size-10 shrink-0 animate-pulse rounded-full bg-surface-2" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3 w-24 animate-pulse rounded-sm bg-surface-2" />
          <div className="h-4 w-3/4 animate-pulse rounded-sm bg-surface-2" />
        </div>
      </div>
    </div>
  );
}

/** Delay evidence collection until the shell has painted at least once. */
function DashboardDeferredInsight() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return ready ? <DashboardJarvisInsight /> : <DashboardInsightFallback />;
}

export function DashboardPageSkeleton({ label }: { readonly label: string }) {
  return (
    <section aria-busy="true" aria-label={label} className="space-y-4">
      <div className="dashboard-panel h-[150px] animate-pulse bg-surface-2/60" />
      <div className="h-10 animate-pulse border-y border-border/60 bg-surface-2/50" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            // The fixed slots preserve the final metric-grid footprint.
            key={index}
            className="dashboard-panel h-[116px] animate-pulse bg-surface-2/60"
          />
        ))}
      </div>
      <div className="dashboard-panel h-14 animate-pulse bg-surface-2/60" />
      <DashboardTrendFallback />
    </section>
  );
}

/** Public presentation boundary for the compact dashboard summary (P1-T1-04). */
export function DashboardPage({ locale }: { readonly locale: Locale }) {
  const { t } = useI18n();
  const dashboard = useDashboardSummary(locale);

  return (
    <div className="dashboard-page dashboard-page-stack pb-12">
      <DashboardDeferredInsight />
      {dashboard.data ? (
        <DashboardV2Page
          data={dashboard.data}
          snapshotStatus={dashboard.snapshotStatus}
          onRetry={dashboard.retry}
        />
      ) : dashboard.error ? (
        <section
          className="dashboard-panel flex flex-wrap items-center justify-between gap-3 border border-destructive/30 bg-destructive/5"
          role="alert"
        >
          <div className="space-y-1">
            <h1 className="aitracker-text-section-title font-medium">
              {t("dashboard.onboarding.workspaceInitializationFailed")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("dashboard.onboarding.workspaceInitializationFailedDesc")}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            onClick={() => void dashboard.retry()}
          >
            {t("dashboard.onboarding.retryWorkspaceInitialization")}
          </button>
        </section>
      ) : (
        <DashboardPageSkeleton
          label={t("dashboard.onboarding.workspaceInitializing")}
        />
      )}
    </div>
  );
}
