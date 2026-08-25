import { createMonitoringServerApi } from "../modules/monitoring/api.server.ts";
import { getCompositionRoot } from "./composition.server.ts";
import { getMonitoringSecuritySummary } from "./security-summary.server.ts";

/** Application-level server facade used by cross-module dashboard loaders. */
export async function getMonitoringStatus() {
  const { monitoring } = await getCompositionRoot();
  const status = await createMonitoringServerApi(monitoring).status();
  const security = await getMonitoringSecuritySummary();
  return security == null ? status : { ...status, security };
}
