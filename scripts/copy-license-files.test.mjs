import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { copyLicenseFiles } from "./copy-license-files.mjs";

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makePackage(dir, pkg, files = {}) {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "package.json"), pkg);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
}

const quietLogger = { warn() {} };

function buildFakeInstall(projectDir) {
  writeJson(join(projectDir, "package.json"), {
    name: "fake-app",
    version: "1.0.0",
    dependencies: {
      "@scoped/pkg": "^1.0.0",
      "app-nested-dep": "^1.0.0",
      "no-legal-files": "^1.0.0",
      scanner: "^1.0.0",
      zod: "^3.0.0",
    },
    devDependencies: {
      vite: "^1.0.0",
    },
  });

  // Direct dependency with a hoisted transitive dependency (deep-dep lives at
  // the top level, reached by climbing from node_modules/scanner) and an
  // unrelated README that must not be copied.
  makePackage(
    join(projectDir, "node_modules", "scanner"),
    {
      name: "scanner",
      version: "1.0.0",
      dependencies: { "deep-dep": "^1.0.0", zod: "^3.0.0" },
    },
    {
      LICENSE: "SCANNER LICENSE\n",
      NOTICE: "SCANNER NOTICE\n",
      "README.md": "not a license\n",
    },
  );

  makePackage(
    join(projectDir, "node_modules", "zod"),
    { name: "zod", version: "3.0.0" },
    { LICENSE: "ZOD LICENSE\n" },
  );

  makePackage(
    join(projectDir, "node_modules", "deep-dep"),
    { name: "deep-dep", version: "1.0.0" },
    { "COPYING.txt": "DEEP COPYING\n" },
  );

  // Package that only declares a license field in package.json with no file.
  makePackage(join(projectDir, "node_modules", "no-legal-files"), {
    name: "no-legal-files",
    version: "1.0.0",
    license: "MIT",
  });

  makePackage(
    join(projectDir, "node_modules", "@scoped", "pkg"),
    { name: "@scoped/pkg", version: "2.0.0" },
    {
      "LICENSE-MIT": "SCOPED LICENSE\n",
      "NOTICE.md": "SCOPED NOTICE\n",
    },
  );

  // Direct dependency with a genuinely nested dependency (inner exists only
  // under app-nested-dep/node_modules, never at the top level).
  makePackage(join(projectDir, "node_modules", "app-nested-dep"), {
    name: "app-nested-dep",
    version: "1.0.0",
    dependencies: { inner: "^1.0.0" },
  });
  makePackage(
    join(projectDir, "node_modules", "app-nested-dep", "node_modules", "inner"),
    { name: "inner", version: "1.0.0" },
    { LICENSE: "INNER LICENSE\n" },
  );

  // Dev dependency that must never be bundled.
  makePackage(
    join(projectDir, "node_modules", "vite"),
    { name: "vite", version: "1.0.0" },
    { LICENSE: "VITE LICENSE\n" },
  );
}

test("bundles license files for direct, scoped, hoisted and nested production dependencies", (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), "aitracker-licenses-"));
  const licensesRoot = join(projectDir, "out", "Resources", "licenses");
  const testContext = { projectDir, licensesRoot };
  t.after(() => rmSync(projectDir, { recursive: true, force: true }));

  buildFakeInstall(projectDir);
  const result = copyLicenseFiles({ ...testContext, logger: quietLogger });

  assert.deepEqual(
    result.copied.map((entry) => entry.name),
    ["@scoped/pkg", "deep-dep", "inner", "scanner", "zod"],
  );
  assert.deepEqual(result.noLegalFiles, ["app-nested-dep", "no-legal-files"]);
  assert.deepEqual(result.duplicatePackages, []);

  // Scanner: LICENSE + NOTICE copied, README is not a license file.
  assert.equal(
    readFileSync(join(licensesRoot, "scanner", "LICENSE"), "utf8"),
    "SCANNER LICENSE\n",
  );
  assert.equal(
    readFileSync(join(licensesRoot, "scanner", "NOTICE"), "utf8"),
    "SCANNER NOTICE\n",
  );
  assert.equal(existsSync(join(licensesRoot, "scanner", "README.md")), false);

  // Scoped package keeps its slash in the destination path.
  assert.equal(
    readFileSync(join(licensesRoot, "@scoped", "pkg", "LICENSE-MIT"), "utf8"),
    "SCOPED LICENSE\n",
  );
  assert.equal(
    readFileSync(join(licensesRoot, "@scoped", "pkg", "NOTICE.md"), "utf8"),
    "SCOPED NOTICE\n",
  );

  // Hoisted transitive dependency (climbed from node_modules/scanner).
  assert.equal(
    readFileSync(join(licensesRoot, "deep-dep", "COPYING.txt"), "utf8"),
    "DEEP COPYING\n",
  );
  // Nested transitive dependency resolved under the declaring package.
  assert.equal(
    readFileSync(join(licensesRoot, "inner", "LICENSE"), "utf8"),
    "INNER LICENSE\n",
  );

  // Packages without license files and devDependencies produce no folders.
  assert.equal(existsSync(join(licensesRoot, "no-legal-files")), false);
  assert.equal(existsSync(join(licensesRoot, "app-nested-dep")), false);
  assert.equal(existsSync(join(licensesRoot, "vite")), false);
  // zod is a direct dependency of the root *and* of scanner; copied once.
  assert.equal(
    readFileSync(join(licensesRoot, "zod", "LICENSE"), "utf8"),
    "ZOD LICENSE\n",
  );
  const zodVersions = result.copied.filter((entry) => entry.name === "zod");
  assert.equal(zodVersions.length, 1);
  assert.equal(zodVersions[0].version, "3.0.0");
});

test("clears stale output between runs and stays deterministic", (t) => {
  const projectDir = mkdtempSync(join(tmpdir(), "aitracker-licenses-"));
  const licensesRoot = join(projectDir, "licenses");
  const testContext = { projectDir, licensesRoot };
  t.after(() => rmSync(projectDir, { recursive: true, force: true }));

  buildFakeInstall(projectDir);
  const first = copyLicenseFiles({ ...testContext, logger: quietLogger });

  // Simulate a leftover from a previous packaging run with a removed
  // dependency: it must be wiped by the next run.
  writeFileSync(join(licensesRoot, "stale-pkg.txt"), "stale\n");

  const second = copyLicenseFiles({ ...testContext, logger: quietLogger });
  assert.equal(existsSync(join(licensesRoot, "stale-pkg.txt")), false);
  assert.deepEqual(second, first);
  assert.equal(
    readFileSync(join(licensesRoot, "zod", "LICENSE"), "utf8"),
    "ZOD LICENSE\n",
  );
});
