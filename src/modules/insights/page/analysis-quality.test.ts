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

test("rejects v4 observed speculation and external benchmark samples", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "今日单事件平均消耗一千余 Token。",
      "单事件消耗量级远高于常见提示场景，提示词或上下文构造可能存在低效重复加载。",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "已安装 Agent 均可读取。",
      "已安装与可读取范围基本一致，但差异可能反映权限或配置状态，需核对清单。",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "当前可读取 Agent 共五个。",
      "本地可读性缺失的 Agent 可能影响分析完整性。",
    ),
    false,
  );
});

test("rejects v4 observed cross-candidate calculations and claims", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "今日共有十二段会话。",
      "平均每段会话二百余事件，单段会话承载的信息密度较高。",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "今日有三个活跃来源。",
      "这些来源贡献全部可统计用量，当前统计覆盖集中在活跃来源。",
    ),
    false,
  );
});

test("rejects inconclusive data-gap filler", () => {
  for (const analysis of [
    "需结合更多指标判断当前状态。",
    "需进一步区分不同来源后才能形成结论。",
    "现有信息无法确认是否存在异常。",
    "需要更多数据进行进一步分析。",
    "The available fact cannot determine the cause.",
  ]) {
    assert.equal(
      isInsightAnalysisUseful("今日记录了可观测用量。", analysis),
      false,
      analysis,
    );
  }
});

test("keeps a fact-supported share implication and priority", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "用量最高的 Agent dsh 占总 Token 的 56%。",
      "单一来源贡献过半消耗，该来源策略调整会直接影响整体用量稳定性，需优先关注。",
    ),
    true,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "The leading agent accounts for more than half of total token use.",
      "This majority share suggests prioritizing changes to that source because they directly affect overall usage stability.",
    ),
    true,
  );
});

test("rejects v6 observed cross-candidate event metric and dimension filler", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "当前范围内共记录 101 段 AI 会话。",
      "会话数量与事件量结合可评估单次会话的活动密度，但当前仅提供总量维度。",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "当前范围内共记录 101 段 AI 会话。",
      "现有只包含总量维度，无法形成进一步结论。",
    ),
    false,
  );
});

test("allows an event implication when the current fact contains that metric", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "当前范围内共记录 101 段 AI 会话和 256 个事件。",
      "事件规模会直接影响逐条复盘成本，应优先处理高活动会话。",
    ),
    true,
  );
});

test("rejects v6 unsupported limited quantity and meta-rule filler", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "当前有 4 个 Agent 产生了可统计的用量事件。",
      "产生事件的来源数量有限，可关注来源覆盖的均衡性，但无需对未产生事件来源做假设。",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "当前有少量 Agent 产生了可统计的用量事件。",
      "产生事件的来源数量有限，应优先关注来源集中带来的用量波动。",
    ),
    true,
  );
});

test("rejects v5 observed inconclusive and allocation filler", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "今日安全风险记录为零。",
      "安全状态无记录，无法据此判断整体健康度",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "今日剩余调用次数为八次。",
      "剩余调用次数充足，但需结合实际需求分配，避免集中消耗导致后续不足。",
    ),
    false,
  );
});

test("rejects v5 observed ratios and ungrounded level conclusions", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "当前可读取 Agent 为三个。",
      "四分之三的 Agent 可读取，当前覆盖度较高。",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "今日有两个来源产生数据。",
      "仅有少数来源产生数据，可据此判断覆盖集中度。",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "今日记录了单事件平均消耗。",
      "单事件消耗偏高时优先排查高消耗会话",
    ),
    false,
  );
});

test("rejects v5 observed fixed-state and configuration filler", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "当前有三个 Agent 产生事件。",
      "当前产生事件的代理数量已固定，可据此判断近期活跃代理的覆盖范围。",
    ),
    false,
  );
  assert.equal(
    isInsightAnalysisUseful(
      "注册表记录十个来源。",
      "注册表来源总量固定，但可用性与产出差异明显，需评估存量来源的配置价值。",
    ),
    false,
  );
});

test("keeps a level conclusion when the fact provides an explicit threshold", () => {
  assert.equal(
    isInsightAnalysisUseful(
      "单事件消耗已超过预设上限。",
      "偏高消耗会放大高频请求成本，应优先处理。",
    ),
    true,
  );
});
