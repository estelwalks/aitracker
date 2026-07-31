import { createServerFn } from "@tanstack/react-start";

import type { LocalUsageSnapshot } from "./types.ts";
import type { UsageAdapterConfigState } from "./adapter-config.server.ts";

export const getLocalUsageSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<LocalUsageSnapshot> => {
    const { getCachedLocalUsageSnapshot } = await import("./snapshot.server.ts");
    return getCachedLocalUsageSnapshot();
  },
);

export const refreshLocalUsageSnapshot = createServerFn({ method: "POST" }).handler(
  async (): Promise<LocalUsageSnapshot> => {
    const { clearLocalUsageSnapshotCache, getCachedLocalUsageSnapshot } =
      await import("./snapshot.server.ts");
    clearLocalUsageSnapshotCache();
    return getCachedLocalUsageSnapshot();
  },
);

export const getUsageAdapterConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<UsageAdapterConfigState> => {
    const { readUsageAdapterConfig } = await import("./adapter-config.server.ts");
    return readUsageAdapterConfig();
  },
);

export const saveUsageAdapterConfig = createServerFn({ method: "POST" })
  .validator((text: string) => {
    if (typeof text !== "string" || text.length > 100_000) {
      throw new Error("适配器配置内容不合法");
    }
    return text;
  })
  .handler(async ({ data }): Promise<UsageAdapterConfigState> => {
    const [{ writeUsageAdapterConfig }, { clearLocalUsageSnapshotCache }] = await Promise.all([
      import("./adapter-config.server.ts"),
      import("./snapshot.server.ts"),
    ]);
    const state = await writeUsageAdapterConfig(data);
    clearLocalUsageSnapshotCache();
    return state;
  });
