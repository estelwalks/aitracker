import { AppWindowMac } from "lucide-react";

import { EmptyState } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";

/** Placeholder widget preview page — filled by the prototype alignment task. */
export function WidgetPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4 pb-12">
      <EmptyState
        icon={<AppWindowMac className="size-5" strokeWidth={1.8} />}
        title={t("widget.placeholderTitle")}
        desc={t("widget.placeholderDesc")}
      />
    </div>
  );
}
