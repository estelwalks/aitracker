import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

import type { ReportContentStore, ReportDocument } from "../contracts.ts";

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.md$/;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

function validateBody(body: string): void {
  if (body.includes("\0")) throw new TypeError("report body is invalid");
  if (Buffer.byteLength(body, "utf8") > MAX_MARKDOWN_BYTES)
    throw new TypeError("report body is too large");
}

function safePath(rootDirectory: string, contentFile: string): string {
  if (!SAFE_FILE.test(contentFile) || basename(contentFile) !== contentFile)
    throw new TypeError("report content file is invalid");
  const root = resolve(rootDirectory);
  const target = resolve(root, contentFile);
  if (!target.startsWith(`${root}${sep}`))
    throw new TypeError("report content path escapes its root");
  return target;
}

function fileNameFor(
  document: ReportDocument,
  revision = randomUUID(),
): string {
  const day = document.generatedAt.slice(0, 10).replace(/[^0-9-]/g, "");
  const kind = document.definitionId === "reports.weekly" ? "weekly" : "daily";
  const id = document.reportId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);
  return `${day || "report"}-${kind}-${id}-${revision}.md`;
}

async function atomicWrite(path: string, body: string): Promise<void> {
  validateBody(body);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    // `path` contains a fresh UUID and therefore does not exist. This avoids
    // platform-specific occupied-target rename semantics (notably Windows).
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export function createMarkdownReportStore(options: {
  readonly rootDirectory: string;
}): ReportContentStore {
  const rootDirectory = resolve(options.rootDirectory);
  return {
    async create(document, body) {
      await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
      const contentFile = fileNameFor(document);
      await atomicWrite(safePath(rootDirectory, contentFile), body);
      return contentFile;
    },
    async read(contentFile) {
      const handle = await open(
        safePath(rootDirectory, contentFile),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        return await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
    },
    async replace(document, body) {
      await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
      const contentFile = fileNameFor(document);
      await atomicWrite(safePath(rootDirectory, contentFile), body);
      return contentFile;
    },
  };
}

export const reportMarkdownLimits = { maxBytes: MAX_MARKDOWN_BYTES } as const;
