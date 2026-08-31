import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { APP_DATA_DIR, ENV } from "../../lib/app-config";
import { AppError } from "../../lib/errors";
import { AI_TOOLS } from "../../lib/tools/catalog.ts";
import { SKILL_AGENTS } from "../../lib/local-skills/types.ts";
import { SKILL_ROOT_SUFFIXES } from "../../lib/local-skills/scanner.server.ts";
import { resetCompositionRootForTests } from "../../app/composition.server.ts";
import {
  migrateSourceSkills,
  validateMigrationInput,
  type SourceMigrationInput,
} from "./migration.server.ts";

/** The id of any non-Skill tool (such as aipy/workbuddy, etc.), used for "no Skill root" use cases. */
const NON_SKILL_TOOL_ID = AI_TOOLS.find(
  (tool) => !SKILL_AGENTS.includes(tool.nameZh),
)!.id;

function validInput(
  overrides: Partial<SourceMigrationInput> = {},
): SourceMigrationInput {
  return {
    sourceId: "claude-code",
    targetAgents: ["Codex"],
    onConflict: "skip",
    ...overrides,
  };
}

async function withTempHome(
  run: (root: string, dataDirectory: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "aitracker-sources-migrate-"));
  const dataDirectory = join(root, APP_DATA_DIR);
  // `scanLocalSkills` resolves its origins/blacklist state through the
  // composition root's SQLite httpCache. Point that root at this temp home so
  // the scan never touches the real `~/.aitracker` database (held open by a
  // running dev/Electron process, or migrated by older code).
  const previous = process.env[ENV.USAGE_HOME];
  process.env[ENV.USAGE_HOME] = root;
  resetCompositionRootForTests();
  try {
    await run(root, dataDirectory);
  } finally {
    resetCompositionRootForTests();
    if (previous === undefined) delete process.env[ENV.USAGE_HOME];
    else process.env[ENV.USAGE_HOME] = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function writeSkill(
  root: string,
  agent: keyof typeof SKILL_ROOT_SUFFIXES,
  name: string,
  content = `# ${name}\n`,
): Promise<string> {
  const dir = join(root, SKILL_ROOT_SUFFIXES[agent], name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content);
  return dir;
}

test("validateMigrationInput rejects unknown sourceId", () => {
  assert.throws(
    () => validateMigrationInput(validInput({ sourceId: "not-a-tool" })),
    (error) =>
      error instanceof AppError &&
      error.code === "errors.sources.migrateInvalid",
  );
});

test("validateMigrationInput rejects empty or oversized targetAgents", () => {
  assert.throws(
    () => validateMigrationInput(validInput({ targetAgents: [] })),
    (error) =>
      error instanceof AppError &&
      error.code === "errors.sources.migrateInvalid",
  );
  assert.throws(
    () =>
      validateMigrationInput(
        validInput({
          targetAgents: [
            ...SKILL_AGENTS,
            ...SKILL_AGENTS,
            ...SKILL_AGENTS,
            ...SKILL_AGENTS,
          ],
        }),
      ),
    (error) =>
      error instanceof AppError &&
      error.code === "errors.sources.migrateInvalid",
  );
});

test("validateMigrationInput rejects unknown target agents", () => {
  assert.throws(
    () => validateMigrationInput(validInput({ targetAgents: ["Nope"] })),
    (error) =>
      error instanceof AppError &&
      error.code === "errors.sources.migrateInvalid",
  );
});

test("validateMigrationInput rejects invalid onConflict", () => {
  assert.throws(
    () =>
      validateMigrationInput(
        validInput({
          onConflict: "merge" as SourceMigrationInput["onConflict"],
        }),
      ),
    (error) =>
      error instanceof AppError &&
      error.code === "errors.sources.migrateInvalid",
  );
});

test("migrateSourceSkills rejects unknown sourceId", async () => {
  await assert.rejects(
    migrateSourceSkills(validInput({ sourceId: "not-a-tool" })),
    (error) =>
      error instanceof AppError &&
      error.code === "errors.sources.migrateInvalid",
  );
});

test("migrateSourceSkills copies a tool's skills to target agents", async () => {
  await withTempHome(async (root, dataDirectory) => {
    const name = `migrate-${randomUUID().slice(0, 8)}`;
    const sourceDir = await writeSkill(root, "Claude Code", name);
    const options = { homeDirectory: root, dataDirectory };

    const result = await migrateSourceSkills(
      validInput({ targetAgents: ["Codex"] }),
      options,
    );

    assert.equal(result.ok, true);
    assert.equal(result.total, 1);
    assert.equal(result.migrated.length, 1);
    assert.deepEqual(result.migrated[0], { agent: "Codex", skillName: name });
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failed.length, 0);

    // The file is actually copied to the skill root of the Codex.
    const content = await readFile(
      join(root, SKILL_ROOT_SUFFIXES["Codex"], name, "SKILL.md"),
      "utf8",
    );
    assert.match(content, new RegExp(`# ${name}`));
    // The source directory remains intact.
    await readFile(join(sourceDir, "SKILL.md"), "utf8");
  });
});

test("migrateSourceSkills excludes the source agent itself from targets", async () => {
  await withTempHome(async (root, dataDirectory) => {
    const name = `self-${randomUUID().slice(0, 8)}`;
    await writeSkill(root, "Claude Code", name);
    const options = { homeDirectory: root, dataDirectory };

    const result = await migrateSourceSkills(
      validInput({ targetAgents: ["Claude Code", "Codex"] }),
      options,
    );

    assert.equal(result.total, 1);
    assert.deepEqual(result.migrated, [{ agent: "Codex", skillName: name }]);
    assert.equal(result.failed.length, 0);
  });
});

test("migrateSourceSkills skips existing targets when onConflict is skip", async () => {
  await withTempHome(async (root, dataDirectory) => {
    const name = `conflict-${randomUUID().slice(0, 8)}`;
    await writeSkill(root, "Claude Code", name, "# Source\n");
    await writeSkill(root, "Codex", name, "# Original\n");
    const options = { homeDirectory: root, dataDirectory };

    const result = await migrateSourceSkills(
      validInput({ targetAgents: ["Codex"], onConflict: "skip" }),
      options,
    );

    assert.equal(result.total, 1);
    assert.equal(result.migrated.length, 0);
    assert.deepEqual(result.skipped, [
      { agent: "Codex", skillName: name, reason: "conflict" },
    ]);
    assert.equal(result.failed.length, 0);

    // The target content was not covered.
    const content = await readFile(
      join(root, SKILL_ROOT_SUFFIXES["Codex"], name, "SKILL.md"),
      "utf8",
    );
    assert.match(content, /Original/);
  });
});

test("migrateSourceSkills overwrites existing targets when onConflict is overwrite", async () => {
  await withTempHome(async (root, dataDirectory) => {
    const name = `overwrite-${randomUUID().slice(0, 8)}`;
    await writeSkill(root, "Claude Code", name, "# Source\n");
    await writeSkill(root, "Codex", name, "# Original\n");
    const options = { homeDirectory: root, dataDirectory };

    const result = await migrateSourceSkills(
      validInput({ targetAgents: ["Codex"], onConflict: "overwrite" }),
      options,
    );

    assert.equal(result.total, 1);
    assert.equal(result.migrated.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.failed.length, 0);

    const content = await readFile(
      join(root, SKILL_ROOT_SUFFIXES["Codex"], name, "SKILL.md"),
      "utf8",
    );
    assert.match(content, /Source/);
  });
});

test("migrateSourceSkills returns empty result when the tool has no Skill root", async () => {
  await withTempHome(async (root, dataDirectory) => {
    const result = await migrateSourceSkills(
      validInput({ sourceId: NON_SKILL_TOOL_ID }),
      { homeDirectory: root, dataDirectory },
    );
    assert.deepEqual(result, {
      ok: true,
      migrated: [],
      skipped: [],
      failed: [],
      total: 0,
    });
  });
});

test("migrateSourceSkills returns empty result when the Skill root has no Skills", async () => {
  await withTempHome(async (root, dataDirectory) => {
    // Directory exists but no marker file → No Skill.
    await mkdir(join(root, SKILL_ROOT_SUFFIXES["Claude Code"], "empty"), {
      recursive: true,
    });
    const result = await migrateSourceSkills(validInput(), {
      homeDirectory: root,
      dataDirectory,
    });
    assert.deepEqual(result, {
      ok: true,
      migrated: [],
      skipped: [],
      failed: [],
      total: 0,
    });
  });
});

test("migrateSourceSkills migrates every Skill of the source tool", async () => {
  await withTempHome(async (root, dataDirectory) => {
    const first = `first-${randomUUID().slice(0, 8)}`;
    const second = `second-${randomUUID().slice(0, 8)}`;
    await writeSkill(root, "Claude Code", first);
    await writeSkill(root, "Claude Code", second);
    const options = { homeDirectory: root, dataDirectory };

    const result = await migrateSourceSkills(
      validInput({ targetAgents: ["Codex", "Cursor"] }),
      options,
    );

    assert.equal(result.total, 2);
    assert.equal(result.migrated.length, 4);
    const pairs = result.migrated.map(
      (item) => `${item.skillName}:${item.agent}`,
    );
    assert.ok(pairs.includes(`${first}:Codex`));
    assert.ok(pairs.includes(`${first}:Cursor`));
    assert.ok(pairs.includes(`${second}:Codex`));
    assert.ok(pairs.includes(`${second}:Cursor`));
    assert.equal(result.failed.length, 0);
  });
});
