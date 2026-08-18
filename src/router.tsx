import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * P4-T4-07: Router/Query ownership.
 *
 * Router loaders own the first-screen read models (Dashboard, Agents, Skills,
 * Sources, Reports, Sessions, Tracker); React Query owns interaction data
 * (custom dashboard ranges, tool-overview detail queries, widget polling).
 * The same read model is never cached by both. Defaults here are overridden
 * per route via `staleTime`/`gcTime`/`preloadStaleTime`/`loaderDeps` so a
 * cached navigation never re-executes a loader whose snapshot revision is
 * unchanged (cache-navigation budget P95 ≤ 500 ms).
 */
export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultStaleTime: 30_000,
    defaultGcTime: 5 * 60_000,
  });

  return router;
};
