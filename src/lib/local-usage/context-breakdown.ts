import type {
  LocalTokenCounts,
  LocalUsageCommandStat,
  LocalUsageEvent,
  LocalUsageSkillCall,
  LocalUsageToolCall,
  LocalUsageToolCategory,
} from "./types.ts";

export interface LocalUsageContextBreakdownRow extends LocalTokenCounts {
  key: string;
  calls: number;
}

export interface LocalUsageContextBreakdown {
  totals: LocalTokenCounts;
  messages: LocalUsageContextBreakdownRow[];
  categories: LocalUsageContextBreakdownRow[];
  tools: LocalUsageContextBreakdownRow[];
  skills: LocalUsageContextBreakdownRow[];
  commands: LocalUsageContextBreakdownRow[];
}

type BreakdownMap = Map<string, LocalUsageContextBreakdownRow>;

function emptyCounts(): LocalTokenCounts {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function emptyRow(key: string): LocalUsageContextBreakdownRow {
  return { key, calls: 0, ...emptyCounts() };
}

function addCounts(target: LocalTokenCounts, source: LocalTokenCounts): void {
  target.inputTokens += source.inputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
  target.totalTokens += source.totalTokens;
}

function combinedCounts(counts: LocalTokenCounts[]): LocalTokenCounts {
  const combined = emptyCounts();
  for (const current of counts) addCounts(combined, current);
  return combined;
}

function distributableCounts(event: LocalUsageEvent): LocalTokenCounts {
  const reasoningTokens = Math.min(event.reasoningOutputTokens, event.outputTokens);
  return {
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    cacheCreationInputTokens: event.cacheCreationInputTokens,
    outputTokens: event.outputTokens - reasoningTokens,
    reasoningOutputTokens: reasoningTokens,
    totalTokens: event.totalTokens,
  };
}

function splitInteger(value: number, parts: number, index: number): number {
  const base = Math.floor(value / parts);
  return base + (index < value % parts ? 1 : 0);
}

function splitCounts(event: LocalUsageEvent, parts: number, index: number): LocalTokenCounts {
  return splitTokenCounts(distributableCounts(event), parts, index);
}

function splitTokenCounts(
  counts: LocalTokenCounts,
  parts: number,
  index: number,
): LocalTokenCounts {
  return {
    inputTokens: splitInteger(counts.inputTokens, parts, index),
    cachedInputTokens: splitInteger(counts.cachedInputTokens, parts, index),
    cacheCreationInputTokens: splitInteger(counts.cacheCreationInputTokens, parts, index),
    outputTokens: splitInteger(counts.outputTokens, parts, index),
    reasoningOutputTokens: splitInteger(counts.reasoningOutputTokens, parts, index),
    totalTokens: splitInteger(counts.totalTokens, parts, index),
  };
}

function addRow(map: BreakdownMap, key: string, counts: LocalTokenCounts, calls: number): void {
  const row = map.get(key) ?? emptyRow(key);
  addCounts(row, counts);
  row.calls += calls;
  map.set(key, row);
}

function sortedRows(map: BreakdownMap): LocalUsageContextBreakdownRow[] {
  return [...map.values()].sort(
    (left, right) => right.totalTokens - left.totalTokens || left.key.localeCompare(right.key),
  );
}

function uniqueTools(event: LocalUsageEvent): LocalUsageToolCall[] {
  const byName = new Map<string, LocalUsageToolCall>();
  for (const tool of event.context?.tools ?? []) {
    if (tool.calls <= 0 || tool.name.length === 0) continue;
    const key = `${tool.category}:${tool.name}`;
    const existing = byName.get(key);
    if (existing == null) byName.set(key, { ...tool });
    else existing.calls += tool.calls;
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function commandKey(command: LocalUsageCommandStat): string {
  return `${command.executable} · ${command.safeSignature}`;
}

function skillCalls(event: LocalUsageEvent): LocalUsageSkillCall[] {
  const byName = new Map<string, number>();
  for (const skill of event.context?.skills ?? []) {
    if (skill.calls > 0 && skill.name.length > 0) {
      byName.set(skill.name, (byName.get(skill.name) ?? 0) + skill.calls);
    }
  }
  return [...byName].map(([name, calls]) => ({ name, calls }));
}

/**
 * Attributes one event's tokens only once across its distinct tools. Skills and command rows are
 * filtered views of those tool allocations, so category/tool totals never exceed event totals.
 */
export function buildContextBreakdown(events: LocalUsageEvent[]): LocalUsageContextBreakdown {
  const totals = emptyCounts();
  const messages: BreakdownMap = new Map();
  const categories: BreakdownMap = new Map();
  const tools: BreakdownMap = new Map();
  const skills: BreakdownMap = new Map();
  const commands: BreakdownMap = new Map();

  for (const event of events) {
    addCounts(totals, distributableCounts(event));
    const eventTools = uniqueTools(event);
    if (eventTools.length === 0) {
      addRow(messages, "text_response", distributableCounts(event), 1);
      addRow(categories, "messages", distributableCounts(event), 1);
      addRow(tools, "text_response", distributableCounts(event), 1);
      continue;
    }

    const allocations = new Map<string, LocalTokenCounts>();
    for (const [index, tool] of eventTools.entries()) {
      const counts = splitCounts(event, eventTools.length, index);
      allocations.set(`${tool.category}:${tool.name}`, counts);
      addRow(categories, tool.category, counts, tool.calls);
      addRow(tools, tool.name, counts, tool.calls);
    }

    const skillCounts = combinedCounts(
      eventTools
        .filter((tool) => tool.category === "skills")
        .map((tool) => allocations.get(`${tool.category}:${tool.name}`) ?? emptyCounts()),
    );
    const eventSkills = skillCalls(event);
    if (eventSkills.length > 0) {
      for (const [index, skill] of eventSkills.entries()) {
        addRow(
          skills,
          skill.name,
          splitTokenCounts(skillCounts, eventSkills.length, index),
          skill.calls,
        );
      }
    }

    const commandTool = eventTools.find((tool) => tool.name === "exec_command");
    if (commandTool != null) {
      const counts =
        allocations.get(`${commandTool.category}:${commandTool.name}`) ?? emptyCounts();
      const eventCommands = (event.context?.commands ?? []).filter((command) => command.calls > 0);
      for (const [index, command] of eventCommands.entries()) {
        addRow(
          commands,
          commandKey(command),
          splitTokenCounts(counts, eventCommands.length, index),
          command.calls,
        );
      }
    }
  }

  return {
    totals,
    messages: sortedRows(messages),
    categories: sortedRows(categories),
    tools: sortedRows(tools),
    skills: sortedRows(skills),
    commands: sortedRows(commands),
  };
}

export type { LocalUsageToolCategory };
