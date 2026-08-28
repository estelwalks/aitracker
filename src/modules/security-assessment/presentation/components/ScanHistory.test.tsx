import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { SecurityHistoryView } from "../security-view.ts";
import { ScanHistory } from "./ScanHistory.tsx";

function historyEntry(
  taskIndex: number,
  entryIndex: number,
): SecurityHistoryView {
  const finishedAt = new Date(Date.now() - taskIndex * 60_000).toISOString();
  return {
    id: `history:${taskIndex}:${entryIndex}`,
    scanId: `scan:${taskIndex}`,
    skillRef: `skill:${taskIndex}:${entryIndex}`,
    skillName: `skill-${taskIndex}-${entryIndex}`,
    mode: "quick",
    trigger: "manual",
    locale: "zh-CN",
    status: "complete",
    startedAt: finishedAt,
    finishedAt,
    report: {
      status: "complete",
      mode: "quick",
      verdict: "allow",
      riskScore: 100,
      rulesVersion: "1",
      engineVersion: "1",
      locale: "zh-CN",
      scannedFiles: 1,
      threatLevel: "none",
      threatLevelDisplay: "无",
      summary: "安全",
      findings: [],
      branches: [{ name: "static", status: "complete" }],
      skippedFiles: [],
    },
  };
}

test("ScanHistory shows 10 tasks on the first page by default", () => {
  const markup = renderToStaticMarkup(
    <ScanHistory
      entries={Array.from({ length: 11 }, (_, taskIndex) => [
        historyEntry(taskIndex, 0),
        historyEntry(taskIndex, 1),
      ]).flat()}
    />,
  );

  assert.equal((markup.match(/任务详情/g) ?? []).length, 10);
  assert.match(markup, /第 1–10 条 \/ 共 11 条/);
  assert.equal((markup.match(/全量检测 · Skill/g) ?? []).length, 10);
});
