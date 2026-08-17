import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { SecurityRuntimeCapabilityView } from "../security-view.ts";
import { RuntimeBlockPanel } from "./RuntimeBlockPanel.tsx";

const DETECTION_ONLY: SecurityRuntimeCapabilityView = {
  activeDefense: false,
  capability: "detection-only",
  monitorAvailable: true,
  evidence: "local-static-and-model-analysis",
  cancellation: "between-skills",
  riskKinds: ["remote_execution", "secret_access"],
};

test("RuntimeBlockPanel renders real capability rows, never fabricated blocks", () => {
  const markup = renderToStaticMarkup(
    <RuntimeBlockPanel
      runtime={DETECTION_ONLY}
      scannedSkills={3}
      riskKindCount={11}
    />,
  );
  // Header + 6 real capability rows + honest empty state.
  assert.match(markup, /运行时防御 · 拦截日志/);
  assert.match(markup, /监控中/);
  assert.match(markup, /仅检测 · 不阻断运行时行为/);
  assert.match(markup, /未启用/);
  assert.match(markup, /技能之间/);
  assert.match(markup, /11 个风险维度/);
  assert.match(markup, /3 个 Skill/);
  assert.equal((markup.match(/<li class=/g) ?? []).length, 6);
  // Honest empty state — no mock interception entries (no agent/time rows).
  assert.match(markup, /暂无拦截记录/);
  assert.match(markup, /不会展示任何模拟或占位数据/);
  assert.doesNotMatch(markup, /Claude Code/);
  assert.doesNotMatch(markup, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
});

test("RuntimeBlockPanel degrades to the off state without a capability view", () => {
  const markup = renderToStaticMarkup(
    <RuntimeBlockPanel runtime={null} scannedSkills={0} riskKindCount={0} />,
  );
  assert.match(markup, /未开启/);
  // Only the two history-independent rows remain.
  assert.equal((markup.match(/<li class=/g) ?? []).length, 2);
  assert.match(markup, /暂无拦截记录/);
});
