import type { SourceHealthSnapshot, SourcesModuleId } from "./contracts.ts";

/** Server transport DTO boundary; route adapters should depend on SourcesApplication. */
export type SourcesApiResponse =
  SourceHealthSnapshot | { module: SourcesModuleId };
