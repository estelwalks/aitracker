/** Public identity and future application boundary for the Market module. */
export const marketModuleId = "market" as const;
export type MarketModuleId = typeof marketModuleId;

export interface MarketModuleContract {
  readonly id: MarketModuleId;
}
