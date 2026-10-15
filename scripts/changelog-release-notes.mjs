#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SECTION_PATTERN = /^## \[([^\]]+)\](?:[^\n]*)$/u;
/** Sub-heading whose content is what users read on the GitHub release page. */
const HIGHLIGHTS_PATTERN = /^### +Highlights *$/u;
/**
 * Chinese counterpart of `### Highlights`. The release page is bilingual, so a
 * version that carries this sub-section publishes its list as `## 本次更新`
 * right after the English one; a version without it stays English-only.
 */
const ZH_HIGHLIGHTS_PATTERN = /^### +更新摘要 *$/u;
const SUB_HEADING_PATTERN = /^### /u;

/** Headings the published notes carry, in page order. */
const CHANGED_HEADING = "## What's changed";
const ZH_CHANGED_HEADING = "## 本次更新";

function trimBlankEdges(lines) {
  const body = [...lines];
  while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
  while (body.length > 0 && body[0].trim() === "") body.shift();
  return body;
}

/**
 * Body of one `### ` sub-section, without its heading.
 *
 * A leading blockquote is an editorial note (what the sub-section is for), not
 * something a user should read on the release page, so those lines are dropped.
 * An empty sub-section returns an empty list and the caller decides whether
 * that is an error, because "no such sub-section" and "an empty one" mean
 * different things for the release page.
 */
function readSubSection(section, heading) {
  const at = section.findIndex((line) => heading.test(line));
  if (at === -1) return undefined;
  const body = [];
  for (let index = at + 1; index < section.length; index += 1) {
    if (SUB_HEADING_PATTERN.test(section[index])) break;
    body.push(section[index]);
  }
  return trimBlankEdges(body.filter((line) => !/^> /u.test(line)));
}

/**
 * Release notes for one version, taken from CHANGELOG.md.
 *
 * The GitHub release page is an update summary, not a second copy of the
 * changelog, so a section may carry a `### Highlights` sub-section listing the
 * user-visible changes in short form, plus an optional `### 更新摘要` with the
 * same list in Chinese. Both are published, the English list first, each under
 * its own heading (`## What's changed` / `## 本次更新`), so the page reads as
 * two language versions of one short summary and stays useful to either
 * audience.
 *
 * When there is no `### Highlights` at all, the whole section is used instead,
 * which keeps a version written before this convention releasable rather than
 * shipping an empty release. A Chinese sub-section without the English list is
 * a mistake rather than a supported shape: it would publish Chinese bullets
 * inside the English body.
 */
export function extractReleaseNotes(changelog, version) {
  if (typeof changelog !== "string")
    throw new Error("changelog must be a string");
  if (typeof version !== "string" || version.length === 0)
    throw new Error("version is required");

  const lines = changelog.split(/\r?\n/u);
  const start = lines.findIndex((line) => {
    const match = SECTION_PATTERN.exec(line);
    return match !== null && match[1] === version;
  });
  if (start === -1)
    throw new Error(
      `CHANGELOG.md has no "## [${version}]" section; add it before tagging`,
    );

  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (SECTION_PATTERN.test(lines[index])) break;
    body.push(lines[index]);
  }
  const section = trimBlankEdges(body);
  if (section.length === 0)
    throw new Error(
      `CHANGELOG.md "## [${version}]" section is empty; release notes would be blank`,
    );

  const highlights = readSubSection(section, HIGHLIGHTS_PATTERN);
  const chinese = readSubSection(section, ZH_HIGHLIGHTS_PATTERN);

  if (highlights === undefined) {
    if (chinese !== undefined)
      throw new Error(
        `CHANGELOG.md "## [${version}]" has a "### 更新摘要" without a "### Highlights" section; the English list is what the release page leads with`,
      );
    return notesPage([CHANGED_HEADING, "", ...section]);
  }

  if (highlights.length === 0)
    throw new Error(
      `CHANGELOG.md "## [${version}]" has an empty "### Highlights" section; move the summary or remove the heading`,
    );
  const notes = [CHANGED_HEADING, "", ...highlights];
  if (chinese !== undefined) {
    if (chinese.length === 0)
      throw new Error(
        `CHANGELOG.md "## [${version}]" has an empty "### 更新摘要" section; translate the highlights or remove the heading`,
      );
    notes.push("", ZH_CHANGED_HEADING, "", ...chinese);
  }
  return notesPage(notes);
}

function notesPage(lines) {
  return `${trimBlankEdges(lines).join("\n")}\n`;
}

export function parseReleaseNotesArgs(argv) {
  const options = {
    version: undefined,
    changelog: join(PROJECT_ROOT, "CHANGELOG.md"),
    output: undefined,
  };
  const valueOptions = new Set(["--version", "--changelog", "--output"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [maybeName, inlineValue] = arg.split("=", 2);
    if (!valueOptions.has(maybeName)) throw new Error(`unknown option: ${arg}`);
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`${maybeName} requires a value`);
    const key = maybeName
      .slice(2)
      .replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    options[key] = value;
  }
  if (!options.version) throw new Error("--version is required");
  return options;
}

export async function writeReleaseNotes({ version, changelog, output }) {
  const text = await readFile(changelog, "utf8");
  const notes = extractReleaseNotes(text, version);
  if (output === undefined || output === "-") {
    process.stdout.write(notes);
    return notes;
  }
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), notes, "utf8");
  return notes;
}

// Path comparison instead of `file://${process.argv[1]}`: on Windows
// import.meta.url is `file:///D:/...` while the naive interpolation produces
// `file://D:\...`, so the entry block would never run.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const options = parseReleaseNotesArgs(process.argv.slice(2));
    await writeReleaseNotes(options);
  } catch (error) {
    console.error(
      `changelog-release-notes: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
