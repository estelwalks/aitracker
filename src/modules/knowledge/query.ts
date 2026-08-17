/**
 * Knowledge query transport bridge. Exposes server-function wrappers
 * (list + create/update/archive) around the server-only `api.server.ts` so the
 * memory page imports a single renderer-safe entry point without pulling
 * server internals into the browser bundle. Mirrors the distillation/sessions
 * pattern.
 *
 * The `MemoryPage` component is intentionally NOT re-exported here: the page
 * imports the server fns from this module, so re-exporting it would form a
 * relative import cycle (query -> presentation -> query) that the
 * architecture verifier blocks. Routes import the page directly from
 * `presentation/MemoryPage.tsx`.
 */
import { createServerFn } from "@tanstack/react-start";

import { AppError } from "../../lib/errors.ts";
import type {
  MemoryActionResponse,
  MemoryCreateInput,
  MemoryEntry,
  MemoryUpdateInput,
} from "./presentation/index.ts";

export type {
  MemoryActionResponse,
  MemoryCreateInput,
  MemoryEntry,
  MemoryUpdateInput,
};

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TITLE_MAX = 256;
const BODY_MAX = 4_000;
const FIELD_MAX = 128;

function record(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    throw new AppError("errors.memory.invalidInput");
  return value as Record<string, unknown>;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new AppError("errors.memory.invalidInput");
}

function requiredText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value.includes("\0")
  )
    throw new AppError("errors.memory.invalidInput");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new AppError("errors.memory.invalidInput");
  return trimmed;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value.includes("\0")
  )
    throw new AppError("errors.memory.invalidInput");
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Exposed for route/tests: validates the create-memory payload. */
export function validateCreateMemoryInput(value: unknown): MemoryCreateInput {
  const input = record(value);
  onlyKeys(input, ["type", "title", "body", "source", "project"]);
  const type = input.type;
  if (type !== "profile" && type !== "task")
    throw new AppError("errors.memory.invalidInput");
  const source = optionalText(input.source, FIELD_MAX);
  const project = optionalText(input.project, FIELD_MAX);
  return {
    type,
    title: requiredText(input.title, TITLE_MAX),
    body: requiredText(input.body, BODY_MAX),
    ...(source ? { source } : {}),
    ...(project ? { project } : {}),
  };
}

/** Exposed for route/tests: validates the update-memory payload. */
export function validateUpdateMemoryInput(value: unknown): MemoryUpdateInput {
  const input = record(value);
  onlyKeys(input, ["assetId", "type", "title", "body", "source", "project"]);
  if (typeof input.assetId !== "string" || !OPAQUE_ID.test(input.assetId))
    throw new AppError("errors.memory.invalidInput");
  const base = validateCreateMemoryInput({
    type: input.type,
    title: input.title,
    body: input.body,
    source: input.source,
    project: input.project,
  });
  return { assetId: input.assetId, ...base };
}

/** Exposed for route/tests: validates the archive-memory payload. */
export function validateArchiveMemoryInput(value: unknown): {
  assetId: string;
} {
  const input = record(value);
  onlyKeys(input, ["assetId"]);
  if (typeof input.assetId !== "string" || !OPAQUE_ID.test(input.assetId))
    throw new AppError("errors.memory.invalidInput");
  return { assetId: input.assetId };
}

/** Load the memory hub read model (route loader / page refresh). */
export const getMemoryAssets = createServerFn({ method: "GET" }).handler(
  async (): Promise<MemoryEntry[]> => {
    const { listMemoryAssets } = await import("./api.server.ts");
    return listMemoryAssets();
  },
);

/** Create a manual memory entry (body hashed, only summary persisted). */
export const createMemory = createServerFn({ method: "POST" })
  .validator(validateCreateMemoryInput)
  .handler(async ({ data }): Promise<MemoryActionResponse> => {
    const { createMemoryAsset } = await import("./api.server.ts");
    return createMemoryAsset(data);
  });

/** Update an existing memory entry (new version; body re-hashed). */
export const updateMemory = createServerFn({ method: "POST" })
  .validator(validateUpdateMemoryInput)
  .handler(async ({ data }): Promise<MemoryActionResponse> => {
    const { updateMemoryAsset } = await import("./api.server.ts");
    return updateMemoryAsset(data);
  });

/** Archive (soft-delete) a memory entry. */
export const archiveMemory = createServerFn({ method: "POST" })
  .validator(validateArchiveMemoryInput)
  .handler(async ({ data }): Promise<{ ok: boolean; errorCode?: string }> => {
    const { archiveMemoryAsset } = await import("./api.server.ts");
    return archiveMemoryAsset(data.assetId);
  });
