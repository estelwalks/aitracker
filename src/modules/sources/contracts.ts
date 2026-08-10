import type { AgentHealth } from "../agent-directory/contracts.ts";
import type { UsageSnapshotDto } from "../usage/contracts.ts";
import type { SkillSnapshot } from "../../lib/local-skills/types.ts";

export const sourcesModuleId = "sources" as const;
export type SourcesModuleId = typeof sourcesModuleId;

export type SourceHealthStatus =
  "healthy" | "degraded" | "unavailable" | "unknown";
export type SourceFreshness = "fresh" | "stale" | "unknown";

/** Browser-safe health projection. Paths, commands and raw diagnostics are excluded. */
export interface SourceHealth {
  readonly sourceId: string;
  readonly status: SourceHealthStatus;
  readonly freshness: SourceFreshness;
  readonly anomalyLines: number;
  readonly lastScannedAt?: string;
  readonly lastUpdatedAt?: string;
  readonly issueCodes: readonly `errors.${string}`[];
}

export interface SourceHealthSnapshot {
  readonly generatedAt: string;
  readonly sources: readonly SourceHealth[];
}

/** Inputs are already-created projections. Implementations must not probe or scan. */
export interface SourceHealthInputs {
  readonly agentHealth?: readonly AgentHealth[];
  readonly usageSnapshot?: UsageSnapshotDto;
  readonly skillSnapshot?: SkillSnapshot;
}

export interface SourceHealthRepository {
  read(): Promise<SourceHealthInputs>;
}

export interface GetSourceHealthRequest {
  readonly maxAgeMs?: number;
}

export type SourcesApplicationErrorCode = "errors.sources.readFailed";

export interface SourcesApplication {
  readonly getSourceHealth: (
    request?: GetSourceHealthRequest,
  ) => Promise<
    import("../../shared/result.ts").Result<
      SourceHealthSnapshot,
      SourcesApplicationErrorCode
    >
  >;
}
