// Unit + process-level tests for the renderer-bundle SQLite/secret gate
// (review finding P1-1): a Nitro server-function chunk (`*.server-*.js`) that
// carries a forbidden marker inside `.output/public` must fail the gate with
// exit 1, and browser chunks must keep the existing hard assertion.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeBundle } from "./verify-bundle-no-sqlite.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "verify-bundle-no-sqlite.mjs",
);

async function withFixture(files, run) {
  const directory = await mkdtemp(join(tmpdir(), "bundle-no-sqlite-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      const target = join(directory, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source, "utf8");
    }
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("server chunks carrying a forbidden marker are violations, clean ones are not", async () => {
  const { scanned, serverChunks, violations } = await withFixture(
    {
      "assets/composition.server-abc123.js":
        'const db = "aitracker.v1.db"; const driver = "node:sqlite";',
      "assets/scanner.server-BPyc.js": "export const ok = 1;",
      "assets/index-abc123.js": "console.log('browser chunk');",
    },
    analyzeBundle,
  );
  assert.equal(scanned, 1); // only the genuinely browser-executed chunk
  assert.equal(serverChunks.length, 2);
  assert.equal(
    violations.filter((violation) =>
      violation.file.endsWith("assets/composition.server-abc123.js"),
    ).length,
    2, // "aitracker.v1.db" + "node:sqlite" on the same line
  );
  assert.ok(
    violations.some(
      (violation) =>
        violation.file.endsWith("assets/composition.server-abc123.js") &&
        violation.marker === "node:sqlite",
    ),
  );
  assert.ok(
    violations.some(
      (violation) =>
        violation.file.endsWith("assets/composition.server-abc123.js") &&
        violation.marker === "aitracker.v1.db",
    ),
  );
  assert.equal(
    violations.some((violation) => violation.file.endsWith("index-abc123.js")),
    false,
  );
});

test("browser chunks and marker-free server chunks pass the assertion", async () => {
  const result = await withFixture(
    {
      "assets/index-abc123.js": "console.log('browser chunk');",
      "assets/collector.server-x1.js": "export const fn = () => 1;",
    },
    analyzeBundle,
  );
  assert.deepEqual(result.violations, []);
});

test("a marker in a browser chunk still fails the gate", async () => {
  const result = await withFixture(
    {
      "assets/index-abc123.js": "const x = 'DatabaseSync';",
    },
    analyzeBundle,
  );
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].marker, "DatabaseSync");
});

test("script exits 1 when a server chunk carries a forbidden marker (P1-1)", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bundle-no-sqlite-exit-"));
  try {
    await mkdir(join(directory, "assets"), { recursive: true });
    await writeFile(
      join(directory, "assets", "composition.server-abc123.js"),
      "const db = 'DatabaseSync';",
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--output-dir", directory],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL/);
    assert.match(result.stderr, /composition\.server-abc123\.js/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("script exits 0 for clean browser chunks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bundle-no-sqlite-ok-"));
  try {
    await mkdir(join(directory, "assets"), { recursive: true });
    await writeFile(
      join(directory, "assets", "index-abc123.js"),
      "console.log(1);",
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--output-dir", directory],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /OK/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
