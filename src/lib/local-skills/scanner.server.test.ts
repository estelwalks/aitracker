import assert from "node:assert/strict";
import {
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
  installMarketSkill,
  refreshMarketSkillEvidence,
  scanLocalSkills,
  SKILL_ROOT_SUFFIXES,
  trashLocalSkills,
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

  // Skill agents are now derived from the 27-tool catalog: the 9 tools that
  // expose a skills directory (Claude Code, Codex CLI, Cursor, Gemini CLI,
  // OpenCode, Grok Build, Antigravity, Hermes Agent, OpenClaw).
  assert.equal(Object.keys(snapshot.roots).length, 9);
  assert.equal(snapshot.skills.length, 1);
  assert.equal(snapshot.skills[0].installations.length, 2);
  assert.equal(snapshot.skills[0].health, "unknown");
  assert.match(snapshot.skills[0].healthReason, /文件修改时间不作为调用证据/);
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

  assert.equal(snapshot.skills[0]?.health, "active");
  assert.match(snapshot.skills[0]?.healthReason ?? "", /真实调用 5 次/);
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

test("rejects an empty batch trash operation", async () => {
  await assert.rejects(trashLocalSkills([]), /至少选择一个 Skill/);
});

test("deduplicates batch paths and keeps successful trash results when another item fails", async () => {
  const calls: string[] = [];
  const result = await trashLocalSkills(
    ["/skill/ok", "/skill/fail", "/skill/ok"],
    async (path) => {
      calls.push(path);
      if (path === "/skill/fail") throw new Error("模拟失败");
      return {
        id: randomUUID(),
        skillName: "ok",
        agent: "Codex CLI",
        originalPath: path,
        trashedAt: "2026-07-28T00:00:00.000Z",
        expiresAt: "2026-07-28T00:05:00.000Z",
      };
    },
  );

  assert.deepEqual(calls, ["/skill/ok", "/skill/fail"]);
  assert.equal(result.succeeded.length, 1);
  assert.equal(result.succeeded[0].originalPath, "/skill/ok");
  assert.deepEqual(result.failed, [{ path: "/skill/fail", error: "模拟失败" }]);
});

test("returns every successful batch trash result", async () => {
  const result = await trashLocalSkills(
    ["/skill/one", "/skill/two"],
    async (path) => ({
      id: randomUUID(),
      skillName: path.split("/").at(-1) ?? "skill",
      agent: "Codex",
      originalPath: path,
      trashedAt: "2026-07-28T00:00:00.000Z",
      expiresAt: "2026-07-28T00:05:00.000Z",
    }),
  );

  assert.deepEqual(
    result.succeeded.map((entry) => entry.originalPath),
    ["/skill/one", "/skill/two"],
  );
  assert.deepEqual(result.failed, []);
});
