import assert from "node:assert/strict";
import test from "node:test";

import { consumeDailyScan, readDailyScanCount } from "./daily-limit.ts";

function storage() {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

test("persists ten scans per local calendar day and resets next day", () => {
  const memory = storage();
  const today = new Date(2026, 6, 27, 12);
  for (let count = 1; count <= 10; count += 1) {
    assert.equal(consumeDailyScan(memory, today), count);
  }
  assert.throws(
    () => consumeDailyScan(memory, today),
    /errors.security.dailyLimitReached/,
  );
  assert.equal(readDailyScanCount(memory, new Date(2026, 6, 28, 0, 1)), 0);
});
