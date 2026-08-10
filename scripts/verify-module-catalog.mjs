import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const contract = await tsImport(
  join(root, "src/app/module-catalog.contracts.ts"),
  import.meta.url,
);
const generated = await tsImport(
  join(root, "src/app/module-catalog.generated.ts"),
  import.meta.url,
);
const source = JSON.parse(
  await readFile(join(root, "src/app/module-catalog.source.json"), "utf8"),
);
try {
  contract.assertSafeModuleCatalog(source);
  const parsed = contract.ModuleCatalogSchema.parse(source);
  if (
    JSON.stringify(parsed) !== JSON.stringify(generated.PUBLIC_MODULE_CATALOG)
  )
    throw new Error("generated catalog differs from JSON source");
  if (!generated.moduleCatalogIsSafe(generated.PUBLIC_MODULE_CATALOG))
    throw new Error("generated catalog failed privacy check");
  console.log(`module-catalog verify: OK (${parsed.modules.length} modules)`);
} catch (error) {
  console.error(
    `module-catalog verify: FAIL\n${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
