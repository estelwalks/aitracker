// Verifies the job-catalog projection. The authoritative source of task
// definitions is `src/app/runtime-policy.source.json` -> `scheduledJobs`
// (since P0-T0-04 the standalone `job-catalog.json` no longer exists).
// This script re-validates the schema and compares the generated projection
// with the source, so a hand-edited generated file or a drifted source fails.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = "src/modules/tasks/definitions";
const contract = await tsImport(
  pathToFileURL(join(root, `${base}/contracts.ts`)).href,
  import.meta.url,
);
const generated = await tsImport(
  pathToFileURL(join(root, `${base}/job-catalog.generated.ts`)).href,
  import.meta.url,
);
const policySchema = await tsImport(
  pathToFileURL(join(root, "src/app/runtime-policy.schema.ts")).href,
  import.meta.url,
);
const raw = JSON.parse(
  await readFile(join(root, "src/app/runtime-policy.source.json"), "utf8"),
);

try {
  const parsed = policySchema.RuntimePolicySourceSchema.parse(raw);
  const tasks = parsed.scheduledJobs.tasks;
  if (JSON.stringify(tasks) !== JSON.stringify(generated.JOB_CATALOG.tasks))
    throw new Error(
      "generated catalog differs from runtime-policy scheduledJobs",
    );
  const keys = new Set(contract.JOB_EXECUTOR_KEYS);
  for (const task of tasks)
    if (!keys.has(task.executorKey))
      throw new Error(`unknown executor: ${task.executorKey}`);
  console.log(
    `job-catalog verify: OK (${tasks.length} jobs, ${generated.JOB_CATALOG_VERSION})`,
  );
} catch (error) {
  console.error(
    `job-catalog verify: FAIL\n${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
