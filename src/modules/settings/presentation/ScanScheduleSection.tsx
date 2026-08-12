import { useEffect, useState, type ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";

import { Segmented } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import type { SecurityClient } from "../../security-assessment/query/desktop-client";
import type {
  SecurityScanCycle,
  SecurityScanScheduleView,
} from "../../security-assessment/presentation/security-view";
import {
  Field,
  SectionHeading,
  SecurityLoadError,
  SecurityUnavailable,
  Toggle,
} from "./fields";
import type { SecurityConnectionStatus } from "./use-security-client";

const CYCLE_OPTIONS: readonly SecurityScanCycle[] = [
  "hourly",
  "daily",
  "weekly",
];

/**
 * 自动扫描计划：开启/暂停 + 扫描周期（hourly/daily/weekly）。
 * 绑定真实 SecurityClient.getScanSchedule()/setScanSchedule()。
 */
export function ScanScheduleSection({
  client,
  status,
  onRetry,
}: {
  client: SecurityClient | null;
  status: SecurityConnectionStatus;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const [schedule, setSchedule] = useState<SecurityScanScheduleView | null>(
    null,
  );
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (client == null) return;
    let cancelled = false;
    setLoadError(false);
    setSchedule(null);
    client
      .getScanSchedule()
      .then((next) => {
        if (!cancelled) setSchedule(next);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        toast.error(t("settings.security.schedule.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadTick, t]);

  const retryLoad = () => setReloadTick((value) => value + 1);

  const save = async (next: SecurityScanScheduleView) => {
    if (client == null) return;
    const previous = schedule;
    setSchedule(next);
    setSaving(true);
    try {
      const saved = await client.setScanSchedule(next);
      setSchedule(saved);
      toast.success(t("settings.security.schedule.saved"));
    } catch {
      if (previous != null) setSchedule(previous);
      toast.error(t("settings.security.schedule.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  let content: ReactNode;
  if (status === "unavailable") {
    content = <SecurityUnavailable onRetry={onRetry} />;
  } else if (loadError) {
    content = (
      <SecurityLoadError
        message={t("settings.security.schedule.loadFailed")}
        onRetry={retryLoad}
      />
    );
  } else if (schedule == null) {
    content = (
      <Field label={t("settings.security.schedule.title")}>
        <span className="text-[13px] text-muted-foreground">
          {t("common.loading")}
        </span>
      </Field>
    );
  } else {
    content = (
      <div>
        <Field
          label={t("settings.security.schedule.enabled")}
          hint={t("settings.security.schedule.enabledHint")}
        >
          <Toggle
            value={schedule.enabled}
            onChange={(enabled) => void save({ ...schedule, enabled })}
            disabled={saving}
          />
        </Field>
        <Field label={t("settings.security.schedule.cycle")}>
          <div className={saving ? "pointer-events-none opacity-50" : ""}>
            <Segmented
              value={schedule.cycle}
              onChange={(cycle) => void save({ ...schedule, cycle })}
              options={CYCLE_OPTIONS.map((cycle) => ({
                value: cycle,
                label: t(`settings.security.schedule.${cycle}`),
              }))}
            />
          </div>
        </Field>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading icon={<CalendarClock className="size-3.5" />}>
        {t("settings.security.schedule.title")}
      </SectionHeading>
      <p className="mb-3 text-[11px] text-muted-foreground">
        {t("settings.security.schedule.desc")}
      </p>
      {content}
    </div>
  );
}
