export const projectsModuleId = "projects" as const;
export type ProjectsModuleId = typeof projectsModuleId;
export interface ProjectsModuleContract {
  readonly module: ProjectsModuleId;
  readonly schemaVersion: 1;
}

import type {
  LocalTokenCounts,
  LocalUsageEvent,
} from "../../lib/local-usage/types";
import type { SessionRecord } from "../../lib/local-sessions/types";
import type { CostEstimate } from "../../lib/pricing";

export const UNKNOWN_PROJECT_ID = "project:unknown" as const;

export interface ProjectIdentity {
  readonly id: string;
  readonly displayName: string;
  /** Canonical path, when the source supplied one. Never required by callers. */
  readonly projectRef: string | null;
  readonly known: boolean;
}

export interface ProjectUsage extends ProjectIdentity {
  readonly tokens: LocalTokenCounts;
  readonly cost: CostEstimate;
  readonly eventCount: number;
  readonly sessionCount: number;
}

export interface ProjectUsageReadModel {
  readonly generatedAt: string;
  readonly projects: readonly ProjectUsage[];
  readonly unknownProjectId: typeof UNKNOWN_PROJECT_ID;
}

export interface ProjectUsageInput {
  readonly events?: readonly LocalUsageEvent[];
  readonly sessions?: readonly SessionRecord[];
  readonly generatedAt?: string;
}

/** Pricing is injected from the pricing feature; projects never know pricing rules. */
export interface ProjectPricingPort {
  readonly estimateEventCost: (event: LocalUsageEvent) => CostEstimate;
}

export type ProjectReferencePlatform = "posix" | "windows";
