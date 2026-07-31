import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { parseExternalUsageAdapterFile } from "./adapters/config.server.ts";
import type { ExternalUsageAdapterFile } from "./adapters/types.ts";

const CONFIG_PATH = join(homedir(), ".trusttools", "usage-adapters.json");
const EMPTY_CONFIG: ExternalUsageAdapterFile = { version: 1, adapters: [] };

export interface UsageAdapterConfigState {
  path: string;
  text: string;
}

export async function readUsageAdapterConfig(): Promise<UsageAdapterConfigState> {
  const text = await readFile(CONFIG_PATH, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return `${JSON.stringify(EMPTY_CONFIG, null, 2)}\n`;
    throw error;
  });
  return { path: CONFIG_PATH, text };
}

export async function writeUsageAdapterConfig(text: string): Promise<UsageAdapterConfigState> {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("配置不是有效 JSON");
  }
  const parsed = parseExternalUsageAdapterFile(raw);
  if (parsed.file == null) {
    throw new Error(parsed.diagnostics[0]?.message ?? "适配器配置不合法");
  }

  const normalized = `${JSON.stringify(parsed.file, null, 2)}\n`;
  const temporaryPath = `${CONFIG_PATH}.${process.pid}.tmp`;
  await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  await writeFile(temporaryPath, normalized, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, CONFIG_PATH);
  return { path: CONFIG_PATH, text: normalized };
}
