# TrustTools 今日洞察双模式敏捷任务清单

| 属性 | 值 |
|------|-----|
| 文档类型 | 敏捷任务清单 (AGILE-TASK) |
| 项目名称 | TrustTools-今日洞察双模式 |
| 版本 | v1.0 |
| 创建日期 | 2026-08-19 10:25:57 |
| 更新日期 | 2026-08-19 10:25:57 |
| 生成工具 | agile-feature-dev + product-manager |
| 文档状态 | 草稿 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v1.0 | 2026-08-19 10:25:57 | 根据双模式架构拆分 Release A 规则核心与 Release B 可选 LLM 增强的史诗、故事、任务和验收门禁 |

---

## 1. 目标与交付边界

本计划对应《TrustTools 全页面“今日洞察”双模式架构设计与实施方案》。交付分成两次可独立发布：

- **Release A（MUST）**：14 个 UI 路由全部接入确定性 Insight Core。无需大模型、Profile、API Key 或网络，仍提供真实事实、解释、行动建议或明确空态。
- **Release B（SHOULD，可选）**：通过 `InsightEnhancerPort` 接入 LLM，增强候选排序与解释表达。它可延期、取消或关闭，不能反向成为 Release A 的依赖。

本轮是架构与任务规划，不包含业务代码实施。任务进入开发后，每个故事控制在 2–5 人日，每个任务控制在 0.5–1 人日，并要求可独立测试、评审和回滚。

### 1.1 范围路由

| 批次 | 路由 / Surface | 展示形态 |
|---|---|---|
| Pilot | `/`、`/sources`、`/tracker` | `JarvisInsight` |
| Workbench | `/agents`、`/distill`、`/reports`、`/memory` | `JarvisInsight` |
| Ecosystem | `/skills`、`/market`、`/chats/` | `JarvisInsight` |
| Special | `/security`、`/widget`、`/settings`、`/chats/:id` | `SecurityBriefing`、`JarvisWidget` 或专属容器 |

非 UI 路由 `/sitemap.xml` 明确排除。新增 UI 路由必须先登记 Surface、证据源、规则策略和展示形态，才能通过覆盖门禁。

## 2. 需求与优先级

### 2.1 可追踪需求

| ID | 级别 | 需求 | 验收摘要 |
|---|---|---|---|
| FR-DM-001 | MUST | 14 个 UI 路由提供统一今日洞察 | 每页有完整规则洞察或明确空态 |
| FR-DM-002 | MUST | 今日洞察不依赖大模型 | 无 Profile、无 Key、断网、未注入 Enhancer 时 14/14 通过 |
| FR-DM-003 | MUST | 事实与动作由本地代码控制 | 数字、实体、严重度、动作均能追踪到读模型和规则 |
| FR-DM-004 | SHOULD | 用户可主动启用 LLM 增强 | 支持 `enhanced-manual`；关闭后规则结果不变 |
| FR-DM-005 | COULD | 已授权用户可自动增强 | 支持 `enhanced-auto`，首屏仍先显示规则结果 |
| FR-DM-006 | MUST | 本地优先与数据最小化 | 规则模式零外发；增强不发送正文、路径、命令、凭据 |
| FR-DM-007 | MUST | 安全洞察不可被模型弱化 | mandatory 和 severity floor 运行时强校验 |
| NFR-DM-001 | MUST | 规则洞察不阻塞首屏 | 纯规则计算 P95 小于 50 ms，不发网络请求 |
| NFR-DM-002 | MUST | 支持 zh-CN、en-US、ja-JP | 规则模式三语言完整；增强语言错误保留规则文案 |
| NFR-DM-003 | SHOULD | 增强成本和故障可控 | 缓存、预算、超时、singleflight、kill switch 可验证 |

### 2.2 MoSCoW 边界

| 优先级 | 包含 | 不包含 |
|---|---|---|
| MUST | 14 页 Core、证据适配器、确定性规则、动作白名单、三语言、空态/陈旧态、无模型验收 | 任何 Provider 调用 |
| SHOULD | 可选 Port、手动增强、脱敏输入、输出校验、缓存/预算、独立开关 | 自动外发、正文分析 |
| COULD | 自动增强 opt-in、预热、反馈按钮、真实模型非阻塞评测 | 作为 Release A 门禁 |
| WON'T（本阶段） | LLM 直接执行动作、生成数字或安全 verdict、发送原始正文、跨设备缓存、微服务化 | — |

## 3. 依赖图与发布里程碑

```mermaid
flowchart LR
  A0["A0 基线与 ADR"] --> A1["A1 Insight Core"]
  A1 --> A2["A2 三页试点"]
  A2 --> A3["A3 十一页扩展"]
  A3 --> A4["A4 Release A 门禁"]
  A4 -. 可选立项 .-> B1["B1 Enhancer Port"]
  B1 --> B2["B2 三页增强试点"]
  B2 --> B3["B3 全页增强与偏好"]
  B3 --> B4["B4 Release B 门禁"]
```

| 里程碑 | 完成定义 | 预计人日 |
|---|---|---:|
| M-A0 | 路由、数据源、现有文案和决策基线冻结 | 2 |
| M-A1 | 统一 Core 契约与三页规则试点完成 | 6 |
| Release A | 14/14 页面规则模式通过无模型发布门 | 17–18（累计） |
| M-B1 | 可选 Enhancer Port 与三页手动增强可用 | 5 |
| Release B | 全页增强、评测、灰度和独立回滚完成 | 15（独立增量） |

Release A 是关键路径；Release B 只能在 Release A 完成后单独立项。任何 B 类任务不得修改 FR-DM-001/002/003 的验收定义。

## 4. Epic A — Release A：无模型完整能力（MUST）

### Story A-01：冻结基线与双模式决策（2 人日，2 SP）

作为产品与研发团队，我们需要固定页面范围、事实源和模型可选原则，以便后续实现不会遗漏页面或把模型误设为核心依赖。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| A-01-01 | 建立 14 路由覆盖清单与现状截图/fixture | 1d | 无 | 每个 Surface 有当前组件、证据源、空态和特殊限制 |
| A-01-02 | 新增 ADR：Core 必选、Enhancer 可选、远程聚合数据需授权 | 0.5d | 无 | 明确依赖方向、代价、复审条件和两次发布 |
| A-01-03 | 建立新增路由 coverage 检查骨架 | 0.5d | A-01-01 | 未登记 UI 路由可使验证失败；`/sitemap.xml` 在排除清单 |

验收场景：仓库完全没有模型 Profile 时，现有应用基线可运行；ADR 不使用“无模型降级版”表述。

### Story A-02：建立 Insight Core 契约与规则引擎（4 人日，5 SP）

作为页面开发者，我需要统一的证据、候选、动作和响应契约，以便不同页面共享运行机制但保留业务语义。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| A-02-01 | 定义 Surface、Scope、Evidence、Candidate、Envelope 契约 | 1d | A-01-02 | 契约无 React/Node/Provider 类型；Evidence 只允许标量和枚举 |
| A-02-02 | 实现候选优先级、mandatory、新鲜度和规则状态机 | 1d | A-02-01 | empty/healthy/risk/stale/partial fixture 单测通过 |
| A-02-03 | 实现本地事实、解释、动作拼装和动作注册表 | 1d | A-02-01 | 动作仅为登记的站内导航或无副作用 UI 操作 |
| A-02-04 | 建立 Adapter Registry 与组合根 | 0.5d | A-02-01 | Core 不 import `ai-orchestration`；新增 Surface 必须注册 |
| A-02-05 | 补 Core 指标、错误脱敏和性能基准 | 0.5d | A-02-02 | 规则计算 P95 初始基准可重复；日志不含事实值和用户内容 |

验收场景：在测试中禁止网络并移除全部模型依赖，Core 仍能从 fixture 生成完整 `InsightEnvelope`。

### Story A-03：迁移三页规则试点（2 人日，3 SP）

作为用户，我希望首页、数据源和 Tracker 先使用统一洞察，以验证 Core 能兼容现有功能和真实数据。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| A-03-01 | 迁移 `/` Dashboard adapter 与规则 | 1d | A-02 | 安全、成本、效率、数据质量能按规则选出 1–3 条 |
| A-03-02 | 迁移 `/sources` 与 `/tracker` adapter/规则 | 0.5d | A-02 | 两页现有真实行行为 parity，未知数据不当作零 |
| A-03-03 | 接入安全查询与 `JarvisInsight` 兼容展示 | 0.5d | A-03-01,A-03-02 | 打开页面不调用 Provider；三页无模型 E2E 通过 |

验收场景：断网、删除 Profile、刷新三页，洞察保持可用且不出现“请配置 AI”提示。

### Story A-04：迁移工作台页面（3 人日，5 SP）

作为工作台用户，我希望 Agent、蒸馏、报告和记忆页面都有基于真实状态的下一步建议。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| A-04-01 | `/agents` 证据 adapter、兼容矩阵规则与范围隔离 | 1d | A-03 | toolId 经注册表校验；建议不由模型生成 |
| A-04-02 | `/distill` 证据 adapter 与选择/审批/配额规则 | 0.5d | A-03 | 不读取或外发 transcript、产物正文 |
| A-04-03 | `/reports` 证据 adapter 与生成/计划/错误规则 | 0.5d | A-03 | 报告正文不进入 Evidence；未知状态诚实展示 |
| A-04-04 | `/memory` 证据 adapter 与同步/去重/来源规则 | 0.5d | A-03 | 只使用计数和状态；不读取记忆正文 |
| A-04-05 | 四页 fixture、三语言和 E2E | 0.5d | A-04-01..04 | empty/healthy/actionable/stale/partial 均覆盖 |

### Story A-05：迁移生态与会话列表页面（2 人日，3 SP）

作为生态和会话用户，我希望 Skills、Market、Chats 页面用一致的规则洞察提示风险、机会和下一步。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| A-05-01 | `/skills` 证据 adapter 与安全/同步/使用规则 | 0.5d | A-03 | 自定义 Skill 名不进入通用 Evidence；动作需二次确认 |
| A-05-02 | `/market` 证据 adapter 与更新/兼容/风险规则 | 0.5d | A-03 | 未过安全门禁的项目不会被推荐安装 |
| A-05-03 | `/chats/` 证据 adapter 与活动/成本/连续性规则 | 0.5d | A-03 | 只使用会话元数据，不读取正文 |
| A-05-04 | 三页展示、三语言、契约测试与 E2E | 0.5d | A-05-01..03 | 文案 key 完整；无模型、断网和空数据场景通过 |

### Story A-06：迁移特殊表面（3 人日，5 SP）

作为安全、设置、小组件和会话详情用户，我希望特殊页面保留专属视觉，同时遵循统一证据与规则边界。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| A-06-01 | `/security` adapter 与 mandatory/severity 规则 | 1d | A-03 | 高危事实第一条；扫描不完整时不宣称安全 |
| A-06-02 | `/widget` 全局摘要投影和单行规则 | 0.5d | A-03 | 复用 dashboard 证据，不产生独立扫描或模型请求 |
| A-06-03 | `/settings` 配置健康规则与静默默认状态 | 0.5d | A-03 | 未配置模型不显示缺陷；仅在用户主动增强处给配置入口 |
| A-06-04 | `/chats/:id` 元数据规则与 entityId 校验 | 0.5d | A-03 | 非法 ID 被拒绝；不读取会话正文 |
| A-06-05 | 专属展示适配、三语言和 E2E | 0.5d | A-06-01..04 | `SecurityBriefing`/`JarvisWidget` 视觉保留，契约一致 |

### Story A-07：Release A 质量门与交付（2 人日，3 SP）

作为发布负责人，我需要证明产品在完全不接大模型时仍满足“所有页面今日洞察”的交付定义。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| A-07-01 | 执行 14 页面 coverage、契约、i18n 和浏览器边界测试 | 0.5d | A-04,A-05,A-06 | 14/14 登记并通过；renderer 无敏感字段 |
| A-07-02 | 执行零 Profile、零 Key、禁网、未注入 Enhancer E2E | 0.5d | A-07-01 | 14/14 完整规则洞察或明确空态；零外发请求 |
| A-07-03 | 执行性能、桌面离线、安全 mandatory 回归 | 0.5d | A-07-01 | Core P95 目标达标；安全严重度和首屏不回归 |
| A-07-04 | 完成 Release A 架构审计、发布说明和回滚演练 | 0.5d | A-07-02,A-07-03 | 可独立发布；回滚不涉及增强数据或模型配置 |

Release A 退出条件：FR-DM-001/002/003/006/007 与 NFR-DM-001/002 全部通过。未完成 Release B 不得记录为 Release A 缺陷。

## 5. Epic B — Release B：可选 LLM 增强（SHOULD）

### Story B-01：实现可选 Enhancer Port 和增强基础设施（5 人日，8 SP）

作为选择模型增强的用户，我希望系统在不改变事实与动作的前提下改善解释和排序。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| B-01-01 | 定义 `InsightEnhancerPort`、输入/输出和可选 DI | 0.5d | Release A | 未注入 Port 时构建和全部 A 类测试结果一致 |
| B-01-02 | 复用 composition `AIExecutorPort`，移除首页自建 Provider 路径 | 1d | B-01-01 | Profile/密钥只有现有服务端入口；协议实现不重复 |
| B-01-03 | 实现 Prompt registry 与版本化最小 payload | 1d | B-01-02 | 输入仅含候选 ID、脱敏事实、严重度和 actionId |
| B-01-04 | 实现结构、引用、数字/实体、动作和语言五层校验 | 1d | B-01-03 | 任一失败丢弃增强结果并保留规则文案 |
| B-01-05 | 实现内容寻址缓存、singleflight、预算和超时 | 1d | B-01-02 | 缓存键隔离 surface/locale/evidence/profile/prompt；预算 fail-closed |
| B-01-06 | 实现独立指标、脱敏日志和 Enhancer kill switch | 0.5d | B-01-04,B-01-05 | 关闭后不读 Profile、不调 Provider，Core 指标不受影响 |

### Story B-02：三页手动增强试点（2 人日，3 SP）

作为已配置模型的用户，我希望在三页试点主动请求更自然的解释，并可随时继续使用规则结果。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| B-02-01 | `/`、`/sources`、`/tracker` 接入 `enhanced-manual` | 1d | B-01 | 规则结果先显示；模型只替换解释部分 |
| B-02-02 | 增加用户操作处的 Profile/授权/预算状态 | 0.5d | B-02-01 | 未配置时只在主动操作处提示，不产生全局错误 |
| B-02-03 | fake provider、隐私 payload、错误输出和 Profile 切换 E2E | 0.5d | B-02-01 | 成功/失败均不改变事实、动作或页面可用性 |

### Story B-03：全页面增强与用户偏好（5 人日，8 SP）

作为选择增强模式的用户，我希望所有页面遵循同一设置、隐私和失败行为。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| B-03-01 | Workbench 四页接入手动增强 | 1d | B-02 | 不发送正文；规则事实和动作不变 |
| B-03-02 | Ecosystem 三页接入手动增强 | 1d | B-02 | 实体别名和安全门禁生效 |
| B-03-03 | Security/Chat detail 接入受限增强 | 1d | B-02 | 高危 mandatory 不可隐藏、降级或改写 |
| B-03-04 | Widget 复用 dashboard 增强缓存；Settings 接入偏好 | 1d | B-02 | Widget 不单独调用；默认固定 `rules` |
| B-03-05 | 实现 `enhanced-auto` opt-in 与远程授权版本 | 0.5d | B-03-04 | 未授权不调远程模型；首屏不等待增强 |
| B-03-06 | 全页面模式切换、缓存隔离和失败等价 E2E | 0.5d | B-03-01..05 | rules/manual/auto 切换不串页、不串语言、不闪空 |

### Story B-04：增强评测、灰度与 Release B（3 人日，5 SP）

作为发布负责人，我需要用独立质量门确认增强能力安全、可控且能一键关闭。

| Task | 工作项 | 估时 | 依赖 | 验收 |
|---|---|---:|---|---|
| B-04-01 | 建立 14 页 × 5 状态的 fake-provider 评测集 | 1d | B-03 | candidate/mandatory/数字/动作/语言硬指标自动评分 |
| B-04-02 | 执行真实模型手动基准、成本和 P95 记录 | 0.5d | B-04-01 | 真实模型不作为普通 CI 门；结果可按 Provider/Profile 对比 |
| B-04-03 | 执行 shadow、manual pilot、manual beta 灰度 | 0.5d | B-04-01 | 每阶段有进入/退出条件；默认仍是 `rules` |
| B-04-04 | Enhancer kill switch、缓存清理和 Release A 回归演练 | 0.5d | B-04-03 | 关闭 Enhancer 后 Release A 全套测试结果一致 |
| B-04-05 | 完成 Release B 架构/测试审计和发布说明 | 0.5d | B-04-02,B-04-04 | 遗留风险、预算和外发策略有明确 owner |

Release B 退出条件：FR-DM-004、NFR-DM-003 通过；FR-DM-005 可按产品决定留在 opt-in beta，不影响 Release A/B 的规则能力。

## 6. 页面完成定义（Definition of Done）

每个 Surface 只有同时满足以下条件才记为完成：

1. 权威读模型、Evidence 白名单、候选规则、动作和空态均已登记。
2. 规则结果中的事实、数字、实体、严重度和动作可追踪，不由 LLM 创造。
3. `empty|healthy|risk|stale|partial` fixture 至少覆盖适用状态。
4. zh-CN、en-US、ja-JP 文案和无障碍语义完整。
5. 删除 Profile、API Key 并断网后，页面仍通过规则模式 E2E。
6. 页面 loader/GET 不触发 Provider，不读取原始正文，不返回路径、命令或凭据。
7. 若接入增强：成功只改变解释/排序；失败、超时、超预算和非法输出均保留同证据版本规则结果。
8. 相关 TypeScript、lint、边界检查、单测、E2E 和 `git diff --check` 通过。

## 7. 关键验收场景

| 场景 | Release A 预期 | Release B 额外预期 |
|---|---|---|
| 首次安装、无模型配置 | 14 页完整可用，不提示能力缺失 | 增强入口按需说明配置方式 |
| 断网 | 所有规则洞察正常，零外发 | 已缓存增强可显示；新增强保留规则结果 |
| 空数据/未知费用 | 明确空态或未知，不描述为健康/零费用 | 模型不得填造事实 |
| 安全高危 | 高危事实第一条，严重度不降低 | 模型不能隐藏、降级或生成处置命令 |
| Provider 超时/429/5xx | 不适用，Core 不接 Provider | 页面不闪空，保留规则结果并记录增强状态 |
| 语言/Profile/证据变化 | 规则结果按最新本地状态重算 | 增强缓存严格隔离，旧生成不得覆盖新规则 |
| 用户关闭增强 | 不影响任何页面 | 不再读取 Profile 或调用 Provider，可清理可丢弃缓存 |

## 8. 实施节奏与团队建议

按 2 人全职估算：

- Sprint 1：A-01、A-02、A-03，完成三页规则试点。
- Sprint 2：A-04、A-05、A-06，完成 14 页规则覆盖。
- Sprint 3 前半：A-07，发布 Release A；剩余时间用于缺陷缓冲或下一优先级工作。
- 后续独立迭代：若产品选择接入模型，再安排 B-01 至 B-04；不接入时无需预留 Provider、缓存或预算运维成本。

并行原则：A-02 完成前不铺页面；A-03 通过后，A-04/A-05/A-06 可由两人分批并行。B-01 完成前不接页面增强；A 类测试在所有 B 类提交中保持阻断。

## 9. 任务完成模板

每个任务的 PR/提交说明应包含：

- 任务 ID、涉及 Surface、依赖已满足的证据；
- Evidence/规则/动作/i18n 是否变化及其 fixture；
- 是否新增浏览器 DTO、存储 schema、Profile 或网络行为；
- 无模型、断网、空态和安全 mandatory 的测试结果；
- 若涉及增强：外发字段、授权、预算、缓存键、失败等价与 kill switch 证据；
- 执行的类型检查、lint、边界测试、单测、E2E 和未覆盖风险；
- 回滚方式，以及兼容 facade 的删除条件。

## 附录：计划自检

- 14 个 UI 路由均有明确批次和任务归属，`/sitemap.xml` 明确排除。
- Release A 不需要模型 Profile、API Key、网络、增强缓存或预算，具备独立估算和发布门。
- Release B 通过 Port 可选注入，可延期、关闭和独立回滚。
- 页面故事控制在 2–5 人日，任务控制在 0.5–1 人日，并标注依赖和可测试验收。
- 模型不生成事实、数字、严重度或任意动作；远程增强不读取原始正文。
- 未确认的预算、实体外发和增强缓存保留策略只阻塞 Release B，不阻塞 Release A。
