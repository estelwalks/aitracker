import { useCallback, useEffect, useRef, useState } from "react";

import { getBrowserSecurityClient } from "../../query/browser-client";
import {
  getDesktopSecurityClient,
  type SecurityClient,
} from "../../query/desktop-client";
import {
  EMPTY_SECURITY_PROGRESS,
  SECURITY_RISK_KINDS,
  isScanActive,
  type SecurityHistoryView,
  type SecurityScanStateView,
  type SecuritySkillView,
} from "../security-view";
import { ScanVortex } from "./ScanVortex";

const ACTIVE_POLL_INTERVAL_MS = 450;
// Keep the global indicator responsive when a scan is started from another
// route while reducing background polling once a scan is idle.
const IDLE_POLL_INTERVAL_MS = 1_000;

const IDLE_STATE: SecurityScanStateView = {
  scanId: null,
  status: "idle",
  mode: null,
  trigger: null,
  locale: null,
  progress: EMPTY_SECURITY_PROGRESS,
  resultIds: [],
};

/**
 * Application-level security scan indicator.
 *
 * It intentionally lives outside the security route so a running scan keeps
 * its minimized/full state and remains visible while the user visits another
 * page.
 */
export function SecurityScanProgressOverlay() {
  const clientRef = useRef<SecurityClient | null>(null);
  const skillsLoadedRef = useRef(false);
  const historyScanIdRef = useRef<string | null>(null);
  const [state, setState] = useState<SecurityScanStateView>(IDLE_STATE);
  const [skills, setSkills] = useState<readonly SecuritySkillView[]>([]);
  const [history, setHistory] = useState<readonly SecurityHistoryView[]>([]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let polling = false;

    const poll = async (): Promise<boolean> => {
      if (polling) return false;
      polling = true;
      try {
        const client =
          clientRef.current ??
          getDesktopSecurityClient() ??
          (await getBrowserSecurityClient());
        if (!client || disposed) return false;
        clientRef.current = client;

        const nextState = await client.getStatus();
        if (disposed) return false;
        setState(nextState);

        if (!skillsLoadedRef.current) {
          skillsLoadedRef.current = true;
          void client
            .listSkills()
            .then((nextSkills) => {
              if (!disposed) setSkills(nextSkills);
            })
            .catch(() => {
              skillsLoadedRef.current = false;
            });
        }

        const active = isScanActive(nextState.status);
        const shouldRefreshHistory =
          !active && historyScanIdRef.current !== nextState.scanId;
        if (shouldRefreshHistory) {
          const nextHistory = await client.getHistory();
          if (!disposed) {
            setHistory(nextHistory);
            historyScanIdRef.current = nextState.scanId;
          }
        }
        return active;
      } catch {
        return false;
      } finally {
        polling = false;
      }
    };

    const loop = async () => {
      const active = await poll();
      if (!disposed) {
        timer = window.setTimeout(
          () => void loop(),
          active ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS,
        );
      }
    };

    void loop();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const cancel = useCallback(async () => {
    await clientRef.current?.cancelScan();
  }, []);

  return (
    <ScanVortex
      active={isScanActive(state.status)}
      state={state}
      skills={skills}
      history={history}
      riskKinds={SECURITY_RISK_KINDS}
      onCancel={() => void cancel()}
    />
  );
}
