import assert from "node:assert/strict";
import test from "node:test";

import {
  createWidgetShellDataUrl,
  createWidgetShellHtml,
} from "./widget-shell.js";

test("widget shell is a script-free 420×680 dark rounded first frame", () => {
  const html = createWidgetShellHtml();
  assert.match(html, /width: 420px/u);
  assert.match(html, /height: 680px/u);
  assert.match(html, /border-radius: 30px/u);
  assert.match(html, /background: linear-gradient/u);
  assert.match(html, /Content-Security-Policy/u);
  assert.doesNotMatch(html, /<script/u);
});

test("widget shell data URL round-trips its HTML", () => {
  const url = createWidgetShellDataUrl();
  assert.match(url, /^data:text\/html;base64,/u);
  const decoded = Buffer.from(url.split(",", 2)[1] ?? "", "base64").toString(
    "utf8",
  );
  assert.equal(decoded, createWidgetShellHtml());
});
