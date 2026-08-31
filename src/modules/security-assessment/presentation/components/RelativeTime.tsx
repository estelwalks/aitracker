import { useI18n } from "../../../../lib/i18n/context";
import { relativeTimeParts } from "../security-view";

/**
 * "N minutes ago" relative time label. One-time rendering (non-responsive), with ScanHistory
 * The convention inside `Date.now()` is consistent. Empty iso is not rendered and it is up to the caller to downgrade the copy.
 */
export function RelativeTime({ iso }: { iso: string }) {
  const { t } = useI18n();
  if (!iso) return null;
  const parts = relativeTimeParts(iso, Date.now());
  if (parts.unit === "just") {
    return <>{t("security.center.status.agoJust")}</>;
  }
  if (parts.unit === "minute") {
    return (
      <>{t("security.center.status.agoMinutes", { count: parts.value })}</>
    );
  }
  if (parts.unit === "hour") {
    return <>{t("security.center.status.agoHours", { count: parts.value })}</>;
  }
  return <>{t("security.center.status.agoDays", { count: parts.value })}</>;
}
