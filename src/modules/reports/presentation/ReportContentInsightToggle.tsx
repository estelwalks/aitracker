/**
 * Opt-in switch for content-based reporting.
 *
 * OFF (default): every report stays strictly statistics-based — no transcript
 * is opened. ON: the covered sessions' transcripts are read locally and only a
 * bounded, redacted digest is sent to the user's own configured model, so the
 * daily/weekly/monthly summary can describe the actual work.
 *
 * The switch is a plain app preference, read per generation by the server, so
 * flipping it takes effect on the next report without a restart.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useI18n } from "../../../lib/i18n/context";
import {
  getPreference,
  setPreference,
} from "../../../lib/preferences/client.ts";
import {
  ScheduleField,
  ScheduleToggle,
} from "../../../shared/ui/schedule-config";
import { REPORT_CONTENT_INSIGHT_KEY } from "../schedule.ts";

export function ReportContentInsightToggle() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPreference(REPORT_CONTENT_INSIGHT_KEY)
      .then((value) => {
        if (!cancelled) setEnabled(value === true);
      })
      .catch(() => {
        // An unreadable preference must not silently enable content reading.
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const change = async (next: boolean) => {
    if (enabled === null || saving) return;
    const previous = enabled;
    setSaving(true);
    setEnabled(next);
    try {
      await setPreference(REPORT_CONTENT_INSIGHT_KEY, next);
      toast.success(t("common.success"));
    } catch {
      setEnabled(previous);
      toast.error(t("reports.contentInsight.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScheduleField
      label={t("reports.contentInsight.title")}
      hint={
        enabled === true
          ? t("reports.contentInsight.hintOn")
          : t("reports.contentInsight.hintOff")
      }
    >
      <ScheduleToggle
        value={enabled === true}
        onChange={change}
        disabled={enabled === null || saving}
        ariaLabel={t("reports.contentInsight.title")}
      />
    </ScheduleField>
  );
}
