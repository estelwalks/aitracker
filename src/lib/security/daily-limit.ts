const STORAGE_KEY = "trusttools.security.daily-count.v1";
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

export function readDailyScanCount(storage: Pick<Storage, "getItem">, now = new Date()): number {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as DailyCount | null;
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
  if (count >= DAILY_SCAN_LIMIT) throw new Error("今日 10 次本地扫描额度已用完");
  const next = count + 1;
  storage.setItem(STORAGE_KEY, JSON.stringify({ date: localDateKey(now), count: next }));
  return next;
}
