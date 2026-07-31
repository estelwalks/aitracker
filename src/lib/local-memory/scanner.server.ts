import { createHash } from "node:crypto";
import { lstat, opendir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

import type { MemoryEntry, MemorySnapshot } from "./types.ts";

const MEMORY_FILE_NAMES = new Set([
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  "MEMORY.md",
  "memory.md",
  "copilot-instructions.md",
]);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILES = 500;
const MAX_DEPTH = 4;
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
]);

interface ScanMemoryOptions {
  homeDirectory?: string;
  currentDirectory?: string;
  customPaths?: string[];
  includeDefaults?: boolean;
  memoryExcludes?: string[];
}

function expandPath(path: string, homeDirectory: string): string {
  if (path === "~") return homeDirectory;
  if (path.startsWith("~/")) return join(homeDirectory, path.slice(2));
  return resolve(path);
}

export function markdownTitle(content: string, path: string): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || basename(path, extname(path));
}

export function markdownSummary(content: string): string {
  const normalized = content
    .replace(/^---[\s\S]*?---\s*/u, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > 180
    ? `${normalized.slice(0, 177)}…`
    : normalized || "空 Markdown 文件";
}

function sourceFor(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  if (normalizedPath.includes("/.claude/") || basename(path) === "CLAUDE.md")
    return "Claude Code";
  if (normalizedPath.includes("/.codex/") || basename(path) === "AGENTS.md")
    return "Codex";
  if (normalizedPath.includes("/.gemini/") || basename(path) === "GEMINI.md")
    return "Gemini CLI";
  return "自定义";
}

async function discoverFromPath(
  path: string,
  result: Set<string>,
  warnings: string[],
  depth = 0,
  acceptAllMarkdown = false,
  excludes: Set<string> = SKIPPED_DIRECTORIES,
): Promise<void> {
  if (result.size >= MAX_FILES || depth > MAX_DEPTH) return;
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink()) return;
    if (details.isFile()) {
      if (MEMORY_FILE_NAMES.has(basename(path)) || acceptAllMarkdown) {
        result.add(path);
      }
      return;
    }
    if (!details.isDirectory()) return;

    const directory = await opendir(path);
    for await (const entry of directory) {
      if (result.size >= MAX_FILES) break;
      if (entry.name.startsWith(".") && depth > 0) continue;
      if (excludes.has(entry.name)) continue;
      const child = join(path, entry.name);
      if (
        entry.isFile() &&
        (MEMORY_FILE_NAMES.has(entry.name) ||
          (acceptAllMarkdown && extname(entry.name).toLowerCase() === ".md"))
      ) {
        result.add(child);
      } else if (entry.isDirectory()) {
        await discoverFromPath(
          child,
          result,
          warnings,
          depth + 1,
          acceptAllMarkdown,
          excludes,
        );
      }
    }
  } catch (error) {
    warnings.push(
      `${path}: ${error instanceof Error ? error.message : "无法读取"}`,
    );
  }
}

export async function scanLocalMemory(
  options: ScanMemoryOptions = {},
): Promise<MemorySnapshot> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const currentDirectory = options.currentDirectory ?? process.cwd();
  const defaults = [
    join(homeDirectory, "CLAUDE.md"),
    join(homeDirectory, "AGENTS.md"),
    join(homeDirectory, ".claude", "CLAUDE.md"),
    join(homeDirectory, ".codex", "AGENTS.md"),
    join(homeDirectory, ".gemini", "GEMINI.md"),
    currentDirectory,
  ];
  const defaultPaths = options.includeDefaults === false ? [] : defaults;
  const customPaths = (options.customPaths ?? []).map((path) =>
    expandPath(path, homeDirectory),
  );
  const requested = [...defaultPaths, ...customPaths];
  const files = new Set<string>();
  const warnings: string[] = [];

  const mergedExcludes = new Set(SKIPPED_DIRECTORIES);
  for (const dir of options.memoryExcludes ?? []) {
    if (dir.trim()) mergedExcludes.add(dir.trim());
  }

  for (const path of [...new Set(defaultPaths)]) {
    await discoverFromPath(path, files, warnings, 0, false, mergedExcludes);
  }
  for (const path of [...new Set(customPaths)]) {
    await discoverFromPath(path, files, warnings, 0, true, mergedExcludes);
  }

  const entries: MemoryEntry[] = [];
  for (const path of files) {
    try {
      const details = await stat(path);
      if (details.size > MAX_FILE_BYTES) {
        warnings.push(`${path}: 超过 1MB，已跳过`);
        continue;
      }
      const content = await readFile(path, "utf8");
      entries.push({
        id: createHash("sha256").update(path).digest("hex").slice(0, 16),
        title: markdownTitle(content, path),
        summary: markdownSummary(content),
        content,
        source: sourceFor(path),
        project: basename(dirname(path)),
        path,
        modifiedAt: details.mtime.toISOString(),
      });
    } catch (error) {
      warnings.push(
        `${path}: ${error instanceof Error ? error.message : "无法读取"}`,
      );
    }
  }

  entries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return {
    generatedAt: new Date().toISOString(),
    scannedPaths: [...new Set(requested)],
    entries,
    warnings,
  };
}
