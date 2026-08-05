/**
 * Restricted user overrides for tool definitions (server-only).
 *
 * Reads `~/.trusttools/tool-overrides.json`, validates it against a strict
 * schema, and merges ONLY whitelisted fields (enable/disable, additional safe
 * discovery roots, display preferences) into the built-in definitions. A user
 * can NEVER override a Reader key, resume command, pricing rule, or market
 * write root - those keys do not exist in the schema, so any attempt is
 * rejected as an invalid override.
 *
 * Corrupt or invalid files fall back to the built-in definitions and produce a
 * diagnostic; they never execute their content. Writes use temp-file + atomic
 * rename with mode 0o600.
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

import type { ToolDefinition } from "./contracts.ts";
import { isUnsafePath } from "./validate.ts";

const DEFAULT_OVERRIDE_PATH = join(
  homedir(),
  ".trusttools",
  "tool-overrides.json",
);

// `.strict()` so any attempt to override a non-whitelisted field (reader,
// command, pricing, market write root, ...) is REJECTED rather than silently
// stripped - users can never inject behavior via overrides.
const ToolOverrideSchema = z
  .object({
    enabled: z.boolean().optional(),
    extraDiscoveryRoots: z.array(z.string().min(1)).optional(),
    display: z
      .object({ nameZh: z.string().min(1).optional() })
      .strict()
      .optional(),
  })
  .strict();

const ToolOverridesSchema = z.record(z.string(), ToolOverrideSchema);

export type ToolOverride = z.infer<typeof ToolOverrideSchema>;
export type ToolOverrides = z.infer<typeof ToolOverridesSchema>;

export interface OverrideDiagnostic {
  toolId: string;
  message: string;
}

export interface OverridesFile {
  version: 1;
  overrides: ToolOverrides;
}

const OverridesFileSchema = z.object({
  version: z.literal(1),
  overrides: ToolOverridesSchema,
});

export interface ReadOverridesResult {
  overrides: ToolOverrides;
  diagnostics: OverrideDiagnostic[];
  /** Path that was read. */
  source: string;
}

/**
 * Read and validate the overrides file. A missing file is not an error (empty
 * overrides). A corrupt or schema-invalid file yields empty overrides plus a
 * diagnostic - it never throws to the caller.
 */
export async function readToolOverrides(
  filePath: string = DEFAULT_OVERRIDE_PATH,
): Promise<ReadOverridesResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { overrides: {}, diagnostics: [], source: filePath };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      overrides: {},
      diagnostics: [
        { toolId: "*", message: "tool-overrides.json 不是合法 JSON，已忽略" },
      ],
      source: filePath,
    };
  }

  const result = OverridesFileSchema.safeParse(parsed);
  if (!result.success) {
    return {
      overrides: {},
      diagnostics: [
        {
          toolId: "*",
          message: `tool-overrides.json 结构非法，已忽略：${result.error.message}`,
        },
      ],
      source: filePath,
    };
  }

  const overrides = result.data.overrides;
  const diagnostics: OverrideDiagnostic[] = [];
  for (const [toolId, override] of Object.entries(overrides)) {
    for (const root of override.extraDiscoveryRoots ?? []) {
      if (isUnsafePath(root)) {
        diagnostics.push({
          toolId,
          message: `extraDiscoveryRoot "${root}" 不安全（绝对路径/遍历/空），已忽略该根`,
        });
      }
    }
  }
  return { overrides, diagnostics, source: filePath };
}

/**
 * Merge a single override into a definition (whitelist fields only). Returns
 * a new definition; never mutates the input. Unsafe extra roots are dropped.
 */
export function applyOverride(
  def: ToolDefinition,
  override: ToolOverride,
): { definition: ToolDefinition; dropped: string[] } {
  const dropped: string[] = [];
  const extraRoots = (override.extraDiscoveryRoots ?? []).filter((root) => {
    if (isUnsafePath(root)) {
      dropped.push(root);
      return false;
    }
    return true;
  });

  const next: ToolDefinition = {
    ...def,
    detection: {
      ...def.detection,
      roots: [...def.detection.roots, ...extraRoots],
    },
    display: override.display?.nameZh
      ? { ...def.display, nameZh: override.display.nameZh }
      : def.display,
  };
  return { definition: next, dropped };
}

export interface MergeOverridesResult {
  definitions: ToolDefinition[];
  diagnostics: OverrideDiagnostic[];
  /** ids of tools explicitly disabled by override. */
  disabledIds: string[];
}

/** Apply overrides to a full definition set; disabled tools are dropped. */
export function mergeOverrides(
  defs: readonly ToolDefinition[],
  overrides: ToolOverrides,
  overrideDiagnostics: OverrideDiagnostic[] = [],
): MergeOverridesResult {
  const diagnostics: OverrideDiagnostic[] = [...overrideDiagnostics];
  const disabledIds: string[] = [];
  const definitions: ToolDefinition[] = [];
  for (const def of defs) {
    const override = overrides[def.id];
    if (!override) {
      definitions.push(def);
      continue;
    }
    if (override.enabled === false) {
      disabledIds.push(def.id);
      continue;
    }
    const { definition, dropped } = applyOverride(def, override);
    for (const root of dropped) {
      diagnostics.push({
        toolId: def.id,
        message: `extraDiscoveryRoot "${root}" 不安全，已忽略`,
      });
    }
    definitions.push(definition);
  }
  return { definitions, diagnostics, disabledIds };
}

/**
 * Atomically write overrides via temp-file + rename (mode 0o600). Ensures the
 * directory exists with 0o700.
 */
export async function writeToolOverrides(
  overrides: ToolOverrides,
  filePath: string = DEFAULT_OVERRIDE_PATH,
): Promise<void> {
  const file: OverridesFile = { version: 1, overrides };
  const payload = JSON.stringify(file, null, 2);
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, payload, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, filePath);
}
