import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { MarketListResult } from "./types.ts";

const CACHE_VERSION = 1;
const CACHE_FILE = join(homedir(), ".trusttools", "cache", "market-v1.json");

interface MarketCache {
  version: number;
  entries: Record<string, MarketListResult>;
}

export function marketCacheKey(page: number, limit: number, search: string): string {
  return `${page}:${limit}:${search.toLocaleLowerCase()}`;
}

async function readCacheFile(): Promise<MarketCache> {
  try {
    const parsed = JSON.parse(await readFile(CACHE_FILE, "utf8")) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      parsed.version === CACHE_VERSION &&
      "entries" in parsed &&
      typeof parsed.entries === "object" &&
      parsed.entries !== null
    ) {
      return parsed as MarketCache;
    }
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
  return { version: CACHE_VERSION, entries: {} };
}

export async function readMarketCache(key: string): Promise<MarketListResult | null> {
  const cache = await readCacheFile();
  return cache.entries[key] ?? null;
}

export async function writeMarketCache(key: string, result: MarketListResult): Promise<void> {
  const cache = await readCacheFile();
  cache.entries[key] = result;
  const temporaryFile = `${CACHE_FILE}.${process.pid}.tmp`;
  await mkdir(dirname(CACHE_FILE), { recursive: true, mode: 0o700 });
  await writeFile(temporaryFile, JSON.stringify(cache), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryFile, CACHE_FILE);
}
