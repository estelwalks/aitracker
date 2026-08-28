import { z } from "zod";
import { describe, expect, it } from "vitest";
import { capFilesForModel, capForModel, chatJson, parseJsonText } from "../src/model/client.js";
import type { ModelConfig } from "../src/types.js";
import { TokenUsageCollector } from "../src/model/usage.js";

const schema = z.object({ ok: z.boolean() });
const config: ModelConfig = { endpoint: "https://api.example.com/v1", apiKey: "sk-test", liteModel: "lite", proModel: "pro", timeoutMs: 1000, maxAgentTurns: 12 };

describe("parseJsonText", () => {
  it("passes through plain JSON", () => {
    expect(parseJsonText('{"a":1}')).toBe('{"a":1}');
    expect(parseJsonText("[1, 2, 3]")).toBe("[1, 2, 3]");
  });
  it("extracts JSON from markdown code fences", () => {
    expect(parseJsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(parseJsonText('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("extracts JSON embedded in surrounding prose", () => {
    expect(parseJsonText('Here is the result:\n{"a":{"b":2}}')).toBe('{"a":{"b":2}}');
    expect(parseJsonText('Prefix [1,2,3] suffix')).toBe("[1,2,3]");
  });
  it("throws on empty and non-JSON text", () => {
    expect(() => parseJsonText("   ")).toThrow("model response is empty");
    expect(() => parseJsonText("no json here")).toThrow("model response is not valid JSON");
  });
});

describe("capForModel", () => {
  it("passes content within the budget through unchanged", () => {
    expect(capForModel("hello world", 10)).toBe("hello world");
    expect(capForModel("hello")).toBe("hello");
  });
  it("keeps head and tail with a truncation marker when over budget", () => {
    const out = capForModel("x".repeat(1000), 10);
    expect(out.startsWith("x".repeat(10))).toBe(true);
    expect(out.endsWith("x".repeat(10))).toBe(true);
    expect(out).toContain("...[truncated 980 chars]...");
  });
});

describe("capFilesForModel", () => {
  it("uses the default per-file cap without a context window", () => {
    const files = [{ path: "a.md", content: "y".repeat(100), isBinary: false }];
    expect(capFilesForModel(files, config)[0].content).toBe("y".repeat(100));
  });
  it("caps files by the declared context window budget", () => {
    const big = "x".repeat(100_000);
    const files = [{ path: "big.md", content: big, isBinary: false }];
    const out = capFilesForModel(files, { ...config, contextWindowTokens: 5000 });
    expect(out[0].content.length).toBeLessThan(20_000);
    expect(out[0].content.length).toBeGreaterThan(10_000);
  });
});

describe("chatJson (OpenAI-compatible)", () => {
  it("builds the OpenAI request and parses the response", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetcher = async (url: string, init?: RequestInit) => {
      seenUrl = url; seenInit = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    };
    const out = await chatJson(fetcher, { ...config, provider: "openai-completions" }, "gpt-test", [{ role: "user", content: "hi" }], schema);
    expect(out).toEqual({ ok: true });
    expect(seenUrl).toBe("https://api.example.com/v1/chat/completions");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(seenInit?.body));
    expect(body.model).toBe("gpt-test");
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual([{ role: "user", content: "hi\nRespond with strict JSON only." }]);
  });
  it("appends a JSON hint only when the OpenAI prompt lacks the word json", async () => {
    const seen: string[] = [];
    const fetcher = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      seen.push(String(body.messages.at(-1).content));
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    };
    await chatJson(fetcher, config, "gpt", [{ role: "user", content: "hello world" }], schema);
    await chatJson(fetcher, config, "gpt", [{ role: "user", content: "return json please" }], schema);
    expect(seen[0]).toContain("Respond with strict JSON only");
    expect(seen[1]).toBe("return json please");
  });
  it("tolerates a fenced JSON response", async () => {
    const fetcher = async () => new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"ok":false}\n```' } }] }), { status: 200 });
    await expect(chatJson(fetcher, config, "gpt", [{ role: "user", content: "hi" }], schema)).resolves.toEqual({ ok: false });
  });
  it("maps the legacy openai provider to Chat Completions", async () => {
    let seenUrl = "";
    const fetcher = async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    };
    await expect(chatJson(fetcher, { ...config, provider: "openai" }, "gpt", [{ role: "user", content: "return json" }], schema)).resolves.toEqual({ ok: true });
    expect(seenUrl).toBe("https://api.example.com/v1/chat/completions");
  });
});

describe("chatJson (OpenAI Responses)", () => {
  it("builds a Responses request with instructions, user/assistant input, JSON mode, and usage", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const collector = new TokenUsageCollector();
    const fetcher = async (url: string, init?: RequestInit) => {
      seenUrl = url; seenInit = init;
      return new Response(JSON.stringify({ output_text: '{"ok":true}', usage: { input_tokens: 11, output_tokens: 3, total_tokens: 14, cached_tokens: 2 } }), { status: 200 });
    };
    const out = await chatJson(fetcher, { ...config, provider: "openai-responses" }, "gpt-responses", [
      { role: "system", content: "sys" },
      { role: "user", content: "return json please" },
      { role: "assistant", content: "previous answer" },
    ], schema, { collector, context: { model: "gpt-responses", branch: "ruleReview" } });

    expect(out).toEqual({ ok: true });
    expect(seenUrl).toBe("https://api.example.com/v1/responses");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(seenInit?.body));
    expect(body).toMatchObject({
      model: "gpt-responses",
      instructions: "sys",
      input: [
        { role: "user", content: "return json please" },
        { role: "assistant", content: "previous answer" },
      ],
      temperature: 0,
      text: { format: { type: "json_object" } },
    });
    expect(body).not.toHaveProperty("messages");
    expect(collector.report()).toMatchObject({ status: "complete", requestCount: 1, reportedRequestCount: 1, inputTokens: 11, outputTokens: 3, totalTokens: 14, cachedInputTokens: 2 });
  });

  it("extracts text from the raw output array when output_text is absent", async () => {
    const fetcher = async () => new Response(JSON.stringify({
      output: [
        { type: "reasoning", content: [{ type: "reasoning_text", text: "ignored" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: '{"ok":' }, { type: "output_text", text: "false}" }] },
      ],
    }), { status: 200 });
    await expect(chatJson(fetcher, { ...config, provider: "openai-responses" }, "gpt", [{ role: "user", content: "return json" }], schema)).resolves.toEqual({ ok: false });
  });
});

describe("chatJson (Anthropic Messages)", () => {
  it("builds the Anthropic request when provider is auto-detected", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetcher = async (url: string, init?: RequestInit) => {
      seenUrl = url; seenInit = init;
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"ok":true}' }] }), { status: 200 });
    };
    const anthropic = { ...config, provider: "anthropic" as const, endpoint: "https://api.anthropic.com/v1" };
    const out = await chatJson(fetcher, anthropic, "claude-test", [{ role: "system", content: "sys" }, { role: "user", content: "hi" }], schema);
    expect(out).toEqual({ ok: true });
    expect(seenUrl).toBe("https://api.anthropic.com/v1/messages");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(seenInit?.body));
    expect(body.system).toBe("sys");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body).not.toHaveProperty("response_format");
  });
  it("detects anthropic from a /messages endpoint suffix", async () => {
    const fetcher = async (url: string) => {
      expect(url).toContain("/messages");
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"ok":true}' }] }), { status: 200 });
    };
    await chatJson(fetcher, { ...config, endpoint: "https://proxy.example/v1/messages" }, "m", [{ role: "user", content: "x" }], schema);
  });
});

describe("chatJson (errors)", () => {
  it("throws on a non-OK HTTP status", async () => {
    await expect(chatJson(async () => new Response("{}", { status: 500 }), config, "g", [{ role: "user", content: "x" }], schema)).rejects.toThrow("model HTTP 500");
  });
  it("throws when the response has no text content", async () => {
    await expect(chatJson(async () => new Response(JSON.stringify({}), { status: 200 }), config, "g", [{ role: "user", content: "x" }], schema)).rejects.toThrow("model response has no text content");
  });
  it("throws when the payload does not match the schema", async () => {
    const collector = new TokenUsageCollector();
    const fetcher = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"wrong":1}' } }], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } }), { status: 200 });
    await expect(chatJson(fetcher, config, "g", [{ role: "user", content: "x" }], schema, { collector, context: { model: "g", branch: "ruleReview" } })).rejects.toThrow();
    expect(collector.report()).toMatchObject({ status: "complete", requestCount: 1, reportedRequestCount: 1, inputTokens: 7, outputTokens: 2, totalTokens: 9 });
  });
  it("records a non-2xx request without fabricating usage", async () => {
    const collector = new TokenUsageCollector();
    await expect(chatJson(async () => new Response("{}", { status: 429 }), config, "g", [{ role: "user", content: "x" }], schema, { collector, context: { model: "g", branch: "ruleReview" } })).rejects.toThrow("model HTTP 429");
    expect(collector.report()).toMatchObject({ status: "unavailable", requestCount: 1, reportedRequestCount: 0, totalTokens: 0 });
  });
});
