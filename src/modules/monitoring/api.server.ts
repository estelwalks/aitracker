import type { MonitoringRuntime, MonitoringStatus } from "./contracts.ts";

/** Server API factory keeps framework/composition concerns outside the module. */
export function createMonitoringServerApi(
  runtime: Pick<MonitoringRuntime, "status">,
): { status(): Promise<MonitoringStatus> } {
  return { status: () => runtime.status() };
}
