import type { ReactNode } from "react";
import { AlertTriangle, MonitorX, RefreshCw } from "lucide-react";

import { useI18n } from "../../../lib/i18n/context";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <div>
        <div className="aitracker-text-body">{label}</div>
        {hint && (
          <div className="aitracker-text-caption mt-0.5 text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function Toggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      disabled={disabled}
      className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
        value ? "bg-primary" : "border border-border bg-surface-2"
      } disabled:cursor-not-allowed disabled:opacity-50`}
      aria-pressed={value}
    >
      <span
        className="block size-4 rounded-full bg-background transition-transform"
        style={{ transform: value ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

/** 设置页内嵌分组的小标题（带可选图标）。 */
export function SectionHeading({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-1.5 mt-1 flex items-center gap-1.5">
      {icon && (
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-muted-foreground">
          {icon}
        </span>
      )}
      <h3 className="aitracker-text-section-title font-semibold tracking-tight">
        {children}
      </h3>
    </div>
  );
}

/** 数据读取失败的内联提示（带重试），供安全相关设置分组复用。 */
export function SecurityLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="aitracker-text-body-sm flex items-start gap-2 rounded-xl bg-warn/10 px-3.5 py-3 text-warn">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="aitracker-text-caption mt-1 inline-flex items-center gap-1 hover:opacity-80"
        >
          <RefreshCw className="size-3" />
          {t("common.retry")}
        </button>
      </div>
    </div>
  );
}

/** 安全检测服务不可用的诚实提示，供安全相关设置分组复用。 */
export function SecurityUnavailable({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="aitracker-text-body-sm flex items-start gap-2 rounded-xl bg-warn/10 px-3.5 py-3 text-warn">
      <MonitorX className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">
          {t("settings.security.unavailable.title")}
        </p>
        <p className="mt-0.5 leading-relaxed text-warn/80">
          {t("settings.security.unavailable.desc")}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="aitracker-text-caption mt-2 inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 hover:bg-accent"
        >
          <RefreshCw className="size-3" />
          {t("settings.security.unavailable.retry")}
        </button>
      </div>
    </div>
  );
}
