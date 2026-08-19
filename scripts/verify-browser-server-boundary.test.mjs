// Regression tests for the browser/server boundary gate (P6-T6-03).
// Guards the false-negative fixed for mixed value+type imports of the same
// `.server` module (version-check case): a specifier that is both
// value-imported and type-imported must still be treated as a static edge.
//
// Batch B (P1-6) adds the `platform-node-sqlite-outside-infrastructure` rule:
// inside `src/platform/database/**` and `src/platform/persistence/**` only
// `infrastructure/**` may statically import the raw driver.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { analyzeBrowserServerBoundary } from "./verify-browser-server-boundary.mjs";

async function withFixture(files, run) {
  const dir = await mkdtemp(join(tmpdir(), "boundary-fixture-"));
  try {
    const src = join(dir, "src");
    await mkdir(src, { recursive: true });
    await writeFile(join(src, "browser-safe.ts"), "export const x = 1;\n");
    await writeFile(
      join(src, "server-only.server.ts"),
      "export const y = 2;\n",
    );
    for (const [name, content] of Object.entries(files)) {
      const target = join(src, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("mixed value + type import of a .server module is a violation", async () => {
  const violations = await withFixture(
    {
      "consumer.ts": [
        'import { checkForUpdates } from "./server-only.server";',
        'import type { VersionCheckResult } from "./server-only.server";',
        "export { checkForUpdates };\n",
      ].join("\n"),
    },
    (dir) => analyzeBrowserServerBoundary(dir),
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].type, "browser-static-server-import");
  assert.ok(violations[0].detail.endsWith("server-only.server.ts"));
});

test("type-only import of a .server module is not a violation", async () => {
  const violations = await withFixture(
    {
      "consumer.ts":
        'import type { ServerThing } from "./server-only.server";\nexport type { ServerThing };\n',
    },
    (dir) => analyzeBrowserServerBoundary(dir),
  );
  assert.deepEqual(violations, []);
});

test("dynamic import of a .server module is not a violation", async () => {
  const violations = await withFixture(
    {
      "consumer.ts":
        'export async function load() { return await import("./server-only.server"); }\n',
    },
    (dir) => analyzeBrowserServerBoundary(dir),
  );
  assert.deepEqual(violations, []);
});

test("value re-export of a .server module is a violation", async () => {
  const violations = await withFixture(
    {
      "consumer.ts":
        'export { checkForUpdates } from "./server-only.server";\n',
    },
    (dir) => analyzeBrowserServerBoundary(dir),
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].type, "browser-static-server-import");
  assert.ok(violations[0].detail.endsWith("server-only.server.ts"));
});

test("node builtin static import is a violation", async () => {
  const violations = await withFixture(
    {
      "consumer.ts": 'import { join } from "node:path";\nexport { join };\n',
    },
    (dir) => analyzeBrowserServerBoundary(dir),
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].type, "browser-node-builtin");
});

// ---------------------------------------------------------------------------
// platform-node-sqlite-outside-infrastructure (batch B, P1-6)
// ---------------------------------------------------------------------------

const SQLITE_IMPORT = 'import { DatabaseSync } from "node:sqlite";\n';

test("platform database module outside infrastructure/ may not import node:sqlite", async () => {
  const violations = await withFixture(
    {
      "platform/database/capability-probe.server.ts": `${SQLITE_IMPORT}export const probe = () => new DatabaseSync(":memory:");\n`,
    },
    (dir) => analyzeBrowserServerBoundary(dir),
  );
  assert.equal(violations.length, 1);
  assert.equal(
    violations[0].type,
    "platform-node-sqlite-outside-infrastructure",
  );
  assert.equal(
    violations[0].file,
    "src/platform/database/capability-probe.server.ts",
  );
  assert.equal(violations[0].detail, "node:sqlite");
});

test("platform persistence module outside infrastructure/ may not import node:sqlite", async () => {
  const violations = await withFixture(
    {
      "platform/persistence/store.server.ts": `${SQLITE_IMPORT}export const open = () => new DatabaseSync(":memory:");\n`,
    },
    (dir) => analyzeBrowserServerBoundary(dir),
  );
  assert.equal(violations.length, 1);
  assert.equal(
    violations[0].type,
    "platform-node-sqlite-outside-infrastructure",
  );
});

test("platform infrastructure/ is the allowed home of node:sqlite", async () => {
  const violations = await withFixture(
    {
      "platform/database/infrastructure/sqlite-runtime.server.ts": `${SQLITE_IMPORT}export const open = () => new DatabaseSync(":memory:");\n`,
    },
    (dir) => analyzeBrowserServerBoundary(dir),
  );
  assert.deepEqual(violations, []);
});

test("platform type-only node:sqlite import is not a violation", async () => {
  const violations = await withFixture(
    {
      "platform/database/database-host.server.ts":
        'import type { DatabaseSync } from "node:sqlite";\nexport type Handle = DatabaseSync;\n',
    },
    (dir) => analyzeBrowserServerBoundary(dir),
  );
  assert.deepEqual(violations, []);
});

test("platform co-located test files may import node:sqlite for fixtures", async () => {
  const violations = await withFixture(
    {
      "platform/database/backup.test.ts": `${SQLITE_IMPORT}export const corrupt = () => new DatabaseSync(":memory:");\n`,
    },
    (dir) => analyzeBrowserServerBoundary(dir),
  );
  assert.deepEqual(violations, []);
});
