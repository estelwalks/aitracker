import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownView } from "./markdown.tsx";

function render(source: string): string {
  return renderToStaticMarkup(<MarkdownView source={source} />);
}

test("MarkdownView renders headings at each level with semantic typography classes", () => {
  const markup = render("# 一级\n## 二级\n### 三级\n#### 四级");
  assert.match(
    markup,
    /<h1 class="[^"]*aitracker-text-page-title[^"]*"[^>]*>一级<\/h1>/,
  );
  assert.match(
    markup,
    /<h2 class="[^"]*aitracker-text-section-title[^"]*"[^>]*>二级<\/h2>/,
  );
  assert.match(
    markup,
    /<h3 class="[^"]*aitracker-text-section-title[^"]*"[^>]*>三级<\/h3>/,
  );
  assert.match(
    markup,
    /<h4 class="[^"]*aitracker-text-section-title[^"]*"[^>]*>四级<\/h4>/,
  );
});

test("MarkdownView renders bold and inline code with prototype classes", () => {
  const markup = render("检查 **模式** 与 `flag` 的值");
  assert.match(
    markup,
    /<p class="my-2 text-\[12\.5px\] leading-7 text-muted-foreground">检查 <strong class="font-semibold text-foreground">模式<\/strong> 与 <code class="rounded bg-surface-2 px-1 py-px font-mono text-\[11\.5px\]">flag<\/code> 的值<\/p>/,
  );
});

test("MarkdownView renders bullet and ordered lists with prototype classes", () => {
  const bullet = render("- 甲\n- **乙**");
  assert.match(
    bullet,
    /<ul class="my-2 list-disc space-y-1\.5 pl-5 text-\[12\.5px\] leading-6"><li>甲<\/li><li><strong class="font-semibold text-foreground">乙<\/strong><\/li><\/ul>/,
  );

  const ordered = render("1. 一\n2. 二");
  assert.match(
    ordered,
    /<ol class="my-2 list-decimal space-y-1\.5 pl-5 text-\[12\.5px\] leading-6"><li>一<\/li><li>二<\/li><\/ol>/,
  );
});

test("MarkdownView renders tables with prototype aitracker-table chrome", () => {
  const markup = render("| 名称 | 数量 |\n| --- | --- |\n| A | 1 |\n| B | 2 |");
  assert.match(
    markup,
    /class="aitracker-xscroll my-3 overflow-x-auto rounded-xl bg-surface-2\/60"/,
  );
  assert.match(
    markup,
    /<table class="aitracker-table w-full min-w-\[520px\] table-fixed text-\[12px\]">/,
  );
  assert.match(
    markup,
    /<thead><tr><th class="px-3 py-2 text-left font-mono text-\[10\.5px\] tracking-\[0\.06em\] text-muted-foreground uppercase">名称<\/th><th class="px-3 py-2 text-left font-mono text-\[10\.5px\] tracking-\[0\.06em\] text-muted-foreground uppercase">数量<\/th><\/tr><\/thead>/,
  );
  assert.match(
    markup,
    /<tbody><tr><td class="px-3 py-2 text-left font-mono">A<\/td><td class="px-3 py-2 text-left font-mono">1<\/td><\/tr><tr><td class="px-3 py-2 text-left font-mono">B<\/td><td class="px-3 py-2 text-left font-mono">2<\/td><\/tr><\/tbody>/,
  );
});

test("MarkdownView keeps uneven table rows aligned to the header columns", () => {
  const markup = render(
    "| Agent | 会话 | Tokens |\n| --- | --- | --- |\n| codex | 6 | 159M |\n| aipy | 0 |",
  );
  assert.match(
    markup,
    /<colgroup><col style="width:24%"\/><col style="width:38%"\/><col style="width:38%"\/><\/colgroup>/,
  );
  assert.match(
    markup,
    /<tbody><tr><td class="px-3 py-2 text-left font-mono">codex<\/td><td class="px-3 py-2 text-left font-mono">6<\/td><td class="px-3 py-2 text-left font-mono">159M<\/td><\/tr><tr><td class="px-3 py-2 text-left font-mono">aipy<\/td><td class="px-3 py-2 text-left font-mono">0<\/td><td class="px-3 py-2 text-left font-mono"><\/td><\/tr><\/tbody>/,
  );
});

test("MarkdownView hides Agent rows with zero Tokens", () => {
  const markup = render(
    "| Agent | 会话 | Tokens |\n| --- | --- | --- |\n| codex | 6 | 159M |\n| unused-agent | 0 | 0 |",
  );
  assert.match(markup, /codex/);
  assert.doesNotMatch(markup, /unused-agent/);
});

test("MarkdownView renders blockquotes with prototype border color", () => {
  const markup = render("> 引用第一行\n> 引用第二行");
  assert.match(
    markup,
    /<blockquote class="my-3 rounded-lg bg-surface-2\/60 px-3 py-2 text-\[12px\] leading-relaxed text-muted-foreground" style="border-left:2px solid var\(--chart-1\)">引用第一行 引用第二行<\/blockquote>/,
  );
});

test("MarkdownView renders fenced code blocks preserving newlines", () => {
  const markup = render("```\nline one\nline two\n```");
  assert.match(
    markup,
    /<pre class="my-3 overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2\.5"><code class="block font-mono text-\[12px\] leading-relaxed">line one\nline two<\/code><\/pre>/,
  );
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
