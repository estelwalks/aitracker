import type { SnapshotRefreshRequest } from "../../platform/snapshot-runtime/contracts.ts";

/**
 * P3-T3-08: unified domain refresh use case.
 *
 * Startup, scheduled, manual, mutation and empty-state refreshes all funnel
 * through this single use case. It holds the single-flight semantics (via the
 * snapshot coordinator), routes through the task runtime, and records a stable
 * outcome — no page/API may construct a scanner or call a collector directly.
 */

export type RefreshReason = SnapshotRefreshRequest["reason"];

export interface RefreshDomainSnapshotRequest {
  readonly reason: RefreshReason;
  readonly signal?: AbortSignal;
  /** When true, freshness is ignored (manual refresh). */
  readonly force?: boolean;
}

export type RefreshOutcome =
  | { readonly status: "refreshed"; readonly revision: string | null }
  | { readonly status: "already-running"; readonly revision: string | null }
  | { readonly status: "failed"; readonly revision: string | null }
  | { readonly status: "skipped"; readonly revision: string | null };

export interface DomainRefreshPort {
  /** Runs one refresh through the domain's snapshot coordinator. */
  refresh(request: RefreshDomainSnapshotRequest): Promise<RefreshOutcome>;
}

/**
 * Adapter that turns a snapshot coordinator + optional freshness check into a
 * stable domain refresh port. Manual requests bypass freshness but still go
 * through the coordinator's single-flight and abort handling.
 */
export function createDomainRefreshPort(options: {
  readonly refreshNow: (signal?: AbortSignal) => Promise<
    | {
        readonly revision: string | null;
        readonly data: unknown;
      }
    | { readonly revision: null; readonly data: null }
  >;
  readonly isFresh: (now?: number) => boolean;
  readonly refreshing: () => boolean;
  readonly now?: () => number;
}): DomainRefreshPort {
  const now = options.now ?? Date.now;
  return {
    async refresh(request) {
      if (!request.force && options.isFresh(now())) {
        return { status: "skipped", revision: null };
      }
      if (options.refreshing()) {
        return { status: "already-running", revision: null };
      }
      try {
        const result = await options.refreshNow(request.signal);
        return { status: "refreshed", revision: result.revision };
      } catch {
        return { status: "failed", revision: null };
      }
    },
  };
}
