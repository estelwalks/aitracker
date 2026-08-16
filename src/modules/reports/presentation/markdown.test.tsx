import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownView } from "./markdown.tsx";

function render(source: string): string {
  return renderToStaticMarkup(<MarkdownView source={source} />);
}

test("MarkdownView renders headings at each level", () => {
  const markup = render("# 一级\n## 二级\n### 三级\n#### 四级");
  assert.match(markup, /<h1>一级<\/h1>/);
  assert.match(markup, /<h2>二级<\/h2>/);
  assert.match(markup, /<h3>三级<\/h3>/);
  assert.match(markup, /<h4>四级<\/h4>/);
});

test("MarkdownView renders bold and inline code", () => {
  const markup = render("检查 **模式** 与 `flag` 的值");
  assert.match(
    markup,
    /<p>检查 <strong>模式<\/strong> 与 <code>flag<\/code> 的值<\/p>/,
  );
});

test("MarkdownView renders bullet and ordered lists", () => {
  const bullet = render("- 甲\n- **乙**");
  assert.match(bullet, /<ul><li>甲<\/li><li><strong>乙<\/strong><\/li><\/ul>/);

  const ordered = render("1. 一\n2. 二");
  assert.match(ordered, /<ol><li>一<\/li><li>二<\/li><\/ol>/);
});

test("MarkdownView renders tables with header and rows", () => {
  const markup = render("| 名称 | 数量 |\n| --- | --- |\n| A | 1 |\n| B | 2 |");
  assert.match(markup, /<table>/);
  assert.match(
    markup,
    /<thead><tr><th>名称<\/th><th>数量<\/th><\/tr><\/thead>/,
  );
  assert.match(
    markup,
    /<tbody><tr><td>A<\/td><td>1<\/td><\/tr><tr><td>B<\/td><td>2<\/td><\/tr><\/tbody>/,
  );
});

test("MarkdownView renders blockquotes", () => {
  const markup = render("> 引用第一行\n> 引用第二行");
  assert.match(markup, /<blockquote>引用第一行 引用第二行<\/blockquote>/);
});

test("MarkdownView renders fenced code blocks preserving newlines", () => {
  const markup = render("```\nline one\nline two\n```");
  assert.match(markup, /<pre><code>line one\nline two<\/code><\/pre>/);
});

test("MarkdownView renders an empty string as an empty container", () => {
  const markup = render("");
  assert.equal(markup, '<div class="max-w-none"></div>');
});

test("MarkdownView escapes special characters instead of injecting HTML", () => {
  const markup = render("<script>alert('x')</script> & <b>");
  assert.doesNotMatch(markup, /<script>/);
  assert.doesNotMatch(markup, /<b>/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /&amp; /);
});

test("MarkdownView treats stray asterisks and unmatched backticks as text", () => {
  const markup = render("2 * 3 = 6 与 `未闭合");
  assert.match(markup, /2 \* 3 = 6 与 `未闭合/);
  assert.doesNotMatch(markup, /<strong>/);
});
