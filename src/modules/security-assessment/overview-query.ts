import { createServerFn } from "@tanstack/react-start";
import type { SecurityOverviewReadModel } from "./overview.contracts";

/**
 * Browser-safe RPC for the canonical security overview (the same
 * server-composed model the dashboard summary and the Skill management
 * loader embed). Consumers that are not part of those read models — e.g. the
 * widget pages — read it through here instead of a renderer→engine round
 * trip, so every surface shows the same numbers.
 */
export const getSecurityOverview = createServerFn({ method: "GET" }).handler(
  async (): Promise<SecurityOverviewReadModel> => {
    const { resolveSecurityOverview } = await import("./overview.server.ts");
    return resolveSecurityOverview();
  },
);
