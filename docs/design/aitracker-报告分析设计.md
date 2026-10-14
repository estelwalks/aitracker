# AITracker 报告（日报/周报/月报）分析设计

> 版本：v2（2026-09-17）
> 状态：已实施（R0–R5 完成，2026-09-17）
> 对应模块：`src/modules/reports/`
> 关联文档：[业务结构 §4.8 报告](../architecture/business-structure.zh-CN.md)、[系统架构](../architecture/system-architecture.zh-CN.md)、[后续开发计划](../plan/aitracker-后续开发计划.md)

---

## 1. 产品定位与报告要回答的问题

AITracker 的报告（日报/周报/月报）是用户的 **AI 使用复盘**，不只是用量仪表盘。它应该回答三类问题：

| 问题 | 含义 | 现状 |
|---|---|---|
| Q1 用了多少 | Token、成本、会话、轮次、时长、编辑 | ✅ 已覆盖 |
| Q2 干了什么 | 在哪些项目上、做了哪类工作（编码/调试/研究/规划）、任务主题 | ❌ 基本缺失 |
| Q3 干得怎么样 | 亮点（集中、产出、缓存效率、安全）与不足（重复、分散、无沉淀、异常） | ❌ 完全缺失 |

用户反馈的痛点正是 **Q2/Q3 缺失**：日报总结主要复述统计数字，不分析会话里做了什么、优缺点是什么。本文档定位该问题、给出根因与改进方案。

---

## 2. 现状：报告数据流（已走查验证）

```
SessionSnapshot ─┐
UsageSnapshot  ──┤→ usage-context-adapter.collect()
汇率快照        ─┘        │
                          ▼
                 ReportStats（纯数字聚合）
                          │
                          ▼
        buildContextSummary() → ReportContext.summary（喂给模型的唯一文本）
                          │
                          ▼
   AI 生成适配器 ai-generation-adapter → 模型 → 摘要插入固定正文
```

### 2.1 喂给模型的文本 `context.summary` 只有 4 类内容

`buildContextSummary()`（`src/modules/reports/infrastructure/usage-context-adapter.ts`）生成的文本仅含：

1. 一句总览：会话数、轮次、Token、成本、编辑数、时长（纯数字）；
2. 按 Agent 统计的 Markdown 表格（会话/Token/成本/改动/时长）；
3. 项目名列表（display-safe 键，无路径）；
4. 「主要精力集中在「X」」一句。

**没有任何**：会话主题、行为类型、产出/沉淀、重复工作信号、模型/缓存明细、优缺点依据。

### 2.2 固定正文（离线路径）比模型输入更丰富

`daily-report-document.ts` / `periodic-report-document.ts` 的固定正文包含：
- 会话排行 Top 5（含标题，`reportSessionTitle` = 第一个用户 prompt 截断 ≤72 字符，否则 `项目 · Agent` 兜底）；
- 模型使用、Token 与缓存、Skill 与安全章节；
- 「今日关注」attention 章节。

**关键偏差**：配置了模型 profile 时，AI 摘要插入固定正文之上，但模型只能看到 2.1 的瘦文本（连固定正文里的会话标题都没有）——AI 总结反而比它脚下的固定正文信息更少，只能复述统计数字。

### 2.3 `repeated` 字段是死的

- `ReportStats.sessionsDetail[].repeated`（`src/modules/reports/contracts.ts:227`）被固定正文读取（`repeated.length` 触发「建议蒸馏」关注项）；
- 但 `usage-context-adapter.ts` 构造 `sessionDetails` 时**从不填充 `repeated`**；
- 结论：重复工作/蒸馏机会信号在报告链路中为 dead field，从未生效。

### 2.4 报告模块不读会话内容（有意的隐私边界）

- `ReportContext.summary` 注释明确 "never raw sessions or conversation content"；
- `safeReportText` 在持久化时剥离路径/命令/密钥/正文；
- 周报/月报 prompt 均要求"不出现路径、命令、密钥、完整会话正文"。
- 这是 **fail-closed 的隐私设计，不是缺陷**；改进必须在保持该边界的前提下，用"脱敏聚合信号"补齐 Q2/Q3，而不是读原文。

---

## 3. 现状：提示词分析

提示词全部集中在 `src/modules/reports/templates.ts`（版本化管理：日报模板 v3、AI 摘要日 v2 / 周月 v1）。

### 3.1 日报（zhDaily）

- 定位明确写死："这是一份'快速浏览型日报'，**不是分析文章**"；
- 固定结构全部是数字表格：今日概览 / Agent 使用 / 项目与对话 / 会话排行 / 模型使用 / Token 与缓存 / Skill 与安全 / 今日关注；
- 硬约束：「只使用实际提供的数据，不编造、不推测」「不出现本地路径、命令、密钥或完整会话正文」「Token 高、会话长、轮次多本身不代表浪费」。

### 3.2 周报 / 月报

- 章节比日报更有分析意图：本周总结 / 使用趋势 / Agent·模型·项目 / **本周重点发现** / **沉淀与产出** / 安全情况 / **下周建议**；
- 但「沉淀与产出」「建议」要求"识别跨会话重复出现的任务模式"，**输入里没有该信号** → 模型只能输出「本周暂无明确的新增沉淀机会」或基于数字泛泛而谈；
- 数据规则同样要求"只使用实际提供的数据"，因此模型在缺信号时被约束为闭嘴，而不是编造。

### 3.3 AI 总结 prompt（日/周/月，插入固定正文）

- 全部要求"只使用输入中明确存在的数据，不补充、不猜测、不推断"；
- 因此当输入（2.1）只有数字时，输出只能是数字的转述——这是用户看到"总结主要是统计数"的直接原因。

---

## 4. 覆盖度矩阵（用户视角 vs 现状）

| 用户期望 | 实施后现状（R0–R5） | 落地证据 |
|---|---|---|
| 统计数字（用量/成本/占比/变化） | ✅ 完整（不变） | `ReportStats` 全字段 |
| 会话里做了什么（主题/任务） | ✅ 主要会话进 `context.summary` | R1：`usage-context-adapter` 把主要会话信号写入 summary |
| 做了哪类工作（行为类型） | ✅ 行为分布进 `context.summary` | R1：从 bucket `context.tools` 派生近似分布（ADR-REP-001） |
| 优点（亮点） | ✅ 日报正文「亮点与不足」+ AI 摘要亮点 | R2：正文 v10、AI 摘要 daily v3 |
| 缺点（问题/风险/不足） | ✅ 同上「不足」维度 | R2：同上 |
| 重复工作 / 蒸馏机会 | ✅ `repeated` 真实计算 + 固定正文「建议蒸馏」 | R3：`titlesSimilar` + 跨周期比较；ADR-REP-002 |
| 成果/沉淀（Skill/记忆/蒸馏） | ✅ 周/月报「沉淀与产出」真实计数 | R4：`ReportOutputPort` 经 composition root 注入；正文 v4；ADR-REP-003 |
| 安全与风险 | ⚠️ 有章节但依赖输入（保持） | Skill 与安全章节 |

---

## 5. 根因总结

1. **输入侧是主因**：`context.summary` 是纯聚合数字，模型"巧妇难为无米之炊"；连固定正文里已有的会话标题都没给模型。
2. **提示词定位**：日报被设计成"10 秒快速浏览仪表盘"，不是工作复盘；周报/月报有分析章节但缺输入信号。
3. **已有能力未接线**：`classifyModelBehaviors()`（脱敏行为分类）、`buildContextBreakdown()`（上下文构成）、`repeated`（重复信号）、knowledge/distill 成果——全部已存在但没进报告链路。
4. **隐私边界**：是正确约束，但"不读原文"≠"没有语义信号"，脱敏聚合信号完全可以补齐 Q2/Q3。

---

## 6. 改进方案

### 6.1 输入侧：为 `context.summary` 补充脱敏语义信号（核心）

按隐私边界，全部使用**聚合/投影信号**，不读会话原文：

| # | 信号 | 数据源（已存在） | 形态 |
|---|---|---|---|
| 1 | 行为分布 | `classifyModelBehaviors()`（脱敏，不读文本） | 「编码/重构 x%、调试 x%、研究 x%、规划 x%、子智能体 x%」 |
| 2 | 任务主题 | Top5 `reportSessionTitle`（已安全化） | 会话标题清单 + 项目分组 |
| 3 | 重复工作 | 计算 `repeated`（会话标题/项目/时段相似度，或蒸馏候选标记） | 填充 `sessionsDetail.repeated` + 进 summary |
| 4 | 成果/沉淀 | knowledge/distill/skill 新增数（同周期） | 「新增 Skill n、记忆 n、蒸馏 n」 |
| 5 | 模型与缓存 | 已有 `byModel` / `cache`（在 stats 但没进 summary） | 关键项补入文本 |
| 6 | 对比基准 | 已有 `yesterday` / `trend` | 「较昨日/较上周」已有，保持 |

### 6.2 提示词侧：升级模板版本

- **日报**：
  - 新增「今日工作内容」章节：基于信号 1+2，概括"今天主要在哪些项目上做了哪类工作"（数据支持的概括，禁止编造细节）；
  - 新增「亮点与不足」章节：亮点（集中度高、产出多、缓存命中高、无风险）+ 不足（重复多、分散、无沉淀、缓存命中低、有风险项），**每条必须有输入数据依据**；
  - 保持"快速浏览"定位，不变成长文。
- **周报/月报**：「沉淀与产出」「重点发现」「建议」章节按信号 3+4 补齐输入，让模型能真正识别跨会话重复模式与产出。
- **AI 总结**：输入文本升级后，prompt 增加"先概括做了什么，再给亮点与不足"的指令。
- 版本管理：`templates.ts` 已版本化（`version()` 函数），改模板必须升版本号；新增/修改模板 ID 需同步 `templates.test` 与运行时策略校验。

### 6.3 架构边界（保持）

- reports 不 import sessions/distillation 具体实现；新信号通过 **composition root 注入 port** 或 **动态 import transport**（与蒸馏读取会话内容同模式）接入；
- 渲染端只使用安全 read model，正文过 `safeReportText`；
- 行为分类输入必须保持"脱敏工具/命令聚合，不读会话文本"的 clean-room 约束（`behavior-classify.ts` 注释明确）。

### 6.4 实施建议顺序

1. 输入侧信号 1（行为分布）+ 2（会话标题进 summary）——成本最低、直接改善 Q2；
2. 计算并填充 `repeated`（信号 3），激活固定正文已有的「建议蒸馏」关注项；
3. 提示词升级（日报新增"工作内容 + 亮点不足"章节），升版本号；
4. 信号 4（成果/沉淀）接线，强化周报/月报；
5. 全链路测试与隐私契约测试。

---

## 7. 验收标准

- 日报 AI 总结能说出"今天主要在哪些项目做了哪类工作"，且每条陈述能追溯到输入信号；
- 日报/周报出现"亮点与不足/重点发现"，每一条都有输入数据依据，**不编造**；
- 重复工作被标记并触发固定正文「建议蒸馏」关注项（`repeated` 生效）；
- 周报/月报「沉淀与产出」能反映真实的 Skill/记忆/蒸馏产出；
- 隐私契约测试通过：报告正文与模型输入不含路径、命令、密钥、完整会话正文；
- 模板版本号升级，模板一致性校验（`npm run verify:*` 相关项）通过；
- 全量 `npm run typecheck && npm run lint && npm run test:all` 通过。

---

## 8. 关键代码事实（防回归速查）

| 事实 | 位置 |
|---|---|
| 模型输入 = `context.summary`（瘦文本） | `src/modules/reports/infrastructure/ai-generation-adapter.ts` |
| summary 构造（仅 4 类内容） | `src/modules/reports/infrastructure/usage-context-adapter.ts` `buildContextSummary()` |
| `repeated` 从未填充（dead field） | `contracts.ts:227`；`usage-context-adapter.ts` sessionDetails 映射 |
| 行为分类已存在、未接入报告 | `src/lib/local-usage/behavior-classify.ts` |
| 上下文构成已存在 | `src/lib/local-usage/context-breakdown.ts` |
| 会话标题安全化规则 | `reportSessionTitle()`（≤72 字符，prompt 截断则用项目·Agent 兜底） |
| 隐私边界 | `safeReportText` + `ReportContext.summary` 注释 "never raw sessions or conversation content" |
| 模板版本化管理 | `src/modules/reports/templates.ts` `version()` |
