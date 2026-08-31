import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDashboardSelectedTool,
  resolveDashboardToolRailTools,
  type DashboardToolWithUsage,
} from "./tool-rail-order.ts";

const tool = (id: string): DashboardToolWithUsage => ({
  id,
  name: id,
  available: true,
  detected: true,
  usageSupport: "native",
  tokens: id === "codex" ? 100 : 50,
  events: 0,
});

test("keeps the overview tool order when a tool-specific view is selected", () => {
  const overviewOrder = [tool("claude-code"), tool("codex")];
  const selectedViewOrder = [overviewOrder[1]!, overviewOrder[0]!];

  assert.deepEqual(
    resolveDashboardToolRailTools("codex", selectedViewOrder, overviewOrder),
    overviewOrder,
  );
});

test("uses the current usage order for the all-tools view", () => {
  const currentOrder = [tool("codex"), tool("claude-code")];
  const previousOrder = [currentOrder[1]!, currentOrder[0]!];

  assert.deepEqual(
    resolveDashboardToolRailTools("all", currentOrder, previousOrder),
    currentOrder,
  );
});

test("hides tools without token usage in the active window", () => {
  const tools = [
    { ...tool("codex"), tokens: 100 },
    { ...tool("claude-code"), tokens: 0 },
  ];

  assert.deepEqual(
    resolveDashboardToolRailTools("all", tools, tools).map((item) => item.id),
    ["codex"],
  );
});

test("resets a selected tool when the next window has no token usage", () => {
  const tools = [{ ...tool("codex"), tokens: 0 }];

  assert.equal(resolveDashboardSelectedTool("codex", tools), "all");
  assert.equal(resolveDashboardSelectedTool("all", tools), "all");
});

test("keeps a selected tool when it has usage in the next window", () => {
  assert.equal(resolveDashboardSelectedTool("codex", [tool("codex")]), "codex");
});
