import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { ErrorDetails } from "./ErrorDetails.tsx";

/**
 * The boundary must show the cause in the very first frame, so the summary is
 * derived during render and is therefore present in the SSR markup too. These
 * assertions run without a DOM, which is exactly the server-render contract.
 */

test("the error summary renders the real cause, not just the translated title", () => {
  const html = renderToString(
    createElement(ErrorDetails, {
      error: new TypeError("snapshot database is locked"),
      locale: "zh-CN",
      currency: "CNY",
    }),
  );

  assert.match(html, /error-summary/);
  assert.match(html, /TypeError: snapshot database is locked/);
});

test("a thrown non-Error value still produces a readable summary", () => {
  const html = renderToString(
    createElement(ErrorDetails, { error: "boom", variant: "compact" }),
  );

  assert.match(html, /string: boom/);
});

test("the collapsed panel keeps the report out of the first frame", () => {
  const html = renderToString(
    createElement(ErrorDetails, { error: new Error("hidden until asked") }),
  );

  assert.doesNotMatch(html, /error-report/);
  assert.match(html, /查看错误详情/);
});
