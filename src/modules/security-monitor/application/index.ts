import type { SecurityMonitorModuleContract } from "../contracts";
import type { Result } from "../../../shared/result.ts";
import {
  aggregateIncidents,
  buildMonitorStatus,
  eventSource,
  normalizeObservation,
} from "../domain";
import type { SecurityMonitorErrorCode } from "../domain";
import type {
  EventSource,
  MonitorStatus,
  Observation,
  ObservationInput,
} from "../contracts";
export interface SecurityMonitorApplication {
  readonly contract: SecurityMonitorModuleContract;
}

/** Application boundary for simulated/authorized event ingestion. */
export function ingestObservation(
  input: ObservationInput,
  options: { readonly now?: Date; readonly staleAfterMs?: number } = {},
): Result<Observation, SecurityMonitorErrorCode> {
  return normalizeObservation(input, options);
}

export function projectMonitor(
  sources: readonly EventSource[],
  observations: readonly Observation[],
  options: { readonly now?: Date; readonly staleAfterMs?: number } = {},
): MonitorStatus {
  return buildMonitorStatus(
    sources,
    aggregateIncidents(observations, options),
    options,
  );
}

export function registerEventSource(
  input: {
    readonly ref: string;
    readonly kind: "authorized" | "simulated";
    readonly authorized?: boolean;
    readonly lastSeenAt?: string;
  },
  options: { readonly now?: Date } = {},
): Result<EventSource, SecurityMonitorErrorCode> {
  return eventSource(input, options);
}
