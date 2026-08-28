/**
 * Compact settings control for the daily insight enhancement switch.
 *
 * The renderer deliberately exposes only the product decision: local rules
 * or LLM-enhanced insight. The server keeps the existing enhanced-auto
 * consent marker and safe default quota internally. The refresh section
 * shows per-surface progress with failure attribution so a surface that
 * stays on rule-based insight is explainable (timeout / empty content /
 * reasoning-only / HTTP error).
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "../../../../lib/i18n/context";
import { Toggle } from "../../../settings/index.ts";
import {
  DEFAULT_INSIGHT_REFRESH_INTERVAL_MS,
  MAX_INSIGHT_REFRESH_INTERVAL_MS,
  MIN_INSIGHT_REFRESH_INTERVAL_MS,
  INSIGHT_AUTO_CONSENT_VERSION,
} from "../contracts";
import {
  getPageInsightRefreshStatus,
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

interface RefreshBatchItemView {
  readonly surfaceId: string;
  readonly status: "queued" | "running" | "completed" | "failed" | "skipped";
  readonly resultStatus: string | null;
  readonly resultDetail: string | null;
  readonly finishedAtMs: number | null;
}

interface RefreshBatchView {
  readonly runId: string;
  readonly status: "queued" | "running" | "completed";
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly items: readonly RefreshBatchItemView[];
}

function notifyInsightRefresh(): void {
  window.dispatchEvent(new Event(PAGE_INSIGHT_REFRESH_EVENT));
  if (typeof BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel(PAGE_INSIGHT_REFRESH_CHANNEL);
  channel.postMessage({ reason: "insight-settings-refresh" });
  channel.close();
}

/** Map a persisted failure attribution to its i18n label key. */
function failureReasonLabelKey(
  detail: string | null | undefined,
  resultStatus: string | null,
): string | null {
  if (detail === "recovered") {
    return "settings.insight.section.recovered";
  }
  if (detail !== null && detail !== undefined && detail !== "") {
    if (detail.startsWith("http-error")) {
      return "settings.insight.failureReason.http-error";
    }
    if (detail.startsWith("invalid-output")) {
      return "settings.insight.fallbackStatus.invalid-output";
    }
    switch (detail) {
      case "timeout":
        return "settings.insight.failureReason.timeout";
      case "empty-content":
        return "settings.insight.failureReason.empty-content";
      case "reasoning-only":
        return "settings.insight.failureReason.reasoning-only";
      case "not-json":
        return "settings.insight.failureReason.not-json";
      default:
        return "settings.insight.failureReason.unknown";
    }
  }
  // No attribution detail: fall back to the coarse envelope status.
  switch (resultStatus) {
    case "timeout":
      return "settings.insight.failureReason.timeout";
    case "invalid-output":
      return "settings.insight.fallbackStatus.invalid-output";
    default:
      return "settings.insight.failureReason.unknown";
  }
}

export function InsightSettingsSection() {
  const { t, locale } = useI18n();
  // Dynamic i18n keys (per-surface labels, failure reasons) resolve at runtime.
  const render = t as unknown as (
    key: string,
    params?: Record<string, string | number>,
  ) => string;
  const [enabled, setEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(
    String(DEFAULT_INSIGHT_REFRESH_INTERVAL_MS / 60_000),
  );
  const [loading, setLoading] = useState(true);
  const [savingInterval, setSavingInterval] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshBatch, setRefreshBatch] = useState<RefreshBatchView | null>(
    null,
  );

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

  useEffect(() => {
    if (!refreshBatch || refreshBatch.status === "completed") return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getPageInsightRefreshStatus({
        data: { runId: refreshBatch.runId },
      })
        .then((next) => {
          if (cancelled) return;
          setRefreshBatch({ ...next, items: next.items ?? [] });
          if (next.status !== "completed") return;
          setRefreshing(false);
          notifyInsightRefresh();
          if (next.failed > 0) {
            toast.error(
              t("settings.insight.section.refreshCompletedWithFailures", {
                completed: next.completed,
                failed: next.failed,
                skipped: next.skipped,
              }),
            );
          } else {
            toast.success(
              t("settings.insight.section.refreshCompleted", {
                completed: next.completed,
                skipped: next.skipped,
              }),
            );
          }
        })
        .catch(() => {
          if (!cancelled) setRefreshing(false);
        });
    }, 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshBatch, t]);

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
      const batch = await refreshPageInsights({ data: { locale } });
      // The start response carries no per-item state; the first poll fills it.
      setRefreshBatch({ ...batch, items: [] });
      toast.success(t("settings.insight.section.refreshStarted"));
    } catch {
      setRefreshing(false);
      toast.error(t("settings.insight.section.refreshFailed"));
    }
  };

  /** One line of per-surface progress with failure attribution. */
  const renderItemLine = (item: RefreshBatchItemView) => {
    const surfaceLabel = render(`settings.insight.surfaces.${item.surfaceId}`);
    switch (item.status) {
      case "completed":
        return (
          <div className="flex items-center gap-2">
            <span className="text-emerald-600">✓</span>
            <span className="text-foreground/80">{surfaceLabel}</span>
            <span className="text-muted-foreground">
              {render("settings.insight.status.enhanced-ready")}
            </span>
          </div>
        );
      case "failed": {
        const reasonKey = failureReasonLabelKey(
          item.resultDetail,
          item.resultStatus,
        );
        const reason =
          reasonKey !== null
            ? render(reasonKey)
            : render("settings.insight.failureReason.unknown");
        return (
          <div className="flex items-center gap-2">
            <span className="text-red-600">✗</span>
            <span className="text-foreground/80">{surfaceLabel}</span>
            <span className="text-muted-foreground">{reason}</span>
          </div>
        );
      }
      case "skipped": {
        const reason =
          item.resultStatus === "no-eligible-candidates"
            ? render("settings.insight.fallbackStatus.no-eligible-candidates")
            : item.resultStatus === "pending"
              ? render("settings.insight.status.pending")
              : render("settings.insight.section.skipped");
        return (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">–</span>
            <span className="text-foreground/60">{surfaceLabel}</span>
            <span className="text-muted-foreground">{reason}</span>
          </div>
        );
      }
      default:
        return (
          <div className="flex items-center gap-2">
            <RefreshCw className="size-3 animate-spin text-muted-foreground" />
            <span className="text-foreground/60">{surfaceLabel}</span>
            <span className="text-muted-foreground">
              {render("settings.insight.status.pending")}
            </span>
          </div>
        );
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <div className="aitracker-text-body">
            {t("settings.insight.section.title")}
          </div>
          <div className="aitracker-text-caption mt-0.5 max-w-2xl text-muted-foreground">
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
          <div className="aitracker-text-body">
            {t("settings.insight.section.refreshInterval")}
          </div>
          <div className="aitracker-text-caption mt-0.5 max-w-2xl text-muted-foreground">
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
            className="aitracker-text-body-sm h-8 w-24 rounded-md border border-border bg-background px-2 text-right outline-none focus:border-foreground/50 disabled:opacity-50"
            aria-label={t("settings.insight.section.refreshInterval")}
          />
          <span className="aitracker-text-caption text-muted-foreground">
            {t("settings.insight.section.minutes")}
          </span>
          <button
            type="button"
            onClick={() => void saveInterval()}
            disabled={loading || savingInterval}
            className="aitracker-text-caption h-8 rounded-md bg-surface-2 px-3 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("settings.insight.section.save")}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3">
        <div>
          <div className="aitracker-text-body">
            {t("settings.insight.section.refreshNow")}
          </div>
          <div className="aitracker-text-caption mt-0.5 text-muted-foreground">
            {t("settings.insight.section.refreshNowHint")}
          </div>
          {refreshBatch && (
            <div className="mt-1">
              <div className="aitracker-text-caption text-muted-foreground">
                {refreshBatch.status === "completed"
                  ? refreshBatch.failed > 0
                    ? t(
                        "settings.insight.section.refreshCompletedWithFailures",
                        {
                          completed: refreshBatch.completed,
                          failed: refreshBatch.failed,
                          skipped: refreshBatch.skipped,
                        },
                      )
                    : t("settings.insight.section.refreshCompleted", {
                        completed: refreshBatch.completed,
                        skipped: refreshBatch.skipped,
                      })
                  : t("settings.insight.section.refreshProgress", {
                      completed:
                        refreshBatch.completed +
                        refreshBatch.failed +
                        refreshBatch.skipped,
                      total: refreshBatch.total,
                      failed: refreshBatch.failed,
                    })}
              </div>
              {refreshBatch.items.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {refreshBatch.items.map((item) => (
                    <div key={item.surfaceId} className="text-xs">
                      {renderItemLine(item)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void refreshNow()}
          disabled={loading || refreshing || !enabled}
          title={
            enabled
              ? undefined
              : render("settings.insight.section.rulesModeRefreshDisabled")
          }
          className="aitracker-text-caption inline-flex h-8 items-center gap-1.5 rounded-md bg-surface-2 px-3 transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`size-3 ${refreshing ? "animate-spin" : ""}`} />
          {t("settings.insight.section.refreshNowButton")}
        </button>
      </div>
    </div>
  );
}
