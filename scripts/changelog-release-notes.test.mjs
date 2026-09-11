import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  extractReleaseNotes,
  parseReleaseNotesArgs,
  writeReleaseNotes,
} from "./changelog-release-notes.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "changelog-release-notes.mjs",
);
const CHANGELOG = join(dirname(SCRIPT), "..", "CHANGELOG.md");

const SAMPLE = [
  "# Changelog",
  "",
  "## [Unreleased]",
  "",
  "- work in progress",
  "",
  "## [1.0.2] - 2026-09-10",
  "",
  "- second release note",
  "- another note",
  "",
  "## [1.0.1] - 2026-09-08",
  "",
  "- older note",
  "",
].join("\n");

test("the CLI entry point actually runs when invoked as a script", () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--version is required/);
});

test("extracts only the requested version section without its heading", () => {
  assert.equal(
    extractReleaseNotes(SAMPLE, "1.0.2"),
    "- second release note\n- another note\n",
  );
});

test("stops at the next section, so unreleased work never leaks into notes", () => {
  assert.equal(
    extractReleaseNotes(SAMPLE, "Unreleased"),
    "- work in progress\n",
  );
  assert.doesNotMatch(extractReleaseNotes(SAMPLE, "1.0.2"), /older note/u);
});

test("a missing or empty section is an error instead of blank notes", () => {
  assert.throws(
    () => extractReleaseNotes(SAMPLE, "9.9.9"),
    /no "## \[9\.9\.9\]"/u,
  );
  assert.throws(
    () => extractReleaseNotes("## [1.0.3]\n\n## [1.0.2]\n", "1.0.3"),
    /is empty/u,
  );
  assert.throws(() => extractReleaseNotes(SAMPLE, ""), /version is required/u);
});

test("a Highlights sub-section is what gets published", () => {
  const withHighlights = [
    "## [1.0.2] - 2026-09-10",
    "",
    "### Highlights",
    "",
    "- Short user-facing line",
    "- Another short line",
    "",
    "### Details",
    "",
    "- Long internal note that stays in the changelog",
    "",
    "## [1.0.1] - 2026-09-08",
    "",
    "- older",
  ].join("\n");
  assert.equal(
    extractReleaseNotes(withHighlights, "1.0.2"),
    "- Short user-facing line\n- Another short line\n",
  );
  assert.doesNotMatch(
    extractReleaseNotes(withHighlights, "1.0.2"),
    /Long internal note/u,
  );
});

test("without highlights the whole section is still published", () => {
  assert.equal(
    extractReleaseNotes(SAMPLE, "1.0.2"),
    "- second release note\n- another note\n",
  );
});

test("a blockquote note above the highlights is not published", () => {
  const noted = [
    "## [1.0.2] - 2026-09-10",
    "",
    "### Highlights",
    "",
    "> Editorial note for maintainers",
    "",
    "- User-facing line",
    "",
    "## [1.0.1] - 2026-09-08",
  ].join("\n");
  const notes = extractReleaseNotes(noted, "1.0.2");
  assert.equal(notes, "- User-facing line\n");
  assert.doesNotMatch(notes, /Editorial note/u);
});

test("an empty Highlights heading is an error, not a blank release", () => {
  const empty = "## [1.0.2]\n\n### Highlights\n\n## [1.0.1]\n\n- older\n";
  assert.throws(
    () => extractReleaseNotes(empty, "1.0.2"),
    /empty "### Highlights"/u,
  );
});

test("parses options and rejects unknown flags", () => {
  assert.deepEqual(
    parseReleaseNotesArgs(["--version", "1.0.2"]).version,
    "1.0.2",
  );
  assert.equal(
    parseReleaseNotesArgs(["--version=1.0.2", "--output=-"]).output,
    "-",
  );
  assert.throws(
    () => parseReleaseNotesArgs(["--version"]),
    /requires a value/u,
  );
  assert.throws(() => parseReleaseNotesArgs(["--wat", "1"]), /unknown option/u);
});

/**
 * The changelog carries work in `## [Unreleased]` and only gets a numbered
 * section at release time, when the whole section is retitled and tagged (see
 * docs/RELEASE_CHECKLIST.md). So the invariant is not "package.json's version
 * has a section" - in development it deliberately does not, and asking for its
 * notes before the tag is prepared is the error the release job relies on.
 *
 * What must hold: every section the changelog *does* carry is a dated release
 * section with extractable, non-blank notes, so a tag can never publish blank
 * or malformed notes.
 */
test("every versioned section in the repository changelog is extractable", async () => {
  const changelog = await readFile(CHANGELOG, "utf8");
  const headings = [...changelog.matchAll(/^## \[([^\]]+)\](.*)$/gmu)].map(
    (match) => ({ version: match[1], suffix: match[2].trim() }),
  );
  assert.ok(headings.length >= 4, `expected sections, saw ${headings.length}`);

  const versions = [];
  for (const heading of headings) {
    if (heading.version === "Unreleased") {
      // Work in progress: no date, and it is never published under that name.
      assert.equal(heading.suffix, "", "Unreleased must not carry a date");
      continue;
    }
    assert.match(
      heading.suffix,
      /^-\s\d{4}-\d{2}-\d{2}$/u,
      `## [${heading.version}] must be dated when it becomes a release section`,
    );
    const notes = extractReleaseNotes(changelog, heading.version);
    assert.match(
      notes,
      /\S/u,
      `## [${heading.version}] would publish blank release notes`,
    );
    versions.push(heading.version);
  }

  // The published set is exactly what the tags say; 1.0.4 must not appear here
  // until it is released, or it reads as shipped while it is not.
  assert.ok(versions.includes("1.0.3"), "the last release must be listed");
  assert.equal(
    versions.includes("1.0.4"),
    false,
    "1.0.4 is unreleased: its work belongs under Unreleased until it is tagged",
  );
});

test("writes notes to a file and rejects an unpublished version", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aitracker-notes-test-"));
  try {
    const changelogPath = join(directory, "CHANGELOG.md");
    await writeFile(changelogPath, SAMPLE, "utf8");
    const output = join(directory, "nested", "release-notes.md");
    await writeReleaseNotes({
      version: "1.0.2",
      changelog: changelogPath,
      output,
    });
    assert.equal(
      await readFile(output, "utf8"),
      "- second release note\n- another note\n",
    );
    await assert.rejects(
      writeReleaseNotes({ version: "9.9.9", changelog: changelogPath, output }),
      /no "## \[9\.9\.9\]"/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
