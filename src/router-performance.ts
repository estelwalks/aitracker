import type { RouteComponent } from "@tanstack/react-router";

/** Shared performance defaults kept separately so they have a direct unit-test boundary. */
export const ROUTER_PERFORMANCE_DEFAULTS = {
  preloadStaleTime: 30_000,
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  pendingMs: 100,
  pendingMinMs: 200,
} as const;

export function routerPerformanceOptions(pendingComponent: RouteComponent) {
  return {
    defaultPreloadStaleTime: ROUTER_PERFORMANCE_DEFAULTS.preloadStaleTime,
    defaultStaleTime: ROUTER_PERFORMANCE_DEFAULTS.staleTime,
    defaultGcTime: ROUTER_PERFORMANCE_DEFAULTS.gcTime,
    defaultPendingComponent: pendingComponent,
    defaultPendingMs: ROUTER_PERFORMANCE_DEFAULTS.pendingMs,
    defaultPendingMinMs: ROUTER_PERFORMANCE_DEFAULTS.pendingMinMs,
  };
}
