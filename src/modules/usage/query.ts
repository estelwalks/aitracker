import { createServerFn } from "@tanstack/react-start";

import type { TrackerReadModel } from "./contracts.ts";

export { TrackerPage } from "./presentation/TrackerPage.tsx";

/**
 * Browser-safe RPC for the Token burn leaderboard.
 *
 * Route loaders run both during SSR and later client-side navigations. A
 * plain dynamic import would execute `api.server.ts` in the browser after the
 * router's stale window elapsed, where local SQLite is unavailable; that
 * failure was swallowed as an empty board. A Server Function keeps every read
 * in the Node runtime while the renderer receives only its compact projection.
 */
export const getTrackerQuery = createServerFn({ method: "GET" }).handler(
  async (): Promise<TrackerReadModel> => {
    const { loadTrackerReadModel } = await import("./api.server.ts");
    return loadTrackerReadModel();
  },
);
