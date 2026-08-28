import { describe, expect, it } from "vitest";
import { normalizeModelUsage, TokenUsageCollector } from "../src/model/usage.js";

describe("model token usage", () => {
  it("normalizes OpenAI usage without adding cached tokens twice", () => {
    expect(normalizeModelUsage({ usage: {
      prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 40 },
    } })).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40 });
  });

  it("adds Anthropic cache read and creation tokens to normalized input", () => {
    expect(normalizeModelUsage({ usage: {
      input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 30, cache_creation_input_tokens: 20,
    } })).toEqual({ inputTokens: 100, outputTokens: 10, totalTokens: 110, cachedInputTokens: 30 });
  });

  it("normalizes Responses usage and its cached token count", () => {
    expect(normalizeModelUsage({ usage: {
      input_tokens: 100, output_tokens: 20, total_tokens: 120, cached_tokens: 40,
    } })).toEqual({ inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 40 });
  });

  it("distinguishes complete, partial, unavailable, and not-applicable reporting", () => {
    expect(new TokenUsageCollector().report()).toMatchObject({ status: "not_applicable", requestCount: 0, reportedRequestCount: 0 });
    const collector = new TokenUsageCollector();
    const context = { model: "pro", branch: "multiFileAnalysis" as const };
    collector.request(context);
    expect(collector.report()).toMatchObject({ status: "unavailable", requestCount: 1, reportedRequestCount: 0 });
    collector.request(context);
    collector.response(context, { usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
    expect(collector.report()).toMatchObject({ status: "partial", requestCount: 2, reportedRequestCount: 1, totalTokens: 5 });
  });
});
