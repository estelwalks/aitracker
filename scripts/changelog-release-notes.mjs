#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SECTION_PATTERN = /^## \[([^\]]+)\](?:[^\n]*)$/u;

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
  while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
  while (body.length > 0 && body[0].trim() === "") body.shift();
  if (body.length === 0)
    throw new Error(
      `CHANGELOG.md "## [${version}]" section is empty; release notes would be blank`,
    );
  return `${body.join("\n")}\n`;
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
