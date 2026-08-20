# TrustTools 产品需求文档

| 属性   | 值                   |
| ---- | ------------------- |
| 文档类型 | 产品需求文档 (PRD)        |
| 项目名称 | TrustTools          |
| 版本   | v4.5                |
| 创建日期 | 2026-08-14 15:11:45 |
| 更新日期 | 2026-08-17          |
| 生成工具 | product-manager     |
| 代码基线 | main-4              |
| 文档状态 | 草稿                  |

## 修订记录

| 版本   | 修改时间                | 修改内容                                                                                                                                                                                 |
| ---- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1.0 | 2026-08-13          | 初始版本                                                                                                                                                                                 |
| v2.0 | 2026-08-14          | 基于 main-3 实现状态整体更新，新增记忆库与三主线小组件需求                                                                                                                                                    |
| v3.0 | 2026-08-14 15:11:45 | 基于 V3.0 原型代码（"AI 工具主权控制台"）整体校准：菜单三组重排、简报/月报三周期、燃烧榜三维、蒸馏增强（模型/配额/A-B 对比/历史）、工具覆盖 5-6 核心深度、设置六分类                                                                                       |
| v3.1 | 2026-08-14          | 新增 §9 数据来源与计算口径：逐指标标注来源文件/函数、计算公式与 mock/真实边界，供研发按本地代码还原                                                                                                                              |
| v4.0 | 2026-08-17          | 基于 main-4 整体校准：①术语系统性切换（工具→Agent、简报→日报、Skill 市场→安全市场）；②导航三组重构（工作台/洞察与安全/技能库），`/market` 独立成路由；③Agent 目录扩至 32 项；④修正 MoSCoW 分布统计、NFR 补优先级、可追踪性补全；⑤新增依赖与假设、成功指标两节；⑥FR 按导航顺序重编号并新增数据来源页需求 |
| v4.1 | 2026-08-17          | 落地落差清单：市场按 `scanSkill` 过滤（仅收录安全 Skill）、市场安装状态持久化至 localStorage、补齐日语缺 key（core/hero/watch 16 项 + Agent 术语对齐）、`/sources` 挂载进导航 |
| v4.2 | 2026-08-17          | 拍板两项待确认：产品正式名定为 **TrustTools app**（贾维斯为代号）；安全市场计入 TrustTools、仅展示通过 11 维扫描的 Skill |
| v4.3 | 2026-08-17          | 补全完整性缺陷：①拷贝《需求简报》《桌面小组件信息架构》到 main-4 docs/（原 §1、FR-041 引用悬空）；②NFR-001 视觉一致性补可测量验收项；③§9 成功指标补「关联需求」映射列 |
| v4.4 | 2026-08-17          | 反向回写「已修复」口径：FR-047 验收标准、§2.13 标题与 FR-046 挂载说明、§6 P1 状态、§11.9 市场条目/一键安装两行，消除与 §10/§11.15 的自相矛盾 |
| v4.5 | 2026-08-17          | 新增 §11.17 蒸馏提示词规格：补 workflow / prompt / 画像 / 任务记忆 4 份蒸馏提示词（FR-013/014 实现用）；「角色」暂不实现 |

---

## 1. 概述

本 PRD 定义 TrustTools 的功能与非功能需求，**以当前 main-4 原型代码为唯一事实来源**。定位、目标用户、竞品对标见《需求简报》与《会议纪要 2026-08-04》；三条价值主线（安全 / 高效 / 蒸馏）贯穿全部需求，可追踪性见 §5。

**品牌**：**TrustTools app** ·「AI Agent 主权控制台」（代号贾维斯 Jarvis）。
**一句话定位**：① 先保护你安全 ② 再懂你 ③ 最后给建议。
**核心资产观**：私有上下文 = 最有价值的资产（个人的"煮面秘方"）。
**客群与视角**：to C 爆款、追装机量（目标 10 万级）；以 Agent 为第一视角，AI 原生产品（会说话、会总结、懂你）。

---

## 2. 功能需求（FR）

> 需求按 main-4 导航三组（工作台 / 洞察与安全 / 技能库）+ 设置 + 数据来源 + 国际化组织，FR 编号依此顺序递增。

### 2.1 首页总览 `/`（工作台）

| ID     | 需求           | 优先级    | 验收标准                                                                                               |
| ------ | ------------ | ------ | -------------------------------------------------------------------------------------------------- |
| FR-001 | AI 流式总结      | MUST   | 首屏以打字机效果逐字输出一段「今天你…」总结（`JarvisInsight`）；随选中 Agent 与时间范围变化                                          |
| FR-002 | Agent 筛选     | MUST   | 提供 Agent 切换器（chip），选中某 Agent 后全页数据只显示该 Agent；支持「全部」视图                                              |
| FR-003 | 指标网格         | MUST   | 展示 8 个核心指标卡（Token 消耗 / 费用估算 / 会话总数 / 缓存命中率 / Agent 活跃 / 安全扫描 / 蒸馏产出 / 日报生成），消费类指标带环比涨跌 `DeltaChip` |
| FR-004 | 时间范围缩放       | MUST   | 全页吸顶时间范围（今天 / 7 天 / 30 天 / 全部 + 自定义），切换后 Token/会话/成本按倍率缩放且占比不变                                     |
| FR-005 | 趋势与下钻        | SHOULD | 提供 Token 趋势、模型占比、项目消耗、贡献热力图；均随时间范围缩放                                                               |
| FR-006 | 选中 Agent 工作流 | SHOULD | 选中具体 Agent 后展示该 Agent 的工作流视窗（`AgentWorkstreams`），可一键跳转蒸馏                                           |

### 2.2 Agent 概览 `/agents`（工作台）

| ID     | 需求    | 优先级  | 验收标准                                                        |
| ------ | ----- | ---- | ----------------------------------------------------------- |
| FR-007 | 工牌墙   | MUST | 展示所有已接入 Agent 的「工牌」列表，支持点选切换焦点 Agent                        |
| FR-008 | 消耗趋势  | MUST | 展示选中 Agent 近 24h 迷你趋势与多日趋势（`AgentTrendPanel`）               |
| FR-009 | 上下文构成 | MUST | 展示选中 Agent 上下文来源树（`ContextTree`），区分项目 / 会话 / 规则文件           |
| FR-010 | 模型消耗  | MUST | 展示选中 Agent 下各模型的 Token / 成本 / 调用 / 缓存命中明细（`ToolModelPanel`） |

### 2.3 蒸馏工作台 `/distill`（工作台 · Hero）

| ID     | 需求        | 优先级    | 验收标准                                                                                                |
| ------ | --------- | ------ | --------------------------------------------------------------------------------------------------- |
| FR-011 | 原材料选择     | MUST   | 支持「会话/项目」与「Agent 提示词/配置」两类原材料；切换后提示语与可选素材随之变化                                                       |
| FR-012 | 产物类型选择    | MUST   | 支持 6 种产物：Skill / 工作流 / Prompt / 角色 / 画像 / 任务记忆；能力资产与记忆资产分群展示（「角色」为记忆资产、文档目标第 6 种，与记忆库联动后续补充，见 §11.15）        |
| FR-013 | 能力资产生成    | MUST   | Skill/工作流/Prompt 走文件树 + 导出/安装流程；形态越轻文件越少（Prompt 1 文件、工作流 2 文件、Skill 完整包含 scripts/references/assets） |
| FR-014 | 记忆资产生成与落库 | MUST   | 画像/任务记忆产出「标题+正文」记忆卡片；自动写入记忆库，来源标记「蒸馏」                                                               |
| FR-015 | 附加指令      | SHOULD | 支持为生成过程补充自由文本指令，注入产物正文                                                                              |
| FR-016 | 模型与配额     | SHOULD | 蒸馏可选模型（官方/自定义 profile），显示剩余配额，配额耗尽时提示切换模型                                                           |
| FR-017 | A/B 实验对比  | COULD  | 支持同素材不同模型/指令的多次实验，并排对比产物                                                                            |
| FR-018 | 历史与保存引导   | SHOULD | 记录蒸馏历史（产物类型 / 模型 / 时间），生成后给出导出/安装引导                                                                 |

### 2.4 日报 / 周报 / 月报 `/reports`（工作台）

| ID     | 需求      | 优先级    | 验收标准                                                                  |
| ------ | ------- | ------ | --------------------------------------------------------------------- |
| FR-019 | 三周期切换   | MUST   | 支持「日报（日）/ 周报（周）/ 月报（月）」三周期，默认当前周期，可前后翻页与日历跳选                          |
| FR-020 | AI 草稿生成 | MUST   | 依据当前周期会话自动生成 Markdown 报告（摘要 / Agent 详情 / 蒸馏产出 / 安全概况 / 建议）；无会话数据时给出空态 |
| FR-021 | 编辑与预览   | MUST   | 支持 Markdown 编辑 / 预览双模式，重新生成需二次确认覆盖已编辑内容                               |
| FR-022 | 保存与导出   | MUST   | 保存到本地归档（30 秒自动保存草稿）；支持导出 PDF、导出 Markdown、复制原文                         |
| FR-023 | 批注与历史归档 | SHOULD | 支持快捷批注；历史时间线按周期归档，已保存周期带标记点                                           |

### 2.5 记忆库 `/memory`（工作台）

| ID     | 需求     | 优先级  | 验收标准                                          |
| ------ | ------ | ---- | --------------------------------------------- |
| FR-024 | 列表与筛选  | MUST | 按来源分组展示；按类型（画像 / 任务记忆 / 全部）筛选；支持关键词搜索标题/正文/来源 |
| FR-025 | 手动增删改  | MUST | 可录入一条记忆（选类型、填标题/正文、标来源/项目）；本地增删改，刷新后保留        |
| FR-026 | 蒸馏自动写入 | MUST | 蒸馏产出画像/任务记忆后自动出现在记忆库，来源标记「蒸馏」                 |

### 2.6 安全检测 `/security`（洞察与安全）

| ID     | 需求           | 优先级    | 验收标准                                                                                  |
| ------ | ------------ | ------ | ------------------------------------------------------------------------------------- |
| FR-027 | 全局静态扫描       | MUST   | 按 11 个安全维度扫描本地 Skill；展示已扫/安全/可疑/高风险四类计数与最近扫描时间                                        |
| FR-028 | 不安全 Skill 名单 | MUST   | 列出待处置的不安全 Skill 及命中维度标签，支持查看单 Skill 报告                                                |
| FR-029 | 扫描过程与历史      | MUST   | 扫描过程动画（`ScanVortex`）、进度与状态（`ScanStatus`）；保留扫描历史（`ScanHistory`）与任务详情（`ScanTaskDetail`） |
| FR-030 | 运行时提醒      | SHOULD | 扫描完成后展示运行时提醒面板（`RuntimeBlockPanel`），呈现浪费告警与安全提醒；仅提醒、不做拦截（无系统拦截权限）；当前为 mock 占位，无真实会话执行前检查               |
| FR-031 | 定时扫描配置       | MUST   | 设置中可配置定时扫描开关、周期（每小时/每天/每周/自定义 cron）、范围（全部/指定 Agent/指定目录）与告警通知                         |

### 2.7 燃烧榜 `/tracker`（洞察与安全）

| ID     | 需求   | 优先级  | 验收标准                                      |
| ------ | ---- | ---- | ----------------------------------------- |
| FR-032 | 三维榜单 | MUST | 支持「项目消耗榜 / 会话消耗榜 / Skill 消耗榜」三维切换，按浪费程度排序 |
| FR-033 | 浪费诊断 | MUST | 每条上榜项展示消耗 Token、调用次数、浪费占比与可读的浪费原因         |

### 2.8 Skill Hub `/skills`（技能库）

| ID     | 需求          | 优先级  | 验收标准                              |
| ------ | ----------- | ---- | --------------------------------- |
| FR-034 | 本地 Skill 管理 | MUST | 统一管理本地 Skill：启用/编辑/导出/删除，展示安全扫描状态 |

### 2.9 安全市场 `/market`（技能库 · 独立路由）

| ID     | 需求   | 优先级    | 验收标准                                                                                                           |
| ------ | ---- | ------ | -------------------------------------------------------------------------------------------------------------- |
| FR-035 | 市场检索 | SHOULD | 市场内按分类、评分与热度检索 Skill，**仅收录通过 11 项安全维度扫描的 Skill**                                                               |
| FR-036 | 一键安装 | SHOULD | 选中 Skill 可一键安装到指定 Agent / 全部 Agent（`AgentInstallBar`/`AgentInstallRow`）；支持卸载与 `trusttools install` 命令提示；全程本地执行 |

### 2.10 会话管理 `/chats`（工作台）

| ID     | 需求   | 优先级  | 验收标准                            |
| ------ | ---- | ---- | ------------------------------- |
| FR-037 | 会话列表 | MUST | 按来源/时间列出各 Agent 会话，支持搜索与筛选      |
| FR-038 | 会话详情 | MUST | 查看单条会话的消息流、Token 消耗与元信息，作为蒸馏原材料 |

### 2.11 菜单栏小组件 `/widget`（技能库）

| ID     | 需求    | 优先级  | 验收标准                                                                                                |
| ------ | ----- | ---- | --------------------------------------------------------------------------------------------------- |
| FR-039 | 五载体预览 | MUST | 预览菜单栏（`MenuBarIcon`）/ 浮窗三 Tab（`JarvisWidget`）/ 托盘（`TrayWidget`）/ 桌面小·中·大三档（`DesktopWidgets`），实时反映配置 |
| FR-040 | 内容可配置 | MUST | 小/中号内容、默认 Tab、语气、轮播间隔在设置中可配置并持久化                                                                    |
| FR-041 | 三主线覆盖 | MUST | 安全 / 高效 / 蒸馏三条主线信号在五载体上按信息分层原则覆盖（详见《桌面小组件信息架构》）                                                     |

### 2.12 设置 `/settings`（底部常驻）

| ID     | 需求   | 优先级    | 验收标准                                         |
| ------ | ---- | ------ | -------------------------------------------- |
| FR-042 | 通用配置 | MUST   | 语言、数据目录、开机启动、菜单栏图标、Skill 默认导出目录、清除本地数据（二次确认） |
| FR-043 | 模型配置 | SHOULD | 多模型 profile 增删改、API Key 脱敏展示、测试连接、设为生效       |
| FR-044 | 外观   | SHOULD | 主题、强调色、字体大小可配置并即时生效                          |
| FR-045 | 关于   | COULD  | 版本号、开源协议、源码仓库、问题反馈入口                         |

### 2.13 数据来源 `/sources`（底部常驻）

| ID     | 需求          | 优先级    | 验收标准                                                                             |
| ------ | ----------- | ------ | -------------------------------------------------------------------------------- |
| FR-046 | 本地 Agent 探测 | SHOULD | 检测本地已安装的 32 个 AI Agent，展示采集目录、事件数与异常行、官方下载地址；按状态（有数据 / 已发现 / 未发现客户端）筛选；挂载于侧边栏底部（与设置同级），未进一级分组 |

### 2.14 国际化

| ID     | 需求    | 优先级    | 验收标准                                       |
| ------ | ----- | ------ | ------------------------------------------ |
| FR-047 | 中英日三语 | SHOULD | 中英日三语词典完整；运行时缺 key 回退中文不暴露原文；日语缺 key 已补齐（core/hero/watch 共 16 项 + Agent 术语对齐） |

---

## 3. 非功能需求（NFR）

| ID      | 需求       | 类别   | 优先级    | 验收标准                                                                                                                              |
| ------- | -------- | ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| NFR-001 | 视觉一致性    | 可用性  | SHOULD | 全站统一设计 token（tt-num / tt-subpanel / tt-tag / 圆角变量）；状态用中性标记表达（亮度 + 呼吸，不高饱和告警色）；Apple 设计语言。**可测量验收：① 设计 token 复用率 100%——除 token 定义文件外，组件层不出现硬编码色值/圆角（grep 抽查 0 处裸 hex）；② 状态态仅用亮度+呼吸动画区分在线/离线，不引入红/黄高饱和告警色；③ 字号/间距统一走 tt-* 体系，不出现散落字号** |
| NFR-002 | 数据本地化与隐私 | 安全性  | MUST   | 所有数据写入本地（localStorage / 本地目录），不上传云端；API Key 脱敏展示；清除数据需二次确认；隐私条（`PrivacyStrip`）全程可见                                                |
| NFR-003 | 性能       | 性能   | MUST   | 首页首屏与组件交互在 2 秒内可感知；数据为确定性 mock，渲染稳定无抖动                                                                                            |
| NFR-004 | 可维护性     | 可维护性 | SHOULD | 聚合逻辑下沉 lib，页面只消费结果；组件超 200 行拆分；错误统一 toast + 日志                                                                                    |
| NFR-005 | Agent 覆盖 | 可扩展性 | MUST   | 数据源配置化（`sources.ts` catalog），新增 Agent 仅需补目录与下载地址；当前目录 32 项（13 有数据 / 7 已发现 / 12 未发现），目标 ≥38 补齐国内主流（豆包/通义/Cherry Studio/LobeChat 等） |
| NFR-006 | 数据可靠性 | 可靠性 | SHOULD | 本地核心资产（记忆库 / 蒸馏产物 / 日报草稿）支持 JSON 导出备份；localStorage 超限（记忆 ≤400、蒸馏历史 ≤60）时降级不丢数据；异常 / 崩溃后可恢复上次已保存状态 |

---

## 4. 史诗与用户故事

### Epic 1：首页与 Agent 视角（安全 / 高效 / 蒸馏 首屏可见）

**Business Value**：首屏决定「性不性感」，是冷启动的第一印象。
**User Segments**：全部用户。
**覆盖 FR**：FR-001 ~ FR-010。

- 作为一个 AI 重度用户，我想要首屏一句话告诉我今天发生了什么，以便快速建立认知。
- 作为一个多 Agent 用户，我想要点某个 Agent 只看它的数据，以便定位问题。
- 作为一个成本敏感用户，我想要一眼看到谁在浪费 Token，以便止血。

### Epic 2：安全（先保护你安全）

**Business Value**：安全是信任底座，是「第一主线」。
**User Segments**：全部用户。
**覆盖 FR**：FR-027 ~ FR-031。

- 作为一个怕被注入的用户，我想要自动扫描本地 Skill，以便在用它之前知道安不安全。
- 作为一个谨慎的用户，我想要看到风险 Skill 及理由，以便决定是否隔离。

### Epic 3：蒸馏工作台与会话（把过程沉淀为资产）

**Business Value**：私有上下文 = 最有价值的资产，是留存关键。
**User Segments**：AI 重度开发者。
**覆盖 FR**：FR-011 ~ FR-018、FR-037 ~ FR-038。

- 作为一个沉淀用户，我想要把好对话蒸馏成 Skill/工作流/Prompt/角色，以便复用。
- 作为一个沉淀用户，我想要把「我是谁 / 我的规矩」蒸馏成画像/任务记忆，以便跨 Agent 复用。
- 作为一个沉淀用户，我想要浏览本地各 Agent 的会话，以便挑选优质原材料去蒸馏。

### Epic 4：记忆库（记忆资产管理）

**Business Value**：记忆是「懂你」的数据基础。
**User Segments**：AI 重度开发者。
**覆盖 FR**：FR-024 ~ FR-026。

- 作为一个多 Agent 用户，我想要集中查看所有画像/任务记忆，以便统一管理。
- 作为一个记录用户，我想要手动补一条记忆，以便覆盖蒸馏没覆盖到的约定。

### Epic 5：日报周报与燃烧榜（高效诊断）

**Business Value**：把「成果」和「浪费」讲清楚，是高效主线的落点。
**User Segments**：全部用户。
**覆盖 FR**：FR-019 ~ FR-023、FR-032 ~ FR-033。

- 作为一个复盘用户，我想要一键生成日报/周报/月报，以便直接发出去。
- 作为一个成本敏感用户，我想要按项目/会话/Skill 看谁在浪费，以便优化。

### Epic 6：桌面小组件（会说话的贾维斯常驻）

**Business Value**：装逼属性 = 视觉冲击，是差异化与传播点。
**User Segments**：AI 尝鲜者 / 极客为主。
**覆盖 FR**：FR-039 ~ FR-041。

- 作为一个极客，我想要菜单栏灵动岛滚动播报，以便时刻有「贾维斯在」的陪伴感。
- 作为一个重度用户，我想要桌面三档组件显示关键信号，以便不打开主程序也知道状态。

### Epic 7：Skill 生态与平台（装机量放大器）

**Business Value**：安全市场 + 设置 + 数据来源 + 多语言决定装机量上限。
**User Segments**：全部用户（含海外）。
**覆盖 FR**：FR-034 ~ FR-036、FR-042 ~ FR-047。

- 作为一个装机用户，我想要在安全市场按评分/热度安装 Skill，以便一键扩展到我的 Agent。
- 作为一个国内用户，我想要支持豆包/通义等 Agent，以便统计我的真实使用。
- 作为一个海外用户，我想要英语界面，以便无障碍使用。
- 作为一个高阶用户，我想要配置模型 profile 与扫描周期，以便按我的方式工作。

---

## 5. 可追踪性矩阵

| FR              | 主线           | 史诗     |
| --------------- | ------------ | ------ |
| FR-001 ~ FR-010 | 高效 / 安全 / 蒸馏 | Epic 1 |
| FR-011 ~ FR-018 | 蒸馏           | Epic 3 |
| FR-019 ~ FR-023 | 高效           | Epic 5 |
| FR-024 ~ FR-026 | 蒸馏           | Epic 4 |
| FR-027 ~ FR-031 | 安全           | Epic 2 |
| FR-032 ~ FR-033 | 高效           | Epic 5 |
| FR-034          | 高效           | Epic 7 |
| FR-035 ~ FR-036 | 高效 / 安全      | Epic 7 |
| FR-037 ~ FR-038 | 蒸馏           | Epic 3 |
| FR-039 ~ FR-041 | 三主线          | Epic 6 |
| FR-042 ~ FR-045 | 三主线          | Epic 7 |
| FR-046          | 高效           | Epic 7 |
| FR-047          | 三主线          | Epic 7 |

---

## 6. 优先级

| 阶段      | 内容                                                         | 状态                   |
| ------- | ---------------------------------------------------------- | -------------------- |
| P0（本周）  | 首页重构 + Agent 概览 + 安全扫描 + 蒸馏（5 产物已实现，角色后置）+ 记忆库            | ✅ 已实现（角色除外）          |
| P1（第二周） | 日报周报月报 + 燃烧榜三维 + 五载体小组件 + 国际化 + 32 Agent 覆盖                | ⚠️ 大部分已实现（日语缺 key 已补齐） |
| P2      | 一键迁移 + MCP 管理 + macOS 原生客户端（Swift/WidgetKit）+ Agent 扩到 38+ | ❌ 未动                 |

MoSCoW 分布：MUST 32 项（核心闭环），SHOULD 13 项，COULD 2 项，共 47 项 FR。WON'T（本文档范围外）见 §7。

---

## 7. 范围外（WON'T）

1. 桌面组件内的管理动作（编辑记忆 / 增删 Skill / 改限额）——组件只读，一律跳转对应页面。
2. Windows 原生客户端首版不做，后续简单适配。
3. macOS 原生客户端（Swift / AppKit / WidgetKit / NSStatusItem 常驻）不在本 Web 原型范围，本文档只约束 Web 侧信息架构与设计稿。
4. 记忆「注入回会话」的完整机制本次只做存储与管理。
5. 一键迁移（远期主打粘性功能，Claude Code ↔ Codex 等）与 MCP 管理独立路由，当前仅占位、首版不做（MCP 安全扫描仍归安全主线）。
6. 市场 Skill 的「真实远端拉取 / 支付 / 企业私有源」不在首版范围，当前为本地 mock 目录 + 本地执行安装。

---

## 8. 依赖与假设

**假设**

- 目标用户以 macOS 为主（首版先做 macOS，Windows 后置）。
- 原型阶段数据为确定性 mock，不接真实采集；真实数据口径见独立文档《数据采集规范》。
- 用户本地已安装一个或多个 AI Agent（Claude Code / Codex / Cursor 等），具备可解析的会话留存。

**依赖**

- FR-026（蒸馏自动写入记忆库）依赖 FR-014（记忆资产生成与落库）。
- FR-036（市场一键安装）依赖 Skill 包格式规范与目标 Agent 的 SKILL.md 目录约定（`skill-files.ts`）。
- FR-046（数据来源）依赖 `sources.ts` catalog 覆盖度，新增 Agent 需同步补目录与下载地址。
- 真实数据采集依赖《数据采集规范》落地；macOS 原生客户端依赖 Swift/WidgetKit（P2）。

---

## 9. 成功指标（KPI）

> 基线待定（文档为草稿），方向对齐《会议纪要》装机量优先目标。

| 维度  | 指标                     | 目标方向             | 关联需求                                    |
| --- | ---------------------- | ---------------- | --------------------------------------- |
| 装机  | 装机量统计 / 下载 → 激活转化率             | 装机量 10 万级        | FR-035~036（安全市场）、FR-046（数据来源）、NFR-005（Agent 覆盖 ≥38） |
| 品牌 | GitHub Star 数 | ≥ 10 万 | FR-045（关于 · 源码仓库） |
| 引流 | TrustTools 引流（站外 → 装机转化） | 提升 | FR-035~036（安全市场）、FR-039~041（小组件传播） |
| 留存  | 次周留存率                  | 待定基线             | FR-001~006（首页）、FR-039~041（小组件常驻入口）          |
| 蒸馏  | 周活跃蒸馏用户占比 / 人均蒸馏产物数    | 提升               | FR-011~018（蒸馏）、FR-024~026（记忆）、FR-037~038（会话）  |
| 安全  | 安全扫描覆盖率 / 拦截可疑 Skill 数 | 覆盖 100% 本地 Skill | FR-027~031（安全）、FR-034（Skill Hub）            |
| 高效  | 用户通过燃烧榜识别并优化的浪费占比      | 提升               | FR-032~033（燃烧榜）                           |

---

## 10. 待确认

1. ~~产品正式名称~~（已定：**TrustTools app**；「贾维斯 Jarvis」为代号）。
2. ~~日语词典缺 key~~（已补齐：`core.*`/`hero.*`/`watch.all` 共 16 项缺失 key，`nav.agents`/`nav.overview` 已对齐 Agent 术语）。
3. ~~菜单栏小组件（`/widget`）当前为 Web 设计稿预览，是否复用为 macOS 原生客户端 WKWebView 内嵌内容~~（已定：组件能做出来即可，不纠结 WKWebView 复用方案）。
4. ~~`/sources`（数据来源）入口~~（已挂载到侧边栏底部，与「设置」同级）。
5. ~~安全市场边界~~（已定：安全市场计入 TrustTools，仅展示通过 11 维扫描的 Skill；`/skills` 为本地 Skill 全量列表，含未扫描项）。

---

## 11. 数据来源与计算口径（研发参考）

> **⚠️ 本节描述的是「原型 mock 口径」。真实产品从用户本地文件采集数据的口径，见独立文档 `docs/requirement/trusttools-数据采集规范.md`（来源 → 获取方式 → 数据类型，含今日洞察维度）。** 研发落地真实数据层以那份为准，本节仅用于前端先用 mock 联调。
> 
> 本节是**研发还原口径**：逐指标标注「来源文件:函数 → 计算公式 → mock/真实」。原型为**确定性 mock、无后端**——同一 seed 每次渲染结果恒定，可在本地复现。真实部分仅有：localStorage 持久化、`Date.now()` 时间戳、聚合（sum/count/distinct）、以及模型「测试连接」的远端 `fetch /models`。
> 
> 研发接入真实数据时，只需把 `rnd(seed,max)` 替换为真实采集值，**聚合 / 缩放 / 占比逻辑不变**。

### 11.0 数据架构总览

**11.0.1 确定性伪随机（两套哈希，勿混用）**

| 哈希              | 定义                                     | 使用文件                                                                          |
| --------------- | -------------------------------------- | ----------------------------------------------------------------------------- |
| `hashS`（多项式）    | `h=(h*31+charCode)>>>0`                | agent-view / sources / dash-analytics / quota / security-history / skill-scan |
| FNV-1a          | `h^=charCode; h=Math.imul(h,16777619)` | mock-data（skills/market）/ chats（chatMeta）                                     |
| waste-model `h` | `x=(x*31+charCode)%100003`，初值 7        | waste-model                                                                   |

统一 `rnd(seed,max)=hash(seed)%max`。

**11.0.2 时间缩放机制（首页 / Agent 概览全页吸顶）**

| 预设   | factor                   |
| ---- | ------------------------ |
| 今天   | 0.05                     |
| 7 天  | 0.28                     |
| 30 天 | 1                        |
| 全部   | 2.4                      |
| 自定义  | `round(days/30*100)/100` |

`scaleAgentsBy(agents, f)` 只缩放累计量：`tokens=round(tokens*f)`、`cost=round(cost*f*100)/100`、`sessions=max(live?1:0, round(sessions*f))`；**skills / scanned / verdict 不缩放**（存量属性）。占比因同乘 f 保持不变。

**11.0.3 金额口径（三套单价，勿混用）**

| 场景                        | 单价                             | 来源                                    |
| ------------------------- | ------------------------------ | ------------------------------------- |
| Agent 费用估算（首页 / Agent 概览） | `$2.4 / 1M token`              | `cost=round(tokens/1e6*2.4*100)/100`  |
| 燃烧榜浪费成本                   | `$3 / 1M token`                | `wastedCost=wastedTokens/1e6*3`       |
| 配额 / 日报费用                 | `¥0.0215 / K token`（=¥21.5/1M） | `cost=round(dayTotal*0.0215*100)/100` |

**11.0.4 数值格式化**

| 函数         | 规则                                         |
| ---------- | ------------------------------------------ |
| `fmtToken` | ≥1e9→`x.xxB`；≥1e6→`x.xxM`；≥1e3→`x.xK`；否则整数 |
| `fmtCost`  | ≥1000→`¥x.xK`；否则 `¥x.xx`                   |

**11.0.5 本地持久化键清单**

| 键                                             | 内容                  | 上限  |
| --------------------------------------------- | ------------------- | --- |
| `tt.memory.items`                             | 记忆库条目               | 400 |
| `tt.distill.history`                          | 蒸馏历史                | 60  |
| `tt.distill.jobs`                             | 蒸馏任务队列（进度）          | —   |
| `tt.report.{period}.md`                       | 日报 / 周报 / 月报草稿      | —   |
| `tt.ai.model.profiles` / `tt.ai.model.active` | 模型 profile 列表 / 生效项 | —   |
| `tt.ai.model.config`                          | 旧版单条模型配置（迁移用）       | —   |
| `tt-widget-prefs`                             | 五载体配置               | —   |
| `tt-prefs`                                    | 通用 / 扫描 / 外观设置      | —   |
| `tt.skill-export-dir`                         | Skill 默认导出目录        | —   |

### 11.1 首页 `/`（FR-001~006）

| 指标               | 来源                                          | 计算                                                                                                                                     | 类型               |
| ---------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 流式总结文案           | `JarvisInsight` 组件                          | 按「选中 Agent + 时间范围」拼接固定文案，打字机逐字输出                                                                                                       | mock 文案          |
| Token 消耗（8 卡）    | `agent-view.agentViews`                     | `Σ tokens`（仅 live Agent），随范围缩放                                                                                                         | mock 确定性         |
| 费用估算             | 同上                                          | `Σ cost`（$2.4/1M）                                                                                                                      | mock             |
| 会话总数             | 同上                                          | `Σ sessions`，随范围缩放                                                                                                                     | mock             |
| 缓存命中率            | `agent-view.usageMetrics.cache`             | `18 + rnd(seed:cache,62)`（18~79%）                                                                                                      | mock             |
| Agent 活跃         | `liveAgents.length`                         | `status==="data"` 计数（精确值 13，已跑 Node 验证）                                                                                                | mock             |
| 安全扫描             | `securityPulse`                             | scanned/safe/warn/danger（见 §11.6）                                                                                                      | mock             |
| 蒸馏产出             | `distill-history` 长度                        | 本地记录条数                                                                                                                                 | 真实(localStorage) |
| 日报生成             | `reports` 草稿                                | 本地草稿存在性                                                                                                                                | 真实               |
| 环比涨跌 `DeltaChip` | `dash-analytics.deltaOf(seed,spread=40)`    | `pct=round((rnd(seed,80)-40)*10)/10`（-40~+40%）；`dir=up/down/flat`                                                                      | mock             |
| Token 趋势         | `dailySeries(range,dailyBase,sessionsBase)` | `total=round(dailyBase*jitter)`；`cacheRate=40+rnd(c:key,45)`；`cacheTokens=round(total*rate/100)`；`jitter=0.75+rnd/1000*0.5`（0.75~1.25） | mock             |
| 模型占比             | `dash-analytics.modelSlices(views)`         | 聚合 `agentModels`，`share=round(tokens/total*1000)/10`                                                                                   | mock             |
| 项目消耗             | `dash-analytics.projectRows(factor)`        | `tokens=round(parseTokens(p.tokens)*1000*factor)`                                                                                      | mock             |
| 贡献热力图            | `mock-data.heatmap`                         | 7×24；`workday` 系数 + 高斯双峰(10.5h/16h) + 噪声，`min(100,round(...*62))`                                                                      | mock             |

### 11.2 Agent 概览 `/agents`（FR-007~010）

| 指标               | 来源                          | 计算                                                                                                              | 类型   |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- | ---- |
| 工牌列表             | `agentViews`                | 由 `sources.dataSources`（32 项）映射，按 tokens 倒序；`installed=status!=="missing"`（精确 20），`live=status==="data"`（精确 13） | mock |
| 单 Agent tokens   | `agentViews[i].tokens`      | live ? `rnd(name:tok,9_400_000)+120_000` : 0                                                                    | mock |
| 单 Agent cost     | —                           | `round(tokens/1e6*2.4*100)/100`                                                                                 | mock |
| 单 Agent sessions | —                           | live ? `rnd(name:ses,180)+3` : 0                                                                                | mock |
| 24h 迷你趋势         | `spark`                     | `Array(24)`，`rnd(name:sp{h},100)`                                                                               | mock |
| 上下文构成树           | `mock-data.sourceTree(row)` | 按比例拆分 Messages/Tool calls/Reasoning（参考 §11.10 的 context-engine）                                                 | mock |
| 模型消耗明细           | `agentModels(agent)`        | `count=3+rnd(name:mc,3)`（3~5 个）；`tokens=round(agent.tokens*weight/sum)`；`calls=rnd+12`                          | mock |

### 11.3 蒸馏 `/distill`（FR-011~018）

| 指标    | 来源                                               | 计算                                                                                              | 类型   |
| ----- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ---- |
| 原材料   | `distill-kinds.MATERIALS`                        | chat（会话/项目）/ config（Agent 提示词/配置）两类                                                             | 静态定义 |
| 提示词文件 | `TOOL_PROMPT_FILES`                              | 5 条硬编码（CLAUDE.md ×2 / AGENTS.md / .cursor/rules / GEMINI.md）                                    | 静态   |
| 产物类型  | `OUT_TYPES`                                      | **代码现状 5 种**：skill / workflow / prompt / profile / task；**「角色」为文档目标第 6 种，尚未落库**（记忆资产，归记忆库，联动后续补充） | 静态   |
| 能力文件树 | `buildFiles(form,sources,instruction)`           | prompt=1 文件、workflow=2 文件、pack=7 文件（SKILL.md + references×3 + scripts×2 + assets/metadata.json） | 生成   |
| 记忆卡片  | `buildMemory(type,sources,instruction,material)` | profile 分浅(config)/深(chat)两版文案；task 固定「本项目约定」模板                                                 | 生成   |
| 历史    | `distill-history.recordRun`                      | 写 `tt.distill.history`（≤60）                                                                     | 真实   |
| 模型与配额 | `ai-config.OFFICIAL_MODEL`                       | 官方 "DeepSeek-v4-Pro"；自定义 profile 存 `tt.ai.model.profiles`                                       | 真实   |

### 11.4 记忆库 `/memory`（FR-024~026）

| 指标     | 来源                                        | 计算                              | 类型               |
| ------ | ----------------------------------------- | ------------------------------- | ---------------- |
| 列表     | `memory-store.useMemories`                | 读 `tt.memory.items`；空则 SEED 3 条 | 真实(localStorage) |
| 手动增删改  | `addMemory / updateMemory / removeMemory` | 内存更新 + persist（`slice(0,400)`）  | 真实               |
| 蒸馏自动写入 | 蒸馏页调 `addMemory`，`origin:"distill"`       | 同上                              | 真实               |

### 11.5 日报 / 周报 / 月报 `/reports`（FR-019~023）

| 指标    | 来源                                | 计算                                               | 类型       |
| ----- | --------------------------------- | ------------------------------------------------ | -------- |
| 三周期   | `reports.makePeriod(kind,anchor)` | day / week / month；周从周一算起，月取自然月                  | 真实(Date) |
| 周期会话  | `itemsIn(p)`                      | `chatList.filter(date∈[from,to])`                | mock 数据源 |
| AI 草稿 | `draftOf(p,items)`                | 聚合 `reportStats`；`缓存命中率=58+(len%7)*3`；`风险=len%3` | mock     |
| 保存    | 写 `tt.report.{period}.md`         | 30s 自动存草稿                                        | 真实       |

### 11.6 安全 `/security`（FR-027~031）

| 指标      | 来源                                   | 计算                                                                                                                    | 类型       |
| ------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------- |
| 扫描结论    | `skill-scan.scanSkill(id)`           | `r=hash(id)%100`；`r<78→safe / <94→warn / else→danger`；命中维度 `(h>>i)%7===0` 取前 hitCount                                 | mock 确定性 |
| 11 安全维度 | `mock-data.securityDimensions`       | rce / exfil / secret / persist / destruct / obfus / inject / privesc / files / network / prompt                       | 静态       |
| 巡检摘要    | `agent-view.securityPulse`           | `scanned=80`（skillCatalog 共 80 条）；safe/warn/danger 由 scanSkill 汇总（精确 65/10/5，已跑 Node 验证）；lastRun/nextRun/interval 硬编码 | mock     |
| MCP 扫描  | `security-history.scanMcp(id)`       | `r=hashS(mcp:id)%100`；`r<74→safe / <92→warn / else→danger`                                                            | mock     |
| 扫描历史    | `security-history.buildHistory(now)` | 6 条硬编码 spec（5min/3h/26h/50h/74h/8d），findings 由 scanSkill 派生                                                           | mock     |
| 运行时提醒   | `RuntimeBlocks.runtimeBlocks`        | **5 条硬编码假记录，无真实「会话执行前检查」**                                                                                            | mock 占位  |

### 11.7 燃烧榜 `/tracker`（FR-032~033）

| 指标      | 来源                           | 计算                                                                                                | 类型   |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------- | ---- |
| Skill 榜 | `agent-view.roastList`       | `tokens=rnd(name:rt,2_400_000)+40_000`；`waste=rnd(name:wp,55)+12`（12~66%）；按 `tokens*waste` 倒序取 12 | mock |
| 项目榜     | `roastProjects`              | `tokens=parseTok(byProject.tokens)`；`waste=rnd(pw,48)+12`                                         | mock |
| 会话榜     | `roastSessions`              | `tokens=chatMeta.tokens`；`waste=rnd(sw,52)+10`                                                    | mock |
| 浪费拆解    | `waste-model.wasteBreakdown` | 4 因子（重复上下文/输出丢弃/多轮澄清/过长推理）；`pct=round(raw/sum*waste)`，末项=余量；`wastedCost=wastedTokens/1e6*3`       | mock |
| 优化方案    | `optimizePlan`               | `save=round(factor.pct*0.62)`                                                                     | mock |
| AI 评估   | `aiVerdict`                  | `avg=round(tokens/max(1,calls))`                                                                  | mock |

### 11.8 Skill Hub `/skills`（FR-034）

| 指标       | 来源                    | 计算                                                                                            | 类型   |
| -------- | --------------------- | --------------------------------------------------------------------------------------------- | ---- |
| 本地 Skill | `mock-data.skills`    | 80 条；`calls=rnd(name:calls,900)+3`；`form: r<16→prompt / <38→workflow / else→pack`；`health` 随机 | mock |
| 安全状态     | `scanSkill(skill.id)` | 同 §11.6                                                                                       | mock |

### 11.9 安全市场 `/market`（FR-035~036）

| 指标   | 来源                                                  | 计算                                                                                                                                    | 类型     |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 市场条目 | `mock-data.marketSkills`                            | 与 Skill Hub 同源 80 条；`downloads=rnd(dl,48000)+120`；`rating=round((3.2+rnd(rt,18)/10)*10)/10`；`weekly=max(12,round(downloads/(rnd+8)))`；**渲染层由 `MarketPanel` 按 `scanSkill` 过滤，仅收录 verdict==="safe"（数据层 `safe` 仍硬编码，见 §11.15）** | mock   |
| 分类筛选 | `marketCats` / `domainOf`                           | 由 skillCatalog 类别派生                                                                                                                   | 静态     |
| 一键安装 | `MarketPanel` + `AgentInstallBar`/`AgentInstallRow` | 选中 Skill → 勾选目标 Agent（单个/全部）→ 安装/卸载；安装命令 `trusttools install <name>`；安装状态持久化至 localStorage（`tt.market.installs`）                         | 真实(本地) |

### 11.10 会话 `/chats`（FR-037~038）

| 指标         | 来源               | 计算                                                                                                                                                                                           | 类型   |
| ---------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 会话列表       | `chats.chatList` | 13 条硬编码（含 `turns()` 生成的消息流）                                                                                                                                                                  | mock |
| 单条元信息      | `chatMeta(c)`    | `tokens=18_000+(h%420)*1000`（18K~438K）；`cost=1.2+((h>>>3)%900)/100`（$1.2~10.2）；`turns=4+(h%26)`；`edits=(h>>>5)%32`；`durationMin=6+((h>>>7)%110)`                                             | mock |
| 恢复命令       | `resumeCommand`  | CLI 源 → `cd <cwd> && claude/codex --resume <hash>`；客户端 → 空                                                                                                                                   | 静态   |
| 技术栈标签      | `chatTags`       | 按 project+title 匹配 10 类标志文件规则                                                                                                                                                                | mock |
| Token 构成下钻 | `context-engine` | **注意：这是 Token 上下文计算引擎，非记忆回注**。`allocateByLargestRemainder`（整数分配）、`classifyInputTokens`（输入 3 路分流）、`computeOutputTokenBreakdown`（输出 4 路拆分）、`categorizeTool`（14 类）、`inferExecCommandKind`（命令分类） | mock |

### 11.11 菜单栏小组件 `/widget`（FR-039~041）

| 指标       | 来源                                  | 计算                                                                                                                                         | 类型               |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| 今日产出     | `widget-metrics.outputToday`        | `sessions=todayChats.length`；`turns=Σceil(messages/2)`；`tools/projects=distinct 计数`                                                        | mock             |
| 可蒸馏轮次    | `outputWeek.distillable`            | 近 7 天 `messages.length≥4` 的会话轮次和                                                                                                           | mock             |
| 资产库存     | `assetStock`                        | `total=80`；form 分 pack/workflow/prompt 计数；`unscanned=Σmax(0,skills-scanned)`                                                               | mock             |
| 今日 Token | `tokenToday`                        | `Σ chatMeta(todayChats).tokens`                                                                                                            | mock             |
| 7 日趋势    | `tokenTrend7`                       | 按日聚合 tokens，旧→新                                                                                                                            | mock             |
| 限额       | `quota.quotaWindows`                | `remain=12+rnd(name:q,88)`（12~99%）；`depletion=remain<55?预计X天X小时:null`；取 live 前 6                                                           | mock             |
| 配置       | `widget-prefs.DEFAULT_WIDGET_PREFS` | 默认 `barStyle=icon-num / barClick=panel / defaultTab=today / tone=casual / rotate=10 / smallContent=orb / mediumContent=brief / theme=dark` | 真实(localStorage) |

### 11.12 设置 `/settings`（FR-042~045）

| 配置         | 来源                                                           | 类型               |
| ---------- | ------------------------------------------------------------ | ---------------- |
| 通用 / 外观    | 组件内状态 + localStorage                                         | 真实               |
| 模型 profile | `ai-config.upsertProfile / deleteProfile / setActiveProfile` | 真实(localStorage) |
| 测试连接       | `fetchModels` → `GET {endpoint}/models`，失败回退 FALLBACK 常用模型   | 真实(网络)           |
| API Key 脱敏 | 组件层显示 `••••`                                                 | 真实               |

### 11.13 数据来源 `/sources`（FR-046）

| 指标       | 来源                    | 计算                                                                                                                                | 类型       |
| -------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Agent 目录 | `sources.catalog`     | 32 个 Agent 硬编码（采集目录 `dirs` + 官方下载地址 `download` + 类型 `kind`=CLI/IDE/插件/桌面端）                                                        | 静态       |
| 采集状态     | `sources.dataSources` | `roll=rnd(name:status,100)`；`i<5 或 roll<34→data` / `roll<58→found` / `else→missing`；精确 data=13 / found=7 / missing=12（已跑 Node 验证） | mock 确定性 |
| 事件/异常    | 同上                    | `events=status==="data"? rnd(name:ev,24000)+12 : 0`；`anomalies=status==="data" 且 rnd>8 ? rnd(anv,12)+1 : 0`                       | mock     |
| 最近扫描时间   | `lastScan`            | `07-31 HH:mm` 按 index 派生                                                                                                          | mock     |

### 11.14 国际化（FR-047）

| 项        | 来源                          | 类型   |
| -------- | --------------------------- | ---- |
| 词典       | zh / en / ja 主词典 + jaX 扩展词典 | 静态   |
| 缺 key 回退 | 运行时缺 key → 中文，不暴露原文         | 真实逻辑 |

### 11.15 代码现状 vs 文档目标（落差清单，研发需知）

| 项       | 代码现状                          | 文档目标          | 处置            |
| ------- | ----------------------------- | ------------- | ------------- |
| 蒸馏产物    | `OUT_TYPES` 仅 5 种（无「角色」）      | 6 种（+角色，记忆资产） | 归记忆库，联动后续补充   |
| 运行时安全   | `RuntimeBlocks.tsx` 5 条硬编码假记录 | 仅提醒、不拦截（无拦截权限）   | mock 占位，首版不接真 |
| MCP 增删改 | `mcpServers` 7 条 mock 只读      | 首版不做增删改       | 后置            |
| 一键迁移    | 仅占位                           | 远期主打粘性        | P2            |
| 市场安装持久化 | 安装状态为组件态，未落 localStorage      | 安装结果可持久化      | ✅ 已落 localStorage（`tt.market.installs`） |
| 市场安全过滤  | `marketSkills` 全部 `safe:true` 硬编码  | 仅收录通过 11 维扫描的 Skill | ✅ 已按 `scanSkill` 过滤（仅收录 safe） |

### 11.16 二级数据源补充（上表未尽者）

| 数据源                | 关键函数                                     | 计算                                                                                                                                           | 用途 / 类型                  |
| ------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `agent-report.ts`  | `promptQualityOf(agent)`                 | 提示词质量 0-100：`score=round((clarity+ctx+oneShot)/3)`；`clarity=42+rnd(:clar,55)`、`ctx=clamp(20,98, cache+12)`、`oneShot=35+rnd(:one,60)`         | JarvisInsight Agent 微观洞察 |
| `agent-report.ts`  | `skillBurnOf(agent,5)`                   | 子技能消耗排名：`tokens=round(agent.tokens*0.62*weight/sum)`；`waste=rnd(:waste,52)+8`                                                                | Agent 洞察「最大浪费来自 Skill」   |
| `agent-report.ts`  | `scanLogOf(agent)`                       | Agent 专属扫描日志：`runs=2+rnd(:runs,5)`，danger/warn 各取前 2 条                                                                                       | Agent 洞察安全句              |
| `agent-profile.ts` | `agentProfiles`（前 12 Agent）              | 体检档案：flavor=claude/codex/empty；latency `p50=40+rnd(:p50,70)`、`p95=p50*4+..`、`p99=p50*8+..`；compaction 比值；radar 6 维（消耗/缓存/速度/Skill/子Agent/安全） | Agent 概览深度报告             |
| `skill-report.ts`  | `reportOf(id)`                           | 11 维结构化报告：`score=max(0,100-Σpoints)`；severity 计数；DIM_RULES 映射 CWE/规则名/示例代码/行号                                                                | 单 Skill 安全报告             |
| `skill-social.ts`  | `skillReviews/skillRating/skillVersions` | 评分 `rating=round((4.1+(h%9)/10)*10)/10`；评价 `reviews=(h%900)+12`；版本历史 4 条                                                                     | 市场 + 本地 Skill 详情         |
| `distill.ts`       | `buildSkillPackage(job)`                 | 实际落盘的 Skill 包（7 文件）；`jobProgress=(now-started)/durationMs`；队列存 `tt.distill.jobs`                                                             | 蒸馏保存 / 进度                |
| `skill-files.ts`   | `baseSkillFiles(name,desc)`              | 非蒸馏 Skill 标准目录（SKILL.md + references/usage.md）                                                                                               | Skill 导出                 |
| `prefs.tsx`        | `DEFAULT_PREFS`                          | 默认 `dataDir=~/.trusttools/`、`autoLaunch=true`、`scanEnabled=true`、`scanCycle=daily`、`scanCron=0 3 * * *`、`scanScope=all`、accent/fontSize      | 设置                       |
| `export-dir.ts`    | `readExportDir`                          | 默认 `~/TrustTools/skills/`，存 `tt.skill-export-dir`                                                                                            | 设置 · 导出目录                |
| `page-insights.ts` | `pageInsights(page)`                     | 各页顶部「今日洞察」口语化文案（按页取 totals/roastList/chatList 等拼句）                                                                                           | 各页洞察区                    |

### 11.17 蒸馏提示词规格（FR-013 / FR-014 实现用）

蒸馏能力资产（workflow / prompt）与记忆资产（画像 / 任务记忆）时，发给 AI 的提示词（system prompt 级）。当前 skill 的提示词已另备（`PROMPT_PRESETS` / `QUICK_PROMPT`），此处补 **workflow / prompt / 画像 / 任务记忆** 4 份；「角色」暂不实现。

> **分水岭**：能力资产提炼「怎么干一件事」（可复用），记忆资产提炼「这个人是谁、约定了什么」（长期有效）。两类提炼原则不同，切勿混用。

#### 工作流（Workflow）

```
你是流程提炼专家，负责把零散的会话记录压缩成一条可复用的标准工作流。

【输入】若干段会话（排查/实施/复盘过程）+ 用户可选附加指令。

【任务】识别素材里「一个被反复执行的多步骤过程」，整理成标准工作流。

【提炼原则】
- 只提取有明确先后顺序、可重复执行的过程，忽略一次性动作和闲聊。
- 步骤控制在 3~6 步，每步一句话说清「做什么」。
- 每步必须注明两样：产出（做完留下什么）、校验（怎么知道做对了）。
- 素材里出现过的踩坑/返工，单独摘成「历史踩坑」附在后面。

【输出格式】
# 适用场景
一句话说明什么时候用这条工作流。

# 步骤
1. {步骤名} —— 产出：…；校验：…
2. …（3~6 步）

# 历史踩坑（如有）
- 坑 + 规避方式

【质量标准】
- 一个不了解背景的人照着能独立走完。
- 上一步的产出是下一步的输入，步骤之间不断裂。
- 不保留人名、时间、token 数等一次性信息。
```

#### Prompt

```
你是提示词提炼专家，负责把会话中反复出现的指令诉求，浓缩成一段可直接复用的提示词。

【输入】若干段会话 + 用户可选附加指令。

【任务】提炼一段「通用提示词」，用户粘贴到任意 Agent 就能复用同样的协作方式。

【提炼原则】
- 只提取对 AI 的稳定要求：角色、边界、输出格式、语言偏好，忽略一次性任务内容。
- 用第二人称或祈使句直接对 AI 说话（"你是…""请…""不要…"）。
- 控制在 200 字以内，宁短勿啰嗦。
- 术语保留英文原名。

【输出格式】
# 提示词
你是{角色}。
{核心要求 1~3 条}
{边界 / 不要做什么}
{输出格式要求}

# 使用方式
直接粘贴到 Agent 系统提示词或 CLAUDE.md 顶部。

【质量标准】
- 贴到同类任务直接能用，无需再改。
- 没有一句废话，每条要求可执行、可检验。
```

#### 画像（Profile）

```
你是用户画像提炼专家，负责从会话中提取关于「这个人是谁」的稳定信息。

【输入】若干段会话（或 Agent 配置文件）+ 用户可选附加指令。

【任务】提炼用户的稳定画像——只记长期有效的东西，不记一次性任务。

【提炼原则】
- 只提取三类：① 岗位/角色 ② 沟通与协作偏好 ③ 对输出形式的固定要求（语言、详略、格式）。
- 严格排除：一次性任务内容、具体代码、临时决定。
- 用「事实陈述」写，不评价、不推测。
- 素材不足宁可留空，不要编造。

【输出格式】
{岗位角色}：…
{沟通偏好}：…
{输出要求}：…

【质量标准】
- 每条都能回答「下次合作我该记住什么」。
- 没有会过期的信息（如"今天在改 XX"）。
- 直接陈述，不出现"用户说/用户提到"这类转述腔。
```

#### 任务记忆（Task）

```
你是决策记录专家，负责把会话中「我们定过的规矩」提炼成长期有效的任务记忆。

【输入】若干段会话 + 用户可选附加指令。

【任务】提炼「达成的约定、关键决策、不可逾越的边界」。

【提炼原则】
- 只提取三类：① 约定（反复确认过的规矩）② 决策（拍板过的方向）③ 红线（明确说"不要/禁止"的）。
- 每条写成「规则 + 为什么」：先写规矩，再补一句为什么这么定。
- 排除：还在讨论没拍板的、一次性操作、代码细节。
- 区分程度：红线写"不可逾越"，约定写"应该这么做"。

【输出格式】
- {约定/规矩} —— 为什么：…
- {关键决策} —— 为什么：…
- {红线} —— 为什么：…

【质量标准】
- 每条都是「下次会遵守」的，不是「当时讨论过」的。
- 为什么说清了，换个人也能判断这条规则的适用边界。
```
