/** Provider registry + offline fallback provider for local AI execution.
 *
 * Real provider adapters (Claude, OpenAI, …) will register themselves here. The
 * registry is intentionally tiny: same-id `register` overwrites, `resolve`
 * returns undefined for unknown ids, and `list` exposes only stable provider
 * ids — never prompts, inputs, or secret material.
 *
 * The deterministic `offlineProvider` performs no I/O and no network access,
 * mirroring `application.ts#fallbackResponse`. When the registry has nothing
 * registered, `createRegistryRouter` returns undefined from `route`, letting
 * `executeAIRequest` fall through to its `offlineFallback` port — the built-in
 * safe default.
 */
import type {
  AIProviderId,
  AIProviderRequest,
  AIResponse,
} from "./contracts.ts";
import type { AIModelProvider, AIRequest, ModelRouter } from "./contracts.ts";

const OFFLINE_FALLBACK_TEXT =
  "Offline deterministic fallback: model execution was not available.";

export interface AIProviderRegistry {
  /** Register or replace a provider by its id. */
  register(provider: AIModelProvider): void;
  /** Resolve a registered provider, or undefined when unknown. */
  resolve(providerId: AIProviderId): AIModelProvider | undefined;
  /** Read-only snapshot of registered provider ids (for UI/diagnostics). */
  list(): readonly AIProviderId[];
}

export function createProviderRegistry(
  initial?: readonly AIModelProvider[],
): AIProviderRegistry {
  const providers = new Map<AIProviderId, AIModelProvider>();
  for (const provider of initial ?? [])
    providers.set(provider.providerId, provider);
  return {
    register(provider) {
      providers.set(provider.providerId, provider);
    },
    resolve(providerId) {
      return providers.get(providerId);
    },
    list() {
      return [...providers.keys()];
    },
  };
}

/**
 * Deterministic offline provider. Receives an `AIProviderRequest` (the shape
 * `executeAIRequest` hands to a routed provider) and emits a fixed response
 * derived only from `modelId`. It deliberately does not echo `request.input`,
 * `request.prompt`, or any caller-supplied text — privacy-safe by construction.
 */
export const offlineProvider: AIModelProvider = {
  providerId: "offline",
  async invoke(request: AIProviderRequest): Promise<AIResponse> {
    return {
      providerId: "offline",
      modelId: request.modelId,
      text: OFFLINE_FALLBACK_TEXT,
      finishReason: "stop",
    };
  },
};

/**
 * Router that resolves `request.providerId ?? "offline"` against the registry.
 * Returns undefined when unregistered so `executeAIRequest` invokes its
 * `offlineFallback` port — the safe default for empty registries.
 */
export function createRegistryRouter(
  registry: AIProviderRegistry,
): ModelRouter {
  return {
    route(request: AIRequest): AIModelProvider | undefined {
      return registry.resolve(request.providerId ?? "offline");
    },
  };
}
