import { createServerFn } from "@tanstack/react-start";

import type { MemorySnapshot } from "./types.ts";

interface MemoryRequest {
  customPaths: string[];
  includeDefaults: boolean;
}

const requestValidator = (input: MemoryRequest): MemoryRequest => {
  if (
    !Array.isArray(input?.customPaths) ||
    input.customPaths.length > 50 ||
    input.customPaths.some((path) => typeof path !== "string") ||
    typeof input?.includeDefaults !== "boolean"
  ) {
    throw new Error("记忆目录参数不合法");
  }
  return {
    customPaths: input.customPaths.map((path) => path.trim()).filter(Boolean),
    includeDefaults: input.includeDefaults,
  };
};

export const getLocalMemory = createServerFn({ method: "GET" })
  .validator(requestValidator)
  .handler(async ({ data }): Promise<MemorySnapshot> => {
    const { scanLocalMemory } = await import("./scanner.server.ts");
    return scanLocalMemory({
      customPaths: data.customPaths,
      includeDefaults: data.includeDefaults,
    });
  });
