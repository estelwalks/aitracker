/** Standard row count for the main catalog and security data lists. */
export const STANDARD_PAGE_SIZE = 10;

/**
 * Compact page window for very large result sets. It always includes the
 * first/last page and keeps at most five numbered buttons visible.
 */
export function paginationWindow(page: number, pageCount: number): number[] {
  const safePageCount = Math.max(
    1,
    Math.floor(Number.isFinite(pageCount) ? pageCount : 1),
  );
  const current = Math.min(
    Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)),
    safePageCount,
  );

  if (safePageCount <= 5) {
    return Array.from({ length: safePageCount }, (_, index) => index + 1);
  }
  if (current <= 3) return [1, 2, 3, 4, safePageCount];
  if (current >= safePageCount - 2) {
    return [
      1,
      safePageCount - 3,
      safePageCount - 2,
      safePageCount - 1,
      safePageCount,
    ];
  }
  return [1, current - 1, current, current + 1, safePageCount];
}
