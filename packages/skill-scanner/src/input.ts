import { readFileSync, readdirSync, statSync, type Stats } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ScanSkillReport, SkillFile } from "./types.js";

/** Mirrors ScanSkillRequestSchema `files` max length. */
export const MAX_FILES = 500;
/** Mirrors SkillFileSchema `content` max length. */
export const MAX_FILE_CONTENT_CHARS = 2_000_000;

export interface CollectedInput {
  files: SkillFile[];
  /** Files excluded from content scanning but retained for file-level size/count checks. */
  excludedFiles: SkillFile[];
  /** Absolute paths visible to the reference project tree and therefore to rules/models. */
  analysisPaths: string[];
  /** Reference route decision: a directory entry other than the sole SKILL.md makes this false. */
  singleSkillFile: boolean;
  skipped: ScanSkillReport["skippedFiles"];
}

const PROJECT_TREE_IGNORED_NAMES = new Set([
  "__pycache__", "node_modules", ".env", "dist", "build", "__init__.py", "test", "tests", ".git", ".github",
  "pyproject.toml", "LICENSE", "Dockerfile", ".DS_Store", "Thumbs.db",
]);
const PROJECT_TREE_IGNORED_SUFFIXES = [".log", ".pyc", ".pyo", ".so", ".dll", ".tmp"];

export function isProjectTreeIgnoredName(name: string): boolean {
  return PROJECT_TREE_IGNORED_NAMES.has(name) || PROJECT_TREE_IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export function isProjectTreeIgnoredPath(path: string): boolean {
  return path.split("/").some((part) => isProjectTreeIgnoredName(part));
}

/** Rejects the same unsafe shapes as `scanner.ts`'s `safePath` so the library never sees an invalid report path. */
export function isSafeRelativePath(p: string): boolean {
  return p.length > 0 && !p.includes("\0") && !p.includes("\\") && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && !p.split("/").some((part) => !part || part === "." || part === "..");
}

/** Like `isSafeRelativePath`, but also accepts absolute POSIX paths (leading `/`); rejects NUL, backslashes, drive letters, `..`, and empty segments. */
export function isSafePath(p: string): boolean {
  if (!p || p.includes("\0") || p.includes("\\") || /^[A-Za-z]:/.test(p)) return false;
  const parts = p.split("/");
  for (let i = parts[0] === "" ? 1 : 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part || part === "." || part === "..") return false;
  }
  return true;
}

export function detectBinary(buf: Buffer): boolean {
  const chunk = buf.subarray(0, 1024);
  if (chunk.includes(0)) return true;
  if (chunk.length === 0) return false;
  let nonText = 0;
  for (const byte of chunk) {
    const text = byte === 7 || byte === 8 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 27 || (byte >= 0x20 && byte !== 0x7f);
    if (!text) nonText += 1;
  }
  return nonText / chunk.length > 0.3;
}

interface WalkedFile { path: string; analysisVisible: boolean }

function walk(dir: string, ignored = false): WalkedFile[] {
  const out: WalkedFile[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    const analysisVisible = !ignored && !isProjectTreeIgnoredName(ent.name);
    if (ent.isDirectory()) out.push(...walk(p, !analysisVisible));
    else out.push({ path: p, analysisVisible });
  }
  return out;
}

/**
 * Reads file or directory paths from disk into the in-memory `files` contract.
 * Report paths are resolved to absolute disk paths. Binary, oversized and unsafe paths are
 * collected in `skipped` (never thrown) so the report can surface them as `partial`;
 * missing targets, too many files and empty scans throw.
 */
export async function collectPaths(paths: string[]): Promise<CollectedInput> {
  const files: SkillFile[] = [];
  const excludedFiles: SkillFile[] = [];
  const analysisPaths: string[] = [];
  const skipped: ScanSkillReport["skippedFiles"] = [];
  const seen = new Set<string>();
  let singleSkillFile = paths.length === 1;
  for (const target of paths) {
    let st: Stats;
    try { st = statSync(target); } catch { throw new Error(`path not found: ${target}`); }
    const isDir = st.isDirectory();
    if (isDir) {
      const entries = readdirSync(target);
      singleSkillFile &&= entries.length === 1 && entries[0] === "SKILL.md";
    } else {
      singleSkillFile &&= basename(target) === "SKILL.md";
    }
    const list = isDir ? walk(target) : [{ path: target, analysisVisible: true }];
    for (const item of list) {
      const file = item.path;
      const reportPath = resolve(file);
      if (!isSafePath(reportPath)) { skipped.push({ path: file, reason: "unsafe path" }); continue; }
      if (seen.has(reportPath)) { skipped.push({ path: reportPath, reason: "duplicate path" }); continue; }
      seen.add(reportPath);
      let buf: Buffer;
      try { buf = readFileSync(file); } catch (error) { skipped.push({ path: reportPath, reason: `unreadable file: ${(error as Error).message}` }); continue; }
      if (basename(file) === ".DS_Store") {
        if (files.length + excludedFiles.length >= MAX_FILES) throw new Error(`too many files: ${MAX_FILES} max`);
        files.push({ path: reportPath, content: "", isBinary: false, byteSize: buf.byteLength });
        continue;
      }
      if (detectBinary(buf)) {
        skipped.push({ path: reportPath, reason: "binary file was not scanned" });
        if (files.length + excludedFiles.length >= MAX_FILES) throw new Error(`too many files: ${MAX_FILES} max`);
        files.push({ path: reportPath, content: "", isBinary: true, byteSize: buf.byteLength });
        continue;
      }
      const content = buf.toString("utf-8");
      if (content.length > MAX_FILE_CONTENT_CHARS) {
        skipped.push({ path: reportPath, reason: "content exceeds 2,000,000 char limit" });
        if (files.length + excludedFiles.length >= MAX_FILES) throw new Error(`too many files: ${MAX_FILES} max`);
        excludedFiles.push({ path: reportPath, content: "", isBinary: false, byteSize: buf.byteLength });
        continue;
      }
      if (files.length + excludedFiles.length >= MAX_FILES) throw new Error(`too many files: ${MAX_FILES} max`);
      files.push({ path: reportPath, content, isBinary: false, byteSize: buf.byteLength });
      if (item.analysisVisible) analysisPaths.push(reportPath);
    }
  }
  if (files.length === 0 && excludedFiles.length === 0 && skipped.length === 0) throw new Error("no files found");
  return { files, excludedFiles, analysisPaths, singleSkillFile, skipped };
}
