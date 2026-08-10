/**
 * Browser-only download helper for token-usage exports (FR-032).
 *
 * Pure module consumers (CSV/JSON serializers) have no DOM dependency; this
 * file is the only one in the export module that touches `document`/`Blob`. It
 * is intentionally not exercised by the node:test suite — see `export.test.ts`.
 */

import { EXPORT_FILENAME_PREFIX } from "../app-config";

/** MIME types per export format (UTF-8, so Chinese headers decode correctly). */
const MIME_TYPES: Record<"csv" | "json", string> = {
  csv: "text/csv;charset=utf-8",
  json: "application/json;charset=utf-8",
};

/** File extensions per export format. */
const EXTENSIONS: Record<"csv" | "json", string> = {
  csv: "csv",
  json: "json",
};

/**
 * Build the export filename (e.g. `<export-prefix>${YYYYMMDDHHMM}.${ext}`,
 * prefix from app-config) from a Unix epoch millisecond timestamp in **local**
 * time. Extracted for testability.
 */
export function buildExportFilename(
  format: "csv" | "json",
  timestampMs: number,
): string {
  const d = new Date(timestampMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}` +
    `${pad(d.getMonth() + 1)}` +
    `${pad(d.getDate())}` +
    `${pad(d.getHours())}` +
    `${pad(d.getMinutes())}`;
  return `${EXPORT_FILENAME_PREFIX}${stamp}.${EXTENSIONS[format]}`;
}

/**
 * Trigger a browser download of `content` as the given format.
 *
 * Creates a `Blob` with the appropriate UTF-8 MIME type, a temporary anchor
 * element, and an object URL; simulates a click; then revokes the URL and
 * removes the anchor. The filename is derived from `timestampMs` in local time
 * (see {@link buildExportFilename}).
 *
 * SSR guard: in any environment without `document` (Node, prerender, SSR) this
 * is a no-op, so the module is safe to import server-side.
 *
 * @param content      Serialized export payload.
 * @param format       Export format, selects MIME type and extension.
 * @param timestampMs  Epoch milliseconds used to build the filename (local time).
 */
export function downloadExport(
  content: string,
  format: "csv" | "json",
  timestampMs: number,
): void {
  if (typeof document === "undefined") {
    return;
  }

  const blob = new Blob([content], { type: MIME_TYPES[format] });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = buildExportFilename(format, timestampMs);
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
