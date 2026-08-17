import type { ReactNode } from "react";

/**
 * 轻量 Markdown 渲染器（移植自 V3.0 原型 MarkdownView，并补充围栏代码块）。
 *
 * 纯函数 + React 元素：SSR 安全（不触碰 DOM、不用 dangerouslySetInnerHTML，
 * 特殊字符由 React 自动转义），零外部依赖。行内支持 **粗体** 与 `行内代码`；
 * 块级支持标题 / 列表 / 表格 / 引用 / 围栏代码块 / 段落。排版样式由外层
 * `.tt-md` 容器统一提供，这里只产出语义化元素。
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
        <strong key={`${key}-b${index}`}>{token.slice(2, -2)}</strong>,
      );
    } else {
      nodes.push(<code key={`${key}-c${index}`}>{token.slice(1, -1)}</code>);
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
  if (level === 1) return <h1>{children}</h1>;
  if (level === 2) return <h2>{children}</h2>;
  if (level === 3) return <h3>{children}</h3>;
  return <h4>{children}</h4>;
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
        <pre key={`f${i}`}>
          <code>{buffer.join("\n")}</code>
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
        <div key={`t${i}`} className="tt-xscroll overflow-x-auto">
          <table>
            <thead>
              <tr>
                {head.map((cell, n) => (
                  <th key={n}>{inline(cell, `th${n}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, n) => (
                <tr key={n}>
                  {row.map((cell, k) => (
                    <td key={k}>{inline(cell, `td${n}-${k}`)}</td>
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
        <blockquote key={`q${i}`}>
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
          <ol key={`l${i}`}>{items}</ol>
        ) : (
          <ul key={`l${i}`}>{items}</ul>
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
    out.push(<p key={`p${i}`}>{inline(buffer.join(" "), `p${i}`)}</p>);
  }

  return <div className="max-w-none">{out}</div>;
}
