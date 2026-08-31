import { AlertTriangle, MonitorX, RefreshCw } from "lucide-react";

import { useI18n } from "../../../lib/i18n/context";
export {
  ScheduleField as Field,
  ScheduleSectionHeading as SectionHeading,
  ScheduleToggle as Toggle,
} from "../../../shared/ui/schedule-config";

/** Inline prompt for data read failure (with retry) for group reuse of security-related settings. */
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

/** An honest reminder that the security detection service is unavailable for group reuse of security-related settings. */
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
