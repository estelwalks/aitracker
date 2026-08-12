import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MonitorX, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "../../../components/tt";
import { brandParams } from "../../../lib/app-config";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import {
  getDesktopSecurityClient,
  type SecurityClient,
  type SecurityModelConfigUpdate,
} from "../query/desktop-client";
import { getBrowserSecurityClient } from "../query/browser-client";
import { AutoScanGuide } from "./components/AutoScanGuide";
import { ModelConfigDialog } from "./components/ModelConfigDialog";
import { ScanHistory } from "./components/ScanHistory";
import { ScanStatus } from "./components/ScanStatus";
import { ScanVortex } from "./components/ScanVortex";
import { SecurityBriefing } from "./components/SecurityBriefing";
import { SecurityResultsSummary } from "./components/SecurityResultsSummary";
import {
  EMPTY_SECURITY_PROGRESS,
  EMPTY_SECURITY_TOTALS,
  SECURITY_RISK_KINDS,
  isScanActive,
  latestHistory,
  latestScanEntries,
  summarizeReports,
  type SecurityHistoryView,
  type SecurityModelConfigView,
  type SecurityRuntimeCapabilityView,
  type SecurityScanMode,
  type SecurityScanStateView,
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
  const [modelConfig, setModelConfig] =
    useState<SecurityModelConfigView | null>(null);
  const [runtime, setRuntime] = useState<SecurityRuntimeCapabilityView | null>(
    null,
  );
  const [modelOpen, setModelOpen] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

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
        const [nextSkills, nextState, nextHistory, nextConfig, nextRuntime] =
          await Promise.all([
            client.listSkills(),
            client.getStatus(),
            client.getHistory(),
            client.getModelConfig(),
            client.getRuntimeCapability(),
          ]);
        setSkills(nextSkills);
        setScanState(nextState);
        setHistory(nextHistory);
        setModelConfig(nextConfig);
        setRuntime(nextRuntime);
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

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("configureModel") === "1"
    ) {
      setModelOpen(true);
    }
  }, []);

  useEffect(() => {
    if (!isScanActive(scanState.status)) return;
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
    const timer = window.setInterval(() => void poll(), 450);
    void poll();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [reportError, scanState.status]);

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

  const devMode = clientRef.current?.transport === "companion";
  const latest = latestHistory(history);
  const riskKinds = runtime?.riskKinds ?? SECURITY_RISK_KINDS;
  const latestEntries = useMemo(() => latestScanEntries(history), [history]);
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
  const health = latestTotals.total
    ? Math.round((latestTotals.safe / latestTotals.total) * 100)
    : 0;
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
        const next = await client.startScan({
          scope,
          mode,
          trigger: "manual",
          ...(scope === "single" && skillRef
            ? { skillRef: skillRef as `skill:${string}` }
            : {}),
        });
        setScanState(next);
        if (next.status === "model-required") {
          setModelOpen(true);
          toast.warning(t("security.center.model.requiredDesc"));
        } else {
          toast.success(t("security.center.toast.started"));
        }
      } catch (error) {
        reportError(error);
      }
    },
    [reportError, scanState.status, t],
  );

  const selectDirectory = useCallback(async () => {
    const client = clientRef.current;
    if (client == null || !client.supportsDirectorySelection) return;
    try {
      const selected = await client.selectSkillDirectory();
      if (selected == null) return;
      setSkills((current) => [
        selected,
        ...current.filter((item) => item.skillRef !== selected.skillRef),
      ]);
      toast.success(t("security.center.toast.directorySelected"));
      await startScan("quick", "single", selected.skillRef);
    } catch (error) {
      reportError(error);
    }
  }, [reportError, startScan, t]);

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

  const saveModel = useCallback(
    async (update: SecurityModelConfigUpdate) => {
      const client = clientRef.current;
      if (client == null) return;
      setSavingModel(true);
      try {
        const saved = await client.setModelConfig(update);
        setModelConfig(saved);
        setModelOpen(false);
        toast.success(t("security.center.toast.modelSaved"));
      } catch (error) {
        reportError(error);
      } finally {
        setSavingModel(false);
      }
    },
    [reportError, t],
  );

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        title={t("security.pageHeader")}
        desc={t("security.center.summary", {
          skills: skills.length,
          dimensions: riskKinds.length,
          health,
        })}
      />

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
          {devMode && (
            <div className="flex items-start gap-2 rounded-xl bg-ok/10 px-3.5 py-2 text-[11px] text-ok ring-1 ring-ok/15">
              <span className="mt-1 size-1.5 shrink-0 rounded-full bg-ok" />
              <div className="min-w-0">
                <p className="font-medium">
                  {t("security.center.devBanner.title")}
                </p>
                <p className="text-ok/80">
                  {t("security.center.devBanner.desc")}
                </p>
              </div>
            </div>
          )}
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
            runtime={runtime}
            scanning={isScanActive(scanState.status)}
            canSelectDirectory={
              clientRef.current?.supportsDirectorySelection === true
            }
            devMode={devMode}
            onScan={() => void startScan("quick")}
            onFullScan={() => void startScan("full")}
            onSelectDirectory={() => void selectDirectory()}
          />

          <AutoScanGuide runtime={runtime} />

          <ScanStatus
            state={scanState}
            totals={statusTotals}
            lastScan={lastScanLabel}
          />

          {latestEntries.length > 0 && (
            <>
              <SecurityResultsSummary
                entries={latestEntries}
                dimensions={riskKinds.length}
                onRescan={(mode, skillRef) =>
                  void startScan(mode, "single", skillRef)
                }
              />
            </>
          )}
          <ScanHistory entries={history} />
        </>
      )}

      {isScanActive(scanState.status) && (
        <ScanVortex
          state={scanState}
          skills={skills}
          riskKinds={riskKinds}
          onCancel={() => void cancelScan()}
        />
      )}
      <ModelConfigDialog
        open={modelOpen}
        config={modelConfig}
        saving={savingModel}
        devMode={devMode}
        onClose={() => setModelOpen(false)}
        onSave={(update) => void saveModel(update)}
      />
    </div>
  );
}
