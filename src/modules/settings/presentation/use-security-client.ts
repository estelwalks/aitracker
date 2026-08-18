import { useCallback, useEffect, useRef, useState } from "react";

import {
  getBrowserSecurityClient,
  getDesktopSecurityClient,
  type SecurityClient,
} from "../../security-assessment/index";

export type SecurityConnectionStatus =
  "connecting" | "available" | "unavailable";

/**
 * Resolves the real security client exactly like SecurityAssessmentPage:
 * desktop IPC first, then the local companion.
 *
 * SSR-safety: nothing touches `window`/`document` at module scope or during
 * render. The initial state is `connecting` (client null), so the server and
 * the first client paint match; the connect + status resolution happens inside
 * an effect after hydration.
 */
export function useSecurityClient() {
  const clientRef = useRef<SecurityClient | null>(null);
  const [client, setClient] = useState<SecurityClient | null>(null);
  const [status, setStatus] = useState<SecurityConnectionStatus>("connecting");

  const getClient = useCallback(async () => {
    if (clientRef.current) return clientRef.current;
    const resolved =
      getDesktopSecurityClient() ?? (await getBrowserSecurityClient());
    clientRef.current = resolved;
    setClient(resolved);
    return resolved;
  }, []);

  const refresh = useCallback(async () => {
    clientRef.current = null;
    setClient(null);
    setStatus("connecting");
    const resolved = await getClient();
    setStatus(resolved == null ? "unavailable" : "available");
    return resolved;
  }, [getClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { client, status, refresh };
}
