import { createServerFn } from "@tanstack/react-start";

import type { SourcesQuerySummary } from "./presentation/model";

/**
 * Browser-safe RPC facade for the Sources page (P4-T4-01 / P6-T6-01).
 * Handlers load the server adapter dynamically; the presentation layer never
 * imports `api.server.ts` statically.
 */

export const getSourcesQuery = createServerFn({ method: "GET" }).handler(
  async (): Promise<SourcesQuerySummary> => {
    const { getSourcesQuery: load } = await import("./api.server.ts");
    return load();
  },
);

export const refreshSourcesQuery = createServerFn({ method: "POST" }).handler(
  async (): Promise<SourcesQuerySummary> => {
    const { refreshSourcesQuery: refresh } = await import("./api.server.ts");
    return refresh();
  },
);
export interface GetToolDataDirectoryInput {
  toolId: string;
}

export interface SetToolDataDirectoryInput {
  toolId: string;
  /** Absolute directory, or null to restore the registry default. */
  dataDir: string | null;
}

function parseToolId(input: unknown): GetToolDataDirectoryInput {
  const value =
    input != null && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (typeof value.toolId !== "string" || value.toolId.length === 0) {
    throw new Error("sources.dataDir.invalid");
  }
  return { toolId: value.toolId };
}

/**
 * Reads the configured data directory for one tool. The value is the user's
 * own choice echoed back to the configuration modal (browser-safe carve-out
 * documented with migration 0003); it never appears in summaries or exports.
 */
export const getToolDataDirectory = createServerFn({
  method: "POST",
})
  .validator(parseToolId)
  .handler(async ({ data }): Promise<{ dataDir: string | null }> => {
    const { getCompositionRoot } =
      await import("../../../app/composition.server.ts");
    const { readToolDataDirectory } =
      await import("./tool-data-directory.server.ts");
    const root = await getCompositionRoot();
    const dataDir = await readToolDataDirectory(
      root.database.features.toolDataRoots,
      data.toolId,
    );
    return { dataDir };
  });

/**
 * Sets or clears the data-directory override for one tool and returns the
 * new state. Snapshot refreshes are triggered by the page refresh flow.
 */
export const setToolDataDirectory = createServerFn({ method: "POST" })
  .validator((input: unknown): SetToolDataDirectoryInput => {
    const parsed = parseToolId(input);
    const value =
      input != null && typeof input === "object"
        ? (input as Record<string, unknown>)
        : {};
    const dataDir = value.dataDir;
    if (dataDir !== null && typeof dataDir !== "string") {
      throw new Error("sources.dataDir.invalid");
    }
    return { toolId: parsed.toolId, dataDir: dataDir as string | null };
  })
  .handler(
    async ({
      data,
    }): Promise<{
      configured: boolean;
      dataDir: string | null;
    }> => {
      const { getCompositionRoot } =
        await import("../../../app/composition.server.ts");
      const { writeToolDataDirectory } =
        await import("./tool-data-directory.server.ts");
      const root = await getCompositionRoot();
      const view = await writeToolDataDirectory(
        root.database.features.toolDataRoots,
        data.toolId,
        data.dataDir,
      );
      return { configured: view.configured, dataDir: view.dataDir };
    },
  );
