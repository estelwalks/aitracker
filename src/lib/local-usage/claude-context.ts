/**
 * Claude Code 上下文采集器。
 *
 * 从 Claude Code 会话 JSONL 的 `message.content` block 数组里提取已脱敏的
 * 工具调用 / Skill 调用 / 命令统计，构建 `LocalUsageContext`。
 *
 * Clean-room 合规（docs/compliance/CLEAN_ROOM.md §隐私口径）：
 * - 只读 content block 的结构元数据：`type`（thinking/text/tool_use）、
 *   `name`（工具名）、`input` 的字段名（skill/command）。
 * - 工具参数正文不采集、不持久化；命令经 safeSignature 脱敏为
 *   `executable + 子命令` 签名（与 codex-context 同口径）。
 * - Skill 名、工具名、MCP server/tool 名属统计字段，允许采集。
 *
 * 实现思路参考 AITracker 的可观察行为（按 content block type/name 分类），
 * 但使用应用自有类型与分类口径，不复制其代码结构。
 */

import type {
  LocalUsageCommandStat,
  LocalUsageContext,
  LocalUsageSkillCall,
  LocalUsageToolCall,
  LocalUsageToolCategory,
} from "./types.ts";

interface JsonObject {
  [key: string]: unknown;
}

/** Claude Code 工具名 -> 应用工具分类。 */
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

/** 规范化 MCP 工具名 mcp__server__tool -> mcp_server_tool。 */
function normalizeMcpName(raw: string): string {
  const parts = raw.split("__");
  if (parts.length >= 3) {
    const server = parts[1]!.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
    const tool = parts[2]!.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
    return `mcp_${server}_${tool}`;
  }
  return "mcp_unknown";
}

/** 规范化工具名（保留可读标识，限制长度与字符集）。 */
function normalizeToolName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return "unknown_tool";
  if (trimmed.startsWith("mcp__")) return normalizeMcpName(trimmed);
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown_tool";
}

/** 从命令字符串提取脱敏签名（executable + 首个子命令），与 codex 口径一致。 */
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
 * 从一条 Claude Code 记录的 message.content 提取上下文聚合。
 *
 * 不做 output token 分摊（由 buildContextBreakdown 统一归因）；只采集
 * tools/skills/commands 的结构与调用次数。
 */
export function collectClaudeContext(
  message: unknown,
): LocalUsageContext | undefined {
  const msg = isObject(message) ? message : undefined;
  const content = msg?.content;
  if (!Array.isArray(content)) {
    // 部分记录 content 为字符串（纯文本助手回复）
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

      // Skill 调用：name === "Skill"，input.skill 是 skill 名
      if (rawName === "Skill") {
        const input = isObject(block.input) ? block.input : {};
        const skillName = asString(input.skill);
        if (skillName) {
          const key = skillName.toLowerCase().slice(0, 80);
          skillsMap.set(key, (skillsMap.get(key) ?? 0) + 1);
        }
      }

      // 命令执行：Bash / exec_command，提取脱敏签名
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

  // 合并相同签名的命令
  const mergedCommands = mergeCommands(commands);

  const context: LocalUsageContext = {
    ...(textResponse || tools.length === 0 ? { textResponse: true } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(mergedCommands.length > 0 ? { commands: mergedCommands } : {}),
  };

  return Object.keys(context).length === 0 ? undefined : context;
}

/** 合并相同 executable+signature 的命令统计，累加 calls。 */
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
