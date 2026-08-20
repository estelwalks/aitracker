import { createMonitoringServerApi } from "../modules/monitoring/api.server.ts";
import { getCompositionRoot } from "./composition.server.ts";
import { getMonitoringSecuritySummary } from "./security-summary.server.ts";

/** Application-level server facade used by cross-module dashboard loaders. */
export async function getMonitoringStatus() {
  const { monitoring } = await getCompositionRoot();
  const status = await createMonitoringServerApi(monitoring).status();
  if (status.security == null) {
    const security = await getMonitoringSecuritySummary();
    if (security != null) return { ...status, security };
  }
  return status;
}
