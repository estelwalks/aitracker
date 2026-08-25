import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonitorX, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { brandParams } from "../../../lib/app-config";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import {
  getDesktopSecurityClient,
  type SecurityClient,
} from "../query/desktop-client";
import { getBrowserSecurityClient } from "../query/browser-client";
import { getSecurityLlmReviewAvailability } from "../llm-review.server-fns";
import { AutoScanGuide } from "./components/AutoScanGuide";
import { ScanHistory } from "./components/ScanHistory";
import { ScanStatus, type ScanStatusNav } from "./components/ScanStatus";
import { ScanTaskDetail } from "./components/ScanTaskDetail";
import { SecurityBriefing } from "./components/SecurityBriefing";
import { SkillReportModal } from "./components/SkillReportModal";
import { UnsafeSkillList } from "./components/UnsafeSkillList";
import {
  countScanTasks,
  EMPTY_SECURITY_PROGRESS,
  EMPTY_SECURITY_TOTALS,
  SECURITY_RISK_KINDS,
  effectiveSecurityScanMode,
  isScanActive,
  latestHistory,
  latestScanEntries,
  summarizeReports,
  type SecurityHistoryView,
  type SecurityScanMode,
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

export function SecurityAssessmentPage() {
  const { t, format } = useI18n();
  const clientRef = useRef<SecurityClient | null>(null);
  const previousStatus = useRef<SecurityScanStateView["status"]>("idle");
  const [connection, setConnection] = useState<
    "connecting" | "available" | "unavailable"
  >("connecting");
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<readonly SecuritySkillView[]>([]);
  const [scanState, setScanState] = useState<SecurityScanStateView>(IDLE_STATE);
  const [history, setHistory] = useState<readonly SecurityHistoryView[]>([]);
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

  const refresh = useCallback(
    async (reconnect = false) => {
      if (reconnect) clientRef.current = null;
      setConnection("connecting");
      const client = await getClient();
      if (client == null) {
        setConnection("unavailable");
        setLoading(false);
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
        setConnection("available");
      } catch (error) {
        if (client.transport === "companion") {
          clientRef.current = null;
          setConnection("unavailable");
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
        const next = await client.getStatus();
        if (disposed) return;
        if (!isScanActive(next.status)) {
          const nextHistory = await client.getHistory();
          if (disposed) return;
          // Commit the matching history before the terminal state. Updating
          // scanState tears down this polling effect, so doing it first would
          // mark the request disposed and leave a completed scan looking empty.
          setHistory(nextHistory);
        }
        setScanState(next);
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
  }, [connection, reportError, scanState.status]);

  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = scanState.status;
    if (!isScanActive(previous) || isScanActive(scanState.status)) return;
    if (scanState.status === "complete")
      toast.success(t("security.center.toast.completed"));
    else if (scanState.status === "partial")
      toast.warning(t("security.center.toast.partial"));
    else if (scanState.status === "failed")
      toast.error(t("security.center.toast.failed"));
  }, [scanState.status, t]);

  const latest = latestHistory(history);
  const riskKinds = SECURITY_RISK_KINDS;
  const latestEntries = useMemo(() => latestScanEntries(history), [history]);
  const latestTotals = useMemo(
    () => summarizeReports(latestEntries),
    [latestEntries],
  );
  const historicalTotals = useMemo(() => summarizeReports(history), [history]);
  const statusTotals = isScanActive(scanState.status)
    ? {
        ...EMPTY_SECURITY_TOTALS,
        total: scanState.progress.discovered,
        failed: scanState.progress.failed,
        skipped: scanState.progress.skipped,
      }
    : historicalTotals;
  const lastScanLabel = latest
    ? format.formatDateTime(latest.finishedAt, false)
    : "—";
  const latestPhase =
    latest == null
      ? null
      : latest.status === "skipped"
        ? "partial"
        : latest.status;

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
          <SecurityBriefing
            totals={latestTotals}
            dimensions={riskKinds.length}
            lastScan={lastScanLabel}
            latestStatus={
              latestEntries.some(
                (item) =>
                  item.status === "partial" || item.status === "skipped",
              )
                ? "partial"
                : latestPhase
            }
            scanning={isScanActive(scanState.status)}
            onScan={() =>
              void startScan(
                modelConfigured && aiAssistedEnabled ? "full" : "quick",
              )
            }
          />

          <AutoScanGuide />

          <ScanStatus
            state={scanState}
            totals={statusTotals}
            scanCount={countScanTasks(history)}
            dimensions={riskKinds.length}
            latestFinishedAt={latest?.finishedAt}
            riskKinds={riskKinds}
            onGo={goTo}
          />

          <div ref={unsafeListRef}>
            <UnsafeSkillList
              entries={latestEntries}
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
