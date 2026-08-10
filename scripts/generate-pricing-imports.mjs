// Generates src/lib/pricing/pricing-definitions.generated.ts from the rule
// packs listed in src/lib/pricing/rules/pricing-manifest.json. Each pack is
// Zod-validated at generation time; the runtime compiler trusts the
// already-validated data. The generated file is committed (mirrors the
// tool-registry manifest pattern) and verify:pricing-rules checks for drift.
//
// Since P1-1 (pricing-ownership refactor, phase 1), the manifest also lists the
// new contract data files (model-catalog / billing-routes / model-alias-rules /
// route-selection-rules / rate-packs / fallback-profiles). They are validated
// here and embedded as typed exports for the phase-2 compile/resolve rewrite.
//
// Run: npm run generate:pricing-imports   (also runs in prebuild)
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, isAbsolute } from "node:path";
import { tsImport } from "tsx/esm/api";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const rulesDir = join(root, "src/lib/pricing/rules");
const manifestPath = join(rulesDir, "pricing-manifest.json");
const outPath = join(root, "src/lib/pricing/pricing-definitions.generated.ts");

const {
  PricingManifestSchema,
  PricingPackSchema,
  ModelCatalogFileSchema,
  BillingRoutesFileSchema,
  ModelAliasRulesFileSchema,
  RouteSelectionRulesFileSchema,
  RatePackSchema,
  FallbackProfilesFileSchema,
} = await tsImport(join(root, "src/lib/pricing/contracts.ts"), import.meta.url);

function fail(msg) {
  console.error(`generate-pricing-imports: ${msg}`);
  process.exit(1);
}

function assertSafeRepoPath(rel, kind) {
  if (rel === "" || isAbsolute(rel))
    fail(`${kind} path must be repo-relative: "${rel}"`);
  if (rel.includes("..")) fail(`${kind} path must not traverse: "${rel}"`);
}

const manifestRaw = JSON.parse(await readFile(manifestPath, "utf8"));
const manifest = PricingManifestSchema.parse(manifestRaw);

// --- Legacy rule packs (phase-1 pipeline) ---------------------------------
const seenPackIds = new Set();
const packs = [];
for (const entry of manifest.packs) {
  assertSafeRepoPath(entry.path, `pack "${entry.packId}"`);
  const abs = join(root, entry.path);
  const relToRules = relative(rulesDir, abs);
  if (relToRules.startsWith(".."))
    fail(
      `pack "${entry.packId}" must live under src/lib/pricing/rules: "${entry.path}"`,
    );
  if (seenPackIds.has(entry.packId)) fail(`duplicate packId "${entry.packId}"`);
  seenPackIds.add(entry.packId);

  if (!entry.path.endsWith(".rules.json"))
    fail(
      `pack "${entry.packId}" path must end with .rules.json: "${entry.path}"`,
    );

  let raw;
  try {
    raw = JSON.parse(await readFile(abs, "utf8"));
  } catch (e) {
    fail(`cannot read/parse ${entry.path}: ${e.message}`);
  }
  const parsed = PricingPackSchema.safeParse(raw);
  if (!parsed.success) {
    fail(
      `pack ${entry.path} failed schema validation:\n${JSON.stringify(parsed.error.format(), null, 2)}`,
    );
  }
  if (parsed.data.packId !== entry.packId) {
    fail(
      `pack ${entry.path} has packId "${parsed.data.packId}" but manifest says "${entry.packId}"`,
    );
  }
  packs.push(parsed.data);
}

// --- P1-1 contract data files ---------------------------------------------
async function loadDataFile(entry, kind, schema) {
  if (!entry) return null;
  assertSafeRepoPath(entry.path, kind);
  const abs = join(root, entry.path);
  const relToRules = relative(rulesDir, abs);
  if (relToRules.startsWith(".."))
    fail(`${kind} must live under src/lib/pricing/rules: "${entry.path}"`);
  if (!entry.path.endsWith(".json"))
    fail(`${kind} path must end with .json: "${entry.path}"`);
  let raw;
  try {
    raw = JSON.parse(await readFile(abs, "utf8"));
  } catch (e) {
    fail(`cannot read/parse ${entry.path}: ${e.message}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    fail(
      `${kind} ${entry.path} failed schema validation:\n${JSON.stringify(parsed.error.format(), null, 2)}`,
    );
  }
  return parsed.data;
}

const modelCatalog = await loadDataFile(
  manifest.modelCatalog,
  "modelCatalog",
  ModelCatalogFileSchema,
);
const billingRoutes = await loadDataFile(
  manifest.billingRoutes,
  "billingRoutes",
  BillingRoutesFileSchema,
);
const modelAliasRules = await loadDataFile(
  manifest.modelAliasRules,
  "modelAliasRules",
  ModelAliasRulesFileSchema,
);
const routeSelectionRules = await loadDataFile(
  manifest.routeSelectionRules,
  "routeSelectionRules",
  RouteSelectionRulesFileSchema,
);
const fallbackProfiles = await loadDataFile(
  manifest.fallbackProfiles,
  "fallbackProfiles",
  FallbackProfilesFileSchema,
);

const seenRatePackIds = new Set();
const ratePacks = [];
for (const entry of manifest.ratePacks ?? []) {
  if (seenRatePackIds.has(entry.packId))
    fail(`duplicate ratePackId "${entry.packId}"`);
  seenRatePackIds.add(entry.packId);
  const pack = await loadDataFile(
    entry,
    `ratePack "${entry.packId}"`,
    RatePackSchema,
  );
  if (pack && pack.packId !== entry.packId) {
    fail(
      `ratePack ${entry.path} has packId "${pack.packId}" but manifest says "${entry.packId}"`,
    );
  }
  ratePacks.push(pack);
}

// Canonical hash input: manifest + packs + new data files, deterministic key
// order.
const canonical = JSON.stringify(
  {
    manifest,
    packs,
    modelCatalog,
    billingRoutes,
    modelAliasRules,
    routeSelectionRules,
    ratePacks,
    fallbackProfiles,
  },
  null,
  0,
);
const version = createHash("sha256")
  .update(canonical)
  .digest("hex")
  .slice(0, 16);

const banner =
  "// @generated by scripts/generate-pricing-imports.mjs - DO NOT EDIT.\n";
const body = `import type { PricingManifest, PricingPack } from "./contracts.ts";
import type {
  BillingRoute,
  FallbackProfile,
  ModelAliasRule,
  ModelCatalogEntry,
  RatePack,
  RouteSelectionRule,
} from "./contracts.ts";

export const PRICING_MANIFEST: PricingManifest = ${JSON.stringify(manifest, null, 2)};

export const PRICING_PACKS: readonly PricingPack[] = ${JSON.stringify(packs, null, 2)};

export const PRICING_MODEL_CATALOG: readonly ModelCatalogEntry[] = ${JSON.stringify(modelCatalog?.models ?? [], null, 2)};

export const PRICING_BILLING_ROUTES: readonly BillingRoute[] = ${JSON.stringify(billingRoutes?.routes ?? [], null, 2)};

export const PRICING_MODEL_ALIAS_RULES: readonly ModelAliasRule[] = ${JSON.stringify(modelAliasRules?.rules ?? [], null, 2)};

export const PRICING_ROUTE_SELECTION_RULES: readonly RouteSelectionRule[] = ${JSON.stringify(routeSelectionRules?.rules ?? [], null, 2)};

export const PRICING_RATE_PACKS: readonly RatePack[] = ${JSON.stringify(ratePacks, null, 2)};

export const PRICING_FALLBACK_PROFILES: readonly FallbackProfile[] = ${JSON.stringify(fallbackProfiles?.profiles ?? [], null, 2)};

export const PRICING_REGISTRY_VERSION: string = ${JSON.stringify(version)};
`;
await writeFile(outPath, banner + body, "utf8");

// Summary for CI.
const rules = packs.reduce((n, p) => n + p.rules.length, 0);
const rates = packs.reduce((n, p) => n + p.rates.length, 0);
const profiles = packs.reduce(
  (n, p) => n + (p.fallbackProfiles?.length ?? 0),
  0,
);
console.log("generate-pricing-imports");
console.log("─────────────────────────────────────────");
console.log(`packs:              ${packs.length}`);
console.log(`  conversion rules: ${rules}`);
console.log(`  rates:            ${rates}`);
console.log(`  fallback profiles:${profiles}`);
console.log(`P1-1 data files:`);
console.log(`  model catalog:    ${modelCatalog?.models.length ?? 0} models`);
console.log(`  billing routes:   ${billingRoutes?.routes.length ?? 0} routes`);
console.log(`  alias rules:      ${modelAliasRules?.rules.length ?? 0}`);
console.log(
  `  route selection:  ${routeSelectionRules?.rules.length ?? 0} rules`,
);
console.log(
  `  rate packs:       ${ratePacks.length} (${ratePacks.reduce((n, p) => n + p.rates.length, 0)} rates)`,
);
console.log(`  fallback profiles:${fallbackProfiles?.profiles.length ?? 0}`);
console.log(`registry version:   ${version}`);
console.log(`wrote ${relative(root, outPath)}`);
