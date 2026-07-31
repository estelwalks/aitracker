import type { LocalUsageSnapshot } from "./types.ts";

const CACHE_TTL_MS = 30_000;

let cached:
  | {
      expiresAt: number;
      snapshot: LocalUsageSnapshot;
    }
  | undefined;
let pending: Promise<LocalUsageSnapshot> | undefined;

export function clearLocalUsageSnapshotCache(): void {
  cached = undefined;
}

export async function getCachedLocalUsageSnapshot(): Promise<LocalUsageSnapshot> {
  const now = Date.now();
  if (cached != null && cached.expiresAt > now) {
    return cached.snapshot;
  }
  if (pending != null) {
    return pending;
  }

  pending = import("./scanner.server.ts")
    .then(({ scanLocalUsage }) => scanLocalUsage())
    .then((snapshot) => {
      cached = {
        expiresAt: Date.now() + CACHE_TTL_MS,
        snapshot,
      };
      return snapshot;
    })
    .finally(() => {
      pending = undefined;
    });

  return pending;
}
