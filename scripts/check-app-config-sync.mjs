#!/usr/bin/env node
/**
 * Guard that the centralized app config stays in sync across the tsconfig
 * boundary and that no hardcoded brand literal survives in code:
 *
 *   1. src/lib/app-config.ts   — canonical config (single source of truth)
 *   2. electron/app-config.ts  — mirrored subset (electron cannot cross-import
 *      because of its `rootDir: "electron"` boundary)
 *   3. scripts/*.mjs + electron/dev-runner.mjs — env-var literals (plain JS,
 *      cannot import the config)
 *
 * Checks:
 *   - every constant in the electron mirror exists in the canonical module
 *     with a textually identical literal (strict subset);
 *   - every `TRUSTTOOLS_*` literal in scripts/ matches one of the canonical
 *     ENV values;
 *   - no `AITracker` / `trusttools` / `trustTools` / `TRUSTTOOLS` literal
 *     remains anywhere under src/ or electron/ (comments stripped) except in
 *     the two config files — the rebrand acceptance gate.
 *
 * Run via `npm run check:i18n` or directly: node scripts/check-app-config-sync.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

// Both config modules are zero-import pure constants, so we compare their
// actual runtime values (robust against template-literal derivation) rather
// than regex-parsing source text. Requires tsx (see the npm script wiring):
//   node --import tsx scripts/check-app-config-sync.mjs
const srcConfig = await import(
  new URL("../src/lib/app-config.ts", import.meta.url).href
);
const electronConfig = await import(
  new URL("../electron/app-config.ts", import.meta.url).href
);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/g, "");
}

const failures = [];

const srcConstants = srcConfig;
const electronConstants = electronConfig;
const srcEnv = srcConfig.ENV ?? {};
const electronEnv = electronConfig.ENV ?? {};

for (const [name, value] of Object.entries(electronConstants)) {
  if (name === "ENV") continue;
  if (!(name in srcConstants)) {
    failures.push(
      `electron/app-config.ts: "${name}" is not in src/lib/app-config.ts`,
    );
  } else if (srcConstants[name] !== value) {
    failures.push(
      `electron/app-config.ts: "${name}" = "${value}" ≠ src/lib/app-config.ts "${srcConstants[name]}"`,
    );
  }
}
for (const [name, value] of Object.entries(electronEnv)) {
  if (!(name in srcEnv)) {
    failures.push(
      `electron/app-config.ts: ENV.${name} is not in src/lib/app-config.ts`,
    );
  } else if (srcEnv[name] !== value) {
    failures.push(
      `electron/app-config.ts: ENV.${name} = "${value}" ≠ src ENV.${name} "${srcEnv[name]}"`,
    );
  }
}

// Cross-check env-var literals in plain-JS scripts that cannot import the config.
const expectedEnvValues = new Set(Object.values(srcEnv));
const scriptFiles = execFileSync(
  "find",
  [
    "scripts",
    "electron",
    "-name",
    "*.mjs",
    "-o",
    "-name",
    "*.cjs",
    "-o",
    "-name",
    "*.cts",
  ],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((f) => f && !f.includes("app-config"));
for (const file of scriptFiles) {
  const source = read(file);
  for (const match of source.matchAll(/\bTRUSTTOOLS_[A-Z0-9_]+/g)) {
    if (!expectedEnvValues.has(match[0])) {
      failures.push(
        `${file}: env literal "${match[0]}" is not declared in src/lib/app-config.ts ENV`,
      );
    }
  }
}

// Brand-literal sweep over src/ and electron/ (the rebrand acceptance gate).
const BRAND_RE = /AITracker|trusttools|trustTools|TRUSTTOOLS/;
// Electron dev-runner is plain JS that cannot import the config; its env-var
// literals are cross-checked against ENV above and documented there.
const EXCLUDED_FILES = new Set([
  "src/lib/app-config.ts",
  "electron/app-config.ts",
  "electron/dev-runner.mjs",
]);
const codeFiles = execFileSync("find", ["src", "electron", "-type", "f"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter(
    (f) => /\.(ts|tsx|cts|mjs|css|cjs)$/.test(f) && !EXCLUDED_FILES.has(f),
  );
for (const file of codeFiles) {
  const clean = stripComments(read(file));
  if (!BRAND_RE.test(clean)) continue;
  const lines = clean.split("\n");
  lines.forEach((line, index) => {
    if (!BRAND_RE.test(line)) return;
    // Functional (non-display) brand tokens are exempted the same way the
    // scripts' env literals are cross-checked rather than flagged:
    //   - `TRUSTTOOLS_LLM_*`  env-var family (Base URL / API Key / Model)
    //   - HMAC domain separator used for privacy fingerprints
    //   - repository/project fixture labels in tests
    const functional =
      /\bTRUSTTOOLS_LLM_[A-Z0-9_]+|trusttools-local-usage-event|trusttools_webapp|trusttools\/security-dev|TRUSTTOOLS_SECURITY_DEV_SERVICE/g;
    const remaining = line.replace(functional, "");
    if (!BRAND_RE.test(remaining)) return;
    failures.push(
      `${file}:${index + 1}: hardcoded brand literal — derive from app-config instead`,
    );
  });
}

if (failures.length) {
  console.error(`check-app-config-sync: ${failures.length} issue(s) found\n`);
  for (const f of failures.slice(0, 40)) console.error(`  ✖ ${f}`);
  if (failures.length > 40) {
    console.error(`  … ${failures.length - 40} more (truncated)`);
  }
  process.exit(1);
}

console.log(
  "check-app-config-sync: electron mirror in sync; no hardcoded brand literal in src/ or electron/",
);
