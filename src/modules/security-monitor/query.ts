import { projectMonitor, registerEventSource } from "./application";
import type { EventSource, MonitorStatus, Observation } from "./contracts";

/** Public query facade for the observe-only monitor; no raw telemetry is accepted or returned. */
export function readMonitorStatus(
  sources: readonly EventSource[] = [],
  observations: readonly Observation[] = [],
): MonitorStatus {
  return projectMonitor(sources, observations);
}

export function readSimulatedSource(
  ref = "local-simulator",
): EventSource | undefined {
  const result = registerEventSource({ ref, kind: "simulated" });
  return result.ok ? result.value : undefined;
}
