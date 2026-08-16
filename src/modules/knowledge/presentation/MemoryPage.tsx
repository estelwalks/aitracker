import { Brain } from "lucide-react";

import { EmptyState } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";

/** Placeholder memory hub page — filled by the prototype alignment task. */
export function MemoryPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4 pb-12">
      <EmptyState
        icon={<Brain className="size-5" strokeWidth={1.8} />}
        title={t("memory.placeholderTitle")}
        desc={t("memory.placeholderDesc")}
      />
    </div>
  );
}
