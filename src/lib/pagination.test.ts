import assert from "node:assert/strict";
import test from "node:test";

import { paginationWindow } from "./pagination.ts";

test("pagination window stays compact for a 50,071-page market", () => {
  assert.deepEqual(paginationWindow(1, 50_071), [1, 2, 3, 4, 50_071]);
  assert.deepEqual(
    paginationWindow(25_036, 50_071),
    [1, 25_035, 25_036, 25_037, 50_071],
  );
  assert.deepEqual(
    paginationWindow(50_071, 50_071),
    [1, 50_068, 50_069, 50_070, 50_071],
  );
});

test("pagination window includes every page for small result sets", () => {
  assert.deepEqual(paginationWindow(2, 4), [1, 2, 3, 4]);
  assert.deepEqual(paginationWindow(-10, Number.POSITIVE_INFINITY), [1]);
});
