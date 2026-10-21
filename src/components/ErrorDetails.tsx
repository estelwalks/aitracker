import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useI18n } from "../lib/i18n/context";
import {
  copyDiagnostics,
  createErrorRecord,
  formatErrorRecord,
  storeErrorRecord,
  type RenderErrorRecord,
} from "../lib/error-diagnostics";

/**
 * Shared renderer for the route error boundaries.
 *
 * "Page failed to load" alone is undebuggable, so the boundary always shows the
 * real error and keeps the last records on this machine. Primary actions stay
 * untouched above; everything here is secondary and collapsed by default, but
 * the error line itself is always visible.
 */

interface ErrorDetailsProps {
  readonly error: unknown;
  /** `compact` fits inside a module body; `default` is the full-page boundary. */
  readonly variant?: "default" | "compact";
  /** Locale/currency the app was running when the render failed. */
  readonly locale?: string;
  readonly currency?: string;
}

export function ErrorDetails({
  error,
  variant = "default",
  locale,
  currency,
}: ErrorDetailsProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [storedCount, setStoredCount] = useState<number | null>(null);

  // Derived during render, not in an effect: the cause must be readable in the
  // very first frame (and in the SSR markup), including the frame in which the
  // route failed. Storage is the only side effect, so it stays in the effect.
  const record = useMemo<RenderErrorRecord>(
    () => createErrorRecord(error, { locale, currency }),
    [currency, error, locale],
  );

  useEffect(() => {
    setStoredCount(storeErrorRecord(record).length);
  }, [record]);

  const report = formatErrorRecord(record);
  const compact = variant === "compact";

  // A single line, always visible, so the cause is on screen without a click.
  const summary = `${record.name}: ${record.message}`;

  const copy = async () => {
    const copied = await copyDiagnostics(report);
    setCopyState(copied ? "copied" : "failed");
  };

  return (
    <div
      className={
        compact
          ? "mt-2 flex flex-col items-center gap-1"
          : "mt-3 flex flex-col items-center gap-1"
      }
    >
      {record.message.trim() !== "" && (
        <p
          className={`max-w-full break-words font-mono text-muted-foreground ${
            compact ? "text-[11px]" : "text-xs"
          }`}
          data-testid="error-summary"
        >
          {summary}
        </p>
      )}
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="aitracker-text-body-sm inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {expanded ? (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden="true" />
        )}
        {expanded
          ? t("common.errorDetails.hide")
          : t("common.errorDetails.show")}
      </button>
      {expanded && (
        <div className="w-full space-y-2 text-left">
          <pre
            data-testid="error-report"
            className="aitracker-scroll max-h-72 w-full overflow-auto rounded-sm border border-border bg-surface-2 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground"
          >
            {report}
          </pre>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                void copy();
              }}
              className="aitracker-text-body-sm inline-flex items-center gap-1.5 rounded-sm border border-input bg-background px-2.5 py-1 text-foreground transition-colors hover:bg-accent"
            >
              {copyState === "copied" ? (
                <Check className="size-3.5" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
              {copyState === "copied"
                ? t("common.errorDetails.copied")
                : t("common.errorDetails.copy")}
            </button>
            {storedCount != null && storedCount > 0 && (
              <span className="aitracker-text-body-sm inline-flex items-center gap-1.5 text-muted-foreground">
                <AlertTriangle className="size-3.5" aria-hidden="true" />
                {t("common.errorDetails.storedHint", { count: storedCount })}
              </span>
            )}
          </div>
          {copyState === "failed" && (
            <p className="aitracker-text-body-sm text-muted-foreground">
              {t("common.errorDetails.copyFailed")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
