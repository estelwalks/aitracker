import { createMonitoringServerApi } from "../modules/monitoring/api.server.ts";
import { getCompositionRoot } from "./composition.server.ts";

/** Application-level server facade used by cross-module dashboard loaders. */
export async function getMonitoringStatus() {
  const { monitoring } = await getCompositionRoot();
  return createMonitoringServerApi(monitoring).status();
}
