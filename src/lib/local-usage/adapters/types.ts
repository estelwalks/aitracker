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
  /** Time-window predicate for `query`; one `?` takes the cutoff timestamp. */
  windowFilter?: string;
  /**
   * Whole-file byte budget for paths read in one piece (json/jsonl). It does
   * not apply to `format: "sqlite"` paths: those run a prepared statement
   * rather than buffering the file, so their size says nothing about scan
   * memory (issue #42) - sqlite reads are bounded by the scanner's row budget
   * instead.
   */
  maxFileSizeBytes: number;
  kind: "builtin" | "external";
}

export interface ExternalUsageAdapterConfig {
  id: string;
  paths: UsageAdapterPath[];
  mapping: UsageFieldMapping;
  query?: string;
  /** See `UsageAdapterContract.windowFilter`. */
  windowFilter?: string;
}
