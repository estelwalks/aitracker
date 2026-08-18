/** Renderer-safe state for the local background listener.  It deliberately
 * contains no filesystem path, source text, command, or raw scanner evidence. */
export const monitoringModuleId = "monitoring" as const;

export type MonitoringCollectorId =
  "usage" | "skills" | "sessions" | "security" | "exchange";
export type MonitoringCollectorState =
  "idle" | "running" | "healthy" | "degraded" | "failed";

export interface MonitoringCollectorStatus {
  readonly id: MonitoringCollectorId;
  readonly state: MonitoringCollectorState;
  readonly pending: boolean;
  readonly lastStartedAt?: string;
  readonly lastSucceededAt?: string;
  readonly lastFailedAt?: string;
  /** Stable product error code only; never a thrown message. */
  readonly errorCode?: `errors.${string}`;
}

export interface MonitoringStatus {
  readonly module: typeof monitoringModuleId;
  readonly running: boolean;
  readonly startedAt?: string;
  readonly heartbeatAt?: string;
  readonly pendingCount: number;
  readonly collectors: readonly MonitoringCollectorStatus[];
  /** Aggregate result only. Assessment refs and scanner inputs stay private. */
  readonly security?: MonitoringSecuritySummary;
}

export interface MonitoringSecuritySummary {
  readonly assessedAt: string;
  readonly discoveredAssetCount: number;
  readonly assessedAssetCount: number;
  readonly failedAssetCount: number;
  readonly cleanCount: number;
  readonly suspiciousCount: number;
  readonly dangerousCount: number;
  readonly unknownCount: number;
}

export interface MonitoringStatusStore {
  load(): Promise<MonitoringStatus | undefined>;
  save(status: MonitoringStatus): Promise<void>;
}

export interface MonitoringRecorder {
  started(id: MonitoringCollectorId): Promise<void>;
  succeeded(id: MonitoringCollectorId): Promise<void>;
  failed(
    id: MonitoringCollectorId,
    errorCode: `errors.${string}`,
  ): Promise<void>;
  securityCompleted(summary: MonitoringSecuritySummary): Promise<void>;
}

export interface MonitoringRuntime extends MonitoringRecorder {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<MonitoringStatus>;
}
