import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = "src/modules/tasks/definitions";
const contract = await tsImport(
  join(root, `${base}/contracts.ts`),
  import.meta.url,
);
const generated = await tsImport(
  join(root, `${base}/job-catalog.generated.ts`),
  import.meta.url,
);
const raw = JSON.parse(
  await readFile(join(root, `${base}/job-catalog.json`), "utf8"),
);

try {
  contract.assertSafeStaticCatalog(raw);
  const parsed = contract.JobCatalogSchema.parse(raw);
  if (JSON.stringify(parsed) !== JSON.stringify(generated.JOB_CATALOG))
    throw new Error("generated catalog differs from JSON");
  const keys = new Set(contract.JOB_EXECUTOR_KEYS);
  for (const task of parsed.tasks)
    if (!keys.has(task.executorKey))
      throw new Error(`unknown executor: ${task.executorKey}`);
  console.log(
    `job-catalog verify: OK (${parsed.tasks.length} jobs, ${generated.JOB_CATALOG_VERSION})`,
  );
} catch (error) {
  console.error(
    `job-catalog verify: FAIL\n${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
