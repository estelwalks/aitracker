import type {
  InsightsModuleContract,
  InsightsInput,
  InsightSnapshot,
  StalePolicy,
} from "../contracts";
import type { Clock } from "../../../platform/persistence/contracts.ts";
import { buildInsightSnapshot } from "../domain.ts";
export interface InsightsApplication {
  readonly contract: InsightsModuleContract;
  readonly buildSnapshot: (
    input: InsightsInput,
    options?: { clock?: Clock; stalePolicy?: StalePolicy },
  ) => InsightSnapshot;
}

export function createInsightsApplication(
  options: { readonly clock?: Clock; readonly stalePolicy?: StalePolicy } = {},
): InsightsApplication {
  return {
    contract: { module: "insights", schemaVersion: 1 },
    buildSnapshot: (input, callOptions) =>
      buildInsightSnapshot(input, {
        clock: callOptions?.clock ?? options.clock,
        stalePolicy: callOptions?.stalePolicy ?? options.stalePolicy,
      }),
  };
}
