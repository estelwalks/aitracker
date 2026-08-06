# TrustTools 产品工作台重构实施计划

| 属性 | 值 |
|------|-----|
| 文档类型 | 敏捷任务清单 (AGILE-TASK) |
| 项目名称 | TrustTools |
| 版本 | v1.1 |
| 创建日期 | 2026-08-06 18:26:40 |
| 更新日期 | 2026-08-06 18:50:02 |
| 生成工具 | architecture-design |
| 文档状态 | 草稿 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v1.1 | 2026-08-06 18:50:02 | 完成 P0-02：补充原型页面、事实源、模块、作业与安全边界追踪矩阵。 |
| v1.0 | 2026-08-06 18:26:40 | 基于最新 Lovable 产品原型建立模块化工作台重构执行计划。 |

---

## 1. 使用方式与总原则

本计划落实架构文档第 13 章。每个任务必须独立可构建、可测试、可回滚；完成前不开始依赖任务。默认以单人或小团队顺序实施；标记“可并行”的任务只可在其依赖完成后并行。

每个任务收尾执行：

~~~text
npm run verify:tool-registry
npm run verify:pricing-rules
npx tsc --noEmit
npm run lint
node --import tsx --test <相关测试>
git diff --check
~~~

新增脚本后，应将对应 generate/verify 命令接入 package.json 与 CI。不要手工编辑 generated 文件；不要把 JSON 变成可执行插件；不要在没有对照测试时大批移动业务代码。

## 2. 依赖图与里程碑

~~~mermaid
flowchart LR
  P0["P0 基线与决策"] --> P1["P1 共享内核"]
  P1 --> P2["P2 Agent/Usage/Projects"]
  P1 --> P3["P3 Job Runtime"]
  P2 --> P4["P4 Insights/Search/Tracker"]
  P3 --> P5["P5 Reports/Distillation/Knowledge"]
  P2 --> P6["P6 Security/Skill 生命周期"]
  P4 --> P7["P7 新 UI 与路由"]
  P5 --> P7
  P6 --> P7
  P7 --> P8["P8 清理与发布门禁"]
~~~

| 里程碑 | 完成定义 |
|--------|----------|
| M-A | 新旧数据输出有可重复对照基线，模块边界开始被自动检查。 |
| M-B | Agent、用量、项目和快照用例已脱离路由，原有核心功能未回归。 |
| M-C | Schedule 与 JobRun 运行时可可靠执行、恢复和审计。 |
| M-D | 洞察、搜索、简报、蒸馏、知识和安全/Skill 流程均有受控业务边界。 |
| M-E | 最新原型的所有页面由薄路由和 Feature 模块实现，发布门禁通过。 |

## 3. P0 — 基线、产品契约与架构门禁

| ID | 工作项 | 交付物 | 依赖 | 验收 |
|----|--------|--------|------|------|
| P0-01 | 冻结当前功能输出 | 匿名化 fixture：UsageSnapshot、SkillSnapshot、SessionSummary、Security 结果、Market 列表；统一时间/随机 ID 正规化器。 | 无 | 相同 fixture 下可比较新旧 DTO，不忽略业务字段。 |
| P0-02 | 建立原型页面—模块映射 | 页面、用户动作、读模型、写操作、权限、JobType 的追踪矩阵。 | 无 | 覆盖首页、Agent、蒸馏、报告、安全、Tracker、市场、Skill、设置。 |
| P0-03 | 创建五份 ADR 骨架 | 模块边界、Job runtime、AI 数据治理、运行时防御、Linux 准入。 | 无 | 每份含决策、代价、复审条件；开放项未伪装为已定。 |
| P0-04 | 建立 architecture verify 报告 | scripts/verify-module-boundaries.mjs，初期仅报告 route 大小、深层 import、循环依赖。 | 无 | CI 可运行；白名单含理由、负责人、过期阶段。 |
| P0-05 | 定义脱敏与错误码基线 | 敏感字段清单、DTO 负向测试、稳定 error code 目录。 | P0-01 | 浏览器 API/搜索/日志测试均不出现绝对路径、命令、token、原始正文。 |

退出条件：M-A；此阶段不改产品行为。

## 4. P1 — 共享内核与模块脚手架

| ID | 工作项 | 主要位置 | 依赖 | 验收 |
|----|--------|----------|------|------|
| P1-01 | 建立 shared 内核 | src/shared/result.ts、ids.ts、events.ts。 | P0-05 | domain 层不 import React、Electron、Node。 |
| P1-02 | 抽取持久化 Port | src/platform/persistence：AtomicJsonStore、FileLock、Clock、migration、corrupt backup。 | P0-01 | 原子写入失败/损坏/锁冲突/重启恢复集成测试通过。 |
| P1-03 | 建立 observability | src/platform/observability：CorrelationContext、redaction、JSONL rotation、metric API。 | P1-01 | 日志字段完整且敏感字段测试为零。 |
| P1-04 | 建立 runtime identity | src/platform/runtime：desktop/web/test 身份，background tasks 默认开关。 | P1-02 | 开发 Web 不扫描用户目录；desktop/test 行为可注入。 |
| P1-05 | 创建 modules 脚手架和 public API | modules 下各 Feature 的 contracts、application、presentation、api.server、index。 | P1-01 | 边界检查可识别模块，私有深层 import 被拒绝。 |
| P1-06 | 建立 app 组合根 | src/app/providers.tsx、bootstrap.server.ts、module catalog 生成骨架。 | P1-04 | 全局 Provider 只在 app；浏览器 manifest 无敏感字段。 |

退出条件：所有新模块可空载编译；边界检查从报告变为阻断新违规。

## 5. P2 — Agent、用量、项目与读模型基础

| ID | 工作项 | 主要变更 | 依赖 | 验收 |
|----|--------|----------|------|------|
| P2-01 | AgentDirectory contract | 定义 AgentDefinition、AgentInstallation、AgentHealth、MigrationCandidate；tool-registry 只提供事实投影。 | P1-05 | 工具 JSON 不泄露给浏览器；32 工具卡可由安全 DTO 渲染。 |
| P2-02 | 迁移安装探测 | 现有 detection 改为 AgentInstallationRepository adapter。 | P2-01 | macOS/Windows 10/11 parity；Linux 仍 planned。 |
| P2-03 | 抽 UsageCollector 和 SnapshotRepository | 将 scanner/adapters 包在 modules/usage/infrastructure；先不移动逻辑。 | P1-02 | 用量 fixture 新旧输出对照一致；预算/取消测试通过。 |
| P2-04 | 建 Get/RefreshUsage UseCase | 缓存、扫描、health、提交和错误降级统一到 application。 | P2-03 | 手动刷新与旧 API DTO 一致；失败保留最后成功 snapshot。 |
| P2-05 | 建 Projects 读模型 | project identity、归并规则、项目 Token/费用/会话聚合。 | P2-04 | Dashboard/Tracker 可按项目读取；未知项目不丢失事件。 |
| P2-06 | 迁移 Session contract | 现有会话扫描、过滤、resume 请求只经 usage 公开 API。 | P2-04 | 恢复命令不进入浏览器 DTO；筛选与旧页面对照一致。 |
| P2-07 | Sources 改为健康投影 | 原 Sources 页不再触发扫描，读取 AgentHealth/SourceHealth。 | P2-02,P2-04 | 打开页面不增加读取次数；异常行/上次扫描可显示。 |

退出条件：Agent 生态、项目、用量、会话均可在不依赖 routes 的情况下被 UseCase 调用。

## 6. P3 — Schedule 与 Job Runtime（必须先于 AI 长流程）

| ID | 工作项 | 主要变更 | 依赖 | 验收 |
|----|--------|----------|------|------|
| P3-01 | JobType JSON 契约 | tasks/definitions/job-catalog.json、Zod schema、JSON Schema、generate-job-imports、verify-job-catalog。 | P1-02 | 唯一 ID、未知 executor、非法 timeout/queue/network/i18n key 均构建失败。 |
| P3-02 | Schedule 与 JobRun 存储 | preferences、run log、index、rotation、recovery migration。 | P3-01 | JSON 损坏回退、running->abandoned、重启恢复通过。 |
| P3-03 | 实现 scheduler 状态机 | fake Clock、nextRun、interval/daily/weekly、DST、single-flight、队列优先级、retry、cancel。 | P3-02 | 所有状态转换和 queue full 测试通过；最大同类并发为 1。 |
| P3-04 | Executor registry | 静态 Map，禁止动态 import；接入 usage.refresh、skills.refresh、sessions.refresh、retention.apply。 | P3-03,P2-04 | 手动/计划执行调用同一 UseCase，输出等价。 |
| P3-05 | SSR bootstrap 生命周期 | src/server.ts 调 ensureBackgroundRuntimeStarted；开发默认禁用。 | P3-03,P1-04 | 打包预热只启动一次；托盘隐藏后继续；退出无悬挂。 |
| P3-06 | Job API 与最小任务 UI | 立即执行、取消、历史、启停、频率；Settings 嵌入面板。 | P3-04 | 输入 validator 拒绝未知 Job/Schedule；不显示敏感日志。 |

退出条件：M-C；既有页面直接 interval/scan 可开始逐步删除。

## 7. P4 — 洞察、搜索与成本优化

| ID | 工作项 | 主要变更 | 依赖 | 验收 |
|----|--------|----------|------|------|
| P4-01 | Insights 读模型 | Insight、evidenceRef、freshness、severity；聚合 usage/security/job/knowledge 的安全 DTO。 | P2-04,P3-02 | Dashboard 只读 InsightSnapshot；每条洞察有证据链接。 |
| P4-02 | 迁移 Dashboard | 拆 loader、query、ViewModel、展示与导出；thin route。 | P4-01 | 首页路由 <=80 行；原 KPI/图表/筛选对照通过。 |
| P4-03 | Search 索引 | SearchDocument、模块事件投影、版本和 query API。 | P1-03,P2-02 | Agent/Skill/Session/Report/Knowledge/Finding 搜索不触发原始扫描。 |
| P4-04 | Optimization 引擎 | 规则化成本诊断、OptimizationFinding、Recommendation、证据。 | P2-04,P2-05 | Tracker 可解释排名；unknown price 不误报为精确金额。 |
| P4-05 | ChangeProposal 审批 | 生成 diff、影响、回滚；仅批准后派发写操作。 | P4-04,P3-03 | “一键优化”不会自动修改外部 Skill；审计记录完整。 |

退出条件：首页、Tracker、全局搜索均由读模型驱动，无页面级扫描循环。

## 8. P5 — 蒸馏、知识与简报

| ID | 工作项 | 主要变更 | 依赖 | 验收 |
|----|--------|----------|------|------|
| P5-01 | AI orchestration Port | 模型路由、prompt 版本、脱敏、预算、timeout、fallback、成本状态。 | P1-03,P2-04 | 离线/模型失败/超预算有明确降级；不写业务资产。 |
| P5-02 | Knowledge repository | KnowledgeAsset、version、provenance、content hash、draft/approved/published/archived。 | P1-02 | 版本和来源可追溯；语义去重只能给建议。 |
| P5-03 | Distillation workflow | 会话选择、DistillationRequest、Job executor、候选输出、waiting-approval。 | P3-04,P5-01,P5-02 | 选会话到候选资产 E2E；未批准不写入 Skill 目录。 |
| P5-04 | Security gate for assets | 候选 Skill/包进入 assessment，verdict 进入知识版本。 | P5-03 | 可疑/危险资产无法发布或分发。 |
| P5-05 | Reports domain | ReportDefinition、模板版本、ReportRun、日报/周报 JobType。 | P3-04,P4-01,P5-01 | 手动/计划生成等价；失败保留草稿/旧报告。 |
| P5-06 | Reports 与 Memory UI | 简报流、计划状态、立即生成、报告详情、资产引用。 | P5-05 | 页面由薄路由加载；所有状态来自 JobRun。 |

退出条件：M-D 的知识生产和报告链路可离线降级、可恢复、可审计。

## 9. P6 — 安全与 Skill 生命周期

| ID | 工作项 | 主要变更 | 依赖 | 验收 |
|----|--------|----------|------|------|
| P6-01 | SecurityAssessment domain | Assessment、Finding、判定、处置、历史；接入已有内建规则。 | P1-02 | 文件/目录选择、扫描、历史和规则版本 E2E。 |
| P6-02 | 安全扫描 UI 迁移 | 上传/选择仅产生明确用户动作，扫描为 Job；输出脱敏。 | P3-04,P6-01 | 11 维规则展示与原有规则一致；不上传源码。 |
| P6-03 | SecurityMonitor 契约 | Observation、Incident、事件 source Port、告警策略。 | P1-03 | 初期只能模拟/已授权事件；无 Hook 时 UI 标识“观察中”。 |
| P6-04 | SkillCatalog | 本地/市场/企业源元数据、package hash、安全 verdict、离线 cache。 | P2-02,P6-01 | 离线可读缓存；未过安全门禁不可成为可安装项。 |
| P6-05 | SkillDistribution | 安装计划、目标能力校验、staging、原子替换、backup、rollback。 | P6-04,P3-04 | 多 Agent 分发、冲突、失败回滚、批量卸载测试。 |
| P6-06 | 迁移/安装确认 UI | 目标 Agent、脱敏目标、diff、回滚、用户确认。 | P6-05 | 无确认不写外部工具目录；所有写操作审计。 |

退出条件：原型的安全、市场、Skill 管理、生态迁移可由受控模块实现。

## 10. P7 — 页面重组、国际化与体验收敛

| ID | 工作项 | 依赖 | 验收 |
|----|--------|------|------|
| P7-01 | 重建导航 module catalog | P2,P4,P5,P6 | 核心/防护/基础设施分组由安全 manifest 生成。 |
| P7-02 | 逐页 thin route 迁移 | P2,P4,P5,P6 | 首页、Agents、Distill、Reports、Security、Tracker、Market、Skills、Settings 均 <=80 行。 |
| P7-03 | 统一状态组件 | P3,P4 | fresh/stale/running/waiting-approval/failed/empty 的文案和无障碍一致。 |
| P7-04 | 四语言补齐 | P7-01 | 新 Job、审批、AI 降级、安全状态均有 zh/en/ja/ko key；locale 检查通过。 |
| P7-05 | 删除页面扫描轮询 | P3,P7-02 | 仅 Job 状态低频兜底；不存在页面直接 scanner 调用。 |

退出条件：M-E；最新原型的所有页面是模块 UI，不是新增巨型路由。

## 11. P8 — 清理、跨平台与发布

| ID | 工作项 | 依赖 | 验收 |
|----|--------|------|------|
| P8-01 | 删除旧 facade/双事实源 | P7 | local-* 旧导出仅在无消费者后删除；无永久 feature flag。 |
| P8-02 | 门禁转强制 | P7 | verify-module-boundaries、job catalog、敏感 manifest、循环依赖均阻断 CI。 |
| P8-03 | 跨平台 smoke | P3,P6 | macOS x64/arm64、Windows x64：启动、扫描、Job、安装确认；Linux：schema/XDG/planned。 |
| P8-04 | 性能与恢复演练 | P3,P5 | 大日志、队列、断电写入、重启恢复、模型超时、离线市场符合预算。 |
| P8-05 | 开源卫生检查 | P8-01 | 无本机路径/构建物/Token/私有配置/未声明第三方代码；README/贡献指南/ADR 完整。 |

## 12. 关键验收场景

1. 用户打开首页：只读 InsightSnapshot，不会触发全盘日志扫描。
2. 用户点击“立即生成日报”：创建 reports.generate JobRun；窗口隐藏后继续；失败可见且可重试。
3. 到期日报计划：Scheduler 创建同一 JobType 的运行记录；相同输入运行中时不重复生成。
4. 用户在蒸馏工作台选择两个会话：候选资产经脱敏和安全评估后停在 waiting-approval；未批准不分发。
5. 用户点击“优化”：只出现 ChangeProposal；确认前任何本地 Agent Skill 目录均不变。
6. 用户扫描 Skill 文件夹：只在明确选择后读取；结果保留 Finding/规则版本，不上传内容。
7. 用户向多个 Agent 分发 Skill：每个目标独立记录、冲突可回滚；未安装/不支持目标不可选择。
8. 模型、网络或动态费率不可用：报告/蒸馏可解释失败或使用离线规则，UI 不把估算称为精确。
9. Windows 10、Windows 11 与 macOS 使用同一 Job 语义；Linux 未验证能力不会自动执行。
10. 应用异常退出：未完成 Job 标记 abandoned，满足恢复策略的 Job 新建 run 重试，快照不损坏。

## 13. 任务完成模板

每项任务的 PR/提交说明必须包含：

- 任务 ID、影响模块、依赖已满足的证据；
- 事实源是否变化，以及缓存/schema migration；
- API/DTO 的新增或破坏性变更；
- 手动、计划、恢复三种执行路径的影响；
- 安全/隐私/跨平台影响；
- 已运行的命令、测试结果和未覆盖风险；
- 回滚方式与需要删除的迁移兼容层。

## 附录：计划自检

- 所有原型页面均映射到明确的业务模块，而非复用一个万能 Dashboard。
- Job runtime 在 AI 长流程之前实施，避免用页面 timer 或一次性 Server Function 承担恢复/审批。
- 安全写入、Skill 分发和优化均具有用户确认与回滚。
- 远程、Linux、运行时阻断等未验证能力均标注为预留，不被纳入首期完成定义。
+

## 14. P0-02 原型页面—模块追踪矩阵

| 页面/入口 | 读取的权威读模型 | 用户写操作 | 所属模块 | JobType/审批 | 安全边界 |
|-----------|------------------|------------|----------|--------------|----------|
| 首页总览 | InsightSnapshot、TaskSummary | 手动刷新、跳转 | insights、dashboard | 已有 Job 关联；不直接扫描 | 仅安全 DTO。 |
| 工具概览 | AgentDirectorySnapshot、Usage/Session 摘要 | 选择工具、请求迁移 | agent-directory、usage | agent migration 提案 | 不显示原始路径/命令。 |
| 蒸馏工作台 | Session 列表、DistillationRequest | 选择会话、开始蒸馏、批准产物 | distillation、knowledge | distillation.run；必须 waiting-approval | 上下文最小化/脱敏；未批准不分发。 |
| 简报与记忆 | ReportDefinition、ReportRun、KnowledgeAsset | 创建/启停 Schedule、立即生成 | reports、knowledge、tasks | reports.generate；计划触发 | 模型/网络同意、成本状态可见。 |
| 安全与防御 | Assessment、Finding、Incident | 选择目标、扫描、处置 | security-assessment、security-monitor | assessment.scan；处置确认 | 本地读取、无 Hook 时仅观察/告警。 |
| Skill 燃烧榜 | OptimizationFinding、Usage/Project 聚合 | 创建 ChangeProposal、批准优化 | optimization | change.apply；必须批准 | 不自动改写外部 Skill。 |
| Agent 生态/迁移 | AgentInstallation、AgentHealth、MigrationCandidate | 重新扫描、创建迁移计划 | agent-directory、skill-distribution | agent migration；外部写入前确认 | 目标能力和路径白名单。 |
| Skill 市场 | CatalogEntry、SecurityVerdict、Installation | 请求安装 | skill-catalog、skill-distribution | skill.install；确认 | 离线缓存优先，未通过安全门禁不可安装。 |
| Skill 管理 | InstalledSkill、Installation、Assessment | 扫描、同步、卸载、导出 | skill-catalog、skill-distribution | sync/uninstall；写入前确认 | staging、backup、rollback。 |
| 设置 | Settings、Schedule、NetworkConsent | 保存偏好、清理数据 | settings、tasks | maintenance/retention | schema 校验、清理仅限应用数据根。 |
| 全局搜索 | SearchIndex | 无 | search | 无 | 只索引脱敏 SearchDocument。 |

P0-02 验收：后续新增页面、按钮、Server Function 或 JobType 时，必须先更新本矩阵并指定唯一模块与事实源；任何“无所属模块”的交互不得进入编码阶段。

