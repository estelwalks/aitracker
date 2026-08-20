/**
 * Compact settings control for the daily insight enhancement switch.
 *
 * The renderer deliberately exposes only the product decision: local rules
 * or LLM-enhanced insight. The server keeps the existing enhanced-auto
 * consent marker and safe default quota internally.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "../../../../lib/i18n/context";
import { Toggle } from "../../../settings/presentation/fields";
import { INSIGHT_AUTO_CONSENT_VERSION } from "../contracts";
import { getInsightPreferences, setInsightPreferences } from "../server-fns";

export function InsightSettingsSection() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getInsightPreferences({ data: {} })
      .then((preference) => {
        if (!cancelled) setEnabled(preference.mode === "enhanced-auto");
      })
      .catch(() => {
        if (!cancelled) toast.error(t("settings.insight.section.saveFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const changeEnabled = async (nextEnabled: boolean) => {
    const previous = enabled;
    setEnabled(nextEnabled);
    try {
      await setInsightPreferences({
        data: nextEnabled
          ? {
              mode: "enhanced-auto",
              consentVersion: INSIGHT_AUTO_CONSENT_VERSION,
            }
          : { mode: "rules" },
      });
    } catch {
      setEnabled(previous);
      toast.error(t("settings.insight.section.saveFailed"));
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <div className="text-[13px]">
            {t("settings.insight.section.title")}
          </div>
          <div className="mt-0.5 max-w-2xl text-[11px] text-muted-foreground">
            {t("settings.insight.section.desc")}
          </div>
        </div>
        <Toggle
          value={enabled}
          onChange={(value) => void changeEnabled(value)}
          disabled={loading}
        />
      </div>
    </div>
  );
}
