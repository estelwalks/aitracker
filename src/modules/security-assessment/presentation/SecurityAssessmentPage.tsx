import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MonitorX, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { brandParams } from "../../../lib/app-config";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import {
  PAGE_INSIGHT_REFRESH_CHANNEL,
  PAGE_INSIGHT_REFRESH_EVENT,
  refreshPageInsightSurface,
} from "../../insights/index.ts";
import {
  getDesktopSecurityClient,
  type SecurityClient,
} from "../query/desktop-client";
import { getBrowserSecurityClient } from "../query/browser-client";
import { getSecurityLlmReviewAvailability } from "../llm-review.server-fns";
import { SECURITY_SCAN_STARTED_EVENT } from "../events";
import { AutoScanGuide } from "./components/AutoScanGuide";
import { ScanHistory } from "./components/ScanHistory";
import { ScanStatus, type ScanStatusNav } from "./components/ScanStatus";
import { ScanTaskDetail } from "./components/ScanTaskDetail";
import { SecurityBriefing } from "./components/SecurityBriefing";
import { SkillReportModal } from "./components/SkillReportModal";
import { UnsafeSkillList } from "./components/UnsafeSkillList";
import {
  countScanTasks,
  dedupeHistoryByContentHash,
  EMPTY_SECURITY_PROGRESS,
  EMPTY_SECURITY_TOTALS,
  SECURITY_RISK_KINDS,
  effectiveSecurityScanMode,
  historyForCurrentSkills,
  clampPercent,
  isScanActive,
  latestHistory,
  resolveNextScheduledScanAt,
  summarizeReports,
  type SecurityHistoryView,
  type SecurityScanMode,
  type SecurityScanRunView,
  type SecurityScanStateView,
  type SecurityScanTaskView,
  type SecuritySkillView,
} from "./security-view";

const IDLE_STATE: SecurityScanStateView = {
  scanId: null,
  status: "idle",
  mode: null,
  trigger: null,
  locale: null,
  progress: EMPTY_SECURITY_PROGRESS,
  resultIds: [],
};

const ACTIVE_SCAN_POLL_INTERVAL_MS = 450;
const IDLE_SCAN_POLL_INTERVAL_MS = 5_000;

function broadcastSecurityInsightRefresh(): void {
  window.dispatchEvent(new Event(PAGE_INSIGHT_REFRESH_EVENT));
  if (typeof BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel(PAGE_INSIGHT_REFRESH_CHANNEL);
  channel.postMessage({ reason: "security-scan-completed" });
  channel.close();
}

export function SecurityAssessmentPage() {
  const { t, format } = useI18n();
  const clientRef = useRef<SecurityClient | null>(null);
  const refreshedInsightScanId = useRef<string | null>(null);
  const [connection, setConnection] = useState<
    "connecting" | "available" | "unavailable"
  >("connecting");
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<readonly SecuritySkillView[]>([]);
  const [scanState, setScanState] = useState<SecurityScanStateView>(IDLE_STATE);
  const [history, setHistory] = useState<readonly SecurityHistoryView[]>([]);
  const [nextScanAt, setNextScanAt] = useState<string | null>(null);
  const [latestRun, setLatestRun] = useState<SecurityScanRunView | null>(null);
  const [modelConfigured, setModelConfigured] = useState(false);
  const [aiAssistedEnabled, setAiAssistedEnabled] = useState(false);
  const [selectedReport, setSelectedReport] =
    useState<SecurityHistoryView | null>(null);
  const [selectedTask, setSelectedTask] = useState<SecurityScanTaskView | null>(
    null,
  );
  const unsafeListRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  const goTo = useCallback((key: ScanStatusNav) => {
    const target = key === "unsafe" ? unsafeListRef : historyRef;
    target.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const getClient = useCallback(async () => {
    if (clientRef.current) return clientRef.current;
    const client =
      getDesktopSecurityClient() ?? (await getBrowserSecurityClient());
    clientRef.current = client;
    return client;
  }, []);

  const reportError = useCallback(
    (error: unknown) => {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    },
    [t],
  );

  const refreshSecurityInsight = useCallback(async () => {
    try {
      await refreshPageInsightSurface({
        data: { surfaceId: "security" },
      });
    } catch {
      // The renderer refresh still lets the page recover when cache
      // invalidation is temporarily unavailable.
    } finally {
      broadcastSecurityInsightRefresh();
    }
  }, []);

  const refresh = useCallback(
    async (reconnect = false) => {
      if (reconnect) clientRef.current = null;
      setConnection("connecting");
      const client = await getClient();
      if (client == null) {
        setConnection("unavailable");
        setLoading(false);
        setNextScanAt(null);
        return;
      }
      if (client.transport === "desktop") setConnection("available");
      try {
        const [nextSkills, nextState, nextHistory] = await Promise.all([
          client.listSkills(),
          client.getStatus(),
          client.getHistory(),
        ]);
        setSkills(nextSkills);
        setScanState(nextState);
        setHistory(nextHistory);
        if (
          nextState.scanId !== null &&
          (nextState.status === "complete" || nextState.status === "partial")
        ) {
          refreshedInsightScanId.current = nextState.scanId;
        }
        void Promise.all([
          client.getScanSchedule(),
          client.getScanScheduleStatus(),
        ])
          .then(([schedule, status]) => {
            setNextScanAt(resolveNextScheduledScanAt(schedule, status));
            setLatestRun(status.lastRun);
          })
          .catch(() => setNextScanAt(null));
        setConnection("available");
      } catch (error) {
        if (client.transport === "companion") {
          clientRef.current = null;
          setConnection("unavailable");
          setNextScanAt(null);
        }
        reportError(error);
      } finally {
        setLoading(false);
      }
    },
    [getClient, reportError],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A scan can be started from another route immediately before navigation to
  // this page. Re-read the shared runtime state when that handoff completes so
  // the in-page progress bar does not wait for the idle polling interval.
  useEffect(() => {
    let disposed = false;
    const syncStartedScan = async () => {
      try {
        const client = await getClient();
        if (client == null || disposed) return;
        const next = await client.getStatus();
        if (!disposed) setScanState(next);
      } catch (error) {
        if (!disposed) reportError(error);
      }
    };
    const onScanStarted = () => void syncStartedScan();
    window.addEventListener(SECURITY_SCAN_STARTED_EVENT, onScanStarted);
    return () => {
      disposed = true;
      window.removeEventListener(SECURITY_SCAN_STARTED_EVENT, onScanStarted);
    };
  }, [getClient, reportError]);

  // The scan setting is the shared gate for both the optional report review
  // and the model-assisted full scan. A configured model alone must never
  // silently turn an immediate detection into a model call.
  useEffect(() => {
    let disposed = false;
    void getSecurityLlmReviewAvailability()
      .then((availability) => {
        if (disposed) return;
        setModelConfigured(availability.configured);
        setAiAssistedEnabled(availability.enabled);
      })
      .catch(() => {
        if (disposed) return;
        setModelConfigured(false);
        setAiAssistedEnabled(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (connection !== "available") return;
    const client = clientRef.current;
    if (client == null) return;
    let disposed = false;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const [next, scheduleStatus] = await Promise.all([
          client.getStatus(),
          client.getScanScheduleStatus(),
        ]);
        if (disposed) return;
        setLatestRun(scheduleStatus.lastRun);
        if (scheduleStatus.nextRunAt != null) {
          setNextScanAt(scheduleStatus.nextRunAt);
        }
        if (!isScanActive(next.status)) {
          const nextHistory = await client.getHistory();
          if (disposed) return;
          // Commit the matching history before the terminal state. Updating
          // scanState tears down this polling effect, so doing it first would
          // mark the request disposed and leave a completed scan looking empty.
          setHistory(nextHistory);
        }
        const shouldRefreshInsight =
          next.scanId !== null &&
          (next.status === "complete" || next.status === "partial") &&
          refreshedInsightScanId.current !== next.scanId;
        if (shouldRefreshInsight) {
          refreshedInsightScanId.current = next.scanId;
        }
        setScanState(next);
        if (shouldRefreshInsight) void refreshSecurityInsight();
      } catch (error) {
        if (!disposed) reportError(error);
      } finally {
        busy = false;
      }
    };
    // Keep a low-frequency watcher while idle so a background automatic scan
    // that starts after the page mounted is reflected in the UI. Active scans
    // retain the fast progress cadence used by the manual-scan flow.
    const interval = isScanActive(scanState.status)
      ? ACTIVE_SCAN_POLL_INTERVAL_MS
      : IDLE_SCAN_POLL_INTERVAL_MS;
    const timer = window.setInterval(() => void poll(), interval);
    void poll();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [connection, refreshSecurityInsight, reportError, scanState.status]);

  const latest = latestHistory(history);
  const latestFinishedAt = [
    latest?.finishedAt,
    latestRun?.finishedAt ?? latestRun?.startedAt,
  ]
    .filter((value): value is string => value != null)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const scanCount = countScanTasks(history);
  const riskKinds = SECURITY_RISK_KINDS;
  const currentHistory = useMemo(
    () => historyForCurrentSkills(history, skills),
    [history, skills],
  );
  const latestEntries = useMemo(
    () => dedupeHistoryByContentHash(currentHistory),
    [currentHistory],
  );
  const latestTotals = useMemo(
    () => summarizeReports(latestEntries),
    [latestEntries],
  );
  const statusTotals = isScanActive(scanState.status)
    ? {
        ...EMPTY_SECURITY_TOTALS,
        total: scanState.progress.discovered,
        failed: scanState.progress.failed,
        skipped: scanState.progress.skipped,
      }
    : latestTotals;
  const lastScanLabel = latestFinishedAt
    ? format.formatDateTime(latestFinishedAt, false)
    : "—";
  const startScan = useCallback(
    async (
      mode: SecurityScanMode,
      scope: "single" | "all" = "all",
      skillRef?: string,
    ) => {
      const client = clientRef.current;
      if (client == null || isScanActive(scanState.status)) return;
      try {
        const effectiveMode = effectiveSecurityScanMode(
          mode,
          modelConfigured,
          aiAssistedEnabled,
        );
        const next = await client.startScan({
          scope,
          mode: effectiveMode,
          trigger: "manual",
          ...(scope === "single" && skillRef
            ? { skillRef: skillRef as `skill:${string}` }
            : {}),
        });
        setScanState(next);
        if (next.status === "model-required") {
          toast.warning(t("security.center.model.requiredSettings"));
        } else {
          toast.success(t("security.center.toast.started"));
        }
      } catch (error) {
        reportError(error);
      }
    },
    [aiAssistedEnabled, modelConfigured, reportError, scanState.status, t],
  );

  const cancelScan = useCallback(async () => {
    const client = clientRef.current;
    if (client == null) return;
    try {
      const accepted = await client.cancelScan();
      if (accepted) {
        setScanState((current) => ({ ...current, status: "cancelling" }));
        toast.info(t("security.center.toast.cancelled"));
      }
    } catch (error) {
      reportError(error);
    }
  }, [reportError, t]);

  return (
    <div className="space-y-2 pb-12">
      {connection !== "connecting" && (
        <SecurityBriefing
          totals={latestTotals}
          dimensions={riskKinds.length}
          lastScan={lastScanLabel}
          nextScan={
            nextScanAt === null ? "—" : format.formatDateTime(nextScanAt, false)
          }
          scanning={
            connection !== "available" || isScanActive(scanState.status)
          }
          onScan={() =>
            void startScan(
              modelConfigured && aiAssistedEnabled ? "full" : "quick",
            )
          }
        />
      )}

      {connection === "available" && isScanActive(scanState.status) && (
        <section
          className="rounded-xl border border-primary/20 bg-card px-4 py-3"
          aria-live="polite"
          aria-label={t("security.center.status.scanning")}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px]">
            <Loader2 className="size-3.5 animate-spin text-primary" />
            <span className="font-semibold text-foreground">
              {t("security.center.status.scanning")}
            </span>
            {scanState.currentSkill && (
              <span className="min-w-0 truncate text-muted-foreground">
                · {scanState.currentSkill}
              </span>
            )}
            <span className="ml-auto text-foreground">
              {clampPercent(scanState.progress.percent)}%
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${clampPercent(scanState.progress.percent)}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>
              {t("security.center.status.progress", {
                completed:
                  scanState.progress.completed +
                  scanState.progress.failed +
                  scanState.progress.skipped,
                total: scanState.progress.queued,
              })}
            </span>
            <span>{scanState.mode ?? "quick"}</span>
          </div>
        </section>
      )}

      {connection === "unavailable" ? (
        <section className="grid min-h-[520px] place-items-center rounded-3xl bg-card p-8 text-center shadow-[var(--elev-1)]">
          <div className="max-w-lg">
            <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-surface-2 text-muted-foreground">
              <MonitorX className="size-8" strokeWidth={1.5} />
            </span>
            <h2 className="mt-5 text-[16px] font-semibold">
              {t("security.center.unavailable.title")}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              {t("security.center.unavailable.desc", brandParams)}
            </p>
            <button
              type="button"
              onClick={() => void refresh(true)}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-[12px] font-medium text-primary-foreground"
            >
              <RefreshCw className="size-4" />{" "}
              {t("security.center.unavailable.retry")}
            </button>
          </div>
        </section>
      ) : connection === "connecting" || loading ? (
        <div className="grid min-h-[480px] place-items-center text-muted-foreground">
          <div className="text-center">
            <RefreshCw className="mx-auto size-6 animate-spin" />
            <p className="mt-3 text-[12px]">
              {t("security.center.unavailable.connecting")}
            </p>
          </div>
        </div>
      ) : (
        <>
          <AutoScanGuide onNextScanAtChange={setNextScanAt} />

          <ScanStatus
            state={scanState}
            totals={statusTotals}
            scanCount={scanCount}
            dimensions={riskKinds.length}
            latestFinishedAt={latestFinishedAt}
            riskKinds={riskKinds}
            onGo={goTo}
          />

          <div ref={unsafeListRef}>
            <UnsafeSkillList
              entries={latestEntries}
              skills={skills}
              onOpenReport={setSelectedReport}
            />
          </div>
          <div ref={historyRef}>
            <ScanHistory entries={history} onOpenTask={setSelectedTask} />
          </div>
        </>
      )}

      {selectedTask && (
        <ScanTaskDetail
          task={selectedTask}
          dimensions={riskKinds.length}
          onClose={() => setSelectedTask(null)}
          onOpenReport={(entry) => {
            setSelectedTask(null);
            setSelectedReport(entry);
          }}
        />
      )}
      {selectedReport && (
        <SkillReportModal
          entry={selectedReport}
          dimensions={riskKinds.length}
          onClose={() => setSelectedReport(null)}
          onRescan={(entry) => {
            setSelectedReport(null);
            void startScan(entry.mode, "single", entry.skillRef);
          }}
        />
      )}
    </div>
  );
}
