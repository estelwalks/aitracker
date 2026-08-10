/**
 * Default compiled pricing registry (singleton).
 *
 * Compiles the generated rule packs once. The compiler is pure; the singleton
 * just avoids recompiling on every event. `__resetDefaultPricingRegistry` is the
 * test/override reload hook (mirrors the tool-registry pattern).
 */
import {
  compilePricingRegistry,
  type CompiledPricingRegistry,
} from "./compile.ts";
import {
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
} from "./pricing-definitions.generated.ts";

let _registry: CompiledPricingRegistry | null = null;

export function getDefaultPricingRegistry(): CompiledPricingRegistry {
  if (!_registry) {
    _registry = compilePricingRegistry(PRICING_PACKS, PRICING_REGISTRY_VERSION);
  }
  return _registry;
}

/** Reset the cached registry (test/override reload hook). */
export function __resetDefaultPricingRegistry(): void {
  _registry = null;
}

export const PRICING_RULES_VERSION = PRICING_REGISTRY_VERSION;
