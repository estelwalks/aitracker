/**
 * Claude Code context collector.
 *
 * Extract desensitized content from the `message.content` block array of Claude Code session JSONL
 * Tool calls/Skill calls/command statistics, build `LocalUsageContext`.
 *
 * Clean-room compliance (docs/compliance/CLEAN_ROOM.md § Privacy Policy):
 * - Read-only structural metadata of content block: `type` (thinking/text/tool_use),
 *   `name` (tool name), field name of `input` (skill/command).
 * - The tool parameter text is not collected or persisted; the command is desensitized by safeSignature.
 *   `executable + subcommand` signature (same caliber as codex-context).
 * - Skill name, tool name, MCP server/tool name are statistical fields and are allowed to be collected.
 *
 * Classify according to the type/name of the content block, and use the application's own type and classification caliber.
 */

import type {
  LocalUsageCommandStat,
  LocalUsageContext,
  LocalUsageSkillCall,
  LocalUsageToolCall,
  LocalUsageToolCategory,
  LocalUsageToolOutputSummary,
} from "./types.ts";

interface JsonObject {
  [key: string]: unknown;
}

/** Claude Code tool name -> application tool category. */
function claudeToolCategory(name: string): LocalUsageToolCategory {
  if (name === "Bash" || name === "exec_command") return "execution";
  if (name === "Edit" || name === "Write" || name === "apply_patch")
    return "execution";
  if (name === "Read" || name === "Glob" || name === "Grep") return "other";
  if (name === "Agent" || name === "Task") return "agent";
  if (
    name === "update_plan" ||
    name === "TodoWrite" ||
    /^Task(Create|Update|Get|List|Output|Stop)$/.test(name)
  )
    return "planning";
  if (name === "WebFetch" || name === "WebSearch") return "browser";
  if (name.startsWith("mcp__")) return "mcp";
  if (name === "Skill") return "skills";
  return "other";
}

/** Normalize MCP tool names mcp__server__tool -> mcp_server_tool. */
function normalizeMcpName(raw: string): string {
  const parts = raw.split("__");
  if (parts.length >= 3) {
    const server = parts[1]!.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
    const tool = parts[2]!.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
    return `mcp_${server}_${tool}`;
  }
  return "mcp_unknown";
}

/** Normalize tool names (preserve human-readable identifiers, limit length and character set). */
function normalizeToolName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return "unknown_tool";
  if (trimmed.startsWith("mcp__")) return normalizeMcpName(trimmed);
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown_tool";
}

/** Extract the desensitized signature (executable + first subcommand) from the command string, consistent with the codex caliber. */
function safeSignature(command: string): {
  executable: string;
  safeSignature: string;
} {
  const tokens = command.trim().split(/\s+/);
  const safeTokens = tokens.filter((t) => /^[a-zA-Z0-9._-]{1,80}$/.test(t));
  const executable = safeTokens[0] ?? "unknown";
  const subcommand = safeTokens.slice(1).find((t) => !t.startsWith("-"));
  const norm = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_") || "";
  const sub = subcommand ? norm(subcommand) : "";
  return {
    executable,
    safeSignature: sub.length > 0 ? `${executable} ${sub}` : executable,
  };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Private tool-use ids are used only while streaming one JSONL file so a
 * `tool_result` can be attached to the preceding attributed usage event.
 * They are never returned to, persisted by, or exposed outside the scanner.
 */
export function collectClaudeToolUseIds(message: unknown): string[] {
  const content =
    isObject(message) && Array.isArray(message.content) ? message.content : [];
  return content.flatMap((block) => {
    if (!isObject(block) || block.type !== "tool_use") return [];
    const id = asString(block.id);
    return id == null ? [] : [id];
  });
}

export interface ClaudeToolResult {
  readonly toolUseId: string;
  readonly summary: LocalUsageToolOutputSummary;
}

/**
 * Extract only tool-result metadata. The result body is read transiently to
 * measure size and is never retained in the usage snapshot or browser DTO.
 */
export function collectClaudeToolResults(message: unknown): ClaudeToolResult[] {
  const content =
    isObject(message) && Array.isArray(message.content) ? message.content : [];
  const results: ClaudeToolResult[] = [];
  for (const block of content) {
    if (!isObject(block) || block.type !== "tool_result") continue;
    const toolUseId = asString(block.tool_use_id);
    if (toolUseId == null) continue;
    const raw = typeof block.content === "string" ? block.content : "";
    results.push({
      toolUseId,
      summary: {
        characters: raw.length,
        lines: raw.length === 0 ? 0 : raw.split(/\r?\n/u).length,
        completed: true,
        calls: 1,
      },
    });
  }
  return results;
}

/**
 * Extract contextual aggregation from the message.content of a Claude Code record.
 *
 * No output token allocation (unified attribution by buildContextBreakdown); only collection
 * The structure and number of calls of tools/skills/commands.
 */
export function collectClaudeContext(
  message: unknown,
): LocalUsageContext | undefined {
  const msg = isObject(message) ? message : undefined;
  const content = msg?.content;
  if (!Array.isArray(content)) {
    // Partial record content is a string (plain text assistant reply)
    if (typeof content === "string" && content.length > 0) {
      return { textResponse: true };
    }
    return undefined;
  }

  const toolsMap = new Map<string, LocalUsageToolCall>();
  const skillsMap = new Map<string, number>();
  const commands: LocalUsageCommandStat[] = [];
  let textResponse = false;

  for (const block of content) {
    if (!isObject(block)) continue;
    const type = block.type;

    if (type === "text") {
      textResponse = true;
      continue;
    }

    if (type === "tool_use") {
      const rawName = asString(block.name) ?? "unknown_tool";
      const name = normalizeToolName(rawName);
      const category = claudeToolCategory(rawName);
      const existing = toolsMap.get(`${category}:${name}`);
      if (existing) existing.calls += 1;
      else toolsMap.set(`${category}:${name}`, { name, category, calls: 1 });

      // Skill call: name === "Skill", input.skill is the skill name
      if (rawName === "Skill") {
        const input = isObject(block.input) ? block.input : {};
        const skillName = asString(input.skill);
        if (skillName) {
          const key = skillName.toLowerCase().slice(0, 80);
          skillsMap.set(key, (skillsMap.get(key) ?? 0) + 1);
        }
      }

      // Command execution: Bash/exec_command, extract desensitized signature
      if (rawName === "Bash" || rawName === "exec_command") {
        const input = isObject(block.input) ? block.input : {};
        const command = asString(input.command) ?? asString(input.cmd) ?? "";
        if (command.trim()) {
          const { executable, safeSignature: sig } = safeSignature(command);
          commands.push({
            kind: "exec_command",
            executable,
            safeSignature: sig,
            duration: "unknown",
            outputSize: "unknown",
            exitStatus: "unknown",
            calls: 1,
          });
        }
      }
      continue;
    }
    // thinking / 其他 block 类型不采集（避免读推理正文）
  }

  const tools = [...toolsMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const skills: LocalUsageSkillCall[] = [...skillsMap.entries()]
    .map(([name, calls]) => ({ name, calls }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Merge commands with the same signature
  const mergedCommands = mergeCommands(commands);

  const context: LocalUsageContext = {
    ...(textResponse || tools.length === 0 ? { textResponse: true } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(mergedCommands.length > 0 ? { commands: mergedCommands } : {}),
  };

  return Object.keys(context).length === 0 ? undefined : context;
}

/** Combine command statistics with the same executable+signature and accumulate calls. */
function mergeCommands(
  commands: LocalUsageCommandStat[],
): LocalUsageCommandStat[] {
  const combined = new Map<string, LocalUsageCommandStat>();
  for (const cmd of commands) {
    const key = `${cmd.executable}:${cmd.safeSignature}`;
    const existing = combined.get(key);
    if (existing) existing.calls += cmd.calls;
    else combined.set(key, { ...cmd });
  }
  return [...combined.values()].sort((a, b) =>
    a.safeSignature.localeCompare(b.safeSignature),
  );
}
