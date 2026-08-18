import type {
  ReadModelMeta,
  WithReadModelMeta,
} from "../../lib/read-model/contracts.ts";
import type { UsagePeriod } from "../../lib/local-usage/presentation.ts";
import type { ToolOverviewView } from "./application/tool-overview.ts";

/**
 * P1-T1-06: compact Agents (tool overview) read model.
 *
 * The server pre-builds the full `ToolOverviewView` (browser-safe: cards,
 * trend, models, projects, context — never raw events) so `/agents` no longer
 * loads the complete dashboard DTO. Interaction changes (period / tool /
 * custom range) request a new projection through the same server fn.
 */

export interface AgentUsageOverviewReadModel extends WithReadModelMeta {
  readonly locale: string;
  readonly view: ToolOverviewView;
}

export interface AgentUsageOverviewQueryInput {
  readonly locale: string;
  readonly toolId?: string | null;
  readonly period?: UsagePeriod;
  readonly from?: string;
  readonly to?: string;
}

export type { ToolOverviewView };
export type { ReadModelMeta };
