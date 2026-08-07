import { cn } from "@/lib/utils";

import type { StatusMessageKey, StatusViewModel, UiDataStatus } from "./status";
import { createStatusViewModel } from "./status";

export interface StatusTextResolver {
  (key: StatusMessageKey): string;
}

export interface StatusComponentProps {
  status: UiDataStatus | string;
  /** Resolve only the whitelisted status key; no raw errors or sensitive detail are accepted. */
  resolveMessage?: StatusTextResolver;
  className?: string;
}

function statusClass(severity: StatusViewModel["severity"]): string {
  return {
    success:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    info: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    warning:
      "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    danger: "border-destructive/40 bg-destructive/10 text-destructive",
    neutral: "border-border bg-muted text-muted-foreground",
  }[severity];
}

function modelText(
  model: StatusViewModel,
  resolveMessage?: StatusTextResolver,
): string {
  return resolveMessage?.(model.messageKey) ?? model.messageKey;
}

export function StatusBanner({
  status,
  resolveMessage,
  className,
}: StatusComponentProps) {
  const model = createStatusViewModel(status);
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        statusClass(model.severity),
        className,
      )}
      role={model.role}
      aria-live={model.ariaLive}
      aria-busy={model.loading || undefined}
      aria-disabled={model.disabled || undefined}
      data-status={model.status}
      data-severity={model.severity}
    >
      <span>{modelText(model, resolveMessage)}</span>
    </div>
  );
}

export function StatusBadge({
  status,
  resolveMessage,
  className,
}: StatusComponentProps) {
  const model = createStatusViewModel(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        statusClass(model.severity),
        className,
      )}
      role={model.role}
      aria-live={model.ariaLive}
      aria-busy={model.loading || undefined}
      aria-disabled={model.disabled || undefined}
      data-status={model.status}
      data-severity={model.severity}
    >
      {modelText(model, resolveMessage)}
    </span>
  );
}
