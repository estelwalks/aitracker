import type { DistributionRun } from "../contracts.ts";

export interface DistributionRunDocument {
  readonly schemaVersion: 1;
  readonly runs: readonly DistributionRun[];
}
