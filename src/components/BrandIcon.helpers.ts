import { PUBLIC_TOOL_MANIFEST } from "../lib/tool-registry/public-manifest.generated.ts";

type PublicToolDisplay = {
  id: string;
  name: string;
  nameZh: string;
  icon?: string;
  color?: string;
};

const toolDisplayById = new Map(
  PUBLIC_TOOL_MANIFEST.tools.map((tool) => [tool.id, tool]),
);
const toolDisplayByName = new Map(
  PUBLIC_TOOL_MANIFEST.tools.map((tool) => [tool.name, tool]),
);

export function displayOf(name: string): PublicToolDisplay | undefined {
  return toolDisplayById.get(name) ?? toolDisplayByName.get(name) ?? undefined;
}

/** 各产品品牌原色（顺序优先：第一个命中的规则胜出）。 */
const productColor: { test: (name: string) => boolean; color: string }[] = [
  {
    test: (name) =>
      name.includes("claude") ||
      name.includes("sonnet") ||
      name.includes("opus") ||
      name.includes("haiku"),
    color: "#d97757",
  },
  {
    test: (name) =>
      name.includes("codex") ||
      name.includes("openai") ||
      name.startsWith("gpt") ||
      name.startsWith("o5"),
    color: "#10a37f",
  },
  {
    test: (name) => name.includes("gemini") || name.includes("antigravity"),
    color: "#4285f4",
  },
  { test: (name) => name.includes("cursor"), color: "#cfcfcf" },
  { test: (name) => name.includes("kimi"), color: "#7c5cff" },
  { test: (name) => name.includes("deepseek"), color: "#4d6bfe" },
  { test: (name) => name.includes("windsurf"), color: "#09b6a2" },
  { test: (name) => name.includes("cline"), color: "#5b8def" },
  { test: (name) => name.includes("roo"), color: "#f0524d" },
  { test: (name) => name.includes("aider"), color: "#14b8a6" },
  { test: (name) => name.includes("qwen"), color: "#615ced" },
  { test: (name) => name.includes("opencode"), color: "#f59e0b" },
  { test: (name) => name.includes("grok"), color: "#d1d5db" },
  { test: (name) => name.includes("trae"), color: "#ff4d4f" },
  { test: (name) => name.includes("zed"), color: "#3b82f6" },
];

export function brandColorOf(name: string): string {
  const display = displayOf(name);
  if (display?.color) return display.color;
  const normalized = name.toLowerCase();
  return (
    productColor.find((product) => product.test(normalized))?.color ??
    "currentColor"
  );
}
