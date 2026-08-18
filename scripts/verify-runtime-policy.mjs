// Verifies the runtime-policy source against its generated projections:
//   1. The source parses against the strict schema (unknown fields, negatives,
//      duplicates, unregistered executors and cross-field mismatches fail).
//   2. The generated files are byte-identical to what the generator produces
//      right now (drift check: editing generated files by hand is a failure).
//   3. The renderer-safe projection contains none of the forbidden fields.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "src/app/runtime-policy.source.json");

const schema = await tsImport(
  pathToFileURL(join(root, "src/app/runtime-policy.schema.ts")).href,
  import.meta.url,
);
const generated = await tsImport(
  pathToFileURL(join(root, "src/app/runtime-policy.generated.ts")).href,
  import.meta.url,
);
const raw = JSON.parse(await readFile(sourcePath, "utf8"));

try {
  const parsed = schema.RuntimePolicySourceSchema.parse(raw);

  // Full policy projection must equal the parsed source.
  if (JSON.stringify(parsed) !== JSON.stringify(generated.RUNTIME_POLICY))
    throw new Error("runtime-policy.generated.ts drifted from source");

  // Renderer-safe projection must not contain forbidden fields.
  if (!generated.rendererPolicyIsSafe(generated.RENDERER_SAFE_RUNTIME_POLICY))
    throw new Error("renderer-safe projection contains forbidden fields");

  const keys = new Set(schema.SNAPSHOT_POLICY_KEYS);
  for (const key of Object.keys(
    generated.RENDERER_SAFE_RUNTIME_POLICY.snapshotPolicies,
  ))
    if (!keys.has(key))
      throw new Error(`unknown snapshot policy in projection: ${key}`);

  // Job catalog projection must match the source's scheduledJobs.
  const { JOB_CATALOG } = await tsImport(
    pathToFileURL(
      join(root, "src/modules/tasks/definitions/job-catalog.generated.ts"),
    ).href,
    import.meta.url,
  );
  if (
    JSON.stringify(JOB_CATALOG.tasks) !==
    JSON.stringify(parsed.scheduledJobs.tasks)
  )
    throw new Error("job-catalog.generated.ts drifted from scheduledJobs");

  console.log(
    `runtime-policy verify: OK (hash ${generated.RUNTIME_POLICY_SOURCE_HASH}, ${parsed.scheduledJobs.tasks.length} jobs, ${Object.keys(parsed.snapshotPolicies).length} snapshot policies)`,
  );
} catch (error) {
  console.error(
    `runtime-policy verify: FAIL\n${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
