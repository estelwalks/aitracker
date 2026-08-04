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
  /**
   * Per-message-role token view for the context source tree.
   *
   * Clean-room safe (docs/compliance/CLEAN_ROOM.md §隐私口径): this is a cache-proxy
   * heuristic that only RELABELS the event's existing token fields — it reads no
   * message role/content. Mapping:
   *   cachedInputTokens        → conversation_history (cache hits = re-sent history)
   *   cacheCreationInputTokens → system_prefix      (new cache write = new context prefix)
   *   inputTokens              → user_input          (non-cached input)
   *   outputTokens − reasoning → assistant_reply
   *   reasoningOutputTokens    → reasoning
   * These rows are an ALTERNATIVE grouping of the same event totals (like
   * `messages`/`categories`), not an additional attribution — they do not double-count.
   */
  messageRoles: LocalUsageContextBreakdownRow[];
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
  const reasoningTokens = Math.min(
    event.reasoningOutputTokens,
    event.outputTokens,
  );
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

/**
 * 按 calls 权重把一个数值分配给多个份额，返回每个份额的分得量（含取整余数兜底，
 * 保证 sum === value）。weights 长度 = 份额数。
 */
function allocateByWeights(value: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (value * w) / sum);
  const floor = raw.map((r) => Math.floor(r));
  const remainder = value - floor.reduce((s, f) => s + f, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) floor[order[k]!.i]! += 1;
  return floor;
}

/** 按 calls 权重把完整 LocalTokenCounts 分配给各工具，返回每工具的 counts。 */
function allocateCountsByWeights(
  counts: LocalTokenCounts,
  weights: number[],
): LocalTokenCounts[] {
  const fields: (keyof LocalTokenCounts)[] = [
    "inputTokens",
    "cachedInputTokens",
    "cacheCreationInputTokens",
    "outputTokens",
    "reasoningOutputTokens",
    "totalTokens",
  ];
  const byField: Record<string, number[]> = {};
  for (const f of fields) byField[f] = allocateByWeights(counts[f], weights);
  return weights.map((_, i) => {
    const c = emptyCounts();
    for (const f of fields) c[f] = byField[f]![i]!;
    return c;
  });
}

function splitTokenCounts(
  counts: LocalTokenCounts,
  parts: number,
  index: number,
): LocalTokenCounts {
  return {
    inputTokens: splitInteger(counts.inputTokens, parts, index),
    cachedInputTokens: splitInteger(counts.cachedInputTokens, parts, index),
    cacheCreationInputTokens: splitInteger(
      counts.cacheCreationInputTokens,
      parts,
      index,
    ),
    outputTokens: splitInteger(counts.outputTokens, parts, index),
    reasoningOutputTokens: splitInteger(
      counts.reasoningOutputTokens,
      parts,
      index,
    ),
    totalTokens: splitInteger(counts.totalTokens, parts, index),
  };
}

function addRow(
  map: BreakdownMap,
  key: string,
  counts: LocalTokenCounts,
  calls: number,
): void {
  const row = map.get(key) ?? emptyRow(key);
  addCounts(row, counts);
  row.calls += calls;
  map.set(key, row);
}

function sortedRows(map: BreakdownMap): LocalUsageContextBreakdownRow[] {
  return [...map.values()].sort(
    (left, right) =>
      right.totalTokens - left.totalTokens || left.key.localeCompare(right.key),
  );
}

/**
 * Cache-proxy message-role attribution: relabels the event's existing token
 * fields into conversation_history / system_prefix / user_input /
 * assistant_reply / reasoning rows. Each role carries only the slice it owns
 * (e.g. `assistant_reply` holds output-minus-reasoning via the count objects
 * below, with reasoning cleared so the per-field totals stay consistent).
 */
function roleCounts(
  value: number,
  field: keyof LocalTokenCounts,
): LocalTokenCounts {
  const counts = emptyCounts();
  if (value > 0) counts[field] = value;
  counts.totalTokens = value;
  return counts;
}

function addMessageRoleRows(map: BreakdownMap, event: LocalUsageEvent): void {
  const distributable = distributableCounts(event);
  if (event.cachedInputTokens > 0) {
    addRow(
      map,
      "conversation_history",
      roleCounts(event.cachedInputTokens, "cachedInputTokens"),
      0,
    );
  }
  if (event.cacheCreationInputTokens > 0) {
    addRow(
      map,
      "system_prefix",
      roleCounts(event.cacheCreationInputTokens, "cacheCreationInputTokens"),
      0,
    );
  }
  if (event.inputTokens > 0) {
    addRow(map, "user_input", roleCounts(event.inputTokens, "inputTokens"), 0);
  }
  if (distributable.outputTokens > 0) {
    addRow(
      map,
      "assistant_reply",
      roleCounts(distributable.outputTokens, "outputTokens"),
      0,
    );
  }
  if (event.reasoningOutputTokens > 0) {
    addRow(
      map,
      "reasoning",
      roleCounts(event.reasoningOutputTokens, "reasoningOutputTokens"),
      0,
    );
  }
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
  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
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
export function buildContextBreakdown(
  events: LocalUsageEvent[],
): LocalUsageContextBreakdown {
  const totals = emptyCounts();
  const messages: BreakdownMap = new Map();
  const categories: BreakdownMap = new Map();
  const tools: BreakdownMap = new Map();
  const skills: BreakdownMap = new Map();
  const commands: BreakdownMap = new Map();
  const messageRoles: BreakdownMap = new Map();

  for (const event of events) {
    addCounts(totals, distributableCounts(event));
    addMessageRoleRows(messageRoles, event);
    const eventTools = uniqueTools(event);

    // 归因模型 A（参考 AITracker tool_calls_breakdown）：
    // - input 系列（input/cached/cacheCreation）归 messageRoles（对话历史/
    //   用户输入/系统提示词），按角色互斥。
    // - 工具调用分摊**完整事件 token**（input+cache+output），作为独立归因
    //   视角——即「为调用这些工具而消耗的全部上下文」。与 Messages 不互斥
    //   （AITracker 也是这样：Messages 151M + Tool calls 12.7M 并存）。
    //   故 SourceDetail 对工具/MCP 维度不显示「合计=100%」式的百分比。
    const fullCounts = distributableCounts(event);

    if (eventTools.length === 0) {
      addRow(messages, "text_response", fullCounts, 1);
      addRow(categories, "messages", fullCounts, 1);
      continue;
    }

    // 按 calls 权重分摊完整 token 给各工具（模型 A：工具分摊完整事件 token）
    const weights = eventTools.map((t) => t.calls);
    const toolCounts = allocateCountsByWeights(fullCounts, weights);
    const allocations = new Map<string, LocalTokenCounts>();
    for (const [index, tool] of eventTools.entries()) {
      const counts = toolCounts[index]!;
      allocations.set(`${tool.category}:${tool.name}`, counts);
      addRow(categories, tool.category, counts, tool.calls);
      addRow(tools, tool.name, counts, tool.calls);
    }

    const skillCounts = combinedCounts(
      eventTools
        .filter((tool) => tool.category === "skills")
        .map(
          (tool) =>
            allocations.get(`${tool.category}:${tool.name}`) ?? emptyCounts(),
        ),
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
        allocations.get(`${commandTool.category}:${commandTool.name}`) ??
        emptyCounts();
      const eventCommands = (event.context?.commands ?? []).filter(
        (command) => command.calls > 0,
      );
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
    messageRoles: sortedRows(messageRoles),
  };
}

export type { LocalUsageToolCategory };
