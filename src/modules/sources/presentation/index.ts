import type { SourceHealthSnapshot, SourcesModuleId } from "../contracts.ts";

/** Browser-safe source health view model; collector internals never cross this boundary. */
export type SourcesViewModel =
  SourceHealthSnapshot | { module: SourcesModuleId };
