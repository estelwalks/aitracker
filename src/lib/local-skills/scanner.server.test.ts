import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";

import {
  batchUninstallLocalSkills,
  installMarketSkill,
  refreshMarketSkillEvidence,
  scanLocalSkills,
  SKILL_ROOT_SUFFIXES,
  syncLocalSkill,
  uninstallLocalSkill,
} from "./scanner.server.ts";

test("scans common agent roots without treating mtime as usage evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-"));
  const trusttoolsDirectory = join(root, ".trusttools");
  const claudeSkill = join(root, SKILL_ROOT_SUFFIXES["Claude Code"], "example");
  const codexSkill = join(root, SKILL_ROOT_SUFFIXES["Codex CLI"], "example");
  await mkdir(claudeSkill, { recursive: true });
  await mkdir(codexSkill, { recursive: true });
  await writeFile(join(claudeSkill, "SKILL.md"), "# Example");
  await writeFile(join(codexSkill, "SKILL.md"), "# Example");

  const snapshot = await scanLocalSkills({
    homeDirectory: root,
    trusttoolsDirectory,
    now: new Date(),
  });

  // All nine verified Skill installation targets are exposed.
  assert.equal(Object.keys(snapshot.roots).length, 9);
  assert.equal(snapshot.skills.length, 1);
  assert.equal(snapshot.skills[0].installations.length, 2);
  // No structured call evidence: mtime is not treated as usage evidence.
  assert.equal(snapshot.skills[0].lastUsedAt, null);
});

test("detects an installed Agent even when its skill directory is empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-agent-"));
  try {
    // .codex is the installation probe root; .codex/skills intentionally does
    // not exist, proving the market target is not inferred from Skill rows.
    await mkdir(join(root, ".codex"), { recursive: true });
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      trusttoolsDirectory: join(root, ".trusttools"),
    });
    assert.equal(snapshot.skills.length, 0);
    assert.equal(snapshot.agents["Codex CLI"].installed, true);
    assert.deepEqual(snapshot.agents["Codex CLI"].detectedPaths, [
      join(root, ".codex"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses structured Skill calls as the only activity evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-usage-"));
  const trusttoolsDirectory = join(root, ".trusttools");
  const skillPath = join(root, SKILL_ROOT_SUFFIXES["Codex CLI"], "example");
  await mkdir(skillPath, { recursive: true });
  await writeFile(join(skillPath, "SKILL.md"), "# Example");

  const snapshot = await scanLocalSkills({
    homeDirectory: root,
    trusttoolsDirectory,
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
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-"));
  const trusttoolsDirectory = join(root, ".trusttools");
  const skillPath = join(root, SKILL_ROOT_SUFFIXES["Codex CLI"], "versioned");
  try {
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nversion: 1.2.3\nsource: https://example.com/versioned\n---\n# Versioned\n",
    );
    const first = await scanLocalSkills({
      homeDirectory: root,
      trusttoolsDirectory,
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
      trusttoolsDirectory,
    });
    assert.equal(second.skills[0]?.installations[0]?.version, "1.2.4");
    assert.notEqual(second.fingerprint, first.fingerprint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("marks an update only when persisted market evidence is truly newer", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-"));
  const trusttoolsDirectory = join(root, ".trusttools");
  const skillPath = join(
    root,
    SKILL_ROOT_SUFFIXES["Codex CLI"],
    "market-skill",
  );
  try {
    await mkdir(skillPath, { recursive: true });
    await mkdir(trusttoolsDirectory, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nversion: 1.0.0\n---\n# Market\n",
    );
    await writeFile(
      join(trusttoolsDirectory, "skill-origins.json"),
      JSON.stringify({
        version: 1,
        installations: {
          [skillPath]: {
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
      }),
    );

    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      trusttoolsDirectory,
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
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-"));
  const trusttoolsDirectory = join(root, ".trusttools");
  const originsPath = join(trusttoolsDirectory, "skill-origins.json");
  await mkdir(trusttoolsDirectory, { recursive: true });
  await writeFile(
    originsPath,
    JSON.stringify({
      version: 1,
      installations: {
        "/tmp/example": {
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
    }),
  );
  try {
    const changed = await refreshMarketSkillEvidence({
      trusttoolsDirectory,
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
    const persisted = JSON.parse(await readFile(originsPath, "utf8")) as {
      installations: Record<
        string,
        {
          latestRemoteVersion: string | null;
          latestRemoteUpdatedAt: string | null;
        }
      >;
    };
    assert.equal(
      persisted.installations["/tmp/example"].latestRemoteVersion,
      null,
    );
    assert.equal(
      persisted.installations["/tmp/example"].latestRemoteUpdatedAt,
      "2026-02-01T00:00:00.000Z",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installs a validated market skill from the controlled temporary directory", async () => {
  const name = `contract-${randomUUID()}`;
  const sourcePath = join(
    homedir(),
    ".trusttools",
    "tmp",
    `market-${randomUUID()}`,
    name,
  );
  const targetPath = join(homedir(), SKILL_ROOT_SUFFIXES["Codex CLI"], name);
  const trusttoolsDirectory = await mkdtemp(
    join(tmpdir(), "trusttools-origin-"),
  );
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(
      join(sourcePath, "SKILL.md"),
      "---\nversion: 2.3.4\n---\n# Contract",
    );

    await installMarketSkill(
      {
        sourcePath,
        targetAgent: "Codex CLI",
        origin: {
          name,
          slug: name,
          repoOwner: "owner",
          repoName: "repo",
          repoPath: `skills/${name}/SKILL.md`,
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      },
      { trusttoolsDirectory },
    );

    const installed = await import("node:fs/promises").then(({ readFile }) =>
      readFile(join(targetPath, "SKILL.md"), "utf8"),
    );
    assert.match(installed, /version: 2.3.4/);
    const origins = JSON.parse(
      await readFile(join(trusttoolsDirectory, "skill-origins.json"), "utf8"),
    ) as {
      installations: Record<
        string,
        { localVersion: string; source: { slug: string } }
      >;
    };
    assert.equal(origins.installations[targetPath].localVersion, "2.3.4");
    assert.equal(origins.installations[targetPath].source.slug, name);
  } finally {
    await rm(join(sourcePath, ".."), { recursive: true, force: true });
    await rm(targetPath, { recursive: true, force: true });
    await rm(trusttoolsDirectory, { recursive: true, force: true });
  }
});

test("rejects a market source outside the controlled temporary directory", async () => {
  const sourcePath = await mkdtemp(join(tmpdir(), "market-outside-"));
  try {
    await writeFile(join(sourcePath, "SKILL.md"), "# Outside");
    await assert.rejects(
      installMarketSkill({ sourcePath, targetAgent: "Codex CLI" }),
      /不属于受控临时目录/,
    );
  } finally {
    await rm(sourcePath, { recursive: true, force: true });
  }
});

test("rejects symbolic links anywhere in a market skill source", async () => {
  const marketRoot = join(
    homedir(),
    ".trusttools",
    "tmp",
    `market-${randomUUID()}`,
  );
  const sourcePath = join(marketRoot, `symlink-${randomUUID()}`);
  const linkedFile = join(marketRoot, "linked.md");
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, "SKILL.md"), "# Symlink");
    await writeFile(linkedFile, "linked");
    await symlink(linkedFile, join(sourcePath, "reference.md"));

    await assert.rejects(
      installMarketSkill({ sourcePath, targetAgent: "Codex CLI" }),
      /不允许包含符号链接/,
    );
  } finally {
    await rm(marketRoot, { recursive: true, force: true });
  }
});

test("reads description from SKILL.md frontmatter block scalars", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-desc-"));
  const trusttoolsDirectory = join(root, ".trusttools");
  const foldedPath = join(
    root,
    SKILL_ROOT_SUFFIXES["Codex CLI"],
    "folded-skill",
  );
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
      trusttoolsDirectory,
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
  await assert.rejects(batchUninstallLocalSkills([]), /至少选择一个 Skill/);
});

test("permanently deletes a skill via batch uninstall and collects failures", async () => {
  const name = `uninstall-${randomUUID().slice(0, 8)}`;
  const skillPath = join(homedir(), SKILL_ROOT_SUFFIXES["Codex CLI"], name);
  try {
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), "# Test");

    const result = await batchUninstallLocalSkills([
      skillPath,
      "/tmp/nonexistent-trusttools-skill",
    ]);
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].error, /不属于受管 Skill 根目录/);

    // Verify the skill is permanently gone.
    await assert.rejects(lstat(skillPath));
  } finally {
    await rm(skillPath, { recursive: true, force: true });
  }
});

test("syncLocalSkill copies a skill to a target agent with no conflict", async () => {
  const name = `sync-${randomUUID().slice(0, 8)}`;
  const sourcePath = join(homedir(), SKILL_ROOT_SUFFIXES["Claude Code"], name);
  const targetPath = join(homedir(), SKILL_ROOT_SUFFIXES["Codex CLI"], name);
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(
      join(sourcePath, "SKILL.md"),
      `---\nversion: 1.0.0\ndescription: A sync test skill\n---\n# ${name}\n`,
    );

    const result = await syncLocalSkill({
      sourcePath,
      targetAgents: ["Codex CLI"],
      onConflict: "skip",
    });
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.succeeded[0].agent, "Codex CLI");
    assert.equal(result.succeeded[0].path, targetPath);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failed.length, 0);

    // Verify the file was copied.
    const content = await readFile(join(targetPath, "SKILL.md"), "utf8");
    assert.match(content, /version: 1\.0\.0/);
    assert.match(content, /A sync test skill/);

    // Verify description is read from frontmatter after sync.
    const snapshot = await scanLocalSkills({ homeDirectory: homedir() });
    const synced = snapshot.skills.find((s) => s.name === name);
    assert.equal(synced?.description, "A sync test skill");
    // Claude Code source + Codex CLI target.
    assert.equal(synced?.installations.length, 2);
  } finally {
    await rm(sourcePath, { recursive: true, force: true });
    await rm(targetPath, { recursive: true, force: true });
  }
});

test("syncLocalSkill skips on conflict when onConflict is skip", async () => {
  const name = `sync-skip-${randomUUID().slice(0, 8)}`;
  const sourcePath = join(homedir(), SKILL_ROOT_SUFFIXES["Claude Code"], name);
  const targetPath = join(homedir(), SKILL_ROOT_SUFFIXES["Codex CLI"], name);
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

    const result = await syncLocalSkill({
      sourcePath,
      targetAgents: ["Codex CLI"],
      onConflict: "skip",
    });
    assert.equal(result.succeeded.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].agent, "Codex CLI");
    assert.equal(result.skipped[0].reason, "conflict");
    assert.equal(result.failed.length, 0);

    // Verify the target still has the original content.
    const content = await readFile(join(targetPath, "SKILL.md"), "utf8");
    assert.match(content, /version: 1\.0\.0/);
    assert.match(content, /Original/);
  } finally {
    await rm(sourcePath, { recursive: true, force: true });
    await rm(targetPath, { recursive: true, force: true });
  }
});

test("syncLocalSkill overwrites on conflict when onConflict is overwrite", async () => {
  const name = `sync-overwrite-${randomUUID().slice(0, 8)}`;
  const sourcePath = join(homedir(), SKILL_ROOT_SUFFIXES["Claude Code"], name);
  const targetPath = join(homedir(), SKILL_ROOT_SUFFIXES["Codex CLI"], name);
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

    const result = await syncLocalSkill({
      sourcePath,
      targetAgents: ["Codex CLI"],
      onConflict: "overwrite",
    });
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.succeeded[0].agent, "Codex CLI");
    assert.equal(result.succeeded[0].path, targetPath);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failed.length, 0);

    // Verify the target now has the source content (replaced).
    const content = await readFile(join(targetPath, "SKILL.md"), "utf8");
    assert.match(content, /version: 2\.0\.0/);
    assert.match(content, /Overwritten by sync/);
  } finally {
    await rm(sourcePath, { recursive: true, force: true });
    await rm(targetPath, { recursive: true, force: true });
  }
});

test("discovers nested skills two levels deep without treating containers as skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-nested-"));
  const trusttoolsDirectory = join(root, ".trusttools");
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
      trusttoolsDirectory,
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
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-readme-"));
  const trusttoolsDirectory = join(root, ".trusttools");
  const claudeRoot = join(root, SKILL_ROOT_SUFFIXES["Claude Code"]);
  try {
    await mkdir(join(claudeRoot, "development"), { recursive: true });
    // Root-level README.md and a README.md inside a marker-less nested dir.
    await writeFile(join(claudeRoot, "README.md"), "# readme");
    await writeFile(join(claudeRoot, "development", "README.md"), "# nested");
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      trusttoolsDirectory,
    });
    assert.equal(snapshot.skills.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recognizes the lowercase skill.md marker and reads its frontmatter", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-lower-"));
  const trusttoolsDirectory = join(root, ".trusttools");
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
      trusttoolsDirectory,
    });
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0]?.name, "lower-skill");
    assert.equal(snapshot.skills[0]?.description, "lowercase marker works");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stops descending at maxDepth 3", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-depth-"));
  const trusttoolsDirectory = join(root, ".trusttools");
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
      trusttoolsDirectory,
    });
    const names = snapshot.skills.map((skill) => skill.name);
    assert.ok(names.includes("c"), "depth-3 skill must be discovered");
    assert.ok(!names.includes("w"), "depth-4 skill must not be discovered");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prefers frontmatter name over the directory name", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-name-"));
  const trusttoolsDirectory = join(root, ".trusttools");
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
      trusttoolsDirectory,
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
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-hidden-"));
  const trusttoolsDirectory = join(root, ".trusttools");
  const claudeRoot = join(root, SKILL_ROOT_SUFFIXES["Claude Code"]);
  try {
    await mkdir(join(claudeRoot, ".system"), { recursive: true });
    await writeFile(join(claudeRoot, ".system", "SKILL.md"), "# hidden");
    const realSkill = join(claudeRoot, "real");
    await mkdir(realSkill, { recursive: true });
    await writeFile(join(realSkill, "SKILL.md"), "# real");
    await symlink(realSkill, join(claudeRoot, "linked"));
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      trusttoolsDirectory,
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
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-newagents-"));
  const trusttoolsDirectory = join(root, ".trusttools");
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
      trusttoolsDirectory,
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
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-antigravity-"));
  const trusttoolsDirectory = join(root, ".trusttools");
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
      trusttoolsDirectory,
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
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-envhome-"));
  const trusttoolsDirectory = join(root, ".trusttools");
  const envRoot = await mkdtemp(join(tmpdir(), "trusttools-skills-env-"));
  try {
    await mkdir(join(envRoot, "skills", "codex-skill"), { recursive: true });
    await writeFile(join(envRoot, "skills", "codex-skill", "SKILL.md"), "# c");
    await mkdir(join(envRoot, "skills", "grok-skill"), { recursive: true });
    await writeFile(join(envRoot, "skills", "grok-skill", "SKILL.md"), "# g");

    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      trusttoolsDirectory,
      env: { CODEX_HOME: envRoot, GROK_HOME: envRoot },
    });
    assert.deepEqual(snapshot.roots["Codex CLI"], [join(envRoot, "skills")]);
    assert.deepEqual(snapshot.roots["Grok Build"], [join(envRoot, "skills")]);
    const names = snapshot.skills.map((skill) => skill.name);
    assert.ok(names.includes("codex-skill"));
    assert.ok(names.includes("grok-skill"));

    // Empty-string env values are treated as unset and fall back to HOME.
    const fallback = await scanLocalSkills({
      homeDirectory: root,
      trusttoolsDirectory,
      env: { CODEX_HOME: "", GROK_HOME: "" },
    });
    assert.deepEqual(fallback.roots["Codex CLI"], [
      join(root, ".codex", "skills"),
    ]);
    assert.deepEqual(fallback.roots["Grok Build"], [
      join(root, ".grok", "skills"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(envRoot, { recursive: true, force: true });
  }
});

test("resolves default codex and grok roots under HOME without env overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "trusttools-skills-defaultroots-"));
  try {
    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      trusttoolsDirectory: join(root, ".trusttools"),
    });
    assert.deepEqual(snapshot.roots["Codex CLI"], [
      join(root, ".codex", "skills"),
    ]);
    assert.deepEqual(snapshot.roots["Grok Build"], [
      join(root, ".grok", "skills"),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uninstall accepts nested managed paths and rejects traversal escapes", async () => {
  const name = `nested-${randomUUID().slice(0, 8)}`;
  const claudeRoot = join(homedir(), SKILL_ROOT_SUFFIXES["Claude Code"]);
  const nestedPath = join(claudeRoot, "development", name);
  try {
    await mkdir(nestedPath, { recursive: true });
    await writeFile(join(nestedPath, "SKILL.md"), "# Nested");

    const result = await uninstallLocalSkill(nestedPath);
    assert.equal(result.path, nestedPath);
    await assert.rejects(lstat(nestedPath));

    // `development/../escape` traverses outside the nested dir: rejected.
    const traversalPath = `${join(claudeRoot, "development")}/../escape`;
    await assert.rejects(
      uninstallLocalSkill(traversalPath),
      /不属于受管 Skill 根目录/,
    );

    // A symlink inside the root pointing outside is rejected by realpath.
    const linked = join(claudeRoot, `escape-${randomUUID().slice(0, 8)}`);
    const outside = await mkdtemp(join(tmpdir(), "trusttools-outside-"));
    try {
      await symlink(outside, linked);
      await assert.rejects(
        uninstallLocalSkill(linked),
        /检测到越权路径或符号链接/,
      );
    } finally {
      await rm(linked, { force: true });
      await rm(outside, { recursive: true, force: true });
    }
  } finally {
    await rm(nestedPath, { recursive: true, force: true });
    await rm(join(claudeRoot, "development"), {
      recursive: true,
      force: true,
    });
  }
});

test("syncLocalSkill flattens a nested source skill into the codex root", async () => {
  const name = `sync-nested-${randomUUID().slice(0, 8)}`;
  const claudeRoot = join(homedir(), SKILL_ROOT_SUFFIXES["Claude Code"]);
  const sourcePath = join(claudeRoot, "development", name);
  const targetPath = join(homedir(), SKILL_ROOT_SUFFIXES["Codex CLI"], name);
  try {
    await mkdir(sourcePath, { recursive: true });
    await writeFile(
      join(sourcePath, "SKILL.md"),
      "---\nversion: 1.0.0\ndescription: Nested sync source\n---\n# Nested\n",
    );

    const result = await syncLocalSkill({
      sourcePath,
      targetAgents: ["Codex CLI"],
      onConflict: "skip",
    });
    assert.equal(result.succeeded.length, 1);
    assert.equal(result.succeeded[0].agent, "Codex CLI");
    // The nested path is flattened to <root>/<name> at the target agent.
    assert.equal(result.succeeded[0].path, targetPath);

    const content = await readFile(join(targetPath, "SKILL.md"), "utf8");
    assert.match(content, /version: 1\.0\.0/);
    assert.match(content, /Nested/);
  } finally {
    await rm(sourcePath, { recursive: true, force: true });
    await rm(join(claudeRoot, "development"), {
      recursive: true,
      force: true,
    });
    await rm(targetPath, { recursive: true, force: true });
  }
});
