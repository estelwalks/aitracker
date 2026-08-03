import type {
  LocalUsageCommandDurationBucket,
  LocalUsageCommandExitStatus,
  LocalUsageCommandOutputSizeBucket,
  LocalUsageCommandStat,
  LocalUsageContext,
  LocalUsageSkillCall,
  LocalUsageToolCall,
  LocalUsageToolCategory,
} from "./types.ts";

interface JsonObject {
  [key: string]: unknown;
}

type PendingCommand = LocalUsageCommandStat;

export interface CodexPendingContext {
  tools: Map<string, LocalUsageToolCall>;
  skills: Map<string, number>;
  commands: PendingCommand[];
  toolOutputCharacters: number;
  toolOutputLines: number;
  completedOutputs: number;
  outputCalls: number;
  textResponse: boolean;
}

function asObject(value: unknown): JsonObject | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = stringValue(value);
    if (candidate != null) return candidate;
  }
  return undefined;
}

function normalizedIdentifier(value: unknown, fallback: string): string {
  const text = stringValue(value)?.trim().toLowerCase();
  if (text == null || text.length === 0 || text.length > 80) return fallback;
  const normalized = text.replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(normalized) ? normalized : fallback;
}

function normalizedToolName(value: unknown): string {
  const raw = stringValue(value)?.trim();
  if (raw == null) return "unknown_tool";
  const mcp = /^mcp__([a-zA-Z0-9_-]{1,80})__([a-zA-Z0-9_-]{1,80})$/.exec(raw);
  if (mcp != null) {
    return `mcp_${normalizedIdentifier(mcp[1], "unknown_server")}_${normalizedIdentifier(
      mcp[2],
      "unknown_tool",
    )}`;
  }
  const name = normalizedIdentifier(raw, "unknown_tool");
  for (const knownName of [
    "exec_command",
    "apply_patch",
    "tool_search",
    "web_search",
  ]) {
    if (name === knownName || name.endsWith(`_${knownName}`)) return knownName;
  }
  return name;
}

function readArguments(value: unknown): JsonObject | undefined {
  if (typeof value === "string") {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return asObject(value);
}

function toolCategory(name: string): LocalUsageToolCategory {
  if (
    name === "exec" ||
    name === "exec_command" ||
    name === "apply_patch" ||
    name === "patch_apply"
  )
    return "execution";
  if (name.includes("plan")) return "planning";
  if (name.includes("agent") || name.includes("thread")) return "agent";
  if (
    name.includes("browser") ||
    name.includes("web_search") ||
    name.includes("web_")
  ) {
    return "browser";
  }
  if (name.startsWith("mcp_") || name.startsWith("mcp__")) return "mcp";
  if (name.includes("skill") || name === "tool_search") return "skills";
  return "other";
}

function durationBucket(value: unknown): LocalUsageCommandDurationBucket {
  const milliseconds = numberValue(value);
  if (milliseconds == null) return "unknown";
  if (milliseconds < 1_000) return "under-1s";
  if (milliseconds < 10_000) return "1s-10s";
  if (milliseconds < 60_000) return "10s-60s";
  return "over-60s";
}

function outputSizeBucket(
  characters: number | undefined,
): LocalUsageCommandOutputSizeBucket {
  if (characters == null) return "unknown";
  if (characters === 0) return "empty";
  if (characters < 1_024) return "under-1k";
  if (characters < 10_240) return "1k-10k";
  return "over-10k";
}

function exitStatus(
  value: unknown,
  completed: boolean,
): LocalUsageCommandExitStatus {
  if (value === 0 || value === "success" || value === "completed")
    return "success";
  if (typeof value === "number" && value !== 0) return "failure";
  if (value === "failure" || value === "error") return "failure";
  if (value === "interrupted" || value === "cancelled") return "interrupted";
  return completed ? "success" : "unknown";
}

function safeCommandSignature(command: string): {
  executable: string;
  safeSignature: string;
} {
  const tokens = command.trim().split(/\s+/);
  const safeTokens = tokens.filter((token) =>
    /^[a-zA-Z0-9._-]{1,80}$/.test(token),
  );
  const executable = normalizedIdentifier(safeTokens[0], "unknown");
  const subcommand = safeTokens
    .slice(1)
    .find((token) => !token.startsWith("-"));
  const normalizedSubcommand =
    subcommand == null ? undefined : normalizedIdentifier(subcommand, "");
  return {
    executable,
    safeSignature:
      normalizedSubcommand == null || normalizedSubcommand.length === 0
        ? executable
        : `${executable} ${normalizedSubcommand}`,
  };
}

function skillNameFromCommand(command: string): string | undefined {
  let searchable = command;
  try {
    searchable = decodeURIComponent(command);
  } catch {
    // Keep the original tool input when URL decoding is not applicable.
  }
  const match =
    /(?:^|[/\\])skills[/\\]([a-zA-Z0-9_-]{1,80})[/\\](?:SKILL\.md\b|(?:scripts|references|assets)[/\\][^\s"'`;&|]+)/.exec(
      searchable,
    );
  return match == null ? undefined : normalizedIdentifier(match[1], "");
}

function skillNameFromArguments(argumentValue: unknown): string | undefined {
  const args = readArguments(argumentValue);
  const command = firstString(
    args?.cmd,
    args?.command,
    args?.input,
    args?.input && asObject(args.input)?.command,
    typeof argumentValue === "string" ? argumentValue : undefined,
  );
  return command == null ? undefined : skillNameFromCommand(command);
}

function addTool(
  state: CodexPendingContext,
  name: string,
  category = toolCategory(name),
): void {
  const key = `${category}:${name}`;
  const existing = state.tools.get(key);
  if (existing == null) state.tools.set(key, { name, category, calls: 1 });
  else existing.calls += 1;
}

function addSkill(state: CodexPendingContext, name: string | undefined): void {
  if (name == null || name.length === 0) return;
  state.skills.set(name, (state.skills.get(name) ?? 0) + 1);
}

function recordCommand(
  state: CodexPendingContext,
  argumentValue: unknown,
  details: JsonObject,
): void {
  const args = readArguments(argumentValue);
  const command = firstString(
    args?.cmd,
    args?.command,
    args?.input && asObject(args.input)?.command,
  );
  if (command == null) return;
  const { executable, safeSignature } = safeCommandSignature(command);
  state.commands.push({
    kind: "exec_command",
    executable,
    safeSignature,
    duration: durationBucket(details.duration_ms ?? details.durationMs),
    outputSize: "unknown",
    exitStatus: "unknown",
    calls: 1,
  });
  addSkill(state, skillNameFromCommand(command));
}

function outputText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const object = asObject(value);
  return firstString(object?.text, object?.output, object?.content);
}

function recordOutput(
  state: CodexPendingContext,
  details: JsonObject,
  item?: JsonObject,
): void {
  const text = outputText(
    item?.output ?? item?.content ?? details.output ?? details.content,
  );
  const characters = text?.length ?? 0;
  const lines =
    text == null || text.length === 0 ? 0 : text.split(/\r?\n/).length;
  const completed =
    details.completed === true ||
    item?.completed === true ||
    details.status === "completed" ||
    details.status === "success";
  state.toolOutputCharacters += characters;
  state.toolOutputLines += lines;
  state.outputCalls += 1;
  if (completed) state.completedOutputs += 1;

  const command = state.commands.at(-1);
  if (command != null) {
    command.outputSize = outputSizeBucket(characters);
    command.exitStatus = exitStatus(
      details.exit_code ?? details.exitCode ?? details.status ?? item?.status,
      completed,
    );
  }
}

function mcpToolName(details: JsonObject, item?: JsonObject): string {
  const invocation = asObject(details.invocation) ?? asObject(item?.invocation);
  const server = normalizedIdentifier(
    firstString(
      invocation?.server,
      invocation?.server_name,
      details.server,
      details.server_name,
      item?.server,
      item?.server_name,
    ),
    "unknown_server",
  );
  const tool = normalizedIdentifier(
    firstString(
      invocation?.tool,
      invocation?.tool_name,
      invocation?.name,
      details.tool,
      details.tool_name,
      details.name,
      item?.tool,
      item?.tool_name,
    ),
    "unknown_tool",
  );
  return `mcp_${server}_${tool}`;
}

function explicitSkillName(
  details?: JsonObject,
  item?: JsonObject,
): string | undefined {
  const value = firstString(
    details?.skill,
    details?.skill_name,
    item?.skill,
    item?.skill_name,
  );
  return value == null ? undefined : normalizedIdentifier(value, "");
}

export function createCodexPendingContext(): CodexPendingContext {
  return {
    tools: new Map(),
    skills: new Map(),
    commands: [],
    toolOutputCharacters: 0,
    toolOutputLines: 0,
    completedOutputs: 0,
    outputCalls: 0,
    textResponse: false,
  };
}

/** Reads a rollout record transiently and retains only a strictly whitelisted summary. */
export function collectCodexContextRecord(
  state: CodexPendingContext,
  record: JsonObject,
): void {
  const payload = asObject(record.payload) ?? record;
  const item = asObject(payload.item) ?? asObject(payload.response_item);
  const type = normalizedIdentifier(
    firstString(item?.type, payload.type, record.type),
    "unknown",
  );
  const details = item ?? payload;

  if (type === "response_item") {
    const nestedType = normalizedIdentifier(
      item?.type ?? payload.item_type,
      "unknown",
    );
    if (nestedType === "message" || nestedType === "output_text")
      state.textResponse = true;
    if (nestedType === "function_call" || nestedType === "custom_tool_call") {
      const name = normalizedToolName(firstString(item?.name, item?.tool_name));
      const argumentValue = item?.arguments ?? item?.input;
      addTool(state, name);
      if (name === "exec_command")
        recordCommand(state, argumentValue, item ?? payload);
      else addSkill(state, skillNameFromArguments(argumentValue));
      addSkill(state, explicitSkillName(item));
    }
    if (nestedType === "function_call_output")
      recordOutput(state, payload, item);
    return;
  }

  if (type === "function_call" || type === "custom_tool_call") {
    const name = normalizedToolName(
      firstString(details.name, details.tool_name),
    );
    const argumentValue = details.arguments ?? details.input;
    addTool(state, name);
    if (name === "exec_command") recordCommand(state, argumentValue, details);
    else addSkill(state, skillNameFromArguments(argumentValue));
    addSkill(state, explicitSkillName(details));
    return;
  }
  if (type === "tool_search_call") {
    addTool(state, "tool_search", "skills");
    addSkill(state, explicitSkillName(details));
    return;
  }
  if (
    type === "mcp_tool_call_end" ||
    (type === "event_msg" && details.event_type === "mcp_tool_call_end")
  ) {
    addTool(state, mcpToolName(details, item), "mcp");
    return;
  }
  if (type === "patch_apply_end") {
    addTool(state, "apply_patch", "execution");
    return;
  }
  if (type === "web_search_end") {
    addTool(state, "web_search", "browser");
    return;
  }
  if (type === "function_call_output") recordOutput(state, details, item);
  if (type === "message" || type === "output_text") state.textResponse = true;
}

function consolidateCommands(
  commands: PendingCommand[],
): LocalUsageCommandStat[] {
  const combined = new Map<string, LocalUsageCommandStat>();
  for (const command of commands) {
    const key = [
      command.executable,
      command.safeSignature,
      command.duration,
      command.outputSize,
      command.exitStatus,
    ].join(":");
    const existing = combined.get(key);
    if (existing == null) combined.set(key, { ...command });
    else existing.calls += command.calls;
  }
  return [...combined.values()].sort((left, right) =>
    left.safeSignature.localeCompare(right.safeSignature),
  );
}

export function consumeCodexPendingContext(
  state: CodexPendingContext,
): LocalUsageContext | undefined {
  const tools = [...state.tools.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const skills: LocalUsageSkillCall[] = [...state.skills].map(
    ([name, calls]) => ({ name, calls }),
  );
  const context: LocalUsageContext = {
    ...(state.textResponse || tools.length === 0 ? { textResponse: true } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(state.commands.length > 0
      ? { commands: consolidateCommands(state.commands) }
      : {}),
    ...(state.outputCalls > 0
      ? {
          toolOutputs: {
            characters: state.toolOutputCharacters,
            lines: state.toolOutputLines,
            completed: state.completedOutputs === state.outputCalls,
            calls: state.outputCalls,
          },
        }
      : {}),
  };
  return Object.keys(context).length === 0 ? undefined : context;
}
