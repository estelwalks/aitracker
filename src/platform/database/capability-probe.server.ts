/**
 * Runtime version/capability probe (Story S-01, T-01-02).
 *
 * Server-only. The core decision is a pure function โ€?`evaluateCapabilities` โ€? * so tests can inject fake versions and probe results. The Node provider reads
 * `process.versions` plus `SELECT sqlite_version()` from a throwaway
 * `:memory:` connection (no persistent connection is ever held by the probe).
 *
 * This module deliberately contains **no** `node:sqlite` import: every driver
 * touch is delegated to the narrow helpers in
 * `infrastructure/sqlite-runtime.server.ts`, which is the only place allowed to
 * name the driver (gate rule `platform-node-sqlite-outside-infrastructure`).
 */
import {
  probeJournalModeIn,
  readRuntimeSqliteVersion,
} from "./infrastructure/sqlite-runtime.server.ts";

/** Runtime facts recorded at startup (architecture ยง3.2). */
export interface RuntimeVersions {
  readonly nodeVersion: string;
  readonly electronVersion?: string;
  readonly chromeVersion?: string;
  readonly sqliteVersion: string;
}

/** Injectable source of runtime versions (fakeable in tests). */
export interface RuntimeVersionsProvider {
  getVersions(): RuntimeVersions;
}

/** Result of probing a real file-backed database for WAL support. */
export interface CapabilityProbeResult {
  /** `PRAGMA journal_mode` observed after requesting WAL. */
  readonly journalMode: string;
}

export type CapabilityFailureReason =
  "sqlite-below-baseline" | "sqlite-version-unparseable" | "wal-unavailable";

export interface CapabilityEvaluation {
  readonly supported: boolean;
  readonly failureReason: CapabilityFailureReason | null;
  readonly versions: RuntimeVersions;
  readonly probe: CapabilityProbeResult;
}

/**
 * Baseline runtime (ADR ยง4.4): Electron 43.4.1 / Node 24.18.1 / SQLite 3.53.1.
 * Only the SQLite version gates the write path; node/electron/chrome are
 * recorded for diagnostics so web-mode runs are not blocked by their absence.
 */
export const SQLITE_BASELINE_VERSION = "3.53.1";

export interface ParsedSqliteVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Parses a `major.minor.patch` version string, ignoring trailing suffixes. */
export function parseSqliteVersion(
  version: string,
): ParsedSqliteVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (match === null) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/** Numeric three-part comparison; `null` when either side is unparseable. */
export function compareSqliteVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parsedA = parseSqliteVersion(a);
  const parsedB = parseSqliteVersion(b);
  if (parsedA === null || parsedB === null) return null;
  const difference =
    parsedA.major - parsedB.major ||
    parsedA.minor - parsedB.minor ||
    parsedA.patch - parsedB.patch;
  return difference < 0 ? -1 : difference > 0 ? 1 : 0;
}

/**
 * Pure capability decision. Returns a structured result with a stable failure
 * reason; it never throws and never opens a connection.
 */
export function evaluateCapabilities(
  versions: RuntimeVersions,
  probe: CapabilityProbeResult,
): CapabilityEvaluation {
  const comparison = compareSqliteVersions(
    versions.sqliteVersion,
    SQLITE_BASELINE_VERSION,
  );
  if (comparison === null) {
    return evaluation(false, "sqlite-version-unparseable", versions, probe);
  }
  if (comparison < 0) {
    return evaluation(false, "sqlite-below-baseline", versions, probe);
  }
  if (probe.journalMode !== "wal") {
    return evaluation(false, "wal-unavailable", versions, probe);
  }
  return evaluation(true, null, versions, probe);
}

export interface NodeRuntimeVersionsProviderOptions {
  /** Injectable sqlite version source; defaults to a throwaway query. */
  readonly sqliteVersionSource?: () => string;
}

/** Node/Electron adapter reading `process.versions` plus `sqlite_version()`. */
export class NodeRuntimeVersionsProvider implements RuntimeVersionsProvider {
  private readonly sqliteVersionSource: () => string;

  constructor(options: NodeRuntimeVersionsProviderOptions = {}) {
    this.sqliteVersionSource =
      options.sqliteVersionSource ?? readRuntimeSqliteVersion;
  }

  getVersions(): RuntimeVersions {
    const versions = process.versions as Readonly<{
      node?: string;
      electron?: string;
      chrome?: string;
    }>;
    return {
      nodeVersion: versions.node ?? "unknown",
      electronVersion: versions.electron,
      chromeVersion: versions.chrome,
      sqliteVersion: this.sqliteVersionSource(),
    };
  }
}

/**
 * Probes a real file-backed database in `directory` for WAL support and cleans
 * up after itself. No persistent connection survives the call.
 */
export function probeWalCapability(directory: string): CapabilityProbeResult {
  return { journalMode: probeJournalModeIn(directory).journalMode };
}

function evaluation(
  supported: boolean,
  failureReason: CapabilityFailureReason | null,
  versions: RuntimeVersions,
  probe: CapabilityProbeResult,
): CapabilityEvaluation {
  return { supported, failureReason, versions, probe };
}
