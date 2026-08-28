import { describe, expect, it } from "vitest";
import { runBehavioralAgent } from "../src/model/agent.js";
import type { BehavioralRiskItem } from "../src/model/client.js";
import type { ModelConfig, SkillFile } from "../src/types.js";

const config: ModelConfig = { endpoint: "https://api.example.com/v1", apiKey: "k", liteModel: "lite", proModel: "pro", timeoutMs: 1000, maxAgentTurns: 12 };
const files: SkillFile[] = [{ path: "SKILL.md", content: "line one\nline two\nimport os\nos.system('whoami')", isBinary: false }];

const openaiReply = (payload: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });

const finalItem = (over: Partial<BehavioralRiskItem> = {}): BehavioralRiskItem => ({
  index: 0, category: "command_injection", severity: "high", file_path: "SKILL.md", line_number: 4,
  name: "", name_zh: "", description: "agent found exec", description_zh: "", remediation: "", remediation_zh: "", reasoning: "r",
  ...over,
});

describe("runBehavioralAgent", () => {
  it("runs a tool call, feeds the result back, then returns the final findings", async () => {
    let calls = 0;
    const fetcher = async (_url: string, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body)).messages;
      calls += 1;
      if (calls === 1) {
        return openaiReply({ type: "tool_call", tool: "read_file", args: { path: "SKILL.md", start: 1, limit: 50 } });
      }
      expect(messages[messages.length - 1].content).toContain("Tool read_file returned");
      expect(messages[messages.length - 1].content).toContain("line one");
      return openaiReply({ type: "final", risk_found: true, findings: [finalItem()] });
    };
    const findings = await runBehavioralAgent(fetcher, config, files, "sys", "task");
    expect(findings).toEqual([finalItem()]);
  });

  it("surfaces grep no-match results to the model", async () => {
    let calls = 0;
    const fetcher = async (_url: string, init?: RequestInit) => {
      const messages = JSON.parse(String(init?.body)).messages;
      calls += 1;
      if (calls === 1) return openaiReply({ type: "tool_call", tool: "grep", args: { pattern: "zzz" } });
      expect(messages[messages.length - 1].content).toContain("(no matches)");
      return openaiReply({ type: "final", risk_found: false, findings: [] });
    };
    await expect(runBehavioralAgent(fetcher, config, files, "sys", "task")).resolves.toEqual([]);
  });

  it("throws when the agent exhausts its turn limit", async () => {
    const fetcher = async () => openaiReply({ type: "tool_call", tool: "list_files", args: {} });
    await expect(runBehavioralAgent(fetcher, config, files, "sys", "task")).rejects.toThrow("agent turn limit exceeded");
  });

  it("honors a custom maxAgentTurns", async () => {
    let calls = 0;
    const fetcher = async () => { calls += 1; return openaiReply({ type: "tool_call", tool: "list_files", args: {} }); };
    await expect(runBehavioralAgent(fetcher, { ...config, maxAgentTurns: 2 }, files, "sys", "task")).rejects.toThrow("agent turn limit exceeded");
    expect(calls).toBe(2);
  });
});
