/**
 * Lightweight Markdown rendering (titles/lists/tables/code blocks/quotes/bold).
 * Shared renderer: Distillation product cards, comparison pop-ups, memory cards, etc. are reused to ensure consistent rendering results.
 * Output is fed directly to `aitracker-md` / `aitracker-md-sm` (global utility, see styles.css).
 */

export function md(text: string) {
  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(
        /`([^`]+)`/g,
        '<code class="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11.5px]">$1</code>',
      );
  const lines = text.split("\n");
  const out: string[] = [];
  let inCode = false;
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        `<ul class="my-2 space-y-1 pl-4">${list
          .map(
            (l) =>
              `<li class="list-disc text-[12.5px] leading-relaxed">${l}</li>`,
          )
          .join("")}</ul>`,
      );
      list = [];
    }
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (l.startsWith("```")) {
      flush();
      out.push(
        inCode
          ? "</code></pre>"
          : '<pre class="my-2 overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed"><code>',
      );
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(`${l.replace(/</g, "&lt;")}\n`);
      continue;
    }
    if (/^#{1,3} /.test(l)) {
      flush();
      const lvl = l.match(/^#+/)![0].length;
      const size =
        lvl === 1 ? "text-[14px]" : lvl === 2 ? "text-[13px]" : "text-[12.5px]";
      out.push(
        `<h${lvl} class="mt-4 mb-1.5 ${size} font-semibold tracking-tight">${inline(
          l.replace(/^#+ /, ""),
        )}</h${lvl}>`,
      );
      continue;
    }
    if (/^[-*] /.test(l) || /^\d+\. /.test(l)) {
      list.push(inline(l.replace(/^([-*]|\d+\.) /, "")));
      continue;
    }
    if (l.startsWith("> ")) {
      flush();
      out.push(
        `<p class="my-2 border-l-2 border-foreground/20 pl-3 text-[12px] text-muted-foreground">${inline(
          l.slice(2),
        )}</p>`,
      );
      continue;
    }
    if (l.startsWith("|")) {
      flush();
      const cells = l.split("|").slice(1, -1);
      if (cells.every((c) => /^\s*-+\s*$/.test(c))) continue;
      out.push(
        `<div class="flex gap-3 py-1 font-mono text-[11.5px] text-muted-foreground">${cells
          .map(
            (c) =>
              `<span class="min-w-0 flex-1 truncate">${inline(c.trim())}</span>`,
          )
          .join("")}</div>`,
      );
      continue;
    }
    if (!l) {
      flush();
      continue;
    }
    flush();
    out.push(
      `<p class="my-1.5 text-[12.5px] leading-relaxed">${inline(l)}</p>`,
    );
  }
  flush();
  return out.join("");
}
