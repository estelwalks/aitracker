import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownTranscriptBody } from "./TranscriptPanel.tsx";

test("assistant transcript body renders Markdown instead of raw markers", () => {
  const markup = renderToStaticMarkup(
    <MarkdownTranscriptBody
      text={
        "## Result\n\n- **Done**\n- `npm test`\n\n```ts\nconst ok = true;\n```"
      }
    />,
  );

  assert.match(markup, /<h2[^>]*>Result<\/h2>/);
  assert.match(markup, /<strong[^>]*>Done<\/strong>/);
  assert.match(markup, /<code[^>]*>npm test<\/code>/);
  assert.match(markup, /<pre[^>]*>.*const ok = true;/s);
  assert.doesNotMatch(markup, /## Result/);
  assert.doesNotMatch(markup, /\*\*Done\*\*/);
});

test("assistant transcript Markdown escapes raw HTML", () => {
  const markup = renderToStaticMarkup(
    <MarkdownTranscriptBody text={'<img src=x onerror="alert(1)">'} />,
  );

  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /&lt;img/);
});

test("assistant transcript Markdown renders links and hides AiPy metadata comments", () => {
  const markup = renderToStaticMarkup(
    <MarkdownTranscriptBody
      text={
        '[Open docs](https://example.com)\n<!-- aipy_meta: {"kind":"internal"} -->'
      }
    />,
  );

  assert.match(markup, /<a[^>]*href="https:\/\/example\.com"/);
  assert.doesNotMatch(markup, /aipy_meta/);
  assert.doesNotMatch(markup, /<!--/);
});
