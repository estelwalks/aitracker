import { STORAGE_KEY_PREFIX } from "../app-config";
import { AppError } from "../errors";

const STORAGE_KEY = `${STORAGE_KEY_PREFIX}security.daily-count.v1`;
export const DAILY_SCAN_LIMIT = 10;

interface DailyCount {
  date: string;
  count: number;
}

function localDateKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Seed the daily scan count from the IPC-backed preferences file into
 * localStorage so that subsequent synchronous reads see the persisted value
 * even after an Electron restart (where the random port resets localStorage).
 */
export async function seedDailyCountFromPlatform(): Promise<void> {
  if (typeof window === "undefined") return;
  const api = (
    window as {
      desktopApi?: {
        getPreferences(): Promise<Record<string, unknown>>;
      };
    }
  ).desktopApi;
  if (!api) return;
  try {
    const prefs = await api.getPreferences();
    if (prefs && typeof prefs[STORAGE_KEY] === "string") {
      window.localStorage.setItem(STORAGE_KEY, prefs[STORAGE_KEY]);
    }
  } catch {
    // IPC unavailable; keep existing localStorage value
  }
}

export function readDailyScanCount(
  storage: Pick<Storage, "getItem">,
  now = new Date(),
): number {
  try {
    const parsed = JSON.parse(
      storage.getItem(STORAGE_KEY) ?? "null",
    ) as DailyCount | null;
    return parsed?.date === localDateKey(now) && Number.isInteger(parsed.count)
      ? Math.max(0, parsed.count)
      : 0;
  } catch {
    return 0;
  }
}

export function consumeDailyScan(
  storage: Pick<Storage, "getItem" | "setItem">,
  now = new Date(),
): number {
  const count = readDailyScanCount(storage, now);
  if (count >= DAILY_SCAN_LIMIT)
    throw new AppError("errors.security.dailyLimitReached", {
      limit: DAILY_SCAN_LIMIT,
    });
  const next = count + 1;
  const value = JSON.stringify({ date: localDateKey(now), count: next });
  storage.setItem(STORAGE_KEY, value);

  // Also persist to IPC-backed filesystem for cross-restart durability
  if (typeof window !== "undefined") {
    const api = (
      window as {
        desktopApi?: {
          setPreference(key: string, value: unknown): Promise<void>;
        };
      }
    ).desktopApi;
    if (api) {
      void api.setPreference(STORAGE_KEY, value).catch(() => {});
    }
  }

  return next;
}
