import type {
  AtomicJsonStore,
  Clock,
} from "../../../platform/persistence/contracts.ts";
import { dedupePackages, toSkillPackageDto } from "../domain.ts";
import type {
  OfflineCache,
  OfflineCacheDocument,
  SkillPackageDto,
  SkillPackageRecord,
} from "../contracts.ts";

const MAX_AGE_DEFAULT = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is SkillPackageRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const source = row.source as Record<string, unknown> | undefined;
  return (
    typeof row.packageRef === "string" &&
    row.packageRef.startsWith("package:") &&
    typeof row.skillRef === "string" &&
    row.skillRef.startsWith("skill:") &&
    typeof row.name === "string" &&
    typeof row.version === "string" &&
    typeof row.hash === "string" &&
    /^sha256-[a-f0-9]{64}$/.test(row.hash) &&
    typeof row.normalizedAt === "string" &&
    typeof source?.kind === "string" &&
    typeof source.ref === "string" &&
    source.ref.startsWith("skill-source:") &&
    ["clean", "suspicious", "dangerous", "unknown"].includes(
      String(row.verdict),
    ) &&
    ["installable", "blocked"].includes(String(row.installability)) &&
    Array.isArray(row.capabilities) &&
    Array.isArray(row.refs)
  );
}

function safeEntries(value: unknown): SkillPackageRecord[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const row = value as Record<string, unknown>;
  if (
    row.schemaVersion !== 1 ||
    typeof row.savedAt !== "string" ||
    !Array.isArray(row.entries)
  )
    return undefined;
  if (!row.entries.every(isRecord)) return undefined;
  return dedupePackages(row.entries);
}

export function createOfflineCache(
  entries: readonly SkillPackageRecord[],
  savedAt: string,
  nowMs = Date.parse(savedAt),
  maxAgeMs = MAX_AGE_DEFAULT,
): OfflineCache {
  const stale = !Number.isFinite(nowMs) || Date.now() - nowMs > maxAgeMs;
  return {
    entries: dedupePackages(entries).map(toSkillPackageDto),
    savedAt,
    stale,
  };
}

export async function loadOfflineCache(
  store: AtomicJsonStore<OfflineCacheDocument>,
  clock: Clock,
  maxAgeMs = MAX_AGE_DEFAULT,
): Promise<OfflineCache> {
  try {
    const read = await store.read();
    const entries = safeEntries(read.value);
    if (!entries) return { entries: [], stale: true };
    const savedAt = read.value.savedAt;
    const savedMs = Date.parse(savedAt);
    const stale =
      !Number.isFinite(savedMs) || clock.now().getTime() - savedMs > maxAgeMs;
    return { entries: entries.map(toSkillPackageDto), savedAt, stale };
  } catch {
    return { entries: [], stale: true };
  }
}

export async function saveOfflineCache(
  store: AtomicJsonStore<OfflineCacheDocument>,
  entries: readonly SkillPackageRecord[],
  clock: Clock,
): Promise<void> {
  const savedAt = clock.now().toISOString();
  await store.write({
    schemaVersion: 1,
    savedAt,
    entries: dedupePackages(entries),
  });
}

export function cacheDocumentFromEntries(
  entries: readonly SkillPackageRecord[],
  savedAt: string,
): OfflineCacheDocument {
  return { schemaVersion: 1, savedAt, entries: dedupePackages(entries) };
}
