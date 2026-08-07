import type { OptimizationModuleContract } from "../contracts";
import { buildOptimizationSnapshot } from "../domain.ts";
import type { OptimizationInput, OptimizationSnapshot } from "../contracts";
export interface OptimizationApplication {
  readonly contract: OptimizationModuleContract;
}

export function createOptimizationSnapshot(
  input: OptimizationInput,
): OptimizationSnapshot {
  return buildOptimizationSnapshot(input);
}
