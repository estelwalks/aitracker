import type { RuntimeFlagRepository } from "./runtime-flag-repository.server.ts";

export const M2_STORAGE_DOMAINS = [
  "tasks",
  "monitoring",
  "http-cache",
  "runtime-flags",
] as const;
export type M2StorageDomain = (typeof M2_STORAGE_DOMAINS)[number];

export const M2_SQLITE_READ_FLAG_KEYS: Readonly<
  Record<M2StorageDomain, string>
> = {
  tasks: "storage.sqlite.tasks.read",
  monitoring: "storage.sqlite.monitoring.read",
  "http-cache": "storage.sqlite.http-cache.read",
  "runtime-flags": "storage.sqlite.runtime-flags.read",
};

/** In-memory cutover snapshot: hydrate once, then pass `isEnabled` to adapters. */
export interface StorageCutoverSnapshot {
  isEnabled(domain: M2StorageDomain): boolean;
}

export async function loadStorageCutoverSnapshot(
  flags: RuntimeFlagRepository,
): Promise<StorageCutoverSnapshot> {
  const enabled = new Set<M2StorageDomain>();
  await Promise.all(
    M2_STORAGE_DOMAINS.map(async (domain) => {
      const record = await flags.get<unknown>(M2_SQLITE_READ_FLAG_KEYS[domain]);
      if (record?.value === true) enabled.add(domain);
    }),
  );
  return { isEnabled: (domain) => enabled.has(domain) };
}
