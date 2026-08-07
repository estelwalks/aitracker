import { err, ok, type Result } from "../../shared/result.ts";
import type {
  AlertDecision,
  AlertPolicy,
  EventSource,
  EventSourceRef,
  EventSourceState,
  Incident,
  IncidentRef,
  IncidentState,
  MonitorLifecycle,
  MonitorStatus,
  Observation,
  ObservationCategory,
  ObservationInput,
  ObservationRef,
  ObservationSeverity,
} from "./contracts";

export type SecurityMonitorErrorCode =
  | "errors.securityMonitor.unauthorizedSource"
  | "errors.securityMonitor.invalidObservation"
  | "errors.securityMonitor.invalidIncident";

const severityWeight: Record<ObservationSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
const categories = new Set<ObservationCategory>([
  "process",
  "network",
  "file",
  "authentication",
  "policy",
  "unknown",
]);
const severities = new Set<ObservationSeverity>([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);
const refPart = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function opaque(value: string, prefix: string): string {
  const part = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return `${prefix}${refPart.test(part) ? part : "unknown"}`;
}

function isoOrNow(value: string | undefined, now: Date): string {
  return value && !Number.isNaN(Date.parse(value)) ? value : now.toISOString();
}

function isStale(occurredAt: string, now: Date, staleAfterMs: number): boolean {
  const age = now.getTime() - Date.parse(occurredAt);
  return Number.isFinite(age) && age > staleAfterMs;
}

/** Normalizes a source event without accepting raw telemetry fields. */
export function normalizeObservation(
  input: ObservationInput,
  options: { readonly now?: Date; readonly staleAfterMs?: number } = {},
): Result<Observation, SecurityMonitorErrorCode> {
  const now = options.now ?? new Date();
  if (input.sourceKind === "authorized" && input.authorized !== true)
    return err("errors.securityMonitor.unauthorizedSource");
  if (input.sourceKind !== "authorized" && input.sourceKind !== "simulated")
    return err("errors.securityMonitor.invalidObservation");
  if (typeof input.sourceRef !== "string" || input.sourceRef.length === 0)
    return err("errors.securityMonitor.invalidObservation");
  const category = categories.has(input.category as ObservationCategory)
    ? (input.category as ObservationCategory)
    : "unknown";
  const severity = severities.has(input.severity as ObservationSeverity)
    ? (input.severity as ObservationSeverity)
    : "info";
  const occurredAt = isoOrNow(input.occurredAt, now);
  const sourceRef = opaque(input.sourceRef, "event-source:") as EventSourceRef;
  const fingerprintRef = opaque(
    input.fingerprintRef ?? `${category}-${severity}`,
    "fingerprint:",
  ) as `fingerprint:${string}`;
  const ref = opaque(
    `${sourceRef.slice("event-source:".length)}-${occurredAt}`,
    "observation:",
  ) as ObservationRef;
  return ok({
    ref,
    sourceRef,
    category,
    severity,
    fingerprintRef,
    occurredAt,
    stale: isStale(occurredAt, now, options.staleAfterMs ?? 5 * 60 * 1000),
  });
}

export function eventSource(
  input: {
    readonly ref: string;
    readonly kind: "authorized" | "simulated";
    readonly authorized?: boolean;
    readonly lastSeenAt?: string;
  },
  options: {
    readonly now?: Date;
    readonly staleAfterMs?: number;
    readonly offlineAfterMs?: number;
  } = {},
): Result<EventSource, SecurityMonitorErrorCode> {
  if (input.kind === "authorized" && input.authorized !== true)
    return err("errors.securityMonitor.unauthorizedSource");
  const now = options.now ?? new Date();
  const lastSeenAt =
    input.lastSeenAt && !Number.isNaN(Date.parse(input.lastSeenAt))
      ? input.lastSeenAt
      : undefined;
  const age = lastSeenAt ? now.getTime() - Date.parse(lastSeenAt) : Infinity;
  const offlineAfter = options.offlineAfterMs ?? 30 * 60 * 1000;
  const staleAfter = options.staleAfterMs ?? 5 * 60 * 1000;
  const state: EventSourceState =
    !lastSeenAt || age > offlineAfter
      ? "offline"
      : age > staleAfter
        ? "stale"
        : "online";
  return ok({
    ref: opaque(input.ref, "event-source:") as EventSourceRef,
    kind: input.kind,
    state,
    authorized: input.kind === "simulated" || input.authorized === true,
    capability: "observe-only",
    ...(lastSeenAt ? { lastSeenAt } : {}),
  });
}

/** Groups events by source and opaque fingerprint; no raw event data is retained. */
export function aggregateIncidents(
  observations: readonly Observation[],
  options: { readonly now?: Date; readonly staleAfterMs?: number } = {},
): readonly Incident[] {
  const now = options.now ?? new Date();
  const groups = new Map<string, Observation[]>();
  for (const observation of observations) {
    const key = `${observation.sourceRef}|${observation.fingerprintRef}`;
    const existing = groups.get(key) ?? [];
    existing.push(observation);
    groups.set(key, existing);
  }
  return [...groups.values()].map((items) => {
    const sorted = [...items].sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
    );
    const latest = sorted[sorted.length - 1];
    const stale = isStale(
      latest.occurredAt,
      now,
      options.staleAfterMs ?? 5 * 60 * 1000,
    );
    const severity = sorted.reduce<ObservationSeverity>(
      (max, item) =>
        severityWeight[item.severity] > severityWeight[max]
          ? item.severity
          : max,
      "info",
    );
    const id = `${latest.sourceRef.slice("event-source:".length)}-${latest.fingerprintRef.slice("fingerprint:".length)}`;
    return {
      ref: `incident:${opaque(id, "").slice(0, 120)}` as IncidentRef,
      sourceRef: latest.sourceRef,
      fingerprintRef: latest.fingerprintRef,
      category: latest.category,
      severity,
      count: sorted.length,
      firstObservedAt: sorted[0].occurredAt,
      lastObservedAt: latest.occurredAt,
      state: stale || latest.stale ? "stale" : "open",
      observationRefs: sorted.map((item) => item.ref),
    };
  });
}

function transitionIncident(
  incident: Incident,
  state: IncidentState,
): Result<Incident, SecurityMonitorErrorCode> {
  if (incident.state === "resolved" && state !== "resolved")
    return err("errors.securityMonitor.invalidIncident");
  return ok({ ...incident, state });
}

export const acknowledgeIncident = (incident: Incident) =>
  transitionIncident(incident, "acknowledged");
export const resolveIncident = (incident: Incident) =>
  transitionIncident(incident, "resolved");

export function evaluateAlertPolicy(
  policy: AlertPolicy,
  incidents: readonly Incident[],
): AlertDecision {
  if (!policy.enabled)
    return {
      policyRef: policy.ref,
      triggered: false,
      incidentRefs: [],
      reason: "disabled",
    };
  const matched = incidents.filter((incident) => {
    if (incident.state !== "open" && incident.state !== "acknowledged")
      return false;
    if (
      severityWeight[incident.severity] < severityWeight[policy.minimumSeverity]
    )
      return false;
    return !policy.categories || policy.categories.includes(incident.category);
  });
  if (!matched.length) {
    const anyActive = incidents.some(
      (incident) =>
        incident.state === "open" || incident.state === "acknowledged",
    );
    return {
      policyRef: policy.ref,
      triggered: false,
      incidentRefs: [],
      reason: anyActive
        ? policy.categories
          ? "category-filtered"
          : "below-threshold"
        : "no-active-incident",
    };
  }
  return {
    policyRef: policy.ref,
    triggered: true,
    incidentRefs: matched.map((item) => item.ref),
    reason: "matched",
  };
}

export function buildMonitorStatus(
  sources: readonly EventSource[],
  incidents: readonly Incident[],
  options: { readonly now?: Date } = {},
): MonitorStatus {
  const now = options.now ?? new Date();
  const hasOnline = sources.some((source) => source.state === "online");
  const hasStale = sources.some((source) => source.state === "stale");
  const status: MonitorLifecycle = hasOnline
    ? "observing"
    : hasStale
      ? "stale"
      : "offline";
  return {
    status,
    capability: "observe-only",
    sources,
    activeIncidentCount: incidents.filter(
      (item) => item.state === "open" || item.state === "acknowledged",
    ).length,
    observedAt: now.toISOString(),
  };
}
