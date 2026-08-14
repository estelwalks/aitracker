import {
  AlertTriangle,
  Check,
  Download,
  FileCode,
  FolderTree,
  Loader2,
  ShieldBan,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { BrandIcon } from "../../../components/BrandIcon";
import { Segmented, TTButton } from "../../../components/tt";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useI18n } from "../../../lib/i18n/context";
import {
  getSkillFiles,
  SKILL_AGENTS,
  type LocalSkill,
  type SkillAgent,
  type SkillFileEntry,
} from "../query.ts";
import type { SkillCardSecurity } from "./SkillCard.tsx";
import { formatSizeBytes } from "./skill-format.ts";

/** Browser download of a single text file (no server round-trip needed). */
function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Nested YAML-subset frontmatter node (key → scalar value and/or child keys). */
interface FmNode {
  key: string;
  value: string | null;
  children: FmNode[];
}

/** Parse indented `key: value` frontmatter lines into a nested tree. */
function parseFrontmatter(lines: readonly string[]): FmNode[] {
  const root: FmNode[] = [];
  const stack: { indent: number; node: FmNode }[] = [];
  for (const raw of lines) {
    const content = raw.trim();
    if (!content) continue;
    const indent = raw.length - raw.trimStart().length;
    const colon = content.indexOf(":");
    if (colon === -1) {
      // Block-scalar continuation (e.g. `description: |` + indented lines).
      const top = stack[stack.length - 1];
      if (top) top.node.value = `${top.node.value ?? ""}\n${content}`;
      continue;
    }
    const key = content.slice(0, colon).trim();
    const value = content.slice(colon + 1).trim();
    const node: FmNode = { key, value: value || null, children: [] };
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    if (stack.length > 0) stack[stack.length - 1].node.children.push(node);
    else root.push(node);
    stack.push({ indent, node });
  }
  return root;
}

/** Recursively render one frontmatter node; nested children are indented with a rail. */
function FrontmatterNode({ node }: { node: FmNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex gap-2">
        <span className="w-24 shrink-0 truncate text-foreground/70">
          {node.key}
        </span>
        {node.value != null && (
          <span className="min-w-0 break-all">{node.value}</span>
        )}
      </div>
      {node.children.length > 0 && (
        <div className="ml-2 flex flex-col gap-0.5 border-l border-border/40 pl-2.5">
          {node.children.map((child, index) => (
            <FrontmatterNode key={`${child.key}-${index}`} node={child} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Render inline markdown: bold, italic, inline code, links. */
function inline(text: string): ReactNode {
  const pattern =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key++}
          className="rounded-sm bg-surface-2 px-1 py-px font-mono text-[11px] text-primary"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key++} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a
            key={key++}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            {link[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

/** A markdown table separator row, e.g. `|------|:---:|` or `---|--`. */
function isTableSeparator(line: string): boolean {
  return (
    /^\s*\|?[\s:]*:?-+:?[\s:]*(\|[\s:]*:?-+:?[\s:]*)*\|?\s*$/.test(line) &&
    line.includes("-")
  );
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Minimal Markdown renderer: nested frontmatter / tables / quotes / code / lists. */
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactElement[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Opening frontmatter fence (only at the very start of the file).
    if (trimmed === "---" && i === 0) {
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && lines[i]!.trim() !== "---") {
        buffer.push(lines[i]!);
        i += 1;
      }
      i += 1; // skip the closing fence
      const tree = parseFrontmatter(buffer);
      out.push(
        <div
          key={key++}
          className="tt-num rounded-sm border border-border bg-surface-2/50 px-3 py-2 text-[11px] text-muted-foreground"
        >
          {tree.length === 0
            ? buffer.join("\n")
            : tree.map((node, index) => (
                <FrontmatterNode key={`fm-${index}`} node={node} />
              ))}
        </div>,
      );
      continue;
    }

    // Fenced code block.
    if (line.startsWith("```")) {
      const buffer: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        buffer.push(lines[i]!);
        i += 1;
      }
      i += 1;
      out.push(
        <pre
          key={key++}
          className="tt-xscroll tt-num overflow-x-auto rounded-sm border border-border bg-surface-2/60 p-3 text-[11.5px] leading-relaxed"
        >
          {buffer.join("\n")}
        </pre>,
      );
      continue;
    }

    // Heading.
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(
        <div
          key={key++}
          className={
            level <= 1
              ? "mt-1 text-[15px] font-semibold"
              : level === 2
                ? "mt-3 border-t border-border/60 pt-3 text-[13px] font-semibold"
                : "mt-2 text-[12.5px] font-medium text-foreground/85"
          }
        >
          {inline(heading[2]!)}
        </div>,
      );
      i += 1;
      continue;
    }

    // Table (header row followed by a separator row).
    if (line.includes("|") && isTableSeparator(lines[i + 1] ?? "")) {
      const header = splitTableRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (
        i < lines.length &&
        lines[i]!.includes("|") &&
        !isTableSeparator(lines[i]!)
      ) {
        rows.push(splitTableRow(lines[i]!));
        i += 1;
      }
      out.push(
        <div
          key={key++}
          className="tt-xscroll overflow-x-auto rounded-sm border border-border"
        >
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="bg-surface-2/60">
                {header.map((cell, index) => (
                  <th
                    key={index}
                    className="border-b border-border px-2 py-1.5 text-left font-medium text-foreground"
                  >
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-surface-2/20">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className="border-t border-border/50 px-2 py-1.5 align-top text-muted-foreground"
                    >
                      {inline(cell)}
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

    // Blockquote.
    if (trimmed.startsWith(">")) {
      const buffer: string[] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith(">")) {
        buffer.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(
        <blockquote
          key={key++}
          className="rounded-sm border-l-2 border-primary/40 bg-primary/5 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground"
        >
          {inline(buffer.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const buffer: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
        buffer.push(lines[i]!.replace(/^\s*[-*+]\s+/, ""));
        i += 1;
      }
      out.push(
        <ul
          key={key++}
          className="space-y-1 text-[12.5px] text-muted-foreground"
        >
          {buffer.map((item, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-primary/70">▸</span>
              <span className="min-w-0">{inline(item)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const buffer: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) {
        buffer.push(lines[i]!.replace(/^\s*\d+[.)]\s+/, ""));
        i += 1;
      }
      out.push(
        <ol
          key={key++}
          className="list-decimal space-y-1 pl-5 text-[12.5px] text-muted-foreground"
        >
          {buffer.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Horizontal rule (not the frontmatter fence).
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push(<hr key={key++} className="border-border" />);
      i += 1;
      continue;
    }

    // Blank line.
    if (trimmed === "") {
      i += 1;
      continue;
    }

    // Paragraph: consume consecutive non-blank, non-block lines.
    const buffer: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const next = lines[i]!;
      const nextTrimmed = next.trim();
      if (
        nextTrimmed === "" ||
        /^(#{1,4})\s+/.test(nextTrimmed) ||
        next.startsWith("```") ||
        nextTrimmed.startsWith(">") ||
        /^\s*[-*+]\s+/.test(nextTrimmed) ||
        /^\s*\d+[.)]\s+/.test(nextTrimmed) ||
        (next.includes("|") && isTableSeparator(lines[i + 1] ?? ""))
      ) {
        break;
      }
      buffer.push(next);
      i += 1;
    }
    out.push(
      <p
        key={key++}
        className="text-[12.5px] leading-relaxed text-muted-foreground"
      >
        {inline(buffer.join(" "))}
      </p>,
    );
  }
  return <div className="space-y-2">{out}</div>;
}

/** Directory-relative file tree grouped by folder. */
function FileTree({
  root,
  files,
  active,
  onPick,
}: {
  root: string;
  files: readonly SkillFileEntry[];
  active: string;
  onPick: (path: string) => void;
}) {
  const dirs = useMemo(() => {
    const map = new Map<string, SkillFileEntry[]>();
    files.forEach((file) => {
      const index = file.path.lastIndexOf("/");
      const dir = index === -1 ? "" : file.path.slice(0, index);
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push(file);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [files]);

  return (
    <div className="tt-scroll h-full min-h-0 overflow-auto rounded-sm border border-border bg-surface-2/40 p-1.5">
      <div className="tt-num flex items-center gap-1.5 px-1.5 py-1 text-[11px] text-muted-foreground">
        <FolderTree className="size-3.5" />
        {root}/
      </div>
      {dirs.map(([dir, entries]) => (
        <div key={dir || "_root"}>
          {dir && (
            <div className="tt-num flex items-center gap-1.5 py-0.5 pl-4 text-[11px] text-muted-foreground/80">
              <FolderTree className="size-3" />
              {dir}/
            </div>
          )}
          {entries.map((file) => (
            <button
              key={file.path}
              type="button"
              onClick={() => onPick(file.path)}
              className={`tt-num flex w-full items-center gap-1.5 rounded-sm py-1 pr-2 text-left text-[11.5px] ${
                dir ? "pl-7" : "pl-4"
              } ${
                active === file.path
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
              }`}
            >
              <FileCode className="size-3 shrink-0" />
              <span className="truncate">{file.path.split("/").pop()}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkillDetailModal({
  skill,
  security,
  usableAgents,
  blacklisted,
  onClose,
  onSync,
  onRemove,
  onOpenSecurity,
  onToggleBlacklist,
}: {
  skill: LocalSkill;
  security?: SkillCardSecurity;
  usableAgents: readonly SkillAgent[];
  blacklisted: boolean;
  onClose: () => void;
  onSync: () => void;
  onRemove: () => void;
  onOpenSecurity: () => void;
  onToggleBlacklist: () => void;
}) {
  const { t, format } = useI18n();
  const [listing, setListing] = useState<{
    root: string;
    files: SkillFileEntry[];
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState("SKILL.md");
  const [raw, setRaw] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setListing(null);
    setLoadError(null);
    setActive("SKILL.md");
    void getSkillFiles({ data: { name: skill.name } })
      .then((result) => {
        if (cancelled) return;
        setListing({ root: result.root, files: [...result.files] });
        if (result.files.some((file) => file.path === "SKILL.md")) {
          setActive("SKILL.md");
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : t("common.failed");
        setLoadError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [skill.name, t]);

  const file =
    listing?.files.find((item) => item.path === active) ??
    listing?.files[0] ??
    null;
  const isMarkdown = file?.path.toLowerCase().endsWith(".md") ?? false;

  const installedAgents = skill.installations.map(
    (installation) => installation.agent,
  );
  const installedSet = new Set(installedAgents);
  const usableSet = new Set(usableAgents);
  const firstVersion =
    skill.installations.find((i) => i.version)?.version ?? null;

  const metrics: { key: string; label: string }[] = [
    {
      key:
        skill.lastUsedAt != null
          ? format.formatDateTime(skill.lastUsedAt, false)
          : t("skills.detail.noLastUsed"),
      label: t("skills.detail.lastUsedAt", { time: "" }).replace(/:$/, ""),
    },
    {
      key: `${installedSet.size} / ${usableSet.size}`,
      label: t("skills.detail.installedPos"),
    },
    {
      key: firstVersion ?? t("skills.detail.notProvided"),
      label: t("common.version"),
    },
    { key: formatSizeBytes(skill.sizeBytes), label: t("skills.card.size") },
  ];

  const exportCurrent = () => {
    if (!file) return;
    downloadTextFile(file.path.split("/").pop() ?? file.path, file.content);
  };

  const exportBundle = () => {
    if (!listing) return;
    listing.files.forEach((entry) =>
      downloadTextFile(
        entry.path.split("/").pop() ?? entry.path,
        entry.content,
      ),
    );
    toast.success(t("skills.toast.exportedTo", { path: listing.root }));
  };

  const verdict =
    security == null || !security.hasHistory
      ? "unknown"
      : security.riskCount > 0
        ? "warn"
        : "ok";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8 text-[15px] font-semibold">
            <span>
              {t("skills.detail.rootTitle", {
                root: listing?.root ?? skill.name,
              })}
            </span>
            {verdict === "ok" && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-ok/30 bg-ok/10 px-1.5 py-px text-[10px] text-ok">
                <ShieldCheck className="size-2.5" />{" "}
                {t("skills.security.clean")}
              </span>
            )}
            {verdict === "warn" && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-warn/30 bg-warn/10 px-1.5 py-px text-[10px] text-warn">
                <AlertTriangle className="size-2.5" />{" "}
                {t("skills.security.attention")}
              </span>
            )}
            {blacklisted && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-danger/30 bg-danger/10 px-1.5 py-px text-[10px] text-danger">
                <ShieldBan className="size-2.5" />{" "}
                {t("skills.badge.blacklisted")}
              </span>
            )}
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              {t("skills.detail.source", {
                source:
                  skill.installations[0]?.source?.kind === "market"
                    ? t("skills.source.market")
                    : skill.installations[0]?.source?.kind === "frontmatter"
                      ? t("skills.source.frontmatter")
                      : t("skills.source.unknown"),
              })}
              {" · "}
              {skill.installations[0]?.installedAt
                ? format.formatDateTime(
                    skill.installations[0].installedAt,
                    false,
                  )
                : t("skills.detail.notProvided")}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Metric strip */}
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-sm border border-border bg-surface-2/40 px-2.5 py-1.5"
            >
              <div className="tt-label text-[10px]">{metric.label}</div>
              <div
                className="tt-num mt-0.5 truncate text-[13px]"
                title={metric.key}
              >
                {metric.key}
              </div>
            </div>
          ))}
        </div>

        {/* File tree + content viewer (bounded row: long content scrolls, never overlaps footer) */}
        <div className="grid h-[46vh] min-h-[320px] grid-cols-[220px_1fr] grid-rows-[minmax(0,1fr)] gap-3">
          {listing ? (
            <FileTree
              root={listing.root}
              files={listing.files}
              active={file?.path ?? ""}
              onPick={setActive}
            />
          ) : loadError ? (
            <div className="tt-scroll h-full min-h-0 overflow-auto rounded-sm border border-border bg-surface-2/40 p-3 text-[11px] text-muted-foreground">
              {loadError}
            </div>
          ) : (
            <div className="grid h-full min-h-0 place-items-center rounded-sm border border-border bg-surface-2/40 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-sm border border-border bg-surface-2/30">
            <div className="flex h-8 shrink-0 items-center justify-between border-b border-border px-2.5">
              <span className="tt-num truncate text-[11px] text-muted-foreground">
                {listing ? `${listing.root}/${file?.path ?? ""}` : skill.name}
              </span>
              {isMarkdown && (
                <Segmented
                  value={raw ? "raw" : "render"}
                  onChange={(value) => setRaw(value === "raw")}
                  options={[
                    { value: "render", label: t("skills.detail.render") },
                    { value: "raw", label: t("skills.detail.sourceCode") },
                  ]}
                />
              )}
            </div>
            <div className="tt-scroll min-h-0 flex-1 overflow-auto p-3">
              {listing == null && loadError == null ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              ) : file ? (
                isMarkdown && !raw ? (
                  <Markdown text={file.content} />
                ) : (
                  <pre className="tt-num whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted-foreground">
                    {file.content}
                  </pre>
                )
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  {t("skills.detail.noDescription")}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Install position chips */}
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="tt-label">
              {t("skills.detail.installPos", {
                installed: installedSet.size,
                usable: usableSet.size,
              })}
            </span>
            <button
              type="button"
              onClick={onSync}
              className="text-[11px] text-primary hover:underline"
            >
              {t("skills.detail.syncToTools")}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SKILL_AGENTS.map((agent) => {
              const installed = installedSet.has(agent);
              const usable = usableSet.has(agent);
              return (
                <span
                  key={agent}
                  title={`${agent} · ${installed ? t("common.installed") : t("common.notInstalled")}`}
                  className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[11.5px] ${
                    !usable
                      ? "border-border text-muted-foreground/40"
                      : installed
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground"
                  }`}
                >
                  <span
                    className={`grid size-3 shrink-0 place-items-center rounded-sm border ${
                      installed
                        ? "border-primary bg-primary/30"
                        : "border-border"
                    } ${usable ? "" : "opacity-40"}`}
                  >
                    {installed && <Check className="size-2.5" />}
                  </span>
                  <BrandIcon
                    name={agent}
                    className={`size-3.5 ${usable ? "" : "opacity-40"}`}
                  />
                  {agent}
                  {!usable && (
                    <span className="text-[9px]">
                      · {t("common.notInstalled")}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>

        <DialogFooter className="mt-3 flex-wrap items-center gap-2">
          <div className="mr-auto flex flex-wrap gap-2">
            <TTButton size="sm" variant="ghost" onClick={onToggleBlacklist}>
              <ShieldBan className="size-3.5" />
              {blacklisted
                ? t("skills.actions.unblock")
                : t("skills.actions.block")}
            </TTButton>
            <TTButton size="sm" variant="ghost" onClick={onOpenSecurity}>
              <ShieldCheck className="size-3.5" />{" "}
              {t("skills.detail.scanSecurity")}
            </TTButton>
          </div>
          <TTButton size="sm" variant="ghost" onClick={exportCurrent}>
            <Download className="size-3.5" /> {t("skills.detail.exportFile")}
          </TTButton>
          <TTButton size="sm" variant="ghost" onClick={exportBundle}>
            <Download className="size-3.5" /> {t("skills.detail.exportDir")}
          </TTButton>
          <TTButton size="sm" variant="danger" onClick={onRemove}>
            <Trash2 className="size-3.5" /> {t("skills.actions.uninstall")}
          </TTButton>
          <TTButton size="sm" onClick={onSync}>
            <Download className="size-3.5" /> {t("skills.detail.syncToTools")}
          </TTButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
