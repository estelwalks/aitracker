import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { analyzeSqliteOnly } from "./verify-sqlite-only.mjs";

async function withFixture(files, run) {
  const directory = await mkdtemp(join(tmpdir(), "sqlite-only-"));
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

test("rejects legacy stores, imports, shadow writes and read switches", async () => {
  const violations = await withFixture(
    {
      "src/app/runtime.server.ts": [
        "const store = new NodeAtomicJsonStore({});",
        'const prefs = new ElectronStore(); // "electron-store" is forbidden',
        "const shadow = createShadowTaskRunRepository({ legacyStore });",
        "await importAtomicJsonStore(source);",
        "const flag = FORCE_LEGACY_READ_PATH;",
      ].join("\n"),
    },
    analyzeSqliteOnly,
  );
  assert.deepEqual(
    new Set(violations.map((item) => item.type)),
    new Set([
      "atomic-json-store",
      "electron-file-store",
      "storage-shadow-or-double-write",
      "legacy-data-import",
      "legacy-read-switch",
    ]),
  );
});

test("rejects read fallbacks and legacy import methods without false positives", async () => {
  const violations = await withFixture(
    {
      "src/app/seams.server.ts": [
        "const pref = createPreferenceReadFallback(sqlite, legacy);",
        "const usage = repository.importLegacyUsage(rows);",
        "const snapshot = withLegacySnapshotImport(a, b);",
        "const factory = createPreferenceRepository(db);",
      ].join("\n"),
    },
    analyzeSqliteOnly,
  );
  assert.deepEqual(
    new Set(violations.map((item) => item.type)),
    new Set(["legacy-read-fallback", "legacy-data-import"]),
  );
  assert.equal(violations.length, 3);
});

test("rejects legacy.read / readLegacy / legacyRead without hitting readOnly", async () => {
  const violations = await withFixture(
    {
      "src/app/legacy-source.ts": [
        "const value = legacy.read(key);",
        "const other = repository.readLegacy(key);",
        "const third = store.legacyRead(key);",
        "const safe = preferences.readOnly;",
      ].join("\n"),
    },
    analyzeSqliteOnly,
  );
  assert.deepEqual(
    new Set(violations.map((item) => item.type)),
    new Set(["legacy-read-fallback"]),
  );
  assert.equal(violations.length, 3);
});

test("rejects app-owned localStorage, JSON and sidecar state", async () => {
  const violations = await withFixture(
    {
      "src/settings.ts": [
        'window.localStorage.setItem("theme", "dark");',
        'const history = "security-scan-history.json";',
        'const version = "schema_version";',
      ].join("\n"),
    },
    analyzeSqliteOnly,
  );
  assert.deepEqual(
    violations.map((item) => item.type),
    [
      "app-owned-local-storage",
      "app-owned-json-file",
      "app-owned-sidecar-state",
    ],
  );
});

test("rejects forbidden storage modules even when empty", async () => {
  const violations = await withFixture(
    { "src/platform/database/legacy-import.server.ts": "export {};\n" },
    analyzeSqliteOnly,
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].type, "forbidden-storage-module");
});

test("rejects atomic stores and node-file persistence modules", async () => {
  const violations = await withFixture(
    {
      "src/modules/reports/infrastructure/atomic-report-store.ts":
        "export {};\n",
      "src/platform/persistence/infrastructure/node-file-system.ts":
        "export {};\n",
      "src/platform/persistence/infrastructure/node-file-lock.ts":
        "export {};\n",
    },
    analyzeSqliteOnly,
  );
  assert.deepEqual(
    violations.map((item) => item.type),
    [
      "forbidden-storage-module",
      "forbidden-storage-module",
      "forbidden-storage-module",
    ],
  );
});

test("allows external reads, static config, logs, backup manifests and user file operations", async () => {
  const violations = await withFixture(
    {
      "src/lib/local-sessions/scanner.server.ts":
        'import { readFile } from "node:fs/promises";\nexport const scan = (path) => readFile(path, "utf8");\n',
      "src/lib/pricing/registry.ts":
        'export const manifest = "pricing-manifest.json";\n',
      "src/platform/observability/node-jsonl-logger.ts":
        'export const log = "observability.jsonl";\n',
      "src/platform/database/backup.server.ts":
        'export const manifest = "manifest.json";\n',
      "src/modules/distillation/export.server.ts":
        'import { writeFile } from "node:fs/promises";\nexport const save = (path, body) => writeFile(path, body);\n',
      "src/lib/pricing/rules-loader.server.ts":
        'export const profiles = "fallback-profiles.json";\n',
    },
    analyzeSqliteOnly,
  );
  assert.deepEqual(violations, []);
});

test("excludes tests, generated files and fixtures only", async () => {
  const violations = await withFixture(
    {
      "src/store.test.ts": "const store = new NodeAtomicJsonStore({});\n",
      "src/policy.generated.ts": 'const file = "runs.v1.json";\n',
      "src/__fixtures__/legacy.ts": 'window.localStorage.setItem("x", "y");\n',
      "src/live.ts": 'const file = "runs.v1.json";\n',
    },
    analyzeSqliteOnly,
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, "src/live.ts");
});
