import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

async function readMemoryExcludes(): Promise<string[]> {
  let prefsDir: string;
  try {
    const { app } = await import("electron");
    prefsDir = app.getPath("userData");
  } catch {
    prefsDir = join(homedir(), ".trusttools");
  }
  const prefsPath = join(prefsDir, "trusttools-prefs.json");
  try {
    const raw = await readFile(prefsPath, "utf8");
    const prefs = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(prefs.memoryExcludes)) {
      return prefs.memoryExcludes
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
        .map((item) => item.trim());
    }
  } catch {
    // fall through
  }
  return [];
}

export const getLocalMemory = createServerFn({ method: "GET" })
  .validator(requestValidator)
  .handler(async ({ data }): Promise<MemorySnapshot> => {
    const [{ scanLocalMemory }, excludes] = await Promise.all([
      import("./scanner.server.ts"),
      readMemoryExcludes(),
    ]);
    return scanLocalMemory({
      customPaths: data.customPaths,
      includeDefaults: data.includeDefaults,
      memoryExcludes: excludes,
    });
  });
