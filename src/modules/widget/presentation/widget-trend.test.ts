import assert from "node:assert/strict";
import test from "node:test";

import { formatDate, formatTokens } from "../../../lib/i18n/format.ts";
import {
  formatWidgetTrendDate,
  formatWidgetTrendTokens,
  normalizeWidgetTrend,
} from "./widget-trend.ts";

test("widget trend aggregates real daily buckets and fills missing local dates", () => {
  const trend = normalizeWidgetTrend(
    [
      { date: "2026-08-12", tokens: 1_000_000 },
      { date: "2026-08-12", tokens: 200_000 },
      { date: "2026-08-14", tokens: 3_000_000 },
    ],
    new Date(2026, 7, 14, 12),
  );

  assert.deepEqual(
    trend,
    [
      ["2026-08-08", 0],
      ["2026-08-09", 0],
      ["2026-08-10", 0],
      ["2026-08-11", 0],
      ["2026-08-12", 1_200_000],
      ["2026-08-13", 0],
      ["2026-08-14", 3_000_000],
    ].map(([date, tokens]) => ({
      date: date as string,
      tokens: tokens as number,
    })),
  );
});

test("widget trend display keeps compact precision, unit spacing and locale date", () => {
  assert.equal(
    formatWidgetTrendTokens(12_345_678, (value) =>
      formatTokens("zh-CN", value),
    ),
    "12.3 M",
  );
  assert.equal(
    formatWidgetTrendDate("2026-08-12", (value, options) =>
      formatDate("zh-CN", value, options),
    ),
    "8月12日",
  );
});
