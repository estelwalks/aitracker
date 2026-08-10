import { marketModuleId, type MarketModuleContract } from "../contracts";

/** Composition hook reserved for future market application use cases. */
export function createMarketApplication(): MarketModuleContract {
  return { id: marketModuleId };
}
