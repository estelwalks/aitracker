import type { ReactNode } from "react";

/**
 * Lightweight Markdown renderer using the reference MarkdownView styles and fenced
 * code-block support.
 *
 * The prototype does not use frameworks such as react-markdown, but instead writes a handwritten renderer and writes the typesetting class directly on each label.
 * (Table aitracker-table, reference chart-1 border, title font size, etc.), so the preview area does not need an outer .aitracker-md
 * Restore the same visual effect. Pure functions + React elements: SSR safe (no touching DOM, no need
 * dangerouslySetInnerHTML), zero external dependencies. Inline support **bold** and `inline code`; block level support
 * Titles/Lists/Tables/Quotes/Fence Blocks/Paragraphs.
 */

const INLINE_TOKEN =
  /(\[[^\]]+\]\([^)]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
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

function numericTokenValue(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)([KMB])?$/i.exec(
    value.replace(/[\s,]/g, "").replace(/tokens?$/i, ""),
  );
  if (!match) return null;
  const multiplier =
    match[2]?.toUpperCase() === "M"
      ? 1_000_000
      : match[2]?.toUpperCase() === "K"
        ? 1_000
        : match[2]?.toUpperCase() === "B"
          ? 1_000_000_000
          : 1;
  return Number(match[1]) * multiplier;
}

function removeUnusedAgentRows(
  head: readonly string[],
  rows: readonly string[][],
): string[][] {
  const isAgentTable = head[0]?.trim().toLowerCase() === "agent";
  const tokenColumn = head.findIndex(
    (cell) => cell.trim().toLowerCase() === "tokens",
  );
  if (!isAgentTable || tokenColumn < 0) return rows.map((row) => [...row]);
  return rows.filter((row) => {
    const tokens = numericTokenValue(row[tokenColumn]);
    return tokens === null || tokens > 0;
  });
}

function safeLinkHref(href: string): string | undefined {
  return /^(https?:|mailto:)/i.test(href) || href.startsWith("#")
    ? href
    : undefined;
}

/** Inline parsing: bold, italics, codes and safe links, the rest is plain text. */
function inline(source: string, key: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = INLINE_TOKEN.exec(source))) {
    if (match.index > last) nodes.push(source.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link == null ? undefined : safeLinkHref(link[2]);
      nodes.push(
        href == null ? (
          token
        ) : (
          <a
            key={`${key}-a${index}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            {link?.[1]}
          </a>
        ),
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong
          key={`${key}-b${index}`}
          className="font-semibold text-foreground"
        >
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`${key}-c${index}`}
          className="rounded bg-surface-2 px-1 py-px font-mono text-[11.5px]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<em key={`${key}-i${index}`}>{token.slice(1, -1)}</em>);
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
    level === 1 ? "aitracker-text-page-title" : "aitracker-text-section-title";
  const className = `mt-5 mb-2 font-semibold tracking-tight first:mt-0 ${size}`;
  if (level === 1) return <h1 className={className}>{children}</h1>;
  if (level === 2) return <h2 className={className}>{children}</h2>;
  if (level === 3) return <h3 className={className}>{children}</h3>;
  return <h4 className={className}>{children}</h4>;
}

export function MarkdownView({
  source,
  hideUnusedAgentRows = true,
}: {
  source: string;
  hideUnusedAgentRows?: boolean;
}) {
  const lines = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\r/g, "")
    .split("\n");
  const out: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fence code block: ``` starts until next ``` (language annotation is ignored).
    if (FENCE_OPEN.test(line.trim())) {
      i += 1;
      const buffer: string[] = [];
      while (i < lines.length && !FENCE_OPEN.test(lines[i].trim())) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1; // Jump over closing fence (possibly to end of file)
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

    // Table: | a | b | header row + |---|---| delimiter rows.
    if (isTableRow(line) && TABLE_SEPARATOR.test(lines[i + 1]?.trim() ?? "")) {
      const head = tableCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(tableCells(lines[i]));
        i += 1;
      }
      // Keep the header and body on one column model even when a generated
      // Markdown row omits a trailing cell or contains an extra separator.
      const alignedRows = rows.map((row) =>
        head.map((_, column) => row[column] ?? ""),
      );
      const normalizedRows = hideUnusedAgentRows
        ? removeUnusedAgentRows(head, alignedRows)
        : alignedRows;
      const numericColumnWidth =
        head.length > 1 ? `${76 / (head.length - 1)}%` : "76%";
      out.push(
        <div
          key={`t${i}`}
          className="aitracker-xscroll my-3 overflow-x-auto rounded-xl bg-surface-2/60"
        >
          <table className="aitracker-table w-full min-w-[520px] table-fixed text-[12px]">
            <colgroup>
              {head.map((_, column) => (
                <col
                  key={column}
                  style={{
                    width: column === 0 ? "24%" : numericColumnWidth,
                  }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                {head.map((cell, n) => (
                  <th
                    key={n}
                    className="px-3 py-2 text-left font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground uppercase"
                  >
                    {inline(cell, `th${n}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalizedRows.map((row, n) => (
                <tr key={n}>
                  {row.map((cell, k) => (
                    <td key={k} className="px-3 py-2 text-left font-mono">
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

    // Title: # ~ ####
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

    // Quotes: >Contiguous lines are merged into one blockquote.
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

    // List:- /*/ 1. Consecutive lines merged into one ul/ol.
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

    // Paragraph: Continuous ordinary lines are merged into a <p> (stop when encountering block-level structure).
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
    // A pipe-delimited line without a Markdown separator is not a valid
    // table. Treat it as plain text and always advance. Previously `buffer`
    // stayed empty and `i` never changed, causing an infinite render loop and
    // eventually crashing the Chromium tab with an out-of-memory error.
    if (buffer.length === 0) {
      buffer.push(lines[i]);
      i += 1;
    }
    const paragraph: ReactNode[] = [];
    buffer.forEach((paragraphLine, lineIndex) => {
      const hardBreak = paragraphLine.endsWith("\\");
      const line = hardBreak ? paragraphLine.slice(0, -1) : paragraphLine;
      paragraph.push(...inline(line, `p${i}-${lineIndex}`));
      if (lineIndex < buffer.length - 1) {
        if (hardBreak) {
          paragraph.push(<br key={`p${i}-br${lineIndex}`} />);
        } else {
          paragraph.push(" ");
        }
      }
    });
    out.push(
      <p
        key={`p${i}`}
        className="my-2 text-[12.5px] leading-7 text-muted-foreground"
      >
        {paragraph}
      </p>,
    );
  }

  return <div className="max-w-none">{out}</div>;
}
