import { COOKIE_TOKEN_NAME, ENV } from "./app-config.js";
import type {
  SecurityScanHistoryEntry,
  SecurityScanRunRecord,
  SecurityScanSchedule,
  SecurityScanScheduleRuntime,
} from "./contracts.js";
import { ProviderSchema, type ModelConfig } from "skill-scanner";

interface StoredModelProfile {
  readonly mode: "official" | "custom";
  readonly protocol: "openai" | "openai-responses" | "anthropic";
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly model?: string;
}

type ScannerProtocol = "openai-responses" | "openai-completions" | "anthropic";

/**
 * Keep the desktop caller compatible with both scanner generations:
 * older packages call this field `provider` and only accept `openai`,
 * while the protocol-aware package accepts the explicit three-value format.
 * Prefer the explicit value as soon as the installed scanner schema supports
 * it; do not silently collapse Responses into Chat Completions in that case.
 */
function scannerProtocol(profile: StoredModelProfile): ScannerProtocol {
  return profile.protocol === "openai"
    ? "openai-completions"
    : profile.protocol;
}

function scannerProvider(profile: StoredModelProfile): string | undefined {
  const protocol = scannerProtocol(profile);
  const parsed = ProviderSchema.safeParse(protocol);
  // Until skill-scanner is upgraded, preserve its legacy enum so the current
  // strict schema remains valid. The upgraded schema accepts the explicit
  // protocol identifiers above and therefore takes this branch naturally.
  return parsed.success
    ? parsed.data
    : ProviderSchema.safeParse(
          protocol === "anthropic" ? "anthropic" : "openai",
        ).success
      ? protocol === "anthropic"
        ? "anthropic"
        : "openai"
      : undefined;
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
    init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
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
        signal: AbortSignal.timeout(10_000),
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
      body: { entries },
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
    // `provider` is the skill-scanner protocol selector. During the package
    // transition, explicit protocol values are used when accepted; otherwise
    // the legacy `openai` alias keeps the current scanner schema valid.
    const provider = scannerProvider(profile);
    if (provider !== undefined) config.provider = provider;
    return config as ModelConfig;
  }
}
