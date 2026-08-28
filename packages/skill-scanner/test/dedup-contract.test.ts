import { describe, expect, it, vi } from "vitest";
import { dedupByLocation, dedupModel, semanticDedup } from "../src/detection/dedup.js";
import type { Finding, FetchLike, ModelConfig } from "../src/types.js";

const model: ModelConfig = {
  endpoint: "https://model.invalid/v1",
  apiKey: "dedup-contract-key",
  liteModel: "lite-contract",
  proModel: "pro-contract",
  timeoutMs: 250,
  maxAgentTurns: 3,
};

function finding(id: string, source: Finding["source"], path: string, line: number | undefined, weight: number): Finding {
  return {
    id,
    kind: "command_injection",
    severity: weight >= 35 ? "high" : "medium",
    source,
    kindDisplay: "Command Injection",
    severityDisplay: weight >= 35 ? "High" : "Medium",
    ...(source === "static" ? { ruleId: `rule-${id}` } : {}),
    ruleName: id,
    message: `message ${id}`,
    remediation: "fix",
    weight,
    path,
    ...(line === undefined ? {} : { line }),
  };
}

function openai(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status });
}

describe("location dedup contract", () => {
  it("covers rule/model collisions, winner weights, undefined lines, and path/line separation", () => {
    const rules = [
      finding("rule-low", "static", "a.ts", 7, 20),
      finding("rule-high", "static", "a.ts", 7, 45),
      finding("rule-other-line", "static", "a.ts", 8, 25),
      finding("rule-other-path", "static", "b.ts", 7, 25),
      finding("file-level-1", "static", "a.ts", undefined, 10),
      finding("file-level-2", "static", "a.ts", undefined, 35),
    ];
    const modelFindings = [
      finding("model-collides-rule", "model", "a.ts", 7, 50),
      finding("model-low", "model", "a.ts", 9, 20),
      finding("model-high", "model", "a.ts", 9, 45),
      finding("model-other-path", "model", "b.ts", 9, 25),
      finding("model-no-line-low", "model", "a.ts", undefined, 20),
      finding("model-no-line-high", "model", "a.ts", undefined, 35),
    ];

    const result = dedupByLocation(rules, modelFindings);

    expect(result.rules.map((entry) => entry.id)).toEqual([
      "rule-high",
      "rule-other-line",
      "rule-other-path",
      "file-level-1",
      "file-level-2",
    ]);
    expect(result.model.map((entry) => entry.id)).toEqual([
      "model-high",
      "model-other-path",
      "model-no-line-high",
    ]);
    expect(result.model.some((entry) => entry.id === "model-collides-rule")).toBe(false);
  });

  it("keeps the first item on equal weight and does not let a line-less rule suppress a line-less model finding", () => {
    const firstRule = finding("first-rule", "static", "same.ts", 3, 25);
    const secondRule = finding("second-rule", "static", "same.ts", 3, 25);
    const lineLessRule = finding("line-less-rule", "static", "same.ts", undefined, 45);
    const firstModel = finding("first-model", "model", "same.ts", 4, 25);
    const secondModel = finding("second-model", "model", "same.ts", 4, 25);
    const lineLessModel = finding("line-less-model", "model", "same.ts", undefined, 25);

    const result = dedupByLocation([firstRule, secondRule, lineLessRule], [firstModel, secondModel, lineLessModel]);

    expect(result.rules.map((entry) => entry.id)).toEqual(["first-rule", "line-less-rule"]);
    expect(result.model.map((entry) => entry.id)).toEqual(["first-model", "line-less-model"]);
    expect(dedupModel([firstModel, secondModel, lineLessModel], [firstRule, secondRule, lineLessRule])).toEqual(result.model);
  });

  it("treats the same path on adjacent lines as distinct at the location stage", () => {
    const result = dedupByLocation(
      [finding("rule-line-10", "static", "flow.py", 10, 25)],
      [finding("model-line-9", "model", "flow.py", 9, 35), finding("model-line-11", "model", "flow.py", 11, 35)],
    );
    expect(result.rules).toHaveLength(1);
    expect(result.model.map((entry) => entry.line)).toEqual([9, 11]);
  });
});

describe("semantic dedup contract", () => {
  const rules = [
    finding("rule-0", "static", "flow.py", 10, 25),
    finding("rule-1", "static", "flow.py", 20, 25),
    finding("rule-2", "static", "other.py", 30, 25),
  ];
  const modelFindings = [finding("model-primary", "model", "flow.py", 11, 35)];

  it("drops only valid duplicate indices and ignores repeated or out-of-range indices", async () => {
    let requestPayload: { primary: unknown[]; secondary: unknown[] } | undefined;
    const fetcher: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const user = body.messages.at(-1)?.content ?? "";
      const jsonStart = user.indexOf("\n{");
      requestPayload = JSON.parse(user.slice(jsonStart + 1)) as typeof requestPayload;
      return openai({ duplicateRuleIndices: [1, 1, 999] });
    };

    const kept = await semanticDedup(fetcher, model, rules, modelFindings);

    expect(kept.map((entry) => entry.id)).toEqual(["rule-0", "rule-2"]);
    expect(requestPayload?.primary).toHaveLength(1);
    expect(requestPayload?.secondary).toHaveLength(3);
  });

  it("does not call the model when either side is empty", async () => {
    const fetcher = vi.fn<FetchLike>();
    await expect(semanticDedup(fetcher, model, [], modelFindings)).resolves.toEqual([]);
    await expect(semanticDedup(fetcher, model, rules, [])).resolves.toEqual(rules);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["HTTP failure", () => new Response("unavailable", { status: 503 })],
    ["invalid JSON", () => new Response("not-json", { status: 200 })],
    ["schema failure", () => openai({ duplicateRuleIndices: ["zero"] })],
  ])("keeps every rule finding when semantic dedup has an %s", async (_name, response) => {
    const kept = await semanticDedup(async () => response(), model, rules, modelFindings);
    expect(kept).toEqual(rules);
  });
});
