import type {
  LocalUsageEvent,
  LocalUsageSource,
} from "../local-usage/types.ts";

export type {
  LocalUsageEvent,
  LocalUsageSource,
} from "../local-usage/types.ts";

export type ProviderAwareUsageEvent = LocalUsageEvent & { provider?: unknown };

export function resolveEventProvider(event: ProviderAwareUsageEvent): string {
  if (typeof event.provider === "string" && event.provider.trim()) {
    return event.provider.trim();
  }

  const model = event.model.trim().toLowerCase();
  if (model.includes("claude")) return "Anthropic";
  if (model.includes("gpt") || /(?:^|[/:\s])o\d(?:$|[-_.])/i.test(model))
    return "OpenAI";
  if (model.includes("gemini")) return "Google";
  if (model.includes("deepseek")) return "DeepSeek";
  if (model.includes("kimi") || model.includes("moonshot")) return "Moonshot";
  if (model.includes("grok")) return "xAI";
  return event.source;
}
