import { COOKIE_TOKEN_NAME, ENV } from "./app-config.js";
import type {
  SecurityFindingDto,
  SecurityScanHistoryEntry,
  SecurityScanRunRecord,
  SecurityScanSchedule,
  SecurityScanScheduleRuntime,
  SecurityTokenUsageBreakdownDto,
  SecurityTokenUsageDto,
} from "./contracts.js";
import type { ModelConfig } from "@estelwalks/agent-threat-scanner";

interface StoredModelProfile {
  readonly mode: "official" | "custom";
  readonly protocol: "openai" | "openai-responses" | "anthropic";
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly model?: string;
}

type ScannerProtocol = "openai-responses" | "openai-completions" | "anthropic";

/**
 * The browser-side broker accepts requests up to 2 MiB, while the renderer
 * persists a compact projection of security history.  Sending full scanner
 * reports across that boundary is unsafe: model reports can contain dozens of
 * findings and hundreds of skipped files, so the final history write can be
 * rejected or block the local server even when every Skill scan completed
 * successfully. Keep the transport well below the server's 2 MiB request
 * ceiling and let the server perform the authoritative privacy projection
 * before persistence.
 */
export const MAX_SECURITY_HISTORY_TRANSPORT_BYTES = 512_000;
const MAX_TRANSPORT_FINDINGS = 50;
const MAX_TRANSPORT_SKIPPED_FILES = 100;
const MAX_TRANSPORT_MODELS = 16;

function boundedText(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

function compactFinding(finding: SecurityFindingDto): SecurityFindingDto {
  const {
    excerpt: _excerpt,
    reasoning: _reasoning,
    ...withoutEvidence
  } = finding;
  return {
    ...withoutEvidence,
    id: boundedText(finding.id, 180),
    kindDisplay: boundedText(finding.kindDisplay, 120),
    severityDisplay: boundedText(finding.severityDisplay, 80),
    ...(finding.ruleId == null
      ? {}
      : { ruleId: boundedText(finding.ruleId, 128) }),
    ruleName: boundedText(finding.ruleName, 240),
    message: boundedText(finding.message, 240),
    remediation: boundedText(finding.remediation, 240),
    ...(finding.cweId == null ? {} : { cweId: boundedText(finding.cweId, 64) }),
    path: boundedText(finding.path, 256),
    ...(finding.fileHash == null
      ? {}
      : { fileHash: boundedText(finding.fileHash, 128) }),
    // Excerpts and model reasoning are useful in the live result but are not
    // part of the persisted history projection.  Omitting them here avoids
    // moving sensitive source evidence through the broker a second time.
  };
}

function compactUsageBreakdown(
  breakdown: SecurityTokenUsageBreakdownDto,
): SecurityTokenUsageBreakdownDto {
  return { ...breakdown };
}

function compactTokenUsage(
  usage: SecurityTokenUsageDto | undefined,
): SecurityTokenUsageDto | undefined {
  if (!usage) return undefined;
  return {
    ...usage,
    byModel: Object.fromEntries(
      Object.entries(usage.byModel)
        .slice(0, MAX_TRANSPORT_MODELS)
        .map(([model, breakdown]) => [
          boundedText(model, 128),
          compactUsageBreakdown(breakdown),
        ]),
    ),
    byBranch: Object.fromEntries(
      Object.entries(usage.byBranch).map(([branch, breakdown]) => [
        branch,
        compactUsageBreakdown(breakdown),
      ]),
    ) as SecurityTokenUsageDto["byBranch"],
  };
}

function compactHistoryEntry(
  entry: SecurityScanHistoryEntry,
): SecurityScanHistoryEntry {
  if (!entry.report) return entry;
  const report = entry.report;
  const tokenUsage = compactTokenUsage(report.tokenUsage);
  return {
    ...entry,
    id: boundedText(entry.id, 160),
    skillName: boundedText(entry.skillName, 160),
    startedAt: boundedText(entry.startedAt, 40),
    finishedAt: boundedText(entry.finishedAt, 40),
    ...(entry.errorCode == null
      ? {}
      : { errorCode: boundedText(entry.errorCode, 160) }),
    report: {
      ...report,
      rulesVersion: boundedText(report.rulesVersion, 128),
      engineVersion: boundedText(report.engineVersion, 128),
      contentHash: boundedText(report.contentHash, 128),
      threatLevelDisplay: boundedText(report.threatLevelDisplay, 80),
      categories: {},
      summary: boundedText(report.summary, 500),
      findings: report.findings
        .slice(0, MAX_TRANSPORT_FINDINGS)
        .map(compactFinding),
      // Rules contain duplicate match excerpts and are discarded by the
      // server projection.  Do not send them over the broker at all.
      rules: [],
      branches: report.branches.slice(0, 8).map((branch) => ({
        ...branch,
        ...(branch.detail == null
          ? {}
          : { detail: boundedText(branch.detail, 240) }),
      })),
      skippedFiles: report.skippedFiles
        .slice(0, MAX_TRANSPORT_SKIPPED_FILES)
        .map((file) => ({
          ...file,
          path: boundedText(file.path, 256),
          reason: boundedText(file.reason, 240),
        })),
      ...(tokenUsage ? { tokenUsage } : {}),
    },
  };
}

/**
 * Prepare the history document for the local HTTP hop.  This is only a
 * transport bound; the server still re-validates and projects all fields
 * before writing to the privacy-guarded app_preferences row.
 */
export function compactSecurityHistoryForTransport(
  entries: readonly SecurityScanHistoryEntry[],
): SecurityScanHistoryEntry[] {
  const compacted = entries.slice(0, 200).map(compactHistoryEntry);
  while (
    compacted.length > 1 &&
    Buffer.byteLength(JSON.stringify({ entries: compacted }), "utf8") >
      MAX_SECURITY_HISTORY_TRANSPORT_BYTES
  ) {
    // History is newest-first at this boundary, so discard the oldest entry.
    compacted.pop();
  }
  return compacted;
}

/** Maps the app's legacy profile label to the published scanner protocol. */
function scannerProtocol(profile: StoredModelProfile): ScannerProtocol {
  return profile.protocol === "openai"
    ? "openai-completions"
    : profile.protocol;
}

export interface DesktopStateBrokerOptions {
  readonly origin: () => string;
  readonly capabilityToken: () => string | undefined;
  readonly fetchFn?: typeof fetch;
}

export class DesktopStateBroker {
  readonly #options: DesktopStateBrokerOptions;

  constructor(options: DesktopStateBrokerOptions) {
    this.#options = options;
  }

  async #request<T>(
    path: string,
    init: {
      method?: "GET" | "POST" | "PUT";
      body?: unknown;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const token = process.env[ENV.DESKTOP_BROKER_TOKEN];
    if (!token) throw new Error("Desktop state broker token is unavailable");
    const origin = this.#options.origin();
    if (!origin) throw new Error("Desktop state broker origin is unavailable");
    const capability = this.#options.capabilityToken();
    const response = await (this.#options.fetchFn ?? fetch)(
      new URL(`/api/desktop-state${path}`, origin),
      {
        method: init.method ?? "GET",
        headers: {
          Accept: "application/json",
          "x-aitracker-desktop-broker": token,
          ...(init.body === undefined
            ? {}
            : { "content-type": "application/json" }),
          ...(capability
            ? { Cookie: `${COOKIE_TOKEN_NAME}=${capability}` }
            : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
      },
    );
    if (!response.ok)
      throw new Error(`Desktop state broker returned HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  preferences(): Promise<Record<string, unknown>> {
    return this.#request("/preferences");
  }

  async setPreference(key: string, value: unknown): Promise<void> {
    await this.#request("/preference", {
      method: "POST",
      body: { key, value },
    });
  }

  resetPreferences(): Promise<{ removedKeys: number }> {
    return this.#request("/preferences/reset", { method: "POST", body: {} });
  }

  readHistory(): Promise<SecurityScanHistoryEntry[]> {
    return this.#request("/security-history");
  }

  async writeHistory(
    entries: readonly SecurityScanHistoryEntry[],
  ): Promise<void> {
    await this.#request("/security-history", {
      method: "PUT",
      body: { entries: compactSecurityHistoryForTransport(entries) },
      // Projection plus the privacy guard is deliberately synchronous in the
      // local server. Give this one bounded write enough time to finish while
      // retaining the short timeout for ordinary broker reads and writes.
      timeoutMs: 30_000,
    });
  }

  async clearHistory(): Promise<void> {
    await this.writeHistory([]);
  }

  readSchedule(): Promise<SecurityScanSchedule | null> {
    return this.#request("/scan-schedule");
  }

  async writeSchedule(schedule: SecurityScanSchedule): Promise<void> {
    await this.#request("/scan-schedule", {
      method: "PUT",
      body: { schedule },
    });
  }

  readScheduleRuntime(): Promise<SecurityScanScheduleRuntime | null> {
    return this.#request("/scan-schedule-runtime");
  }

  async writeScheduleRuntime(
    runtime: SecurityScanScheduleRuntime,
  ): Promise<void> {
    await this.#request("/scan-schedule-runtime", {
      method: "PUT",
      body: { runtime },
    });
  }

  readLatestRun(): Promise<SecurityScanRunRecord | null> {
    return this.#request("/security-scan-run/latest");
  }

  async writeRun(run: SecurityScanRunRecord): Promise<void> {
    await this.#request("/security-scan-run", {
      method: "PUT",
      body: { run },
    });
  }

  async recoverInterruptedRuns(finishedAt: string): Promise<number> {
    const result = await this.#request<{ recovered: number }>(
      "/security-scan-run/recover",
      { method: "POST", body: { finishedAt } },
    );
    return result.recovered;
  }

  async modelConfig(): Promise<ModelConfig | undefined> {
    const profile = await this.#request<StoredModelProfile | null>(
      "/model-profile",
    );
    if (!profile?.apiKey) return undefined;
    const endpoint =
      profile.mode === "official"
        ? "https://api.deepseek.com/v1"
        : (profile.endpoint ??
          (profile.protocol === "anthropic"
            ? "https://api.anthropic.com/v1"
            : "https://api.openai.com/v1"));
    const model = profile.mode === "official" ? "deepseek-chat" : profile.model;
    if (!model) throw new Error("Active model profile has no model");
    const config: Record<string, unknown> = {
      endpoint,
      apiKey: profile.apiKey,
      liteModel: model,
      proModel: model,
      timeoutMs: 120_000,
      maxAgentTurns: 8,
    };
    // `provider` is the published scanner's protocol selector.
    config.provider = scannerProtocol(profile);
    return config as ModelConfig;
  }
}
