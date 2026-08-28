import { z } from "zod";
import { chatJson, BehavioralRiskItemSchema, type BehavioralRiskItem, type ChatMessage } from "./client.js";
import type { FetchLike, ModelConfig, SkillFile } from "../types.js";
import type { TokenUsageCollector } from "./usage.js";

const AgentTurnSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tool_call"), tool: z.enum(["list_files", "read_file", "grep"]), args: z.object({ path: z.string().max(1024).optional(), start: z.number().int().positive().optional(), limit: z.number().int().positive().max(500).optional(), pattern: z.string().max(200).optional() }).strict() }).strict(),
  z.object({ type: z.literal("final"), risk_found: z.boolean(), findings: z.array(BehavioralRiskItemSchema).max(50) }).strict(),
]);

function agentListFiles(files: SkillFile[]): string {
  return JSON.stringify(files.map((f) => ({ path: f.path, lineCount: f.content.split(/\r?\n/).length, chars: f.content.length })));
}
function agentReadFile(files: SkillFile[], path: string, start = 1, limit = 300): string {
  const file = files.find((f) => f.path === path);
  if (!file) return `ERROR: file not found: ${path}`;
  const lines = file.content.split(/\r?\n/);
  const from = Math.max(1, start);
  const to = Math.min(lines.length, from + Math.min(limit, 500) - 1);
  if (from > lines.length) return `(out of range: ${path} has ${lines.length} lines)`;
  return lines.slice(from - 1, to).map((line, i) => `${from + i}: ${line.length > 400 ? `${line.slice(0, 400)}...` : line}`).join("\n");
}
function agentGrep(files: SkillFile[], pattern: string, path?: string): string {
  let regex: RegExp;
  try { regex = new RegExp(pattern, "i"); } catch { return "ERROR: invalid pattern"; }
  const out: string[] = [];
  for (const f of files) {
    if (path && f.path !== path) continue;
    for (const [i, line] of f.content.split(/\r?\n/).entries()) {
      if (regex.test(line)) { out.push(`${f.path}:${i + 1}: ${line.length > 200 ? `${line.slice(0, 200)}...` : line}`); if (out.length >= 30) return out.join("\n"); }
    }
  }
  return out.length ? out.join("\n") : "(no matches)";
}
function executeAgentTool(tool: string, args: { path?: string; start?: number; limit?: number; pattern?: string }, files: SkillFile[]): string {
  if (tool === "list_files") return agentListFiles(files);
  if (tool === "read_file") return agentReadFile(files, args.path ?? "", args.start ?? 1, args.limit ?? 300);
  if (tool === "grep") return agentGrep(files, args.pattern ?? "", args.path);
  return `ERROR: unknown tool ${tool}`;
}

/** Pro-model ReAct loop: must produce a final after ≤ maxAgentTurns tool calls; any exception propagates so the caller can fall back. */
export async function runBehavioralAgent(fetcher: FetchLike, model: ModelConfig, files: SkillFile[], agentSystem: string, agentTask: string, usageCollector?: TokenUsageCollector): Promise<BehavioralRiskItem[]> {
  const maxTurns = model.maxAgentTurns ?? 12;
  const messages: ChatMessage[] = [{ role: "system", content: agentSystem }, { role: "user", content: agentTask }];
  for (let turn = 0; turn < maxTurns; turn++) {
    const reply = await chatJson(fetcher, model, model.proModel, messages, AgentTurnSchema, usageCollector ? { collector: usageCollector, context: { model: model.proModel, branch: "multiFileAnalysis" } } : undefined);
    if (reply.type === "final") return reply.findings;
    const result = executeAgentTool(reply.tool, reply.args, files);
    messages.push({ role: "assistant", content: JSON.stringify(reply) }, { role: "user", content: `Tool ${reply.tool} returned:\n${result}` });
  }
  throw new Error("agent turn limit exceeded");
}
