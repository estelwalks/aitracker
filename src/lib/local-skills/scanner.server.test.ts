import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { APP_DATA_DIR } from "../app-config";

import {
  assertTargetToolInstalled,
  batchUninstallLocalSkills,
  installMarketSkill as installMarketSkillWithState,
  readSkillFiles as readSkillFilesWithState,
  refreshMarketSkillEvidence as refreshMarketSkillEvidenceWithState,
  scanLocalSkills as scanLocalSkillsWithState,
  SKILL_ROOT_SUFFIXES,
  syncLocalSkill as syncLocalSkillWithState,
  type SkillStateRepository,
  uninstallLocalSkill,
} from "./scanner.server.ts";

let origins = { version: 1 as const, installations: {} } as Awaited<
  ReturnType<SkillStateRepository["readOrigins"]>
>;
let blacklist: string[] = [];
const testState: SkillStateRepository = {
  async readOrigins() {
    return structuredClone(origins);
  },
  async writeOrigins(value) {
    origins = structuredClone(value);
  },
  async readBlacklist() {
    return [...blacklist];
  },
  async writeBlacklist(value) {
    blacklist = [...value];
  },
};
const originKey = (path: string) =>
  createHash("sha256").update(resolve(path)).digest("hex");

const scanLocalSkills = (
  options: Parameters<typeof scanLocalSkillsWithState>[0] = {},
) => scanLocalSkillsWithState({ ...options, stateRepository: testState });
const installMarketSkill = (
  input: Parameters<typeof installMarketSkillWithState>[0],
  options: Parameters<typeof installMarketSkillWithState>[1] = {},
) =>
  installMarketSkillWithState(input, {
    ...options,
    stateRepository: testState,
  });
const refreshMarketSkillEvidence = (
  options: Parameters<typeof refreshMarketSkillEvidenceWithState>[0] = {},
) =>
  refreshMarketSkillEvidenceWithState({
    ...options,
    stateRepository: testState,
  });
const syncLocalSkill = (
  input: Parameters<typeof syncLocalSkillWithState>[0],
  options: Parameters<typeof syncLocalSkillWithState>[1] = {},
) => syncLocalSkillWithState(input, { ...options, stateRepository: testState });
const readSkillFiles = (
  name: Parameters<typeof readSkillFilesWithState>[0],
  options: Parameters<typeof readSkillFilesWithState>[1] = {},
) => readSkillFilesWithState(name, { ...options, stateRepository: testState });

test("scans common agent roots without treating mtime as usage evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const claudeSkill = join(root, SKILL_ROOT_SUFFIXES["Claude Code"], "example");
  const codexSkill = join(root, SKILL_ROOT_SUFFIXES["Codex"], "example");
  const aipySkill = join(root, SKILL_ROOT_SUFFIXES["AiPy"], "example");
  await mkdir(claudeSkill, { recursive: true });
  await mkdir(codexSkill, { recursive: true });
  await mkdir(aipySkill, { recursive: true });
  await writeFile(join(claudeSkill, "SKILL.md"), "# Example");
  await writeFile(join(codexSkill, "SKILL.md"), "# Example");
  await writeFile(join(aipySkill, "SKILL.md"), "# Example");

  const snapshot = await scanLocalSkills({
    homeDirectory: root,
    dataDirectory,
    now: new Date(),
  });

  // All verified Skill installation targets are exposed, including AiPy.
  assert.equal(Object.keys(snapshot.roots).length, 10);
  assert.equal(snapshot.agents["AiPy"].installed, true);
  assert.equal(snapshot.skills.length, 1);
  assert.equal(snapshot.skills[0].installations.length, 3);
  // No structured call evidence: mtime is not treated as usage evidence.
  assert.equal(snapshot.skills[0].lastUsedAt, null);
});

test("detects an installed Agent even when its skill directory is empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-agent-"));
  try {
    // .codex is the installation probe root; .codex/skills intentionally does
    // not exist, proving the market target is not inferred from Skill rows.
    await mkdir(join(root, ".codex"), { recursive: true });
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory: join(root, APP_DATA_DIR),
    });
    assert.equal(snapshot.skills.length, 0);
    assert.equal(snapshot.agents["Codex"].installed, true);
    assert.ok(
      snapshot.agents["Codex"].detectedPaths.includes(join(root, ".codex")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses structured Skill calls as the only activity evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-usage-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const skillPath = join(root, SKILL_ROOT_SUFFIXES["Codex"], "example");
  await mkdir(skillPath, { recursive: true });
  await writeFile(join(skillPath, "SKILL.md"), "# Example");

  const snapshot = await scanLocalSkills({
    homeDirectory: root,
    dataDirectory,
    now: new Date("2026-07-28T12:00:00.000Z"),
    usageEvents: [
      {
        source: "codex",
        timestamp: "2026-07-28T10:00:00.000Z",
        model: "test",
        project: "test",
        inputTokens: 10,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 15,
        context: { skills: [{ name: "example", calls: 5 }] },
      },
    ],
  });

  assert.equal(snapshot.skills[0]?.lastUsedAt, "2026-07-28T10:00:00.000Z");
});

test("reads real version and source from SKILL.md frontmatter and changes fingerprint", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const skillPath = join(root, SKILL_ROOT_SUFFIXES["Codex"], "versioned");
  try {
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nversion: 1.2.3\nsource: https://example.com/versioned\n---\n# Versioned\n",
    );
    const first = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    assert.equal(first.skills[0]?.installations[0]?.version, "1.2.3");
    assert.equal(
      first.skills[0]?.installations[0]?.source?.kind,
      "frontmatter",
    );
    assert.equal(
      first.skills[0]?.installations[0]?.source?.url,
      "https://example.com/versioned",
    );

    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nversion: 1.2.4\nsource: https://example.com/versioned\n---\n# Versioned\n",
    );
    const second = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    assert.equal(second.skills[0]?.installations[0]?.version, "1.2.4");
    assert.notEqual(second.fingerprint, first.fingerprint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marks an update only when persisted market evidence is truly newer", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const skillPath = join(root, SKILL_ROOT_SUFFIXES["Codex"], "market-skill");
  try {
    await mkdir(skillPath, { recursive: true });
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nversion: 1.0.0\n---\n# Market\n",
    );
    origins = {
      version: 1,
      installations: {
        [originKey(skillPath)]: {
          source: {
            kind: "market",
            label: "owner/repo",
            url: "https://github.com/owner/repo",
            repoOwner: "owner",
            repoName: "repo",
            repoPath: "skills/market-skill/SKILL.md",
            slug: "market-skill",
          },
          installedAt: "2026-01-01T00:00:00.000Z",
          localVersion: "1.0.0",
          installedRemoteVersion: "1.0.0",
          installedRemoteUpdatedAt: "2026-01-01T00:00:00.000Z",
          latestRemoteVersion: "1.1.0",
          latestRemoteUpdatedAt: "2026-02-01T00:00:00.000Z",
          checkedAt: "2026-02-01T00:00:00.000Z",
        },
      },
    } as typeof origins;

    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    const installation = snapshot.skills[0]?.installations[0];
    assert.equal(installation?.source?.kind, "market");
    assert.equal(installation?.updateStatus, "available");
    assert.match(installation?.updateReason ?? "", /1.1.0/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refreshes matching market evidence without inventing missing fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  await mkdir(dataDirectory, { recursive: true });
  origins = {
    version: 1,
    installations: {
      [originKey("/tmp/example")]: {
        source: {
          kind: "market",
          label: "owner/repo",
          url: "https://github.com/owner/repo",
          repoOwner: "owner",
          repoName: "repo",
          repoPath: "skills/example/SKILL.md",
          slug: "example",
        },
        installedAt: "2026-01-01T00:00:00.000Z",
        localVersion: "1.0.0",
        installedRemoteVersion: "1.0.0",
        installedRemoteUpdatedAt: "2026-01-01T00:00:00.000Z",
        latestRemoteVersion: "1.0.0",
        latestRemoteUpdatedAt: "2026-01-01T00:00:00.000Z",
        checkedAt: "2026-01-01T00:00:00.000Z",
      },
    },
  } as typeof origins;
  try {
    const changed = await refreshMarketSkillEvidence({
      dataDirectory,
      force: true,
      now: new Date("2026-03-01T00:00:00.000Z"),
      fetcher: async () =>
        Response.json({
          data: [
            {
              slug: "example",
              repo_owner: "owner",
              repo_name: "repo",
              updated_at: "2026-02-01T00:00:00.000Z",
            },
          ],
        }),
    });
    assert.equal(changed, true);
    const persisted = await testState.readOrigins();
    assert.equal(
      persisted.installations[originKey("/tmp/example")].latestRemoteVersion,
      null,
    );
    assert.equal(
      persisted.installations[originKey("/tmp/example")].latestRemoteUpdatedAt,
      "2026-02-01T00:00:00.000Z",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installs a validated market skill from the controlled temporary directory", async () => {
  const name = `contract-${randomUUID()}`;
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-market-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const sourcePath = join(dataDirectory, "tmp", `market-${randomUUID()}`, name);
  const targetPath = join(root, SKILL_ROOT_SUFFIXES["Codex"], name);
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(
      join(sourcePath, "SKILL.md"),
      "---\nversion: 2.3.4\n---\n# Contract",
    );

    await installMarketSkill(
      {
        sourcePath,
        targetAgent: "Codex",
        origin: {
          name,
          slug: name,
          repoOwner: "owner",
          repoName: "repo",
          repoPath: `skills/${name}/SKILL.md`,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      },
      { homeDirectory: root, dataDirectory },
    );

    const installed = await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(targetPath, "SKILL.md"), "utf8"),
    );
    assert.match(installed, /version: 2.3.4/);
    const persisted = await testState.readOrigins();
    assert.equal(
      persisted.installations[originKey(targetPath)].localVersion,
      "2.3.4",
    );
    assert.equal(
      persisted.installations[originKey(targetPath)].source.slug,
      name,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a market source outside the controlled temporary directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-market-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  await mkdir(join(dataDirectory, "tmp"), { recursive: true });
  const sourcePath = await mkdtemp(join(tmpdir(), "market-outside-"));
  try {
    await writeFile(join(sourcePath, "SKILL.md"), "# Outside");
    await assert.rejects(
      installMarketSkill(
        { sourcePath, targetAgent: "Codex" },
        { homeDirectory: root, dataDirectory },
      ),
      /errors\.skills\.sourceOutsideTemp/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(sourcePath, { recursive: true, force: true });
  }
});

test("rejects symbolic links anywhere in a market skill source", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-market-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const marketRoot = join(dataDirectory, "tmp", `market-${randomUUID()}`);
  const sourcePath = join(marketRoot, `symlink-${randomUUID()}`);
  const linkedFile = join(marketRoot, "linked.md");
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, "SKILL.md"), "# Symlink");
    if (process.platform === "win32") {
      // Windows junctions are reparse-point links and do not require the
      // Developer Mode/admin privilege required by file symlinks.
      await mkdir(linkedFile);
      await writeFile(join(linkedFile, "payload.txt"), "linked");
      await symlink(linkedFile, join(sourcePath, "reference.md"), "junction");
    } else {
      await writeFile(linkedFile, "linked");
      await symlink(linkedFile, join(sourcePath, "reference.md"));
    }

    await assert.rejects(
      installMarketSkill(
        { sourcePath, targetAgent: "Codex" },
        { homeDirectory: root, dataDirectory },
      ),
      /errors\.skills\.marketSourceSymlink/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads description from SKILL.md frontmatter block scalars", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-desc-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const foldedPath = join(root, SKILL_ROOT_SUFFIXES["Codex"], "folded-skill");
  const literalPath = join(
    root,
    SKILL_ROOT_SUFFIXES["Claude Code"],
    "literal-skill",
  );
  try {
    await mkdir(foldedPath, { recursive: true });
    await mkdir(literalPath, { recursive: true });
    await writeFile(
      join(foldedPath, "SKILL.md"),
      "---\nversion: 1.0.0\ndescription: >\n  This is a\n  folded description.\n---\n# Folded\n",
    );
    await writeFile(
      join(literalPath, "SKILL.md"),
      "---\nversion: 1.0.0\ndescription: |\n  This is a\n  literal description.\n---\n# Literal\n",
    );
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    const folded = snapshot.skills.find((s) => s.name === "folded-skill");
    const literal = snapshot.skills.find((s) => s.name === "literal-skill");
    assert.equal(folded?.description, "This is a folded description.");
    assert.equal(literal?.description, "This is a\nliteral description.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects an empty batch uninstall operation", async () => {
  await assert.rejects(
    batchUninstallLocalSkills([]),
    /errors.skills.noSkillSelected/,
  );
});

test("uninstalls a skill via batch uninstall (moved to trash) and collects failures", async () => {
  const name = `uninstall-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-op-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const skillPath = join(root, SKILL_ROOT_SUFFIXES["Codex"], name);
  try {
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), "# Test");

    const result = await batchUninstallLocalSkills(
      [skillPath, "/tmp/nonexistent-aitracker-skill"],
      { homeDirectory: root, dataDirectory },
    );
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.failed.length, 1);
    assert.equal(
      result.failed[0].errorCode,
      "errors.skills.pathOutsideManaged",
    );

    // Original location is gone, and the skill now lives in the trash with a
    // manifest record (recoverable instead of permanently deleted).
    await assert.rejects(lstat(skillPath));
    const trashDir = join(dataDirectory, "trash", "skills");
    const entries = await readdir(trashDir);
    assert.ok(entries.some((entry) => entry.startsWith(`${name}-`)));
    const manifest = await readFile(join(trashDir, "manifest.jsonl"), "utf8");
    assert.match(manifest, /"action":"uninstall"/);
    assert.match(manifest, new RegExp(name));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects uninstall of a collection directory without a marker", async () => {
  const name = `collection-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-op-"));
  const collectionPath = join(root, SKILL_ROOT_SUFFIXES["Claude Code"], name);
  const childPath = join(collectionPath, "child-skill");
  try {
    await mkdir(childPath, { recursive: true });
    await writeFile(join(childPath, "SKILL.md"), "# Child");

    // A marker-less collection directory (like `~/.claude/skills/development`)
    // must never be treated as a single skill to uninstall.
    await assert.rejects(
      uninstallLocalSkill(collectionPath, { homeDirectory: root }),
      /errors\.skills\.notManagedDir/,
    );
    // Its children are untouched.
    await stat(join(childPath, "SKILL.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("syncLocalSkill refuses to overwrite its own source path", async () => {
  const name = `selfsync-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-op-"));
  const sourcePath = join(root, SKILL_ROOT_SUFFIXES["Claude Code"], name);
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, "SKILL.md"), "# Self");

    const result = await syncLocalSkill(
      {
        sourcePath,
        targetAgents: ["Claude Code"],
        onConflict: "overwrite",
      },
      { homeDirectory: root },
    );
    assert.equal(result.succeeded.length, 0);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].errorCode, "errors.skills.overlappingPaths");
    // The source survives.
    await stat(join(sourcePath, "SKILL.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("syncLocalSkill copies a skill to a target agent with no conflict", async () => {
  const name = `sync-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-op-"));
  const sourcePath = join(root, SKILL_ROOT_SUFFIXES["Claude Code"], name);
  const targetPath = join(root, SKILL_ROOT_SUFFIXES["Codex"], name);
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(
      join(sourcePath, "SKILL.md"),
      `---\nversion: 1.0.0\ndescription: A sync test skill\n---\n# ${name}\n`,
    );

    const result = await syncLocalSkill(
      {
        sourcePath,
        targetAgents: ["Codex"],
        onConflict: "skip",
      },
      { homeDirectory: root },
    );
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.succeeded[0].agent, "Codex");
    assert.equal(result.succeeded[0].path, targetPath);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failed.length, 0);

    // Verify the file was copied.
    const content = await readFile(join(targetPath, "SKILL.md"), "utf8");
    assert.match(content, /version: 1\.0\.0/);
    assert.match(content, /A sync test skill/);

    // Verify description is read from frontmatter after sync.
    const snapshot = await scanLocalSkills({ homeDirectory: root });
    const synced = snapshot.skills.find((s) => s.name === name);
    assert.equal(synced?.description, "A sync test skill");
    // Claude Code source + Codex target.
    assert.equal(synced?.installations.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("syncLocalSkill skips on conflict when onConflict is skip", async () => {
  const name = `sync-skip-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-op-"));
  const sourcePath = join(root, SKILL_ROOT_SUFFIXES["Claude Code"], name);
  const targetPath = join(root, SKILL_ROOT_SUFFIXES["Codex"], name);
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(
      join(sourcePath, "SKILL.md"),
      `---\nversion: 2.0.0\n---\n# Source\n`,
    );
    await mkdir(targetPath, { recursive: true });
    await writeFile(
      join(targetPath, "SKILL.md"),
      `---\nversion: 1.0.0\n---\n# Original\n`,
    );

    const result = await syncLocalSkill(
      {
        sourcePath,
        targetAgents: ["Codex"],
        onConflict: "skip",
      },
      { homeDirectory: root },
    );
    assert.equal(result.succeeded.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].agent, "Codex");
    assert.equal(result.skipped[0].reason, "conflict");
    assert.equal(result.failed.length, 0);

    // Verify the target still has the original content.
    const content = await readFile(join(targetPath, "SKILL.md"), "utf8");
    assert.match(content, /version: 1\.0\.0/);
    assert.match(content, /Original/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("syncLocalSkill overwrites on conflict when onConflict is overwrite", async () => {
  const name = `sync-overwrite-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-op-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const sourcePath = join(root, SKILL_ROOT_SUFFIXES["Claude Code"], name);
  const targetPath = join(root, SKILL_ROOT_SUFFIXES["Codex"], name);
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(
      join(sourcePath, "SKILL.md"),
      `---\nversion: 2.0.0\ndescription: Overwritten by sync\n---\n# Source\n`,
    );
    await mkdir(targetPath, { recursive: true });
    await writeFile(
      join(targetPath, "SKILL.md"),
      `---\nversion: 1.0.0\ndescription: Original target\n---\n# Original\n`,
    );

    const result = await syncLocalSkill(
      {
        sourcePath,
        targetAgents: ["Codex"],
        onConflict: "overwrite",
      },
      { homeDirectory: root, dataDirectory },
    );
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.succeeded[0].agent, "Codex");
    assert.equal(result.succeeded[0].path, targetPath);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failed.length, 0);

    // Verify the target now has the source content (replaced).
    const content = await readFile(join(targetPath, "SKILL.md"), "utf8");
    assert.match(content, /version: 2\.0\.0/);
    assert.match(content, /Overwritten by sync/);

    // The replaced version went to the trash instead of being destroyed.
    const trashDir = join(dataDirectory, "trash", "skills");
    const entries = await readdir(trashDir);
    assert.ok(entries.some((entry) => entry.startsWith(`${name}-`)));
    const manifest = await readFile(join(trashDir, "manifest.jsonl"), "utf8");
    assert.match(manifest, /"action":"overwrite"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers nested skills two levels deep without treating containers as skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-nested-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const skillPath = join(
    root,
    SKILL_ROOT_SUFFIXES["Claude Code"],
    "development",
    "agile-feature-dev",
  );
  try {
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: agile-feature-dev\n---\n# Agile\n",
    );
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0]?.name, "agile-feature-dev");
    // The installation path keeps the nested `development/` segment.
    assert.equal(snapshot.skills[0]?.installations[0]?.path, skillPath);
    // The marker-less container directory itself is not a skill.
    assert.ok(snapshot.skills.every((skill) => skill.name !== "development"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ignores bare markdown files as skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-readme-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const claudeRoot = join(root, SKILL_ROOT_SUFFIXES["Claude Code"]);
  try {
    await mkdir(join(claudeRoot, "development"), { recursive: true });
    // Root-level README.md and a README.md inside a marker-less nested dir.
    await writeFile(join(claudeRoot, "README.md"), "# readme");
    await writeFile(join(claudeRoot, "development", "README.md"), "# nested");
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    assert.equal(snapshot.skills.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recognizes the lowercase skill.md marker and reads its frontmatter", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-lower-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const skillPath = join(
    root,
    SKILL_ROOT_SUFFIXES["Claude Code"],
    "lowercase-marker",
  );
  try {
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "skill.md"),
      "---\nname: lower-skill\ndescription: lowercase marker works\n---\n# Lower\n",
    );
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0]?.name, "lower-skill");
    assert.equal(snapshot.skills[0]?.description, "lowercase marker works");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reads the frontmatter form field for 形态 classification", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-form-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  try {
    await mkdir(join(root, SKILL_ROOT_SUFFIXES["Claude Code"], "wf-pack"), {
      recursive: true,
    });
    await mkdir(join(root, SKILL_ROOT_SUFFIXES["Claude Code"], "plain"), {
      recursive: true,
    });
    await mkdir(join(root, SKILL_ROOT_SUFFIXES["Claude Code"], "a-prompt"), {
      recursive: true,
    });
    await writeFile(
      join(root, SKILL_ROOT_SUFFIXES["Claude Code"], "wf-pack", "SKILL.md"),
      "---\nname: wf-pack\nform: workflow-package\n---\n# W\n",
    );
    await writeFile(
      join(root, SKILL_ROOT_SUFFIXES["Claude Code"], "plain", "SKILL.md"),
      "---\nname: plain\n---\n# P\n",
    );
    await writeFile(
      join(root, SKILL_ROOT_SUFFIXES["Claude Code"], "a-prompt", "SKILL.md"),
      "---\nname: a-prompt\nform: prompt\n---\n# P\n",
    );
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    const byName = new Map(snapshot.skills.map((s) => [s.name, s.form]));
    assert.equal(byName.get("wf-pack"), "workflow");
    assert.equal(byName.get("a-prompt"), "prompt");
    assert.equal(byName.get("plain"), "package");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops descending at maxDepth 3", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-depth-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const claudeRoot = join(root, SKILL_ROOT_SUFFIXES["Claude Code"]);
  try {
    // a/b/c/SKILL.md sits at depth 3 and must be found.
    await mkdir(join(claudeRoot, "a", "b", "c"), { recursive: true });
    await writeFile(join(claudeRoot, "a", "b", "c", "SKILL.md"), "# depth3");
    // x/y/z/w/SKILL.md sits at depth 4 and must not be found.
    await mkdir(join(claudeRoot, "x", "y", "z", "w"), { recursive: true });
    await writeFile(
      join(claudeRoot, "x", "y", "z", "w", "SKILL.md"),
      "# depth4",
    );
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    const names = snapshot.skills.map((skill) => skill.name);
    assert.ok(names.includes("c"), "depth-3 skill must be discovered");
    assert.ok(!names.includes("w"), "depth-4 skill must not be discovered");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prefers frontmatter name over the directory name", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-name-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const claudeRoot = join(root, SKILL_ROOT_SUFFIXES["Claude Code"]);
  try {
    await mkdir(join(claudeRoot, "foo"), { recursive: true });
    await writeFile(
      join(claudeRoot, "foo", "SKILL.md"),
      "---\nname: renamed\n---\n# Foo\n",
    );
    await mkdir(join(claudeRoot, "bar"), { recursive: true });
    await writeFile(join(claudeRoot, "bar", "SKILL.md"), "# Bar\n");
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    const names = snapshot.skills.map((skill) => skill.name);
    assert.ok(names.includes("renamed"), "frontmatter name wins over dir name");
    assert.ok(
      names.includes("bar"),
      "dir name is used without frontmatter name",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skips dot-prefixed and symlinked skill directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-hidden-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const claudeRoot = join(root, SKILL_ROOT_SUFFIXES["Claude Code"]);
  try {
    await mkdir(join(claudeRoot, ".system"), { recursive: true });
    await writeFile(join(claudeRoot, ".system", "SKILL.md"), "# hidden");
    const realSkill = join(claudeRoot, "real");
    await mkdir(realSkill, { recursive: true });
    await writeFile(join(realSkill, "SKILL.md"), "# real");
    if (process.platform === "win32") {
      await symlink(realSkill, join(claudeRoot, "linked"), "junction");
    } else {
      await symlink(realSkill, join(claudeRoot, "linked"));
    }
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    const names = snapshot.skills.map((skill) => skill.name);
    assert.ok(names.includes("real"));
    assert.ok(!names.includes(".system"), "dot-prefixed dirs must be skipped");
    assert.ok(!names.includes("linked"), "symlinked dirs must be skipped");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scans the newly verified agent roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-newagents-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  try {
    // hermes / openclaw / cursor roots are HOME-relative.
    const hermes = join(root, ".hermes", "skills", "h1");
    const openclaw = join(root, ".openclaw", "workspace", "skills", "o1");
    const cursor = join(root, ".cursor", "skills", "c1");
    // grok's base is overridable via GROK_HOME: join(GROK_HOME, "skills").
    const grok = join(root, ".grok", "skills", "g1");
    for (const skillPath of [hermes, openclaw, cursor, grok]) {
      await mkdir(skillPath, { recursive: true });
      await writeFile(join(skillPath, "SKILL.md"), "# Skill");
    }
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
      env: { GROK_HOME: join(root, ".grok") },
    });
    const names = snapshot.skills.map((skill) => skill.name);
    for (const expected of ["h1", "o1", "c1", "g1"]) {
      assert.ok(names.includes(expected), `${expected} must be discovered`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scans both antigravity skill roots as one agent with two installations", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-antigravity-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  try {
    const first = join(root, ".gemini", "antigravity", "skills", "agi-skill");
    const second = join(
      root,
      ".gemini",
      "antigravity-ide",
      "skills",
      "agi-skill",
    );
    for (const skillPath of [first, second]) {
      await mkdir(skillPath, { recursive: true });
      await writeFile(
        join(skillPath, "SKILL.md"),
        "---\nname: agi-skill\n---\n# A\n",
      );
    }
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
    });
    const skill = snapshot.skills.find(
      (candidate) => candidate.name === "agi-skill",
    );
    assert.equal(skill?.installations.length, 2);
    assert.ok(
      skill?.installations.every(
        (installation) => installation.agent === "Antigravity",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("env overrides redirect codex and grok roots; empty values fall back to HOME", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-envhome-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const envRoot = await mkdtemp(join(tmpdir(), "aitracker-skills-env-"));
  try {
    await mkdir(join(envRoot, "skills", "codex-skill"), { recursive: true });
    await writeFile(join(envRoot, "skills", "codex-skill", "SKILL.md"), "# c");
    await mkdir(join(envRoot, "skills", "grok-skill"), { recursive: true });
    await writeFile(join(envRoot, "skills", "grok-skill", "SKILL.md"), "# g");

    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
      env: { CODEX_HOME: envRoot, GROK_HOME: envRoot },
    });
    assert.deepEqual(snapshot.roots["Codex"], [join(envRoot, "skills")]);
    assert.deepEqual(snapshot.roots["Grok Build"], [join(envRoot, "skills")]);
    const names = snapshot.skills.map((skill) => skill.name);
    assert.ok(names.includes("codex-skill"));
    assert.ok(names.includes("grok-skill"));

    // Empty-string env values are treated as unset and fall back to HOME.
    const fallback = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
      env: { CODEX_HOME: "", GROK_HOME: "" },
    });
    assert.deepEqual(fallback.roots["Codex"], [join(root, ".codex", "skills")]);
    assert.deepEqual(fallback.roots["Grok Build"], [
      join(root, ".grok", "skills"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(envRoot, { recursive: true, force: true });
  }
});

test("resolves default codex and grok roots under HOME without env overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-defaultroots-"));
  try {
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory: join(root, APP_DATA_DIR),
    });
    assert.deepEqual(snapshot.roots["Codex"], [join(root, ".codex", "skills")]);
    assert.deepEqual(snapshot.roots["Grok Build"], [
      join(root, ".grok", "skills"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall accepts nested managed paths and rejects traversal escapes", async () => {
  const name = `nested-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-op-"));
  const claudeRoot = join(root, SKILL_ROOT_SUFFIXES["Claude Code"]);
  const nestedPath = join(claudeRoot, "development", name);
  try {
    await mkdir(nestedPath, { recursive: true });
    await writeFile(join(nestedPath, "SKILL.md"), "# Nested");

    const result = await uninstallLocalSkill(nestedPath, {
      homeDirectory: root,
    });
    assert.equal(result.path, nestedPath);
    await assert.rejects(lstat(nestedPath));

    // `development/../escape` traverses outside the nested dir: rejected.
    const traversalPath = `${join(claudeRoot, "development")}/../escape`;
    await assert.rejects(
      uninstallLocalSkill(traversalPath, { homeDirectory: root }),
      /errors\.skills\.pathOutsideManaged/,
    );

    // A symlink inside the root pointing outside is rejected by realpath.
    const linked = join(claudeRoot, `escape-${randomUUID().slice(0, 8)}`);
    const outside = await mkdtemp(join(tmpdir(), "aitracker-outside-"));
    try {
      try {
        await symlink(outside, linked);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }
      await assert.rejects(
        uninstallLocalSkill(linked, { homeDirectory: root }),
        /errors\.skills\.symlinkEscape/,
      );
    } finally {
      await rm(linked, { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("syncLocalSkill flattens a nested source skill into the codex root", async () => {
  const name = `sync-nested-${randomUUID().slice(0, 8)}`;
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-op-"));
  const claudeRoot = join(root, SKILL_ROOT_SUFFIXES["Claude Code"]);
  const sourcePath = join(claudeRoot, "development", name);
  const targetPath = join(root, SKILL_ROOT_SUFFIXES["Codex"], name);
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(
      join(sourcePath, "SKILL.md"),
      "---\nversion: 1.0.0\ndescription: Nested sync source\n---\n# Nested\n",
    );

    const result = await syncLocalSkill(
      {
        sourcePath,
        targetAgents: ["Codex"],
        onConflict: "skip",
      },
      { homeDirectory: root },
    );
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.succeeded[0].agent, "Codex");
    // The nested path is flattened to <root>/<name> at the target agent.
    assert.equal(result.succeeded[0].path, targetPath);

    const content = await readFile(join(targetPath, "SKILL.md"), "utf8");
    assert.match(content, /version: 1\.0\.0/);
    assert.match(content, /Nested/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("measures skill size/token and reads the real file tree via readSkillFiles", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-read-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  const skillDir = join(
    root,
    SKILL_ROOT_SUFFIXES["Claude Code"],
    "file-reader",
  );
  const referencesDir = join(skillDir, "references");
  await mkdir(referencesDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: file-reader\ndescription: Reads files\n---\n# File reader\n",
  );
  await writeFile(
    join(referencesDir, "usage.md"),
    "# Usage\n\nRead and report.",
  );
  await writeFile(join(skillDir, "assets.bin"), "x".repeat(1024));

  try {
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
      now: new Date(),
    });
    const skill = snapshot.skills.find((item) => item.name === "file-reader");
    assert.ok(skill, "scan exposes the skill");
    // Byte size counts every file (including assets.bin); token estimate only
    // reflects readable text (SKILL.md + references/usage.md).
    assert.ok(skill.sizeBytes >= 1024, "size includes the binary asset");
    assert.ok(skill.tokenEstimate > 0, "token estimate reflects text files");

    const listing = await readSkillFiles("file-reader", {
      homeDirectory: root,
      dataDirectory,
    });
    assert.equal(listing.name, "file-reader");
    assert.equal(listing.root, "file-reader");
    const paths = listing.files
      .map((file) => file.path.replaceAll("\\", "/"))
      .sort();
    assert.deepEqual(paths, ["SKILL.md", "references/usage.md"]);
    const manifest = listing.files.find((file) => file.path === "SKILL.md");
    assert.match(manifest?.content ?? "", /# File reader/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readSkillFiles rejects unknown skills and traversal-shaped names", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skills-read-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  try {
    await assert.rejects(
      readSkillFiles("does-not-exist", { homeDirectory: root, dataDirectory }),
    );
    await assert.rejects(
      readSkillFiles("../escape", { homeDirectory: root, dataDirectory }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects installing into a tool that is not actually installed", async () => {
  const previousPath = process.env.PATH;
  const binDir = await mkdtemp(join(tmpdir(), "aitracker-bin-"));
  const cursorBin = join(binDir, "cursor");
  try {
    await writeFile(cursorBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    process.env.PATH = binDir;
    // There is an executable file: it is considered installed and the verification passes.
    await assertTargetToolInstalled("Cursor");

    // After removing the executable file: the IDE tool (Cursor) is not installed and must be rejected with a clear prompt.
    await rm(cursorBin);
    await assert.rejects(
      assertTargetToolInstalled("Cursor"),
      /errors\.skills\.toolNotInstalled/,
    );

    // The CLI tool (Codex) does not perform hard verification of executable files to avoid accidental damage to files that have been installed but the CLI is not present.
    // PATH tools.
    await assertTargetToolInstalled("Codex");
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(binDir, { recursive: true, force: true });
  }
});
