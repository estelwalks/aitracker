import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDashboardToolRailTools,
  type DashboardToolWithUsage,
} from "./tool-rail-order.ts";

const tool = (id: string): DashboardToolWithUsage => ({
  id,
  name: id,
  available: true,
  detected: true,
  usageSupport: "native",
  tokens: 0,
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
