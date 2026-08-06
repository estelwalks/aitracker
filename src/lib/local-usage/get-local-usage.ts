import { createServerFn } from "@tanstack/react-start";

import type { LocalUsageSnapshot } from "./types.ts";

export const getLocalUsageSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<LocalUsageSnapshot> => {
    const { getCachedLocalUsageSnapshot } =
      await import("./snapshot.server.ts");
    return getCachedLocalUsageSnapshot();
  },
);

export const refreshLocalUsageSnapshot = createServerFn({
  method: "POST",
}).handler(async (): Promise<LocalUsageSnapshot> => {
  const { clearLocalUsageSnapshotCache, getCachedLocalUsageSnapshot } =
    await import("./snapshot.server.ts");
  clearLocalUsageSnapshotCache();
  return getCachedLocalUsageSnapshot();
});
