import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, sep } from "node:path";

import type { LocalUsageDiagnostic } from "../types.ts";
import { GENERIC_ADAPTER_MAX_FILE_SIZE_BYTES } from "./catalog.ts";
import type {
  ExternalUsageAdapterConfig,
  ExternalUsageAdapterFile,
  UsageAdapterContract,
  UsageAdapterPath,
  UsageFieldMapping,
} from "./types.ts";

const MAX_EXTERNAL_ADAPTERS = 20;
const MAX_PATHS_PER_ADAPTER = 12;
const MAX_FIELD_CANDIDATES = 12;
const MAX_FIELD_PATH_LENGTH = 160;
const MAX_SQL_QUERY_LENGTH = 4_000;
const ADAPTER_KEYS = new Set(["id", "paths", "mapping", "query"]);
const PATH_KEYS = new Set(["root", "glob", "format"]);
const MAPPING_KEYS = new Set([
  "records",
  "timestamp",
  "sessionId",
  "model",
  "project",
  "inputTokens",
  "cachedInputTokens",
  "cacheCreationInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
]);
const FIELD_PATH_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
const SAFE_GLOB_PATTERN = /^[A-Za-z0-9_./*?[\]-]+$/;
const FORBIDDEN_SQL_PATTERN =
  /\b(?:attach|detach|insert|update|delete|replace|create|alter|drop|vacuum|reindex|pragma)\b/i;

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function safeRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 240 ||
    value.includes("\0") ||
    isAbsolute(value)
  ) {
    return false;
  }
  const normalized = normalize(value);
  return normalized !== ".." && !normalized.startsWith(`..${sep}`);
}

function safeGlob(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    !value.includes("..") &&
    SAFE_GLOB_PATTERN.test(value)
  );
}

function fieldPaths(value: unknown, required = false): string[] | undefined {
  if (value == null && !required) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_FIELD_CANDIDATES ||
    !value.every(
      (path) =>
        typeof path === "string" &&
        path.length <= MAX_FIELD_PATH_LENGTH &&
        FIELD_PATH_PATTERN.test(path),
    )
  ) {
    return undefined;
  }
  return [...new Set(value)];
}

function parsePath(value: unknown): UsageAdapterPath | undefined {
  const path = objectValue(value);
  if (
    path == null ||
    !hasOnlyKeys(path, PATH_KEYS) ||
    !safeRelativePath(path.root) ||
    !safeGlob(path.glob) ||
    (path.format !== "json" && path.format !== "jsonl" && path.format !== "sqlite")
  ) {
    return undefined;
  }
  return { root: path.root, glob: path.glob, format: path.format };
}

function safeReadOnlyQuery(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SQL_QUERY_LENGTH ||
    value.includes(";") ||
    FORBIDDEN_SQL_PATTERN.test(value)
  ) {
    return false;
  }
  return /^(?:select|with)\b/i.test(value.trim()) && /\bselect\b/i.test(value);
}

function parseMapping(value: unknown): UsageFieldMapping | undefined {
  const mapping = objectValue(value);
  if (mapping == null || !hasOnlyKeys(mapping, MAPPING_KEYS)) {
    return undefined;
  }
  const timestamp = fieldPaths(mapping.timestamp, true);
  if (timestamp == null) {
    return undefined;
  }
  const parsed: UsageFieldMapping = { timestamp };
  for (const key of MAPPING_KEYS) {
    if (key === "timestamp") continue;
    const paths = fieldPaths(mapping[key]);
    if (mapping[key] != null && paths == null) {
      return undefined;
    }
    if (paths != null) {
      parsed[key as keyof UsageFieldMapping] = paths;
    }
  }
  if (parsed.inputTokens == null && parsed.outputTokens == null && parsed.totalTokens == null) {
    return undefined;
  }
  return parsed;
}

function parseAdapter(value: unknown): ExternalUsageAdapterConfig | undefined {
  const adapter = objectValue(value);
  if (
    adapter == null ||
    !hasOnlyKeys(adapter, ADAPTER_KEYS) ||
    typeof adapter.id !== "string" ||
    !ADAPTER_ID_PATTERN.test(adapter.id) ||
    !Array.isArray(adapter.paths) ||
    adapter.paths.length === 0 ||
    adapter.paths.length > MAX_PATHS_PER_ADAPTER
  ) {
    return undefined;
  }
  const paths = adapter.paths.map(parsePath);
  const mapping = parseMapping(adapter.mapping);
  const usesSqlite = paths.some((path) => path?.format === "sqlite");
  if (
    paths.some((path) => path == null) ||
    mapping == null ||
    (usesSqlite && !safeReadOnlyQuery(adapter.query)) ||
    (!usesSqlite && adapter.query != null)
  ) {
    return undefined;
  }
  return {
    id: adapter.id,
    paths: paths as UsageAdapterPath[],
    mapping,
    ...(usesSqlite ? { query: adapter.query as string } : {}),
  };
}

export async function loadExternalUsageAdapters(
  configFilePath: string,
): Promise<{ adapters: UsageAdapterContract[]; diagnostics: LocalUsageDiagnostic[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configFilePath, "utf8")) as unknown;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { adapters: [], diagnostics: [] };
    }
    return {
      adapters: [],
      diagnostics: [
        {
          source: "custom:config",
          code: "config-invalid",
          count: 1,
          message: "外部 Token 适配配置无法读取或不是有效 JSON。",
        },
      ],
    };
  }

  const parsed = parseExternalUsageAdapterFile(raw);
  if (parsed.file == null) {
    return { adapters: [], diagnostics: parsed.diagnostics };
  }

  return {
    adapters: parsed.file.adapters.map((adapter) => ({
      source: `custom:${adapter.id}`,
      paths: adapter.paths,
      mapping: adapter.mapping,
      query: adapter.query,
      maxFileSizeBytes:
        adapter.query == null ? GENERIC_ADAPTER_MAX_FILE_SIZE_BYTES : 512 * 1024 * 1024,
      kind: "external",
    })),
    diagnostics: [],
  };
}

export function parseExternalUsageAdapterFile(raw: unknown): {
  file?: ExternalUsageAdapterFile;
  diagnostics: LocalUsageDiagnostic[];
} {
  const file = objectValue(raw);
  if (
    file == null ||
    !hasOnlyKeys(file, new Set(["version", "adapters"])) ||
    file.version !== 1 ||
    !Array.isArray(file.adapters) ||
    file.adapters.length > MAX_EXTERNAL_ADAPTERS
  ) {
    return {
      diagnostics: [
        {
          source: "custom:config",
          code: "config-invalid",
          count: 1,
          message: "外部 Token 适配配置不符合受限 schema。",
        },
      ],
    };
  }

  const adapters = file.adapters.map(parseAdapter);
  if (adapters.some((adapter) => adapter == null)) {
    return {
      diagnostics: [
        {
          source: "custom:config",
          code: "config-invalid",
          count: 1,
          message: "外部 Token 适配配置包含非法路径、glob、只读查询或字段映射。",
        },
      ],
    };
  }

  const ids = adapters.map((adapter) => adapter?.id);
  if (new Set(ids).size !== ids.length) {
    return {
      diagnostics: [
        {
          source: "custom:config",
          code: "config-invalid",
          count: 1,
          message: "外部 Token 适配器 id 必须唯一。",
        },
      ],
    };
  }

  return {
    file: { version: 1, adapters: adapters as ExternalUsageAdapterConfig[] },
    diagnostics: [],
  };
}

export type { ExternalUsageAdapterFile };
