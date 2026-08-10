# TrustTools UI 与总览模块重构需求规格说明书

| 属性 | 值 |
|------|-----|
| 文档类型 | 需求规格说明书 (SRS) |
| 项目名称 | TrustTools |
| 版本 | v2.0 |
| 创建日期 | 2026-08-10 10:55:00 |
| 更新日期 | 2026-08-10 12:38:37 |
| 生成工具 | agile-feature-dev |
| 文档状态 | 草稿 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v2.0 | 2026-08-10 12:38:37 | 以 `project-sparkle-hub-92-33a292ea-main` 更新视觉、数据和模块边界要求。 |
| v1.0 | 2026-08-10 10:55:00 | 基于最新原型建立 UI、首页总览与工具概览重构范围。 |

---

## 1. 背景与目标

以 `docs/V3.0_TrustTools/project-sparkle-hub-92-33a292ea-main` 为唯一视觉与信息架构参照，重构 TrustTools 的整体应用界面，并升级首页总览与工具概览（现有 `/skills`）的真实数据展示和操作体验。

原型中的静态 Mock 仅用于设计参考。现有本地用量、定价、会话、工具扫描、安全评估等模块仍是权威数据来源，禁止以伪造指标替换。

## 2. 功能范围

### 2.1 核心功能

1. 统一应用壳、设计令牌、页面 Hero、卡片墙、筛选器、图表与资产表格的终端化视觉语言；保留 i18n、主题、有效路由与响应式行为。
2. 首页以“洞察 → 系统状态 → 统一时间范围 → KPI → 工具/来源切换 → 趋势、模型、项目、贡献日历”的结构展示真实用量；选中工具后显示可观测的工作流统计。
3. 首页以真实会话数据补充会话数、时长、轮次与编辑轮次；所有区块由同一统计区间驱动；无数据时明确显示不可用，绝不估算伪造。
4. 工具概览提供“资产运营台”首屏：Skill 资产、安装副本、覆盖 Agent、待更新和最近扫描；保留搜索、筛选、排序、分页、详情、扫描、安装、同步、卸载和黑名单治理能力。
5. 工具/来源卡片仅呈现真实探测、真实用量、真实上下文统计和真实模型/项目聚合；缺少 source 与 session 关联时不得分摊或伪造。
6. 所有 UI 数据均经模块自己的 query/application 合约投影，不泄露路径、技能内容、命令、会话原文或其他敏感扫描细节。

### 2.2 本次不做

- 原型固定月预算、模拟调用数/日均调用数、虚构蒸馏进度、模拟安全拦截/省时/提示词质量等结论。
- 在没有稳定 `skillId → assessment` 证据关系前，为工具列表捏造安全结论。
- 迁移原型已废弃的 `/chats` 路由；应用继续使用现有 `/sessions`。

## 3. 数据需求

| 页面 | 维度 | 权威来源 | 获取方式 |
|------|------|----------|----------|
| 首页 | Token、来源、模型、项目、时间 | LocalUsageSnapshot | dashboard server query / application 聚合 |
| 首页 | 已知、估算、未知费用及缓存节省 | PricingSnapshot + usage events | pricing adapter；状态显式展示 |
| 首页 | 会话数、时长、轮次、编辑轮次 | SessionRecord | sessions 公共 query / dashboard adapter |
| 首页 | Skill 数及安装覆盖 | SkillSnapshot | skill-catalog browser-safe 投影 |
| 首页 | 工具/来源卡、趋势、模型、项目、上下文调用构成 | LocalUsageSnapshot + public tool manifest | dashboard application 聚合，仅保留公开 toolId/标签与统计字段 |
| 首页 | 系统探测、工具安装状态 | agent-directory / public manifest | server query 投影；无探测为 unknown |
| 工具概览 | 名称、描述、最后使用、安装位置 | SkillSnapshot | skill-catalog query facade |
| 工具概览 | 版本、来源、更新状态/理由 | SkillInstallation | 仅投影安全 DTO 和 opaque installationRef |
| 工具概览 | 资产/安装/Agent 覆盖/待更新摘要 | SkillSnapshot + agent directory | skill-catalog application read model |

## 4. 验收标准

1. 1440px、1024px、768px 与 320px 下页面无重叠；卡片、日历和宽表格按自身需要横向滚动。
2. 日期区间变化后首页 KPI、工具卡、趋势、模型、项目、贡献日历、上下文统计和导出使用同一组过滤事件；上一期比较只使用真实前一区间。
3. 成本始终区分已知、估算、未知；安全状态无 assessment 时为 unknown；空数据保持 onboarding/空状态。
4. 选中工具卡后，趋势、模型/项目 tab 与上下文构成重新使用该工具/来源的真实事件；合计与首页对应筛选聚合一致。
5. 工具页筛选、排序、分页、批量操作、同步冲突与卸载确认沿用真实后端操作，刷新不使用 Mock/Toast 代替扫描。
6. 浏览器 HTML、loader JSON 和导出中均不出现 path、roots、detectedPaths、URL、命令、会话原文、prompt/response、原始 sessionId 或安全证据。
7. 新增文本完整进入四语言消息目录；关键 DTO、单元测试、模块边界和 build 验证通过。

## 5. 风险与依赖

- 月预算、子 Agent 关系、上下文各节点 Token 归因和全局安全结论没有现有权威模型，本次不展示伪指标。
- 会话与用量数据可能来自不同采集周期，需在 read model 中暴露可用性与生成时间。
- 原型目录与 zip 为用户提供的未追踪参考材料，严禁将其纳入构建或提交。
