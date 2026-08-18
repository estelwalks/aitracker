import { createServerFn } from "@tanstack/react-start";

import type { SourcesQuerySummary } from "./presentation/model";

/**
 * Browser-safe RPC facade for the Sources page (P4-T4-01 / P6-T6-01).
 * Handlers load the server adapter dynamically; the presentation layer never
 * imports `api.server.ts` statically.
 */

export const getSourcesQuery = createServerFn({ method: "GET" }).handler(
  async (): Promise<SourcesQuerySummary> => {
    const { getSourcesQuery: load } = await import("./api.server.ts");
    return load();
  },
);

export const refreshSourcesQuery = createServerFn({ method: "POST" }).handler(
  async (): Promise<SourcesQuerySummary> => {
    const { refreshSourcesQuery: refresh } = await import("./api.server.ts");
    return refresh();
  },
);
