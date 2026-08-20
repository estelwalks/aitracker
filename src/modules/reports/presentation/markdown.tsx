import type { ReactNode } from "react";

/**
 * 轻量 Markdown 渲染器（逐字对齐 V3.0 原型 MarkdownView 的样式类，并补充围栏代码块）。
 *
 * 原型未用 react-markdown 等框架，而是手写渲染器并把排版类直接写死在每个标签上
 * （表格 tt-table、引用 chart-1 边框、标题字号等），因此预览区无需外层 .tt-md 也能
 * 还原同样的视觉效果。纯函数 + React 元素：SSR 安全（不触碰 DOM、不用
 * dangerouslySetInnerHTML），零外部依赖。行内支持 **粗体** 与 `行内代码`；块级支持
 * 标题 / 列表 / 表格 / 引用 / 围栏代码块 / 段落。
 */

const INLINE_TOKEN = /(\*\*[^*]+\*\*|`[^`]+`)/g;
const FENCE_OPEN = /^```/;
const LIST_ITEM = /^\s*([-*]|\d+\.)\s+/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const TABLE_SEPARATOR = /^\|[\s:|-]+\|$/;

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|");
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

/** 行内解析：`**粗体**` → <strong>，`` `code` `` → <code>，其余为纯文本。 */
function inline(source: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = INLINE_TOKEN.exec(source))) {
    if (match.index > last) nodes.push(source.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong
          key={`${key}-b${index}`}
          className="font-semibold text-foreground"
        >
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <code
          key={`${key}-c${index}`}
          className="rounded bg-surface-2 px-1 py-px font-mono text-[11.5px]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
    index += 1;
  }
  if (last < source.length) nodes.push(source.slice(last));
  return nodes;
}

function Heading({
  level,
  children,
}: {
  level: 1 | 2 | 3 | 4;
  children: ReactNode;
}) {
  const size =
    level === 1
      ? "text-[17px]"
      : level === 2
        ? "text-[14.5px]"
        : level === 3
          ? "text-[13px]"
          : "text-[12.5px]";
  const className = `mt-5 mb-2 font-semibold tracking-tight first:mt-0 ${size}`;
  if (level === 1) return <h1 className={className}>{children}</h1>;
  if (level === 2) return <h2 className={className}>{children}</h2>;
  if (level === 3) return <h3 className={className}>{children}</h3>;
  return <h4 className={className}>{children}</h4>;
}

export function MarkdownView({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 围栏代码块：``` 开始，直到下一个 ```（语言标注被忽略）。
    if (FENCE_OPEN.test(line.trim())) {
      i += 1;
      const buffer: string[] = [];
      while (i < lines.length && !FENCE_OPEN.test(lines[i].trim())) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过闭合围栏（可能到文件末尾）
      out.push(
        <pre
          key={`f${i}`}
          className="my-3 overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2.5"
        >
          <code className="block font-mono text-[12px] leading-relaxed">
            {buffer.join("\n")}
          </code>
        </pre>,
      );
      continue;
    }

    // 表格：| a | b | 头行 + |---|---| 分隔行。
    if (isTableRow(line) && TABLE_SEPARATOR.test(lines[i + 1]?.trim() ?? "")) {
      const head = tableCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(tableCells(lines[i]));
        i += 1;
      }
      out.push(
        <div
          key={`t${i}`}
          className="tt-xscroll my-3 overflow-x-auto rounded-xl bg-surface-2/60"
        >
          <table className="tt-table w-full min-w-[520px] text-[12px]">
            <thead>
              <tr>
                {head.map((cell, n) => (
                  <th
                    key={n}
                    className={`px-3 py-2 font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground uppercase ${n ? "text-right" : "text-left"}`}
                  >
                    {inline(cell, `th${n}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, n) => (
                <tr key={n}>
                  {row.map((cell, k) => (
                    <td
                      key={k}
                      className={`px-3 py-2 ${k ? "text-right font-mono" : "text-left"}`}
                    >
                      {inline(cell, `td${n}-${k}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 标题：# ~ ####
    const heading = HEADING.exec(line);
    if (heading) {
      out.push(
        <Heading key={`h${i}`} level={heading[1].length as 1 | 2 | 3 | 4}>
          {inline(heading[2], `h${i}`)}
        </Heading>,
      );
      i += 1;
      continue;
    }

    // 引用：> 连续行合并为一个 blockquote。
    if (line.trim().startsWith(">")) {
      const buffer: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buffer.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(
        <blockquote
          key={`q${i}`}
          className="my-3 rounded-lg bg-surface-2/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground"
          style={{ borderLeft: "2px solid var(--chart-1)" }}
        >
          {inline(buffer.join(" "), `q${i}`)}
        </blockquote>,
      );
      continue;
    }

    // 列表：- / * / 1. 连续行合并为一个 ul / ol。
    if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const buffer: string[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        buffer.push(lines[i].replace(LIST_ITEM, ""));
        i += 1;
      }
      const items = buffer.map((item, n) => (
        <li key={n}>{inline(item, `l${i}-${n}`)}</li>
      ));
      out.push(
        ordered ? (
          <ol
            key={`l${i}`}
            className="my-2 list-decimal space-y-1.5 pl-5 text-[12.5px] leading-6"
          >
            {items}
          </ol>
        ) : (
          <ul
            key={`l${i}`}
            className="my-2 list-disc space-y-1.5 pl-5 text-[12.5px] leading-6"
          >
            {items}
          </ul>
        ),
      );
      continue;
    }

    // 段落：连续普通行合并为一个 <p>（遇到块级结构即停止）。
    const buffer: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING.test(lines[i]) &&
      !lines[i].trim().startsWith(">") &&
      !LIST_ITEM.test(lines[i]) &&
      !FENCE_OPEN.test(lines[i].trim()) &&
      !isTableRow(lines[i])
    ) {
      buffer.push(lines[i]);
      i += 1;
    }
    out.push(
      <p
        key={`p${i}`}
        className="my-2 text-[12.5px] leading-7 text-muted-foreground"
      >
        {inline(buffer.join(" "), `p${i}`)}
      </p>,
    );
  }

  return <div className="max-w-none">{out}</div>;
}
