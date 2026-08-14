import { useI18n } from "../../../../lib/i18n/context";
import { relativeTimeParts } from "../security-view";

/**
 * 「N 分钟前」相对时间标签。一次性渲染（非响应式），与 ScanHistory
 * 内的 `Date.now()` 约定一致。空 iso 不渲染，由调用方决定降级文案。
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
