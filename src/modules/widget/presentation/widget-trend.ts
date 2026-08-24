export interface WidgetTrendPoint {
  readonly date: string;
  readonly tokens: number;
}

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addLocalDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

/**
 * Keep the widget chart on the latest seven local calendar days.
 *
 * `observed` is the real, server-projected usage trend. The small client-side
 * normalization makes the presentation resilient to an omitted day or a
 * duplicated bucket while keeping the source of truth in the usage snapshot.
 */
export function normalizeWidgetTrend(
  observed: readonly WidgetTrendPoint[],
  today = new Date(),
): WidgetTrendPoint[] {
  const tokensByDate = new Map<string, number>();

  for (const point of observed) {
    if (!LOCAL_DATE_PATTERN.test(point.date)) continue;
    const parsed = new Date(`${point.date}T12:00:00`);
    if (
      Number.isNaN(parsed.getTime()) ||
      localDateKey(parsed) !== point.date ||
      !Number.isFinite(point.tokens)
    ) {
      continue;
    }
    tokensByDate.set(
      point.date,
      (tokensByDate.get(point.date) ?? 0) + point.tokens,
    );
  }

  return Array.from({ length: 7 }, (_, index) => {
    const date = localDateKey(addLocalDays(today, index - 6));
    return { date, tokens: tokensByDate.get(date) ?? 0 };
  });
}

export function formatWidgetTrendDate(
  date: string,
  formatDate: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string,
): string {
  return formatDate(`${date}T12:00:00`, {
    year: undefined,
    month: "short",
    day: "numeric",
  });
}

/** Preserve the widget's compact precision while spacing the unit visually. */
export function formatWidgetTrendTokens(
  tokens: number,
  formatTokens: (value: number) => string,
): string {
  return formatTokens(tokens).replace(/([KMB])$/u, " $1");
}
