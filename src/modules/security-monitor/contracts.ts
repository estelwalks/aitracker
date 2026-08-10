export const securityMonitorModuleId = "security-monitor" as const;
export type SecurityMonitorModuleId = typeof securityMonitorModuleId;
export interface SecurityMonitorModuleContract {
  readonly module: SecurityMonitorModuleId;
  readonly schemaVersion: 1;
}

export type SecurityMonitorCapability = "observe-only";
export type MonitorLifecycle = "observing" | "stale" | "offline";
export type EventSourceKind = "authorized" | "simulated";
export type EventSourceState = "online" | "stale" | "offline";
export type ObservationCategory =
  "process" | "network" | "file" | "authentication" | "policy" | "unknown";
export type ObservationSeverity =
  "critical" | "high" | "medium" | "low" | "info";
export type IncidentState = "open" | "acknowledged" | "resolved" | "stale";

export type EventSourceRef = `event-source:${string}`;
export type ObservationRef = `observation:${string}`;
export type IncidentRef = `incident:${string}`;
export type AlertRef = `alert:${string}`;
export type FingerprintRef = `fingerprint:${string}`;

/** Renderer-safe source projection. There is deliberately no endpoint/path field. */
export interface EventSource {
  readonly ref: EventSourceRef;
  readonly kind: EventSourceKind;
  readonly state: EventSourceState;
  readonly authorized: boolean;
  readonly capability: SecurityMonitorCapability;
  readonly lastSeenAt?: string;
}

/** A normalized, privacy-preserving event. Raw command, path, token and content never cross this boundary. */
export interface Observation {
  readonly ref: ObservationRef;
  readonly sourceRef: EventSourceRef;
  readonly category: ObservationCategory;
  readonly severity: ObservationSeverity;
  readonly fingerprintRef: FingerprintRef;
  readonly occurredAt: string;
  readonly stale: boolean;
}

export interface ObservationInput {
  readonly sourceRef: string;
  readonly sourceKind: EventSourceKind;
  readonly authorized?: boolean;
  readonly category: string;
  readonly severity: string;
  readonly fingerprintRef?: string;
  readonly occurredAt?: string;
}

export interface Incident {
  readonly ref: IncidentRef;
  readonly sourceRef: EventSourceRef;
  readonly fingerprintRef: FingerprintRef;
  readonly category: ObservationCategory;
  readonly severity: ObservationSeverity;
  readonly count: number;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly state: IncidentState;
  readonly observationRefs: readonly ObservationRef[];
}

export interface AlertPolicy {
  readonly ref: AlertRef;
  readonly enabled: boolean;
  readonly minimumSeverity: ObservationSeverity;
  readonly categories?: readonly ObservationCategory[];
  readonly cooldownMs?: number;
}

export interface AlertDecision {
  readonly policyRef: AlertRef;
  readonly triggered: boolean;
  readonly incidentRefs: readonly IncidentRef[];
  readonly reason:
    | "matched"
    | "disabled"
    | "below-threshold"
    | "category-filtered"
    | "no-active-incident";
}

export interface MonitorStatus {
  readonly status: MonitorLifecycle;
  readonly capability: SecurityMonitorCapability;
  readonly sources: readonly EventSource[];
  readonly activeIncidentCount: number;
  readonly observedAt: string;
}
