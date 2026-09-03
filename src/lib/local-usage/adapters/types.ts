import type {
  PlatformTarget,
  UsageReaderKey,
} from "../../tool-registry/contracts.ts";
import type { LocalUsageSource } from "../types.ts";

export type UsageLogFormat = "json" | "jsonl" | "sqlite";

export interface UsageAdapterPath {
  root: string;
  glob: string;
  format: UsageLogFormat;
  /** Platform targets from the registry; omitted means every platform. */
  targets?: readonly PlatformTarget[];
}

export interface UsageFieldMapping {
  records?: string[];
  timestamp: string[];
  sessionId?: string[];
  model?: string[];
  project?: string[];
  inputTokens?: string[];
  cachedInputTokens?: string[];
  cacheCreationInputTokens?: string[];
  outputTokens?: string[];
  reasoningOutputTokens?: string[];
  totalTokens?: string[];
}

export interface UsageAdapterContract {
  source: LocalUsageSource;
  reader: UsageReaderKey;
  paths: UsageAdapterPath[];
  mapping: UsageFieldMapping;
  query?: string;
  maxFileSizeBytes: number;
  kind: "builtin" | "external";
}

export interface ExternalUsageAdapterConfig {
  id: string;
  paths: UsageAdapterPath[];
  mapping: UsageFieldMapping;
  query?: string;
}
