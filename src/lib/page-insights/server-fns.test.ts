import assert from "node:assert/strict";
import test from "node:test";

import { pageInsightsValidator } from "./server-fns.ts";

test("validator accepts known pages with a valid locale", () => {
  assert.deepEqual(
    pageInsightsValidator({ page: "sources", locale: "zh-CN" }),
    {
      page: "sources",
      locale: "zh-CN",
    },
  );
  assert.deepEqual(
    pageInsightsValidator({ page: "tracker", locale: "en-US" }),
    {
      page: "tracker",
      locale: "en-US",
    },
  );
});

test("validator rejects unknown pages", () => {
  assert.throws(
    () => pageInsightsValidator({ page: "bogus", locale: "zh-CN" }),
    /AppError/,
  );
});

test("validator rejects unknown locales and missing input", () => {
  assert.throws(
    () => pageInsightsValidator({ page: "sources", locale: "xx-XX" }),
    /AppError/,
  );
  assert.throws(() => pageInsightsValidator(null), /AppError/);
  assert.throws(() => pageInsightsValidator(undefined), /AppError/);
});
