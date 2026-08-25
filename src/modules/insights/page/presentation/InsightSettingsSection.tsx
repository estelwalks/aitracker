/**
 * Compact settings control for the daily insight enhancement switch.
 *
 * The renderer deliberately exposes only the product decision: local rules
 * or LLM-enhanced insight. The server keeps the existing enhanced-auto
 * consent marker and safe default quota internally.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "../../../../lib/i18n/context";
import { Toggle } from "../../../settings/presentation/fields";
import {
  DEFAULT_INSIGHT_REFRESH_INTERVAL_MS,
  MAX_INSIGHT_REFRESH_INTERVAL_MS,
  MIN_INSIGHT_REFRESH_INTERVAL_MS,
  INSIGHT_AUTO_CONSENT_VERSION,
} from "../contracts";
import {
  getInsightPreferences,
  refreshPageInsights,
  setInsightPreferences,
} from "../server-fns";
import {
  PAGE_INSIGHT_REFRESH_CHANNEL,
  PAGE_INSIGHT_REFRESH_EVENT,
} from "./use-page-insight.pure";

const MIN_REFRESH_MINUTES = MIN_INSIGHT_REFRESH_INTERVAL_MS / 60_000;
const MAX_REFRESH_MINUTES = MAX_INSIGHT_REFRESH_INTERVAL_MS / 60_000;

function notifyInsightRefresh(): void {
  window.dispatchEvent(new Event(PAGE_INSIGHT_REFRESH_EVENT));
  if (typeof BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel(PAGE_INSIGHT_REFRESH_CHANNEL);
  channel.postMessage({ reason: "insight-settings-refresh" });
  channel.close();
}

export function InsightSettingsSection() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(
    String(DEFAULT_INSIGHT_REFRESH_INTERVAL_MS / 60_000),
  );
  const [loading, setLoading] = useState(true);
  const [savingInterval, setSavingInterval] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getInsightPreferences({ data: {} })
      .then((preference) => {
        if (!cancelled) {
          setEnabled(preference.mode === "enhanced-auto");
          setIntervalMinutes(
            String(Math.round(preference.refreshIntervalMs / 60_000)),
          );
        }
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

  const persistSettings = async (
    nextEnabled: boolean,
    nextIntervalMs: number,
  ): Promise<void> => {
    await setInsightPreferences({
      data: nextEnabled
        ? {
            mode: "enhanced-auto",
            consentVersion: INSIGHT_AUTO_CONSENT_VERSION,
            refreshIntervalMs: nextIntervalMs,
          }
        : { mode: "rules", refreshIntervalMs: nextIntervalMs },
    });
  };

  const changeEnabled = async (nextEnabled: boolean) => {
    const previous = enabled;
    setEnabled(nextEnabled);
    try {
      const minutes = Number(intervalMinutes);
      if (!Number.isInteger(minutes)) throw new Error("invalid interval");
      await persistSettings(nextEnabled, minutes * 60_000);
      notifyInsightRefresh();
    } catch {
      setEnabled(previous);
      toast.error(t("settings.insight.section.saveFailed"));
    }
  };

  const saveInterval = async () => {
    const minutes = Number(intervalMinutes);
    if (
      !Number.isInteger(minutes) ||
      minutes < MIN_REFRESH_MINUTES ||
      minutes > MAX_REFRESH_MINUTES
    ) {
      toast.error(t("settings.insight.section.intervalInvalid"));
      return;
    }
    setSavingInterval(true);
    try {
      await persistSettings(enabled, minutes * 60_000);
      notifyInsightRefresh();
      toast.success(t("settings.insight.section.intervalSaved"));
    } catch {
      toast.error(t("settings.insight.section.saveFailed"));
    } finally {
      setSavingInterval(false);
    }
  };

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await refreshPageInsights();
      notifyInsightRefresh();
      toast.success(t("settings.insight.section.refreshDone"));
    } catch {
      toast.error(t("settings.insight.section.refreshFailed"));
    } finally {
      setRefreshing(false);
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
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
        <div>
          <div className="text-[13px]">
            {t("settings.insight.section.refreshInterval")}
          </div>
          <div className="mt-0.5 max-w-2xl text-[11px] text-muted-foreground">
            {t("settings.insight.section.refreshIntervalHint", {
              min: MIN_REFRESH_MINUTES,
              max: MAX_REFRESH_MINUTES,
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={MIN_REFRESH_MINUTES}
            max={MAX_REFRESH_MINUTES}
            step={1}
            value={intervalMinutes}
            onChange={(event) => setIntervalMinutes(event.target.value)}
            disabled={loading || savingInterval}
            className="h-8 w-24 rounded-md border border-border bg-background px-2 text-right text-[12px] outline-none focus:border-foreground/50 disabled:opacity-50"
            aria-label={t("settings.insight.section.refreshInterval")}
          />
          <span className="text-[11px] text-muted-foreground">
            {t("settings.insight.section.minutes")}
          </span>
          <button
            type="button"
            onClick={() => void saveInterval()}
            disabled={loading || savingInterval}
            className="h-8 rounded-md bg-surface-2 px-3 text-[11px] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("settings.insight.section.save")}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
        <div>
          <div className="text-[13px]">
            {t("settings.insight.section.refreshNow")}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {t("settings.insight.section.refreshNowHint")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refreshNow()}
          disabled={loading || refreshing}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-surface-2 px-3 text-[11px] transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} />
          {t("settings.insight.section.refreshNowButton")}
        </button>
      </div>
    </div>
  );
}
