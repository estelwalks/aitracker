import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PUBLISH_NPM_WORKFLOW,
  RELEASE_WORKFLOW,
  inspectDraftAssetStep,
  inspectNpmPublishSteps,
  inspectReleaseNotesStep,
  verifyReleaseWorkflows,
} from "./verify-release-workflows.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "verify-release-workflows.mjs",
);
const REPOSITORY_ROOT = join(dirname(SCRIPT), "..");

const RELEASE_WORKFLOW_BODY = [
  "name: Release",
  "jobs:",
  "  draft-release:",
  "    steps:",
  "      - name: Verify the draft's assets and metadata agree",
  "        env:",
  "          GH_TOKEN: ${{ github.token }}",
  "        shell: bash",
  "        run: |",
  "          gh release view \"$GITHUB_REF_NAME\" --json assets --jq '[.assets[].name]' > drafted-assets.json",
  '          gh release download "$GITHUB_REF_NAME" --pattern release-metadata.json --output drafted-release-metadata.json --clobber',
  "          node scripts/verify-release-asset-agreement.mjs --assets drafted-assets.json --metadata drafted-release-metadata.json",
  "      - name: Confirm draft outcome",
  '        run: echo "draft created"',
  "      - name: Prepare release notes",
  "        shell: bash",
  "        run: |",
  '          version="${GITHUB_REF_NAME#v}"',
  '          node scripts/changelog-release-notes.mjs --version "$version" --output - >> release-notes.md',
  "          cat >> release-notes.md <<'EOF'",
  "",
  "          ## Download",
  "",
  "          安装包见下方附件。",
  "          EOF",
  "",
].join("\n");

// The command v1.0.5 actually ran: `releases/tags/` answers 404 for a draft,
// so the step failed after all four installers had been built and uploaded.
const RELEASE_WORKFLOW_READING_TAGS = RELEASE_WORKFLOW_BODY.replace(
  "gh release view \"$GITHUB_REF_NAME\" --json assets --jq '[.assets[].name]' > drafted-assets.json",
  "gh api \"repos/${GITHUB_REPOSITORY}/releases/tags/${GITHUB_REF_NAME}\" --jq '[.assets[].name]' > drafted-assets.json",
);

// Notes built from a fixed template rather than the tag's changelog section:
// the page then describes whichever release the template was written for.
const RELEASE_WORKFLOW_TEMPLATE_NOTES = RELEASE_WORKFLOW_BODY.replace(
  'node scripts/changelog-release-notes.mjs --version "$version" --output - >> release-notes.md',
  'echo "## What is new" >> release-notes.md',
);

// The highlights still arrive (the script emits them), but the copy the
// workflow itself writes loses its Chinese half.
const RELEASE_WORKFLOW_ENGLISH_ONLY_NOTES = RELEASE_WORKFLOW_BODY.replace(
  "          安装包见下方附件。",
  "          Installers are attached below.",
);

const PUBLISH_WORKFLOW_BODY = [
  "name: Publish CLI to npm",
  "jobs:",
  "  publish:",
  "    steps:",
  "      - name: Publish package",
  "        if: steps.existing.outputs.published == 'false'",
  '        run: npm publish ./packages/cli --provenance --access public --tag "$dist_tag"',
  "      - name: Confirm the dist-tag follows this release",
  "        shell: bash",
  "        run: |",
  '          resolved="$(npm view "@estelwalks/aitracker@${dist_tag}" version)"',
  '          echo "$dist_tag resolves to $resolved" >> "$GITHUB_STEP_SUMMARY"',
  "",
].join("\n");

const PUBLISH_WORKFLOW_WITHOUT_TAG = PUBLISH_WORKFLOW_BODY.replace(
  ' --tag "$dist_tag"',
  "",
);

// The write trusted publishing cannot authorize (E401). Replacing the
// assertion with it breaks both rules: the tag is written, and nothing proves
// where it points.
const PUBLISH_WORKFLOW_WRITING_DIST_TAG = PUBLISH_WORKFLOW_BODY.replace(
  '          resolved="$(npm view "@estelwalks/aitracker@${dist_tag}" version)"',
  '          npm dist-tag add "@estelwalks/aitracker@${version}" "$dist_tag"',
);

async function fixtureRoot({
  release = RELEASE_WORKFLOW_BODY,
  publish = PUBLISH_WORKFLOW_BODY,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "aitracker-release-workflows-"));
  const workflows = join(root, ".github", "workflows");
  await mkdir(workflows, { recursive: true });
  await writeFile(join(workflows, "release.yml"), release, "utf8");
  await writeFile(join(workflows, "publish-npm.yml"), publish, "utf8");
  return root;
}

test("the shipped workflows read drafts and assert the npm dist-tag", async () => {
  assert.deepEqual(
    await verifyReleaseWorkflows({ rootDir: REPOSITORY_ROOT }),
    [],
  );
});

test("reading assets through releases/tags/ is reported as a draft-blind lookup", () => {
  const problems = inspectDraftAssetStep({
    workflow: RELEASE_WORKFLOW_READING_TAGS,
  });
  // Two rules fire on this mutation: the endpoint is draft-blind, and it is not
  // the `gh release view --json assets` read the step is required to use.
  assert.equal(problems.length, 2);
  assert.match(problems[0], /answers 404 for a draft/u);
  assert.match(problems[0], /gh release view/u);
  assert.match(problems[1], /must read the drafted assets with/u);
});

test("a dropped draft-asset step is reported instead of silently skipping", () => {
  const problems = inspectDraftAssetStep({ workflow: "name: Release\n" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /step is missing/u);
});

test("notes built from a template instead of the changelog are reported", () => {
  const problems = inspectReleaseNotesStep({
    workflow: RELEASE_WORKFLOW_TEMPLATE_NOTES,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /CHANGELOG section, not a fixed template/u);
});

test("an English-only notes step is reported as half a bilingual page", () => {
  const problems = inspectReleaseNotesStep({
    workflow: RELEASE_WORKFLOW_ENGLISH_ONLY_NOTES,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /need a Chinese half/u);
});

test("a dropped notes step is reported instead of silently skipping", () => {
  const problems = inspectReleaseNotesStep({ workflow: "name: Release\n" });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /step is missing/u);
});

test("publishing without --tag is reported", () => {
  const problems = inspectNpmPublishSteps({
    workflow: PUBLISH_WORKFLOW_WITHOUT_TAG,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /--tag/u);
  assert.match(problems[0], /also lands on latest/u);
});

test("writing the dist-tag is reported as unauthorized under trusted publishing", () => {
  const problems = inspectNpmPublishSteps({
    workflow: PUBLISH_WORKFLOW_WRITING_DIST_TAG,
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /E401/u);
  assert.match(problems[0], /npm view/u);
  assert.match(problems[1], /dist-tag resolves to this version/u);
});

test("the npm workflow is checked even when the release workflow is clean", async () => {
  const root = await fixtureRoot({ publish: PUBLISH_WORKFLOW_WITHOUT_TAG });
  try {
    const problems = await verifyReleaseWorkflows({ rootDir: root });
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(PUBLISH_NPM_WORKFLOW, "u"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a missing workflow is reported rather than skipped", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-release-workflows-"));
  try {
    await assert.rejects(() => verifyReleaseWorkflows({ rootDir: root }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI reports problems and exits non-zero", async () => {
  const root = await fixtureRoot({ release: RELEASE_WORKFLOW_READING_TAGS });
  try {
    const result = spawnSync(process.execPath, [SCRIPT, root], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /verify-release-workflows: FAIL/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI exits zero on the shipped workflows", () => {
  const result = spawnSync(process.execPath, [SCRIPT, REPOSITORY_ROOT], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /verify-release-workflows: PASS/u);
});

// The guard reads the same files the release run does; if either path moves,
// every check above would pass vacuously against a missing file.
test("the guard names the workflows the repository actually ships", async () => {
  const { access } = await import("node:fs/promises");
  for (const relativePath of [RELEASE_WORKFLOW, PUBLISH_NPM_WORKFLOW]) {
    await access(join(REPOSITORY_ROOT, relativePath));
  }
});
