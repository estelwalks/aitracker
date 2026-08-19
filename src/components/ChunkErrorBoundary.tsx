/* eslint-disable react-refresh/only-export-components */
import { Component, type ErrorInfo, type ReactNode } from "react";

import { useI18n } from "../lib/i18n/context";

/**
 * P6-T6-05: chunk error fallback for React.lazy components.
 *
 * When an on-demand chunk fails to load (offline, cache eviction, bad
 * deployment), React.lazy throws during render; this boundary catches it and
 * offers a plain retry instead of white-screening the route.
 */

/** Localized fallback body; separated so the boundary class stays hook-free. */
function ChunkErrorFallback() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center gap-2 rounded-sm border border-border bg-surface px-4 py-6 text-[12.5px] text-muted-foreground">
      <span>{t("common.chunkLoadFailed")}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}

interface ChunkErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

interface ChunkErrorBoundaryState {
  readonly failed: boolean;
}

export class ChunkErrorBoundary extends Component<
  ChunkErrorBoundaryProps,
  ChunkErrorBoundaryState
> {
  override state: ChunkErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ChunkErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep diagnostics server/log-visible; never render the raw error.
    console.error("Lazy chunk failed to load", error, info);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return this.props.fallback ?? <ChunkErrorFallback />;
    }
    return this.props.children;
  }
}
