import type { SecurityReport } from "./scanner.ts";

export interface SecurityStats {
  scanned: number;
  safe: number;
  suspicious: number;
  dangerous: number;
  averageDurationMs: number;
}

/** Statistics are calculated only based on the local history that has been retained for the past 30 days, and no remote or simulated data is introduced. */
export function getSecurityStats(history: SecurityReport[]): SecurityStats {
  const stats: SecurityStats = {
    scanned: history.length,
    safe: 0,
    suspicious: 0,
    dangerous: 0,
    averageDurationMs: 0,
  };
  if (history.length === 0) return stats;

  let totalDuration = 0;
  for (const report of history) {
    if (report.verdict === "安全") stats.safe += 1;
    else if (report.verdict === "可疑") stats.suspicious += 1;
    else stats.dangerous += 1;
    totalDuration += Math.max(0, report.durationMs || 0);
  }
  stats.averageDurationMs = Math.round(totalDuration / history.length);
  return stats;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}
