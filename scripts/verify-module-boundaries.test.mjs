import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MODULE_REQUIRED_ENTRIES,
  ROUTE_LINE_LIMIT,
  analyzeProject,
  extractImportSources,
  getBlockingFindings,
  hasPageCollectionInterval,
  isGeneratedToolingCycle,
  MIGRATION_ALLOWLIST,
  validateAllowlist,
} from "./verify-module-boundaries.mjs";

async function withFixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), "trusttools-architecture-"));
  try {
    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        const target = join(root, path);
        await mkdir(join(target, ".."), { recursive: true });
        await writeFile(target, content);
      }),
    );
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("extractImportSources finds static imports and exports", () => {
  assert.deepEqual(
    extractImportSources(
      'import { value } from "./value"; export { value } from "./value"; import "./side-effect";',
    ),
    ["./side-effect", "./value"],
  );
});

test("generated TanStack route graph cycles are classified as tooling intrinsic", () => {
  assert.equal(
    isGeneratedToolingCycle([
      "src/routeTree.gen.ts",
      "src/router.tsx",
      "src/routeTree.gen.ts",
    ]),
    true,
  );
  assert.equal(
    isGeneratedToolingCycle([
      "src/cycle-a.ts",
      "src/cycle-b.ts",
      "src/cycle-a.ts",
    ]),
    false,
  );
});

test("analyzeProject excludes the generated route graph from business cycle findings", async () => {
  await withFixture(
    {
      "src/routeTree.gen.ts":
        'import type { getRouter } from "./router.tsx";\n',
      "src/router.tsx": 'import { routeTree } from "./routeTree.gen";\n',
    },
    async (root) => {
      const report = await analyzeProject(root, []);
      assert.equal(report.violations.length, 0);
      assert.equal(report.generatedToolingCycles.length, 1);
    },
  );
});

test("page collection intervals are rejected while install progress animation is allowed", () => {
  assert.equal(hasPageCollectionInterval("setInterval(refresh, 5000)"), true);
  assert.equal(
    hasPageCollectionInterval(
      "const progressTimerRef = useRef(null); setInterval(tick, 300);",
    ),
    false,
  );
  assert.equal(hasPageCollectionInterval("setTimeout(refresh, 250)"), false);
});

test("analyzeProject reports all P0 architecture-boundary categories", async () => {
  await withFixture(
    {
      "src/routes/oversized.ts": `${"export const value = 1;\n".repeat(ROUTE_LINE_LIMIT + 1)}`,
      "src/routes/security.ts":
        'import { scan } from "../lib/security/scanner";\n',
      "src/lib/security/scanner.ts": "export const scan = true;\n",
      "src/modules/usage/application/use-case.ts":
        'import { secret } from "../../skills/infrastructure/private";\nexport const usage = secret;\n',
      "src/modules/usage/contracts.ts": "export {};\n",
      "src/modules/usage/application/index.ts": "export {};\n",
      "src/modules/usage/presentation/index.ts": "export {};\n",
      "src/modules/usage/api.server.ts": "export {};\n",
      "src/modules/usage/index.ts": "export {};\n",
      "src/modules/skills/infrastructure/private.ts":
        "export const secret = true;\n",
      "src/modules/skills/contracts.ts": "export {};\n",
      "src/modules/skills/application/index.ts": "export {};\n",
      "src/modules/skills/presentation/index.ts": "export {};\n",
      "src/modules/skills/api.server.ts": "export {};\n",
      "src/modules/skills/index.ts": "export {};\n",
      "src/cycle-a.ts": 'import "./cycle-b";\n',
      "src/cycle-b.ts": 'import "./cycle-a";\n',
    },
    async (root) => {
      const report = await analyzeProject(root);
      assert.deepEqual(
        report.violations.map((violation) => violation.type),
        [
          "module-deep-import",
          "relative-import-cycle",
          "route-direct-server-import",
          "route-line-limit",
        ],
      );
    },
  );
});

test("analyzeProject verifies module scaffolds and prevents public server leaks", async () => {
  await withFixture(
    {
      "src/modules/complete/contracts.ts": "export {};\n",
      "src/modules/complete/application/index.ts": "export {};\n",
      "src/modules/complete/presentation/index.ts": "export {};\n",
      "src/modules/complete/api.server.ts": "export {};\n",
      "src/modules/complete/index.ts": 'export * from "./presentation";\n',
      "src/modules/incomplete/index.ts": 'export * from "./api.server";\n',
      "src/modules/incomplete/api.server.ts": "export {};\n",
    },
    async (root) => {
      const report = await analyzeProject(root);
      assert.deepEqual(
        report.violations.map((violation) => violation.type),
        ["module-public-server-leak", "module-scaffold-missing-entry"],
      );
      assert.equal(
        report.violations[0]?.file,
        "src/modules/incomplete/index.ts",
      );
      assert.equal(
        report.violations[1]?.detail,
        MODULE_REQUIRED_ENTRIES.slice(0, 3).join(", "),
      );
    },
  );
});

test("analyzeProject permits only a fully documented temporary allowlist entry", async () => {
  await withFixture(
    {
      "src/routes/security.ts":
        'import { scan } from "../lib/security/scanner";\n',
      "src/lib/security/scanner.ts": "export const scan = true;\n",
    },
    async (root) => {
      const allowlist = [
        {
          type: "route-direct-server-import",
          file: "src/routes/security.ts",
          reason: "Migrate with security feature in P6.",
          owner: "security-team",
          expiresAtPhase: "P6",
        },
      ];
      const report = await analyzeProject(root, allowlist);
      assert.equal(report.violations.length, 0);
      assert.equal(report.suppressed.length, 1);
      assert.deepEqual(validateAllowlist([{ type: "route-line-limit" }]), [
        "allowlist[0] is missing required field(s): file, reason, owner, expiresAtPhase",
      ]);
    },
  );
});

test("the migration baseline is explicit and does not hide newly introduced findings", async () => {
  assert.ok(MIGRATION_ALLOWLIST.length > 0);
  assert.equal(validateAllowlist(MIGRATION_ALLOWLIST).length, 0);
  await withFixture(
    {
      "src/routes/new.ts": "setInterval(refresh, 5000);\n",
    },
    async (root) => {
      const report = await analyzeProject(root);
      assert.equal(report.violations[0]?.type, "route-collection-interval");
      assert.equal(getBlockingFindings(report).length, 1);
    },
  );
});

test("completed feature routes are no longer part of the migration baseline", () => {
  const routeLineEntries = MIGRATION_ALLOWLIST.filter(
    (entry) => entry.type === "route-line-limit",
  ).map((entry) => entry.file);
  assert.deepEqual(routeLineEntries, []);
  for (const completedRoute of [
    "src/routes/index.tsx",
    "src/routes/market.tsx",
    "src/routes/settings.tsx",
    "src/routes/skills.tsx",
  ]) {
    assert.equal(routeLineEntries.includes(completedRoute), false);
  }
});

test("P8 baseline is empty after completed boundary cleanup", () => {
  assert.deepEqual(MIGRATION_ALLOWLIST, []);
});
