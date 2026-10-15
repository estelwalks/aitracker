#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const RELEASE_WORKFLOW = ".github/workflows/release.yml";
export const PUBLISH_NPM_WORKFLOW = ".github/workflows/publish-npm.yml";

/** Step whose `run:` block reads the drafted release's asset list. */
const DRAFT_ASSET_STEP = "Verify the draft's assets and metadata agree";
/** Step that builds the GitHub release notes. */
const RELEASE_NOTES_STEP = "Prepare release notes";
/** Step that publishes the CLI package to npm. */
const PUBLISH_STEP = "Publish package";
/** Step that proves the dist-tag follows the release. */
const DIST_TAG_STEP = "Confirm the dist-tag follows this release";

/**
 * The release page is a short update summary, and since v1.0.6 it is bilingual:
 * the page carries `## What's changed` with the tag's English highlights and,
 * when the version has a `### 更新摘要` sub-section, `## 本次更新` with the
 * Chinese ones. Two regressions are worth failing on.
 *
 *  - Notes that no longer come from `scripts/changelog-release-notes.mjs`:
 *    the page then describes whichever release the template was written for,
 *    while the changelog section for the tag goes unread.
 *  - A step rewritten in English only: the highlights survive (the script emits
 *    them), but the beta warning and the download pointer — the copy the
 *    workflow itself writes — silently lose their Chinese half.
 */
export function inspectReleaseNotesStep({ workflow }) {
  const problems = [];
  const run = stepRunBlock({ workflow, step: RELEASE_NOTES_STEP });
  if (run === undefined) {
    problems.push(
      `${RELEASE_WORKFLOW}: "${RELEASE_NOTES_STEP}" step is missing; the release page would no longer carry the changelog summary`,
    );
    return problems;
  }
  if (!/scripts\/changelog-release-notes\.mjs/u.test(run)) {
    problems.push(
      `${RELEASE_WORKFLOW}: "${RELEASE_NOTES_STEP}" must build the notes with \`node scripts/changelog-release-notes.mjs --version "$version"\`; the release page is that version's CHANGELOG section, not a fixed template`,
    );
  }
  if (!/[\u3400-\u9fff]/u.test(run)) {
    problems.push(
      `${RELEASE_WORKFLOW}: "${RELEASE_NOTES_STEP}" carries no Chinese copy; the release page is bilingual, so its beta warning and download pointer need a Chinese half`,
    );
  }
  return problems;
}

/**
 * `GET /releases/tags/<tag>` serves published releases only and answers 404 for
 * a draft. The release workflow runs it while the release is still a draft, so
 * the lookup has to go through the release list instead — `gh release view
 * --json assets`. Reading it the wrong way failed the v1.0.5 assembly *after*
 * every installer had been built and uploaded, which reads as a build failure
 * and hides that the draft is complete and correct. The same mistake is
 * invisible to `verify-release-asset-agreement.test.mjs`, which feeds the guard
 * a local asset list and never exercises the command that produces it.
 */
export function inspectDraftAssetStep({ workflow }) {
  const problems = [];
  const run = stepRunBlock({ workflow, step: DRAFT_ASSET_STEP });
  if (run === undefined) {
    problems.push(
      `${RELEASE_WORKFLOW}: "${DRAFT_ASSET_STEP}" step is missing; the drafted assets are no longer compared with release-metadata.json`,
    );
    return problems;
  }
  if (/releases\/tags\//u.test(run)) {
    problems.push(
      `${RELEASE_WORKFLOW}: "${DRAFT_ASSET_STEP}" reads assets through releases/tags/, which answers 404 for a draft and fails the assembly after a successful build; use \`gh release view "$GITHUB_REF_NAME" --json assets\``,
    );
  }
  if (!/gh release view[^\n]*--json assets/u.test(run)) {
    problems.push(
      `${RELEASE_WORKFLOW}: "${DRAFT_ASSET_STEP}" must read the drafted assets with \`gh release view --json assets\``,
    );
  }
  return problems;
}

/**
 * Two separate failures, one root cause: trusted publishing issues an OIDC
 * token that authorizes `npm publish` and nothing else.
 *
 *  - A prerelease must be published with `--tag beta`. Without it npm puts the
 *    prerelease under `latest` as well, so a beta silently becomes what
 *    `npx @estelwalks/aitracker@latest` installs.
 *  - `npm dist-tag add` is an ordinary registry write that gets no trusted
 *    publishing token, so it fails with E401 — the tag cannot be moved after
 *    the fact and has to be right at publish time.
 */
export function inspectNpmPublishSteps({ workflow }) {
  const problems = [];
  const publish = stepRunBlock({ workflow, step: PUBLISH_STEP });
  if (publish === undefined) {
    problems.push(`${PUBLISH_NPM_WORKFLOW}: "${PUBLISH_STEP}" step is missing`);
  } else if (!/npm publish[^\n]*--tag\s+["']?\$\{?dist_tag\}?/u.test(publish)) {
    problems.push(
      `${PUBLISH_NPM_WORKFLOW}: "${PUBLISH_STEP}" must publish with \`--tag "$dist_tag"\`; a prerelease published without it also lands on latest`,
    );
  }

  const distTag = stepRunBlock({ workflow, step: DIST_TAG_STEP });
  if (distTag === undefined) {
    problems.push(
      `${PUBLISH_NPM_WORKFLOW}: "${DIST_TAG_STEP}" step is missing; nothing proves the dist-tag follows the release`,
    );
  } else {
    if (/npm dist-tag add/u.test(distTag)) {
      problems.push(
        `${PUBLISH_NPM_WORKFLOW}: "${DIST_TAG_STEP}" writes the dist-tag, which trusted publishing cannot authorize (E401); publish with \`--tag\` and assert the result with \`npm view\``,
      );
    }
    if (!/npm view[^\n]*\$\{?dist_tag\}?/u.test(distTag)) {
      problems.push(
        `${PUBLISH_NPM_WORKFLOW}: "${DIST_TAG_STEP}" must assert that the dist-tag resolves to this version with \`npm view "@estelwalks/aitracker@$dist_tag" version\``,
      );
    }
    // Two properties the v1.0.6 run needed and did not have. The assertion has
    // to run even when this run published nothing, or re-running the workflow
    // for a version npm already serves proves nothing; and it has to retry,
    // because the registry can answer with the previous dist-tag for a few
    // seconds after `npm publish` exits 0.
    if (!(distTag.includes("for attempt") && distTag.includes("sleep"))) {
      problems.push(
        `${PUBLISH_NPM_WORKFLOW}: "${DIST_TAG_STEP}" must retry the \`npm view\` read (a loop with a sleep); the registry can still answer with the previous dist-tag right after a successful publish`,
      );
    }
  }
  return problems;
}

/** Step that installs the built package inside a distribution container. */
const INSTALL_SMOKE_STEP = "Install the distribution package";
/** Step that installs the X tooling the runtime probe needs. */
const PROBE_TOOLING_STEP = "Install the probe tooling";

/**
 * The install-smoke matrix installs the package it just built on each target
 * distribution. Its first real run (the v1.0.6 tag) failed on two assumptions
 * that only a container can disprove:
 *
 *  - the package was chosen by testing for the RPM file, but the artifact
 *    carries all three Linux formats, so every image ran `dnf` — including
 *    Debian and Ubuntu, where it does not exist. The image's package manager
 *    has to decide.
 *  - the probe tooling was installed with Debian's package names. On the Red Hat
 *    family `x11-utils` does not exist (`xorg-x11-utils` on RHEL 9, separate
 *    packages on RHEL 10/Fedora), and `xdotool` is EPEL-only there.
 */
export function inspectInstallSmokeSteps({ workflow }) {
  const problems = [];
  const install = stepRunBlock({ workflow, step: INSTALL_SMOKE_STEP });
  if (install === undefined) {
    problems.push(
      `${RELEASE_WORKFLOW}: "${INSTALL_SMOKE_STEP}" step is missing; the built package is no longer installed on its target distributions`,
    );
  } else {
    if (!/command -v dnf/u.test(install)) {
      problems.push(
        `${RELEASE_WORKFLOW}: "${INSTALL_SMOKE_STEP}" must choose the package with \`command -v dnf\`; the downloaded artifact carries every Linux format, so a file test picks the RPM on a Debian image and fails with \`dnf: command not found\``,
      );
    }
    if (/\[\s*-f\s+packages\/[^\]]*\.rpm/u.test(install)) {
      problems.push(
        `${RELEASE_WORKFLOW}: "${INSTALL_SMOKE_STEP}" selects the RPM by file presence, which is true on every image`,
      );
    }
  }

  const tooling = stepRunBlock({ workflow, step: PROBE_TOOLING_STEP });
  if (tooling === undefined) {
    problems.push(
      `${RELEASE_WORKFLOW}: "${PROBE_TOOLING_STEP}" step is missing; the runtime probe would have no X server or window tooling`,
    );
  } else if (!/epel-release/u.test(tooling)) {
    problems.push(
      `${RELEASE_WORKFLOW}: "${PROBE_TOOLING_STEP}" must enable EPEL (\`dnf install -y epel-release\`) before \`xdotool\`, which the RHEL family does not ship in its base repositories`,
    );
  }
  return problems;
}

/**
 * Body of one step's `run:` block, matched by the step name so the checks stay
 * readable and cannot silently drift onto a neighbouring step. The step's own
 * text is bounded on both sides by the `- name:` lines around it — without an
 * upper bound the search would run on into the next step that has a block.
 * Both scalar styles are supported: `run: |` with an indented body, and the
 * single-line `run: npm publish …` a short step uses.
 */
export function stepRunBlock({ workflow, step }) {
  const lines = workflow.split(/\r?\n/u);
  const nameAt = lines.findIndex((line) =>
    new RegExp(`^\\s*-\\s*name:\\s*${escapeForRegExp(step)}\\s*$`, "u").test(
      line,
    ),
  );
  if (nameAt === -1) return undefined;
  const stepIndent = lines[nameAt].match(/^\s*/u)[0].length;
  const nextStepAt = lines.findIndex(
    (line, index) =>
      index > nameAt &&
      /^\s*-\s*name:\s*/u.test(line) &&
      line.match(/^\s*/u)[0].length === stepIndent,
  );
  const end = nextStepAt === -1 ? lines.length : nextStepAt;

  const runAt = lines.findIndex(
    (line, index) => index > nameAt && index < end && /^\s*run:\s*/u.test(line),
  );
  if (runAt === -1) return undefined;
  const [, ...rest] = lines[runAt].split(/run:\s*/u);
  const inline = rest.join("run: ").trim();
  if (inline !== "" && inline !== "|" && inline !== ">") {
    return inline;
  }
  // The body's own indentation is the first non-blank line after `run: |`;
  // a fixed key indent would swallow the rest of the step's keys when a step
  // declares `env:`/`shell:` at the same level as `run:`, as this workflow does.
  const firstBodyAt = lines.findIndex(
    (line, index) => index > runAt && index < end && line.trim() !== "",
  );
  if (firstBodyAt === -1) return undefined;
  const indent = lines[firstBodyAt].match(/^\s*/u)[0].length;
  const body = [];
  for (let index = firstBodyAt; index < end; index += 1) {
    const line = lines[index];
    if (line.trim() !== "" && line.match(/^\s*/u)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export async function verifyReleaseWorkflows({ rootDir = PROJECT_ROOT } = {}) {
  const releaseWorkflow = await readWorkflow(rootDir, RELEASE_WORKFLOW);
  const publishWorkflow = await readWorkflow(rootDir, PUBLISH_NPM_WORKFLOW);
  return [
    ...inspectDraftAssetStep({ workflow: releaseWorkflow }),
    ...inspectReleaseNotesStep({ workflow: releaseWorkflow }),
    ...inspectInstallSmokeSteps({ workflow: releaseWorkflow }),
    ...inspectNpmPublishSteps({ workflow: publishWorkflow }),
  ];
}

async function readWorkflow(rootDir, relativePath) {
  return readFile(join(rootDir, relativePath), "utf8");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const rootDir = process.argv[2] ? resolve(process.argv[2]) : PROJECT_ROOT;
    const problems = await verifyReleaseWorkflows({ rootDir });
    if (problems.length > 0) {
      for (const problem of problems) console.error(problem);
      console.error(
        `verify-release-workflows: FAIL (${problems.length} problem${problems.length === 1 ? "" : "s"})`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        "verify-release-workflows: PASS (draft lookup, bilingual release notes, install smoke, npm dist-tag)",
      );
    }
  } catch (error) {
    console.error(
      `verify-release-workflows: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
