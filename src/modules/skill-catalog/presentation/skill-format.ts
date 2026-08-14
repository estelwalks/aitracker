/** Compact human number: 1.2K / 3.4M (prototype-style). */
export function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/** Format a byte size as KB/MB (or '-' for zero/unknown). */
export function formatSizeBytes(bytes: number): string {
  if (bytes == null || bytes <= 0) return "-";
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(0)} KB`;
  return `${bytes} B`;
}
