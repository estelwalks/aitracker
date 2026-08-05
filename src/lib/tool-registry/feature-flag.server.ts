/**
 * Migration feature flag (server-only). Reads `TRUSTTOOLS_TOOL_REGISTRY` from
 * the environment. Defaults to ON: once a consumer is migrated to the registry,
 * the registry path is active and `TRUSTTOOLS_TOOL_REGISTRY=0` is the escape
 * hatch that falls back to the legacy `*.legacy.ts` catalogs.
 *
 * Browser-imported pure-data modules (e.g. `tools/catalog.ts`) always derive
 * from the registry - they have no runtime flag because the registry is pure,
 * compile-time-validated data and parity tests guarantee equivalence. The flag
 * is only consulted by server scanners where migration changes runtime logic.
 *
 * Server-only: reads `process.env`. Do not import from browser bundles.
 */
export function isToolRegistryEnabled(): boolean {
  const value = process.env.TRUSTTOOLS_TOOL_REGISTRY;
  if (value === undefined || value === "") return true;
  return value !== "0" && value.toLowerCase() !== "false";
}
