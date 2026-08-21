import assert from "node:assert/strict";
import test from "node:test";

import { isInsightAnalysisUseful } from "./analysis-quality.ts";

test("rejects the observed security and cache paraphrases", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "今日安全扫描未发现风险，所有项目均通过检查。",
      "今日未发现安全风险，所有已扫描项目均通过检查。",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "「aipy」缓存命中率仅 0，建议复用上下文以降低成本。",
      "缓存命中率极低，建议复用上下文以降低成本。",
    ),
    false,
  );
});

test("rejects unverifiable collection and tool-completeness guidance", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "首页汇总了今日可用数据。",
      "先确认数据来源持续采集中，首页结论才不会因采集断档而失真。",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "Agent 总览展示当前已识别工具。",
      "补齐未接入的本地工具，可使 Agent 总览覆盖更完整。",
    ),
    false,
  );
});

test("rejects interpreting unknown telemetry as zero", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "缓存命中率暂无数据。",
      "当前缓存复用为零，应提高复用率。",
    ),
    false,
  );
});

test("keeps a supported incremental implication", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "检测到高风险安全项。",
      "应优先处置以缩短风险暴露时间。",
    ),
    true,
  );
});
