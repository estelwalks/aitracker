/**
 * LLM configuration probe shared by the feature transports (reports,
 * distillation, dashboard insight). It only ever reads environment variables
 * and returns a safe projection; the API key itself is never handed to the
 * renderer. The dashboards' richer `resolveDashboardAIInsightConfig` remains in
 * the dashboard module for provider construction — this helper is the
 * renderer-facing "is a real model configured?" gate.
 */
export interface LLMEnvConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

export function readLLMConfig(
  env: NodeJS.ProcessEnv = process.env,
): LLMEnvConfig | undefined {
  const baseUrl = env.TRUSTTOOLS_LLM_BASE_URL?.trim();
  const apiKey = env.TRUSTTOOLS_LLM_API_KEY?.trim();
  const model = env.TRUSTTOOLS_LLM_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  if (apiKey.length < 8 || /[\r\n]/.test(apiKey)) return undefined;
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) return undefined;
  try {
    const url = new URL(baseUrl);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    )
      return undefined;
    return { baseUrl, apiKey, model };
  } catch {
    return undefined;
  }
}

/** True when a usable model endpoint is configured for AI generation. */
export function isLLMConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readLLMConfig(env) !== undefined;
}

/** Renderer-safe LLM configuration status. The API key never crosses the boundary. */
export interface LLMConfigStatus {
  readonly configured: boolean;
  readonly model: string | null;
  readonly baseUrl: string | null;
  readonly apiKeyMasked: boolean;
}
