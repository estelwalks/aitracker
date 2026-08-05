# TrustTools V3.0 技术选型决策矩阵

| 属性     | 值                  |
| -------- | ------------------- |
| 文档类型 | 架构决策记录 (ADR)  |
| 项目名称 | TrustTools V3.0     |
| 版本     | v1.2                |
| 创建日期 | 2026-07-27 14:49:27 |
| 更新日期 | 2026-07-27 15:00:47 |
| 生成工具 | tech-selection      |
| 文档状态 | 草稿                |

## 修订记录

| 版本 | 修改时间            | 修改内容                                                                                      |
| ---- | ------------------- | --------------------------------------------------------------------------------------------- |
| v1.2 | 2026-07-27 15:00:47 | 纳入 TokenTracker v0.83.6 数据采集参考分析；新增独立采集内核、接口重构、Clean Room 和开源门禁 |
| v1.1 | 2026-07-27 14:54:39 | 根据产品纠偏，架构核心调整为全栈 TypeScript；Python 降为非核心可选适配器                      |
| v1.0 | 2026-07-27 14:49:27 | 初始版本                                                                                      |

---

## 1. 决策范围

本轮不把 PRD 中的“Python 重构”直接视为架构核心。先从产品本质出发：

- TrustTools 是读取、解析和管理用户本机数据的 Electron 客户端。
- 核心数据流发生在本地文件系统、SQLite 和桌面 UI 之间。
- 不需要建设独立部署、独立扩缩容的后端服务。
- 前端、桌面壳、采集器和本地数据层之间的融合效率优先。

据此重新评估：

1. 主语言和运行时
2. Electron 内部进程职责
3. Renderer 与业务进程通信方式
4. 本地数据库和采集机制
5. 打包与跨平台分发

## 2. 评估维度

评分为 1～5 分，满分 500。

| 维度       | 权重 | 本项目判定重点                     |
| ---------- | ---: | ---------------------------------- |
| 业务适配度 |  20% | 是否贴合纯本地桌面数据工具         |
| 交付速度   |  20% | 是否复用现有 React/TypeScript 资产 |
| 融合与维护 |  20% | 类型、模型、调试和跨进程成本       |
| 性能匹配度 |  10% | 文件采集、10 万条查询、后台资源    |
| 安全匹配度 |  10% | Renderer 最小权限和本地数据边界    |
| 生态成熟度 |  10% | Electron、SQLite、文件监听、打包   |
| 迁移与成本 |  10% | 运行时体积、构建矩阵和回滚影响     |

## 3. 主技术路线对比

| 方案                                                              | 业务 | 交付 | 融合 | 性能 | 安全 | 生态 | 成本 | 加权分 | 结论       |
| ----------------------------------------------------------------- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | -----: | ---------- |
| A. Electron + React + TypeScript 全栈，业务运行在 Utility Process |    5 |    5 |    5 |    4 |    4 |    5 |    5 |    470 | 推荐       |
| B. React/Electron + Python FastAPI 本地服务                       |    4 |    3 |    2 |    4 |    4 |    4 |    2 |    325 | 非核心备选 |
| C. Electron Main 直接承载全部 Node 业务                           |    4 |    5 |    5 |    3 |    2 |    4 |    5 |    405 | 可行但不优 |

### 推荐方案 A

- UI、桌面壳、领域模型、采集器和数据访问统一使用 TypeScript。
- 不分发 Python，不启动本地 HTTP 服务，不维护双语言 DTO。
- 业务逻辑不塞入 Electron Main，而是运行在独立 Node.js Utility Process。
- Main 只管理窗口、托盘、自启、更新和 Utility Process 生命周期。
- Renderer 通过 preload 暴露的白名单类型化 IPC 使用业务能力。

Electron 的 `utilityProcess` 可创建具备 Node.js 和 MessagePort 的独立子进程，适合把本地采集与数据库工作从主进程隔离。

### Python 的新定位

Python 不再是架构必选项，只在以下条件满足时作为可选 sidecar：

- 某个高价值 parser 依赖成熟 Python 库，TypeScript 重写成本显著更高。
- 通过真实 PoC 证明 Python sidecar 的收益高于安装包、进程和调试成本。
- sidecar 只处理特定 parser，不拥有数据库，不提供全局 API。

## 4. 前端形态对比

| 方案                           | 最适合场景              | 主要风险                     | 推荐意见 |
| ------------------------------ | ----------------------- | ---------------------------- | -------- |
| React + TypeScript + Vite SPA  | Electron 本地 Dashboard | 需将 TanStack Start 客户端化 | 推荐     |
| 保留 TanStack Start 全栈运行时 | 同时需要公网 SSR Web    | 引入不必要的 Node Server 层  | 不推荐   |
| Vue 3 重写                     | 团队只熟悉 Vue          | 丢失现有 React 资产          | 放弃     |

推荐复用 React、Tailwind CSS、Radix UI、TanStack Router/Query 和 Recharts，但生产桌面包只保留 SPA 运行时。

## 5. Electron 进程模型对比

| 方案                                         | 隔离性 | 融合性 | 故障影响 | 复杂度 | 结论       |
| -------------------------------------------- | -----: | -----: | -------: | -----: | ---------- |
| Main + Renderer + TypeScript Utility Process |      5 |      5 |        4 |      4 | 推荐       |
| Main + Renderer，业务全部在 Main             |      2 |      5 |        2 |      5 | 不推荐     |
| Main + Renderer + Python HTTP 服务           |      4 |      2 |        4 |      2 | 非核心备选 |
| 多个本地微服务                               |      5 |      1 |        5 |      1 | 放弃       |

### 推荐职责

- **Renderer：** React UI、状态展示、用户交互，无 Node 权限。
- **Preload：** 只暴露明确的业务命令和系统操作。
- **Main：** 窗口、托盘、自启、更新、权限提示、进程监管。
- **Utility Process：** parser、目录监听、聚合计算、SQLite、静态安全扫描、市场 API 适配。
- **Worker Thread：** 仅用于 CPU 密集或长耗时解析，不为普通异步 I/O 创建 worker。

## 6. 通信方案对比

| 方案                                     | 适配度 | 类型安全 | 攻击面 | 调试 | 结论                             |
| ---------------------------------------- | -----: | -------: | -----: | ---: | -------------------------------- |
| contextBridge + 白名单 IPC + MessagePort |      5 |        5 |      4 |    4 | 推荐                             |
| localhost HTTP API                       |      3 |        4 |      3 |    5 | 为浏览器插件预留，不作为 V1 核心 |
| Renderer 直接访问 Node/文件系统          |      5 |        2 |      1 |    4 | 禁止                             |

推荐建立共享 TypeScript contract 包：

- 命令：查询、扫描、安装、清理、配置更新
- 事件：采集进度、扫描进度、目录变化、后台错误
- 响应：统一结果和错误码
- 运行时校验：Zod

不允许通用 `ipc.send(channel, payload)`、任意文件路径读写或 shell 执行接口。

## 7. 本地存储对比

| 方案                                                | 查询 | 事务 | 融合 | 打包 | 结论                             |
| --------------------------------------------------- | ---: | ---: | ---: | ---: | -------------------------------- |
| SQLite WAL + better-sqlite3，运行在 Utility Process |    5 |    5 |    5 |    3 | 推荐                             |
| Node 内置 `node:sqlite`                             |    5 |    5 |    5 |    5 | 候选，需锁定 Electron 版本后 PoC |
| JSONL + SQLite 双写                                 |    4 |    3 |    3 |    4 | 不推荐                           |
| 纯 JSONL                                            |    2 |    2 |    4 |    5 | 放弃                             |

推荐先以 `better-sqlite3` 为可交付基线：

- 同步 API 放在独立 Utility Process，不阻塞 Renderer/Main。
- 启用 WAL、短事务和单写者。
- 使用事件表、游标表、小时/日聚合表和 FTS 索引。
- 原 AI 工具日志仍是采集来源，不复制完整对话。

`better-sqlite3` 是原生模块，隐性成本是必须与 Electron ABI 匹配并在每个平台重建。锁定 Electron 版本后，应同时对 Node 内置 SQLite 做 PoC；如果 API、迁移和性能满足要求，可减少原生依赖风险。

## 8. 文件采集与任务执行

推荐：

- `chokidar`/系统文件事件负责低延迟增量发现。
- 周期性 reconciliation 负责补偿休眠、崩溃、日志轮转和事件丢失。
- 每个工具使用独立 TypeScript parser adapter。
- 采集游标和 parser 版本写入 SQLite。
- I/O 工作使用 Node 异步 API；CPU 密集解析使用有界 Worker Thread 池。
- 单个 parser 失败不能阻断其他工具。

## 9. 打包方案

| 方案                                 | 运行时            | 原生依赖     | 安装包     | 结论       |
| ------------------------------------ | ----------------- | ------------ | ---------- | ---------- |
| electron-builder + TypeScript bundle | 仅 Electron/Node  | SQLite addon | 最小       | 推荐       |
| electron-builder + PyInstaller       | Electron + Python | 两套         | 大         | 放弃为默认 |
| 首次启动下载 Python                  | 外部依赖          | 两套         | 小但不稳定 | 放弃       |

推荐使用 electron-builder 生成 DMG 和 NSIS。原生 SQLite 模块通过 `electron-builder install-app-deps` 或 Electron rebuild 与目标 Electron 版本匹配。

## 10. AI 安全审查条件决策

全栈 JavaScript 不解决“源码是否允许出机”的产品冲突：

- 静态规则扫描在 Utility Process 本地完成。
- AI 审查保持适配器化。
- 云端审查必须先明确上传范围、脱敏、用户确认和失败降级。
- 若禁止任何源码出机，V1 只能使用静态扫描或用户自带本地模型。

## 11. 推荐基线

- React + TypeScript + Vite SPA
- Electron Main + sandboxed Renderer + preload
- TypeScript Utility Process 模块化本地业务层
- 类型化 IPC + MessagePort，Zod 运行时校验
- SQLite WAL；优先 `better-sqlite3`，同时 PoC `node:sqlite`
- chokidar + 周期对账
- Worker Threads 只处理 CPU 密集任务
- electron-builder，单 Electron/Node 运行时
- Python 仅保留为经 PoC 证明必要的 parser sidecar

## 12. 被放弃的方案

- FastAPI 作为本地业务核心：增加双语言、双进程、HTTP 鉴权和打包负担。
- Electron Main 承载全部业务：数据库或 parser 卡顿会影响窗口、托盘和生命周期。
- Renderer 直连文件系统：权限面过大。
- 本地微服务：没有独立部署收益。
- JSONL + SQLite 在线双写：一致性成本高。
- 默认携带 Python：与全站 JavaScript 的融合目标相悖。

## 13. 对后续架构设计的前提

- “Python 数据采集层”从不可变技术约束调整为历史方案，不再约束架构。
- V3.0 是单应用、多进程的模块化单体，不是本地微服务。
- TypeScript contract 是多人并行开发的边界。
- Main 和 Renderer 不直接拥有数据库连接。
- 本地功能断网可用；市场和 AI 审查允许降级。
- 200MB 内存目标必须用打包后的真实应用验证。

## 14. TokenTracker 参考范围

### 14.1 固定参考快照

| 属性         | 值                                                                              |
| ------------ | ------------------------------------------------------------------------------- |
| 本地路径     | `/Users/liyanjun/ks_project/TokenTracker`                                       |
| 版本         | v0.83.6                                                                         |
| Git 提交     | `32df4fe`                                                                       |
| 许可证       | MIT                                                                             |
| 允许研究范围 | 数据源位置、文件/数据库类型、字段语义、增量行为、异常场景                       |
| 禁止继承范围 | 源代码、函数名、模块边界、目录结构、接口、控制流、测试代码、测试夹具、UI 和文案 |

MIT 许可证允许在保留许可声明的前提下复用，但本项目为了未来独立开源和降低同源争议，采用比许可证要求更严格的 Clean Room 实施策略。

### 14.2 可借鉴的行为知识

| 行为知识     | 参考项目体现                              | TrustTools 处理方式                          |
| ------------ | ----------------------------------------- | -------------------------------------------- |
| 多数据介质   | JSONL、JSON、SQLite、OTEL、API            | 抽象成四类独立读取策略，不继承 parser 接口   |
| 增量采集     | 文件 offset、数据库 ID/时间水位、累计快照 | 统一 checkpoint 模型，和业务事件同事务提交   |
| 实时触发     | SessionEnd/notify hook                    | 被动监听为默认，hook 只做可选“唤醒信号”      |
| 被动兜底     | 无 hook 时直接扫描本地数据                | 作为核心能力，不依赖修改其他工具配置         |
| Token 归一化 | 输入、输出、缓存读写、推理                | 建立独立领域规范和一致性校验                 |
| 去重         | 消息 ID、事件 ID、文件指纹、跨源排除      | 使用来源原生身份 + 稳定指纹 + overlap policy |
| 累计值处理   | 快照差量、重置检测                        | adapter 显式声明 event/delta/snapshot 语义   |
| 多安装环境   | 原生、WSL、多 profile                     | source instance 隔离，不共享 checkpoint      |
| 隐私         | 只保存 token 指标                         | 解析阶段投影，prompt/回复不进入持久层        |

### 14.3 不继承的设计

- 不继承 `rollout.js` 单文件集中 20+ parser 的结构。
- 不继承 `sync.js` 同时承担发现、调度、修复、聚合和发布的职责。
- 不继承 `queue.jsonl + cursors.json + generation files` 多事实源组合。
- 不继承“累计 bucket 反复追加，读取时取最新值”的队列语义。
- 不继承 localhost HTTP endpoint 和任何响应结构。
- 不继承通过修改第三方配置实现实时性的默认策略。
- 不复制测试代码、测试名称、样例日志或故障修复代码。

## 15. 自研数据采集内核选型

### 15.1 候选架构

| 方案                                                             | 模块隔离 | 一致性 | 可测试性 | 扩展成本 | 同源风险 | 结论   |
| ---------------------------------------------------------------- | -------: | -----: | -------: | -------: | -------: | ------ |
| A. Adapter + Reader + Normalizer + Transactional Ingest Pipeline |        5 |      5 |        5 |        5 |        5 | 推荐   |
| B. 每个工具独立 parser，直接写聚合表                             |        3 |      3 |        4 |        3 |        3 | 不推荐 |
| C. 按参考项目重做统一大 parser                                   |        1 |      2 |        2 |        2 |        1 | 放弃   |

### 15.2 推荐流水线

```text
Source Catalog
  → Instance Discovery
  → Change Detection
  → Format Reader
  → Provider Decoder
  → Privacy Projection
  → Usage Normalization
  → Provenance + Confidence
  → Dedup / Overlap Resolution
  → SQLite Transaction（事件 + checkpoint）
  → Incremental Aggregation
```

各阶段职责固定：

| 阶段                 | 职责                                         | 禁止事项                 |
| -------------------- | -------------------------------------------- | ------------------------ |
| Source Catalog       | 声明候选路径、平台、数据介质和能力           | 不解析业务字段           |
| Instance Discovery   | 识别安装实例、profile、WSL 和版本            | 不写数据库               |
| Change Detection     | 判断追加、截断、替换、轮转和 DB sidecar 变化 | 不推断 token             |
| Format Reader        | 流式读取 JSONL/JSON/SQLite/OTEL              | 不识别 Provider 业务语义 |
| Provider Decoder     | 提取来源原生的 usage 记录                    | 不直接聚合               |
| Privacy Projection   | 丢弃 prompt、回复、工具参数和敏感正文        | 不允许原文进入持久层     |
| Usage Normalization  | 转为统一 token 领域模型                      | 不猜测缺失明细           |
| Dedup/Overlap        | 处理重复事件、镜像历史和多源重叠             | 不按模型名粗暴排除       |
| Transactional Ingest | 原子写入事件与 checkpoint                    | 不在事务外推进水位       |
| Aggregation          | 更新小时/日维度和项目维度                    | 不改变原始规范化事件     |

### 15.3 新接口边界

所有接口重新设计，不兼容 TokenTracker：

| 接口边界          | 输入                               | 输出                           |
| ----------------- | ---------------------------------- | ------------------------------ |
| Source Locator    | 平台、用户目录、显式覆盖配置       | 零到多个 source instance       |
| Change Probe      | instance + 旧 checkpoint           | changed objects + 新指纹       |
| Record Reader     | changed object + range/watermark   | 原始结构流                     |
| Usage Translator  | 原始结构 + provider schema version | 规范化 usage facts             |
| Overlap Resolver  | usage facts + source provenance    | accepted/rejected/linked facts |
| Ingest Repository | facts + next checkpoint            | 原子提交结果                   |

共享 contract 只描述数据，不暴露文件系统、SQL 或 Provider 私有对象。Adapter 不得直接访问 UI、Electron Main 或聚合查询。

## 16. 数据正确性设计

### 16.1 统一测量语义

每个数据源必须显式声明一种测量类型：

| 类型       | 含义                  | 处理                             |
| ---------- | --------------------- | -------------------------------- |
| `event`    | 单次调用的独立 usage  | 直接规范化并按原生事件 ID 去重   |
| `delta`    | 某次变化量            | 校验非负后入库                   |
| `snapshot` | 会话或账户累计值      | 与上次快照求差，检测归零和回退   |
| `estimate` | 无可靠 usage 时的估算 | 单独标记低置信度，不混入精确指标 |

禁止根据字段名称猜测语义。新 Provider 必须用真实样本和官方统计验证是 event、delta 还是 snapshot。

### 16.2 事务化 checkpoint

Checkpoint 最少包含：

- source instance ID
- source object ID
- reader mode
- byte position 或数据库 watermark
- 文件/数据库指纹
- provider schema version
- adapter version
- 最后完整记录边界

规范化事件、去重索引和 checkpoint 在同一 SQLite 事务提交。崩溃后允许重复读取，但不能重复入账。

### 16.3 稳定事件身份

优先级：

1. Provider 原生 request/event/message ID
2. session ID + turn ID + usage timestamp
3. 不含 prompt/回复的稳定元数据指纹
4. 无法建立稳定身份时进入隔离区，不直接计费

跨源重叠通过显式 policy 处理，例如“主源 + 迁移基线”“原生记录 + 镜像记录”，不能只按 model 名称排除。

### 16.4 置信度与可追溯性

每条 usage fact 记录：

- source adapter
- source instance
- provider schema version
- measurement type
- accuracy grade：exact / normalized / estimated
- dedup key version
- ingestion run ID

Dashboard 可以区分精确值与估算值；审计工具可追踪某个聚合数来自哪些 facts，但不能还原用户对话内容。

## 17. 数据源接入分阶段

### Wave 1：核心五类

| 工具           | 默认数据源                       | 策略                                  |
| -------------- | -------------------------------- | ------------------------------------- |
| Claude Code    | 本地 session JSONL               | 被动监听 + 周期对账；hook 仅可选唤醒  |
| Codex CLI      | 本地 rollout/session JSONL       | 流式增量、重写/归档去重               |
| Cursor         | 本地 SQLite/状态数据             | 默认不读取 auth token，不依赖远程 API |
| Gemini CLI     | 本地 session JSON                | 快照语义验证 + 增量索引               |
| GitHub Copilot | 本地 session-store SQLite / OTEL | 主源优先级 + overlap policy           |

### Wave 2：达到 10+

| 工具       | 默认数据源           | 特殊风险               |
| ---------- | -------------------- | ---------------------- |
| OpenCode   | 本地 SQLite/消息文件 | schema 版本变化        |
| Kimi Code  | 本地 wire JSONL      | 字段命名和兼容模式     |
| Kiro       | SQLite + JSONL       | 双源一致性             |
| Zed Agent  | 本地 SQLite          | 托管模型范围识别       |
| Grok Build | 本地更新/信号文件    | 累计快照可能只能估算   |
| 其他工具   | Adapter 扩展         | 必须单独通过正确性门禁 |

先保证 Wave 1 的准确率和幂等性，再扩展覆盖数量。不能为了“10+”把估算数据伪装成精确数据。

## 18. Clean Room 与开源门禁

### 18.1 执行流程

1. 研究人员基于固定参考快照形成“行为规格”，不得粘贴代码。
2. 实现人员只读取行为规格、Provider 公开文档和自建样本。
3. 接口、命名、目录、数据模型和控制流独立设计。
4. 测试夹具由自建生成器或用户授权的脱敏样本产生。
5. 发布前执行代码相似度、依赖许可证和 NOTICE 审查。

如果团队无法做人员隔离，则采用“时间隔离”：

- 研究阶段只输出结构化行为表。
- 关闭参考源码后再进入设计和编码。
- PR 必须说明依据的行为规格编号，不能引用参考项目代码行。

### 18.2 禁止清单

- 禁止复制或改写参考项目 parser 函数。
- 禁止复制测试名称、断言结构和 fixture。
- 禁止沿用其 queue/cursor schema。
- 禁止沿用 endpoint、CLI 参数和错误码。
- 禁止把“改变量名”视为自研。
- 禁止使用参考项目私有 issue 修复代码作为实现模板。

### 18.3 正确性门禁

每个 Adapter 至少独立验证：

- 首次全量、二次空跑幂等
- 追加完整记录
- 追加半行后再补全
- 文件截断、原子替换、轮转和归档移动
- 累计值增长、归零、单字段回退和临时空值
- 同一事件跨文件、跨 profile、跨数据源重复
- 活跃会话后补字段
- schema 版本变化和未知字段
- 权限拒绝、文件锁和 SQLite WAL sidecar 变化
- Windows/macOS 路径、中文用户名和 WSL
- 与工具官方统计的基准对账

当前需求中的“代码相似度 <10%”保留为自动检查指标，但不能替代人工来源审查；发布标准应是“无复制代码块、接口独立、测试独立、来源可追溯”。

## 19. 官方参考

- [Electron Utility Process](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [electron-builder](https://www.electron.build/docs/)
- [SQLite WAL](https://www.sqlite.org/wal.html)
