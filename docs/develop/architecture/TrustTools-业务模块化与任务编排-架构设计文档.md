# TrustTools 业务模块化与任务编排架构设计

| 属性 | 值 |
|------|-----|
| 文档类型 | 架构设计文档 (ARCH) |
| 项目名称 | TrustTools |
| 版本 | v1.2 |
| 创建日期 | 2026-08-06 18:01:11 |
| 更新日期 | 2026-08-06 18:26:40 |
| 生成工具 | architecture-design |
| 文档状态 | 草稿 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v1.2 | 2026-08-06 18:26:40 | 基于 Lovable 最新产品原型，补充 Agent 资产、蒸馏、知识、简报、安全监测、优化与搜索边界；将任务模型修订为计划调度与持久化作业运行时。 |
| v1.1 | 2026-08-06 18:05:02 | 补全模块边界、采集、任务编排、跨平台、迁移、测试和验收设计。 |
| v1.0 | 2026-08-06 18:01:11 | 建立架构设计大纲。 |

---

## 1. 背景、目标与范围

TrustTools 已将 AI 工具的静态事实、跨平台路径、Reader Key 与模型定价规则收敛为内建 JSON 和受控 TypeScript 实现；这一层应保持不变。但产品功能仍主要以技术目录和页面组织：路由同时承担数据拉取、刷新、状态协调、业务计算和视图渲染，采集刷新策略也散落在页面与根路由。

已核实的证据：

- 首页、Skills、Market、Settings 路由约为 1,204、1,456、1,052、800 行；六个主要路由合计约 5,317 行。
- 根路由、首页、Skills、Market 等页面包含 interval 或 timeout；使用量和 Skill 证据有 5 秒刷新。
- local-usage、local-skills、local-sessions、local-market 已有扫描能力，但缺少一致的应用用例、持久化、API 和 UI 边界。
- Electron 主进程通过本地 HTTP Server 托管 TanStack Start Node SSR；渲染进程无 Node 权限，本地 HTTP 接口由 capability token 保护。

### 1.1 目标

1. UI、业务用例、采集、任务调度和平台适配独立演进；新增功能不修改巨型路由。
2. 手动刷新、启动补偿和定时刷新复用同一个应用用例、采集器、错误模型与审计记录。
3. 保持“JSON 描述事实，TypeScript 受控执行行为”；不支持运行时任意模块、命令或脚本。
4. 首期支持应用运行期间的计划任务、启动补偿、取消、重试、运行记录；预留 macOS、Windows 10、Windows 11、Linux 宿主触发器。
5. 保持离线可用、本地优先、单实例和既有 ~/.trusttools 数据兼容。

### 1.2 非目标

- 不拆微服务、不引入数据库服务器、消息队列、远程配置中心或可执行插件。
- 不允许 JSON 出现 JavaScript、Shell、动态 import、绝对路径或用户给定的读写规则。
- 工具 JSON 不保存调度频率、UI 卡片或模型价格；工具、定价、任务、UI 分属不同事实源。
- 本轮不支持应用退出后由操作系统唤起执行任务；此能力必须另建 ADR。

### 1.3 成功标准

| 编号 | 可验证标准 |
|------|------------|
| SC-01 | routes 只含路由元数据、loader 适配和 Feature 装配；不得直接导入 scanner、完整 registry 或 pricing rules。 |
| SC-02 | 每个模块只有一个公开入口；模块之间不导入对方 infrastructure、presentation 或私有文件。 |
| SC-03 | 手动与计划刷新均通过同一 RefreshUseCase，写入统一 TaskRun。 |
| SC-04 | 重启后恢复任务偏好、上次结果；同一任务不并发，重复触发合并或跳过。 |
| SC-05 | macOS、Windows 10、Windows 11 具有相同任务语义；Linux 未通过 fixture、打包和 smoke 前保持 planned。 |
| SC-06 | 类型、lint、既有 registry/pricing 校验、模块边界校验、任务单元/集成/E2E 测试全通过。 |

## 2. 输入验证、约束与假设

| 输入 | 状态 | 设计处理 |
|------|------|----------|
| 功能需求 | 已提供 | UI 和采集模块化，增加受控定时任务能力。 |
| 技术约束 | 已提供 | Electron、TanStack Start/Router、React、TypeScript、内建 JSON、离线本地数据。 |
| 团队规模 | 部分提供 | 按 1–3 名全栈维护者、单仓库设计，优先模块化单体。 |
| 数据规模/SLO | 部分提供 | 按单机 GB 级日志、交互 P95 小于 500 ms、扫描后台化假设设计。 |
| 安全隐私 | 已提供 | 默认离线、外部工具目录只读、渲染进程无 Node 权限。 |

| 假设 | 置信度 | 影响 | 复审触发 |
|------|--------|------|----------|
| 单实例、单数据根 | 高 | Electron lock + 数据根任务锁，无分布式锁。 | 支持多实例/共享目录。 |
| 关闭窗口只是隐藏 | 高 | 托盘隐藏后任务继续，退出进程时停止。 | 新增关闭即退出。 |
| 任务仅在应用运行期执行 | 中 | 不安装系统服务；启动时补偿漏跑任务。 | 明确要求应用未运行时执行。 |
| 用户只能调整频率和启停 | 高 | executor 固定映射；偏好不可含代码/命令。 | 引入受签名扩展包。 |
| 采集允许最终一致 | 高 | 旧快照降级、原子提交、幂等刷新。 | 引入需要强一致写事务的模块。 |

## 3. 推荐系统形态与核心决策

采用“模块化单体 + 六边形端口 + 进程内事件 + 持久化任务状态机”。

~~~mermaid
flowchart TB
  subgraph Browser["渲染进程"]
    Route["Thin routes"] --> Page["Feature presentation"]
    Page --> Query["Feature query hooks"]
  end
  subgraph Transport["本地 HTTP / Server Function"]
    Query --> Api["Feature api.server adapters"]
  end
  subgraph Application["应用层（无 React / 无 Electron）"]
    Api --> UseCase["Use cases"]
    Executor["Task executors"] --> UseCase
    UseCase --> Ports["Ports"]
    UseCase --> Events["Domain events"]
  end
  subgraph Platform["平台与基础设施"]
    Ports --> Collectors["Collectors / Readers"]
    Ports --> Stores["Snapshot / Task repositories"]
    Ports --> Registry["Tool registry"]
    Ports --> Rules["Pricing / Security"]
    Scheduler["Task scheduler"] --> Executor
    Events --> Obs["Observability"]
  end
  subgraph Host["桌面宿主"]
    Main["Electron main"] --> Web["Local web server"]
    Web --> Api
    Web --> Scheduler
  end
~~~

选择理由：所有功能共享一个用户、一个数据根、一个桌面进程和同一发布节奏；微服务不会带来独立部署收益，反而引入分布式协调、运维和兼容成本。内部事件只用于本进程通知和读模型失效，快照与 TaskRun 才是事实源。

| 决策 | 采用 | 代价/放弃 | 复审触发 |
|------|------|-----------|----------|
| UI 结构 | Feature 模块、薄路由、ViewModel | 新增目录与 DTO | 极小、无共享逻辑页面可简化。 |
| 业务层 | UseCase + Port | 首期有 adapter 样板代码 | 用例只被一个页面且无任务复用。 |
| 采集 | 内建 Collector/Reader Key | 新格式仍要编写受控 Reader | 真正需要签名扩展时。 |
| 调度 | 运行期持久化 scheduler | 退出应用后不执行 | 有明确常驻需求。 |
| 状态推送 | 首期查询失效和低频任务状态轮询 | 非实时 | 状态时效成为产品需求。 |
| 配置 | 内建 task catalog JSON + 用户偏好 JSON | 不能配置任意行为 | 需要运营配置中心时。 |

## 4. 目标目录、边界与依赖规则

### 4.1 目标目录

~~~text
src/
├── app/
│   ├── bootstrap.server.ts              # 幂等启动后台运行时
│   ├── providers.tsx                    # Query/I18n/Theme 组合根
│   └── module-catalog.generated.ts      # 安全导航投影
├── routes/                              # TanStack 路由适配，每个 <= 80 行
├── modules/
│   ├── dashboard/                       # 聚合读模型、首页、导出 ViewModel
│   ├── usage/                           # 用量采集、快照、保留策略
│   ├── sources/                         # 各模块来源健康读模型
│   ├── sessions/                        # 会话发现、过滤、恢复请求
│   ├── skills/                          # Skill/Agent 发现、同步、安装
│   ├── market/                          # 市场 API、缓存、归档、安装编排
│   ├── pricing/                         # 定价模块门面；规则位置不变
│   ├── settings/                        # 用户偏好和保留策略
│   └── tasks/                           # 目录、调度、运行记录、任务 UI
├── platform/
│   ├── tool-registry/                   # 现有 lib/tool-registry 逐步迁入
│   ├── persistence/                     # 原子 JSON、锁、schema migration、clock
│   ├── observability/                   # 日志、metric、correlation、redaction
│   ├── runtime/                         # desktop/web 身份与生命周期
│   └── security/                        # 路径、输入、权限、敏感字段防护
├── shared/
│   ├── result.ts                        # Result/AppError
│   ├── ids.ts                           # TaskId、RunId、CorrelationId
│   ├── events.ts                        # 进程内事件契约
│   └── ui/                              # 无业务语义的共享 UI
└── lib/                                 # 迁移期旧路径，最终只保留 re-export 或删除
~~~

业务组件从 components/dashboard 迁入 modules/dashboard/presentation；通用 shadcn/Radix 组件可逐步迁入 shared/ui。禁止继续向通用 components 目录放业务组件。

### 4.2 模块所有权

| 模块 | 拥有 | 可消费 | 禁止 |
|------|------|--------|------|
| dashboard | 首页聚合、筛选、导出 ViewModel | usage/skills/pricing/tasks 公开 DTO | 扫描文件、读取完整规则。 |
| usage | 采集、标准化、快照、保留 | tool-registry、pricing 公共 Port | 图表和页面状态。 |
| sources | 来源健康/诊断投影 | usage/sessions/skills 状态 | 再次扫描原始数据。 |
| sessions | 会话发现、过滤、恢复请求 | registry session capability | 向浏览器返回命令模板。 |
| skills | Skill/Agent 发现、安装、同步 | registry、market contract | 定义工具路径。 |
| market | API、缓存、归档校验、安装编排 | skills 安装用例 | 用户 Skill 根规则。 |
| pricing | 规则编译、路由解析、估价 DTO | registry model observation | 写入工具 JSON。 |
| settings | 用户偏好 | tasks/settings repository | 散落 localStorage key。 |
| tasks | 任务定义、调度、TaskRun、触发 | 各模块公开 use case | 直接实现扫描协议。 |
| platform | 受控 I/O、路径、registry、安全 | 无业务模块 | 依赖 presentation。 |

### 4.3 模块内部约定

~~~text
modules/<name>/
├── domain/            # 可选：纯类型、不变量、纯函数
├── application/       # use case、port、业务编排
├── infrastructure/    # 仅服务端：fs、网络、缓存、reader
├── presentation/      # 仅浏览器：Page、view model、query hook
├── contracts.ts       # 可跨模块传递的 DTO 与输入 schema
├── api.server.ts      # Server Function：验证 + 调用 use case
└── index.ts           # 唯一浏览器安全入口
~~~

依赖规则：

1. presentation -> contracts/api -> application -> domain/ports -> infrastructure/platform。
2. 模块只能从另一模块根目录导入其 contract 或明确 public application API；不得深层相对 import。
3. React、Router、Server Function、Electron、Node fs 只能在指定 adapter 或 infrastructure 层出现。
4. routes 不得写业务计算、扫描或 timer；例外需 architecture-exception ADR。
5. registry、pricing rules、security rules 是平台规则包，Feature 只消费安全投影。
6. 禁止循环依赖；共享类型下沉 shared，不能以 common/utils 绕过边界。

新增 scripts/verify-module-boundaries.mjs，检查违规 import、循环依赖、route 行数和生成文件漂移。迁移白名单必须带阶段和到期日，阶段 5 后为零。

### 4.4 薄路由示例

~~~tsx
import { createFileRoute } from "@tanstack/react-router";
import { dashboardLoader, DashboardPage } from "../modules/dashboard/presentation/route";

export const Route = createFileRoute("/")({
  loader: dashboardLoader,
  component: DashboardPage,
});
~~~

DashboardPage 只能使用 DashboardViewModel 与 dashboard API；不得直接调用 scanLocalUsage、getDefaultRegistry 或 pricing 内部 matcher。

## 5. UI、API 与读模型

### 5.1 数据流

~~~mermaid
sequenceDiagram
  participant UI as Feature Page
  participant Hook as Query Hook
  participant API as api.server
  participant UC as Use Case
  participant Repo as Snapshot Repo
  participant Task as Scheduler
  UI->>Hook: useDashboardQuery
  Hook->>API: getDashboard
  API->>UC: GetDashboard.execute
  UC->>Repo: read latest snapshot
  Repo-->>UC: snapshot + freshness
  UC-->>API: safe DTO
  API-->>Hook: ViewModel
  UI->>API: requestRefresh
  API->>Task: runNow(usage.refresh)
  Task->>UC: RefreshUsage.execute
  Task-->>Repo: commit snapshot / TaskRun
~~~

首帧可继续使用 Router loader，但 loader 只能调 Feature 的 get-for-route API。交互后的查询、失效和刷新收敛到 React Query。删除根路由 5 秒全局 usage 刷新；UI 显示快照 freshness，只有手动任务、计划任务或明确操作会扫描。

### 5.2 Server Function 规则

Server Function 仅为 transport adapter，必须：

1. 校验输入、限长、能力状态和鉴权。
2. 创建/透传 correlationId，调用一个 UseCase。
3. 返回 versioned DTO；错误为 i18n key + 稳定 code。
4. 不返回绝对路径、命令、token、堆栈、原始日志片段或内部持久化结构。

~~~ts
export const requestUsageRefresh = createServerFn({ method: "POST" })
  .validator(refreshInputSchema.parse)
  .handler(({ data }) => taskFacade.runNow({
    taskId: "usage.refresh",
    reason: data.reason ?? "manual",
  }));
~~~

旧 refreshLocalUsageSnapshot 在迁移期只转调 taskFacade，不可维持另一套扫描事实源；阶段 5 删除。

### 5.3 Dashboard 与 Sources 读模型

Dashboard 聚合 UsageSnapshot、SkillSnapshot、PricingSnapshot 和 TaskSummary，只输出 DashboardViewModel。它新增 freshness 字段：fresh、stale、failed、lastSuccessAt、nextRunAt。Sources 页面只读取各模块写入的 SourceHealthProjection，不因打开页面再次扫描原始日志。

## 6. 数据采集架构

### 6.1 职责分层

| 层 | 职责 | 迁移目标 |
|----|------|----------|
| 工具事实层 | toolId、平台、路径 base、Reader Key、能力状态 | 现有 tool-registry JSON 保持事实源。 |
| 采集基础设施层 | 路径展开、遍历、只读 SQLite、解析、缓存 I/O、诊断 | 将 local-usage scanner/adapters 等逐步迁入 usage/infrastructure。 |
| 应用层 | 何时刷新、预算、幂等、快照提交、DTO、失败策略 | 新建 RefreshUsageUseCase 等。 |

工具 JSON 不定义多久扫描；任务调度属于产品策略，由 tasks 模块拥有。Reader Key 仍映射至内建 TypeScript，不能由 JSON 指向任意实现。

### 6.2 标准 Collector Port

~~~ts
interface CollectionRequest {
  correlationId: string;
  trigger: "startup" | "schedule" | "manual" | "recovery";
  signal: AbortSignal;
  budget: { maxDurationMs: number; maxFiles: number; maxBytes: number };
}
interface CollectionOutcome<T> {
  snapshot: T;
  sourceHealth: readonly SourceHealth[];
  diagnostics: readonly CollectionDiagnostic[];
  counters: { scannedFiles: number; reusedFiles: number; skippedFiles: number };
}
interface Collector<T> {
  id: "usage" | "skills" | "sessions" | "market-evidence";
  collect(request: CollectionRequest): Promise<CollectionOutcome<T>>;
}
~~~

AbortSignal 必须贯穿遍历、读取、网络和解析循环。预算耗尽返回可诊断的失败或部分结果，并保留最近成功快照；绝不能把空数据当成功结果。新采集器需先写 fixture 和 characterization test，再接入 registry。

### 6.3 快照、一致性与持久化

| 数据 | 事实源 | 写入 | 恢复 |
|------|--------|------|------|
| 工具/定价/安全规则 | 随包 JSON + generated 文件 | 仅构建期 | 指纹变化使可再生缓存失效。 |
| UsageSnapshot | 扫描结果 + 文件索引 | 临时文件、可用时 fsync、原子 rename | 扫描失败保留上次成功快照，标记 stale/failed。 |
| Skill/Sessions Snapshot | 扫描结果 | 同一 AtomicJsonStore | 读取完整旧快照，不读取半文件。 |
| TaskPreferences | 用户偏好 | schema 后原子覆盖 | 损坏文件备份并回退默认。 |
| TaskRun | 调度器 | append-only 日志 + 有界索引/轮换 | 启动时 running 标记 abandoned。 |

持久化放在 APP_DATA_DIR，以 DATA_ROOT_MARKER 和路径安全检查保护。任务日志只存 taskId、文件数量、耗时、错误码和脱敏标识，不能存 prompt、API Key、完整路径或命令。

### 6.4 进程内事件

定义 snapshot.updated、snapshot.failed、task.run.changed、settings.changed。载荷必须含 schemaVersion、module、occurredAt、correlationId 和脱敏摘要。事件只用于失效和通知，丢失事件时重新读取快照仍能恢复正确状态。

## 7. 任务编排与定时任务平台

### 7.1 运行位置和生命周期

Scheduler 属于 Node 服务端运行时，不属于 React，也不直接写入 electron/main.ts。现有 Electron TypeScript 编译边界不能直接 import src 业务代码；本地 Web Server 会在桌面主进程中动态加载构建后的 SSR 服务，因此可安全共享应用 UseCase。

在 src/app/bootstrap.server.ts 提供幂等 ensureBackgroundRuntimeStarted；src/server.ts 在处理首个受认证请求前调用它。Electron 启动预热请求确保打包应用显示窗口前初始化。窗口隐藏后进程继续，任务继续；真正退出时进程结束。开发 Web 模式默认关闭，只有 TRUSTTOOLS_ENABLE_BACKGROUND_TASKS=true 才启动，避免开发扫描真实用户目录。

~~~mermaid
stateDiagram-v2
  [*] --> idle
  idle --> queued: 到期 / 启动补偿 / 手动
  queued --> running: 获取 taskId 锁
  queued --> skipped: 已运行 / 冷却 / 未启用
  running --> succeeded: 原子提交成功
  running --> failed: 可恢复失败或预算耗尽
  running --> cancelled: AbortSignal 确认
  running --> abandoned: 进程异常退出
  abandoned --> queued: recovery policy
  succeeded --> idle
  failed --> idle
  cancelled --> idle
~~~

### 7.2 任务目录、配置与用户偏好

新增 modules/tasks/definitions/task-catalog.json，并提供 Zod schema、显式生成 import 和 verify-task-catalog 脚本。目录只引用受控 executorKey；禁止命令、路径、URL 模板和代码。

~~~json
{
  "schemaVersion": 1,
  "tasks": [{
    "id": "usage.refresh",
    "executorKey": "refresh-usage-v1",
    "category": "collection",
    "defaultSchedule": { "kind": "interval", "minutes": 15 },
    "constraints": { "minMinutes": 5, "maxMinutes": 1440, "singleFlight": true },
    "startupPolicy": "if-stale",
    "retry": { "maxAttempts": 2, "backoffSeconds": [30, 120] },
    "network": "forbidden",
    "ui": { "settingsVisible": true, "i18nKey": "tasks.usageRefresh" }
  }]
}
~~~

首期任务目录：

| taskId | executor | 默认计划 | 网络 | 说明 |
|--------|----------|----------|------|------|
| usage.refresh | refresh-usage-v1 | 15 分钟，stale 时启动补偿 | 禁止 | 更新用量和来源健康。 |
| skills.refresh | refresh-skills-v1 | 60 分钟，启动补偿 | 禁止 | 更新 Skill/Agent 发现。 |
| sessions.refresh | refresh-sessions-v1 | 30 分钟，默认可关闭 | 禁止 | 更新会话读模型。 |
| retention.apply | apply-retention-v1 | 每日一次，启动后延迟 | 禁止 | 仅清理 TrustTools 可控数据。 |
| market.evidence.refresh | refresh-market-evidence-v1 | 6 小时，默认关闭 | 允许 | 用户允许网络后才启用。 |
| pricing.dynamic.refresh | refresh-pricing-dynamic-v1 | 每日，默认关闭 | 允许 | 为未来动态费率预留；离线规则始终可用。 |

用户状态保存为 APP_DATA_DIR/tasks/preferences.v1.json：

~~~ts
interface TaskPreference {
  enabled: boolean;
  schedule?: { kind: "interval"; minutes: number } |
             { kind: "daily"; localTime: "HH:mm" };
}
interface TaskPreferencesFile {
  schemaVersion: 1;
  updatedAt: string;
  tasks: Record<TaskId, TaskPreference>;
}
interface TaskRun {
  runId: string;
  taskId: TaskId;
  trigger: "startup" | "schedule" | "manual" | "recovery";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped" | "abandoned";
  startedAt?: string;
  finishedAt?: string;
  attempt: number;
  correlationId: string;
  summary?: { scanned?: number; changed?: number; diagnosticCount?: number };
  error?: { code: string; retryable: boolean };
}
~~~

只接受目录中已有 taskId；interval 必须在任务 min/max 内，daily 时间必须是 HH:mm。本期拒绝 cron、时区字符串、路径、命令、URL 和自定义 executor。TaskRun 只能由 scheduler 写入。

### 7.3 Scheduler 和 Executor

~~~ts
interface TaskExecutor {
  key: TaskExecutorKey;
  execute(context: TaskExecutionContext): Promise<TaskExecutionResult>;
}
interface TaskScheduler {
  start(): Promise<void>;
  stop(): Promise<void>;
  runNow(request: { taskId: TaskId; reason: "manual" | "startup" | "schedule" }): Promise<TaskRun>;
  cancel(runId: string): Promise<void>;
}
~~~

实现规则：

1. TaskExecutorRegistry 是静态 TypeScript Map，例如 refresh-usage-v1 指向 RefreshUsageUseCase；未知 key 构建期和运行期都失败，不动态 import。
2. TaskScheduler 是唯一创建 timer 的位置；页面不得创建采集 interval。
3. singleFlight 任务已有 queued/running 时，新请求写 skipped(already-running)；手动操作可等待同一个 run，不能并发扫描。
4. 每 taskId 维护 AbortController；取消在安全检查点生效，原子提交完成后不能回滚成功状态。
5. 只重试 retryable 错误；使用目录固定 backoff 并添加不超过 10% 确定性 jitter。权限、schema、配置错误不重试。
6. 启动时将未完成 run 标记 abandoned；if-stale 最多补一次，防止启动循环。
7. 队列最大 100；满时跳过低优先级可再生任务，不丢弃用户触发的高优先级请求。
8. 所有 executor 仅调用其他模块的公开 application UseCase，不调用页面 API 或私有 scanner。

### 7.4 UI 交互

Tasks 页面位于 modules/tasks/presentation，Settings 只嵌入它的设置面板。展示启用状态、下次执行、最近成功、最近失败错误码、耗时和立即运行/取消；不展示路径、堆栈或命令。

所有“刷新”按钮迁移为 tasks.runNow(taskId)。task.run.changed 使相应 React Query key 失效。首期允许仅在可见页面每 10 秒读取任务状态作为丢事件兜底，但不得恢复每页 5 秒直接扫描；有实时需求时再通过 ADR 评估同源 SSE。

### 7.5 应用未运行时的预留

未来增加 platform/host-scheduler Port：install、uninstall、status。实现分别为 LaunchAgent、Windows Task Scheduler、systemd user timer。必须有独立 ADR、显式用户授权、安装/升级/卸载 E2E；只允许唤起随包的 TrustTools --run-task <known-id>，绝不执行用户字符串。本轮不实现可运行宿主调度器。

## 8. 跨平台、安全与可观测性

| 关注点 | macOS | Windows 10/11 | Linux | 统一方式 |
|--------|-------|---------------|-------|----------|
| 运行期任务 | Node SSR runtime | 相同 | 未验证前关闭 | RuntimeIdentity + 同一 Scheduler。 |
| 单实例 | Electron lock | 相同 | 相同 | Electron API。 |
| 原子写入 | APFS fixture | NTFS 占用/rename fixture | ext4/XDG fixture | AtomicJsonStore 错误分类。 |
| AI 工具路径 | home/Library | userProfile/AppData/WSL | XDG planned | 只由 registry platform plan 展开。 |
| 退出后任务 | 后续 LaunchAgent | 后续 Task Scheduler | 后续 systemd | 独立 HostSchedulerPort。 |

Windows 10/11 默认共享 windows profile，只有验证出真实差异才增加精确覆盖。Linux 保持 planned，不能自动执行任务。

安全规则：

1. TaskDefinition、ToolDefinition、pricing/security rule pack 在构建期 schema 校验、生成明确 import、版本指纹化。
2. executor 是内建 key；network=allowed 且 Settings 网络同意后才可执行网络任务。
3. Collector 继续使用受控相对路径、文件数/大小/时间预算、只读 SQLite、路径穿越防护。
4. preload 若未来暴露任务能力，只暴露受控操作和安全 DTO，不暴露文件系统、任意 taskId、原始偏好文件或日志。
5. 任务和清理动作记录审计事件；删除只能复用 DATA_ROOT_MARKER 和保留策略安全检查。
6. 生产 UI 不展示 stack；所有错误使用稳定 code 和 i18n key。

可观测性位于 platform/observability，使用本地 JSONL 日志、内存 metric 和 CorrelationContext。最小日志字段：timestamp、level、event、module、taskId、runId、correlationId、durationMs、outcome、errorCode。按大小/天数轮换，无自动远传。

最小 metrics：task_run_total{taskId,status}、task_duration_ms、task_queue_depth、task_last_success_timestamp、collector_scanned_files_total、collector_budget_exhausted_total、snapshot_age_ms、module_api_error_total、registry_version、pricing_rules_version。Settings/诊断页面只显示脱敏健康摘要。

## 9. 分阶段实施计划

原则：每阶段可构建、可测试、可回滚；先补 characterization test，再移动实现；旧 API 只能转调新用例，不能形成双事实源；generated 文件只能脚本生成。

| 阶段 | 工作项 | 关键产物 | 验收 |
|------|--------|----------|------|
| M0 基线 | 记录入口、轮询、缓存；为 Dashboard/Usage/Skills/Sessions/Market 建 fixture 对照；边界脚本报告模式。 | 迁移映射、characterization tests、architecture report。 | 行为不变，现有测试通过。 |
| M1 内核 | 建 shared result/ids/events；platform persistence/clock/lock；modules 空壳和公开 contract；app providers。 | AtomicJsonStore、Module API 规范、边界校验。 | 无 React/Electron 泄漏到 domain；无敏感 manifest。 |
| M2 Usage 样板 | 抽 UsageCollector/SnapshotRepository Port；实现 Get/RefreshUsageUseCase；旧 API 转调；Sources 读 health。 | usage 模块。 | 同 fixture 新旧 DTO 一致；打开 Sources 不扫描。 |
| M3 其余模块/UI | 依次 Skills、Sessions、Market、Pricing facade、Dashboard、Settings；组件迁 Feature；路由瘦身。 | 每模块 API、ViewModel、query hooks。 | 每次只迁一模块；每 route <=80 行或登记 ADR。 |
| M4 Tasks | task schema/catalog/generator；preferences/TaskRun store；scheduler/executor；接入各刷新用例；Tasks UI；server bootstrap。 | task 模块与 settings 面板。 | fake-clock 状态机、重启、single-flight、取消、手动/计划等价。 |
| M5 清理/发布 | 删除 direct interval/scan、旧 facade；边界改阻断；三平台 smoke；开源卫生检查。 | 零迁移白名单、发布证据。 | CI、build:desktop、E2E 全绿。 |

### 9.1 M0 的精确任务

- 新建 docs/develop/plan 对应敏捷任务清单，给每项编号、负责人、依赖和验收。
- 将 index、skills、market、settings、sessions、sources 的所有 Server Function 调用列为调用图。
- 搜索 setInterval、setTimeout、refreshLocalUsageSnapshot、refreshLocalSessions、refreshSkillMarketEvidence，逐个登记删除阶段。
- 为 LocalUsageSnapshot、SkillSnapshot、SessionSummary、MarketListResult 建正规化对照器：忽略 generatedAt、runId 等非确定字段，不忽略业务数据。
- verify-module-boundaries 初始只输出违规，白名单记录文件、理由、责任阶段和过期时间。

### 9.2 M1 的精确任务

- 提取 Clock、RandomId、AtomicJsonStore、FileLock、Redactor Port；测试可注入 fake clock/temp data root。
- 建立 module public API 命名规范：getX、refreshX、requestX；禁止 export scanner。
- 新建 contracts 的 Zod schema，传输对象与存储对象分离。
- 配置 ESLint restricted imports 或自定义脚本，阻止 routes 导入 server scanner。
- 将 QueryClient、I18n、Theme 移入 app/providers，禁止 Feature 重建全局 Provider。

### 9.3 M2/M3 的文件迁移映射

| 当前位置 | 目标位置 |
|----------|----------|
| src/lib/local-usage/* | src/modules/usage/domain、application、infrastructure、contracts、api.server。 |
| src/components/dashboard/* 和首页业务 helper | src/modules/dashboard/presentation。 |
| src/lib/local-skills/* | src/modules/skills/*。 |
| src/lib/local-sessions/* | src/modules/sessions/*。 |
| src/lib/local-market/* | src/modules/market/*。 |
| src/lib/pricing/* | 保持规则在原位置，先增加 src/modules/pricing facade，后续再按边界迁实现。 |
| src/lib/tools/detection.server.ts | src/platform/tool-registry 或 usage/sources 的受控 adapter。 |
| src/lib/settings/store.ts | src/modules/settings/application/infrastructure/presentation。 |
| src/routes/*.tsx | 保留文件名，仅变为 thin route。 |

### 9.4 M4 的精确任务

- 定义 TaskId、TaskDefinition、TaskPreference、TaskRun、TaskRunSummary schema 与 JSON Schema。
- 编写 generate-task-imports 和 verify-task-catalog；检查唯一 ID、未知 executor、频率范围、网络声明、i18n key、public 投影。
- 实现 TaskPreferenceRepository、TaskRunRepository（append、compact、rotate、recover）。
- 用 fake clock 实现 nextRunAt、daily 本地时间、启动补偿、退避与 jitter。
- 用静态 executor registry 接入 refresh usage/skills/sessions/retention/market；每个 executor 只从 public application API 取得依赖。
- src/server 启动 bootstrap；bootstrap 只能初始化一次，开发模式默认禁用。
- 将刷新按钮改为 runNow；迁移完成后删掉页面 scan timer。
- 实现任务配置和运行历史 UI，并补齐四种语言的 i18n key。

### 9.5 回滚

- 迁移期可用 feature flag 选择旧/新 application facade，但不能让两个 scanner 同时写 snapshot。
- 新路径失败时显示最后成功快照并标记 stale，不回退为空。
- task catalog/preferences 无法解析时禁用相应任务、记录诊断，保留手动刷新能力。
- 发布前备份 tasks 状态和可再生索引；迁移失败可恢复旧文件或重建索引。

## 10. 测试、门禁与 CI

| 层级 | 必测场景 |
|------|----------|
| Domain | 状态机、schedule、频率边界、retry 分类、stale、DTO 脱敏。 |
| Application | 手动/计划同用例、原子提交前失败、部分采集、旧快照降级、correlationId。 |
| Infrastructure | JSON 损坏、原子 rename、锁冲突、Windows 占用、缓存版本变更、路径计划。 |
| Scheduler | fake clock 的 startup、single-flight、queue full、cancel、retry、abandoned recovery、DST。 |
| API | 非法 taskId/频率、稳定错误码、无路径/命令泄露、public manifest。 |
| UI | loading/stale/failed、无障碍、立即运行、取消、Query invalidation。 |
| E2E | 首次启动、托盘隐藏任务继续、退出不执行、离线、任务设置、macOS/Windows smoke。 |
| 性能安全 | 大日志预算、UI 不阻塞、重复刷新不并发、路径穿越、超大输入、默认无网络。 |

新增 fitness functions：

| 名称 | 规则 | 阈值 |
|------|------|------|
| 模块边界 | 禁止 import、循环依赖 | 未批准违规为 0。 |
| 路由薄层 | 行数和禁止 import | <=80 行，例外登记 ADR。 |
| 配置安全 | JSON schema、生成漂移、public 投影 | 敏感字段为 0。 |
| 单一执行 | 同 taskId 最大并发 | 1。 |
| 数据恢复 | 写入失败后重启读取 | 最近完整 snapshot。 |
| 采集预算 | fixture 扫描统计 | 不超过目录预算。 |
| 跨平台 | platform plan matrix | macOS/Windows 通过，Linux planned 不执行。 |

建议 CI 顺序：

~~~text
npm run generate:tool-imports
npm run generate:manifest
npm run generate:pricing-imports
npm run generate:security-rules
npm run generate:task-imports
npm run verify:tool-registry
npm run verify:pricing-rules
npm run verify:task-catalog
npm run verify:architecture
npx tsc --noEmit
npm run lint
node --import tsx --test <unit-and-integration-tests>
npm run build:desktop
npm run test:e2e
~~~

## 11. 风险、ADR 与待确认项

| 风险 | 概率/影响 | 缓解 |
|------|-----------|------|
| 大规模移动打断隐式 import | 中/高 | 小批移动、对照测试、短期 re-export、每批构建。 |
| SSR 热重载重复启动 scheduler | 中/中 | singleton、runtime identity、ensure 幂等、启动次数测试。 |
| 任务频率增加 I/O | 中/中 | 合理默认、预算、single-flight、用户开关、删页面扫描轮询。 |
| Windows rename 被占用 | 中/中 | 错误分类、有限 retry、保留旧快照、NTFS fixture。 |
| TaskRun 无限增长 | 中/低 | 有界索引、轮换、retention。 |
| 配置成为插件入口 | 高/高 | 静态 executor map、schema 拒绝代码/命令/路径、构建 gate。 |
| 用户误解退出后任务 | 中/中 | UI 明示“应用运行期间”；宿主调度另立 ADR。 |
| Linux 过早标记支持 | 中/中 | fixture + 打包 + smoke 三项门禁。 |

后续 ADR：

1. ADR-001：模块化单体、目录和依赖方向。
2. ADR-002：任务运行期语义、持久化状态机和 single-flight。
3. ADR-003：宿主级调度按 OS 的授权、升级与卸载（需求成立后）。
4. ADR-004：SSE 与 Electron IPC 的状态推送选择（轮询不足后）。
5. ADR-005：Linux 从 planned 到 supported 的准入标准。

## 12. 实施完成检查清单

- [ ] 每个模块有公开 API、所有权说明和 fixture。
- [ ] 每个 route 为 thin adapter，不含扫描和 timer。
- [ ] 手动、计划、启动补偿共享同一 UseCase。
- [ ] TaskDefinition、TaskPreference、TaskRun 有 schema、版本、恢复和测试。
- [ ] JSON 永远不能执行任意代码、命令或用户路径。
- [ ] 工具、定价、安全规则事实源和职责未被破坏。
- [ ] macOS、Windows 10、Windows 11 测试通过；Linux 保持 planned 至验证完成。
- [ ] 离线、托盘隐藏、退出、写入失败、取消均有证据。
- [ ] 架构/registry/pricing/task 校验、类型、lint、构建、E2E 全部通过。

## 附录：自检摘要

**检查时间**：2026-08-06 18:05:02  
**检查范围**：全文

### 已修正项

- 明确任务运行在由本地 Web Server 加载的 Node SSR 运行时，而非直接在 Electron TypeScript main 中 import src 业务模块，符合现有编译边界。
- 明确工具 JSON 不承载任务、UI 或价格；四类配置各有单一事实源。
- 明确 Windows 10/11 共享 profile、Linux planned、退出后宿主调度预留，避免把设计预留误写为已支持。
- 以原子快照和 TaskRun 为事实源；进程内事件仅为通知，避免将其当作可靠消息队列。

### 遗留待确认项

- 团队规模、真实日志规模、任务频率上限和 UI SLO 未明确；M0 应采集本地、经同意的性能证据后复核预算。
- 是否需要应用未运行时的宿主级调度未确认；本文不实现。
- 首期采用查询失效和低频任务状态兜底轮询；近实时需求触发 ADR-004。

### 使用的假设

- 单实例、单数据根、离线优先、默认无网络后台任务：高置信度。
- 任务在应用运行期执行、窗口隐藏后继续：中高置信度。
- 1–3 名维护者优先模块化单体而非微服务：中置信度。


## 13. v1.2 原型验证与业务架构修订

### 13.1 验证结论

本次以已登录 Lovable 原型的首页总览、工具概览、蒸馏工作台、简报与记忆、安全与防御、Skill 燃烧榜、Agent 生态与迁移、Skill 市场、Skill 管理和设置进行只读验证。

原方案的模块化单体、工具注册表、受控采集器、原子快照、跨平台 profile、薄路由和离线优先原则仍然适用。原型新增了两条跨模块长流程：

~~~text
Agent 会话 -> 蒸馏作业 -> Prompt / Persona / Skill / Memory 资产
-> 安全评估 -> 人工确认 -> 本地安装或市场分发

计划规则 -> 调度触发 -> 持久化作业 -> 简报 / 巡检 / 采集 / 优化分析
-> 运行记录 -> 洞察读模型 -> Dashboard / 通知
~~~

因此，v1.1 中“tasks = 定时刷新器”的定义被本节取代：tasks 是计划调度与作业运行时平台；所有长耗时、可恢复、可取消或需要审批的操作都以 Job 执行。简单的内存事件不能替代 Job 状态。

### 13.2 原型能力与限界上下文

| 原型能力 | 归属模块 | 核心事实源 | 输出 |
|----------|----------|------------|------|
| 工具概览、生态状态、迁移 | agent-directory | AgentDefinition、AgentInstallation、AgentHealth | 兼容性、安装状态、绑定能力、迁移候选。 |
| 会话、Token、项目、模型消费 | usage、projects | UsageEvent、Session、ProjectUsageSnapshot | 项目/模型/Agent 聚合。 |
| 首页洞察 | insights | Insight、InsightSnapshot | 可解释摘要、待处理项、趋势。 |
| Skill 燃烧榜与优化 | optimization | OptimizationFinding、Recommendation、ChangeProposal | 待审批变更提案。 |
| 蒸馏工作台 | distillation | DistillationRequest、DistillationJob、DistillationOutput | 候选 Prompt、Persona、Skill、Memory。 |
| 长期记忆与资产 | knowledge | KnowledgeAsset、AssetVersion、Provenance | 可检索、可追溯资产。 |
| 日报、周报、巡检摘要 | reports | ReportDefinition、Schedule、ReportRun | 版本化报告。 |
| 手动安全扫描 | security-assessment | Assessment、Finding | 判定、历史、处置。 |
| 运行时观察/告警 | security-monitor | SecurityObservation、Incident | 告警、处置状态。 |
| 市场与多 Agent 安装 | skill-catalog、skill-distribution | SkillPackage、CatalogEntry、Installation | 安装计划、安装结果、回滚记录。 |
| 顶栏搜索 | search | SearchDocument、SearchIndexVersion | 脱敏跨实体查询。 |
| 后台执行与计划 | tasks | JobType、Schedule、JobRun、JobQueue | 队列、重试、取消、恢复、审计。 |

原型路径 /sources 显示的是“Agent 生态、检测与一键迁移”，而非 DAG/多 Agent 编排器。因此首期采用 agent-directory 或 agent-lifecycle 命名；只有产品明确出现节点、依赖、输入输出和审批图，才创建 workflow-orchestration 模块。

### 13.3 修订后的模块清单

第 4 章的分层和依赖规则保持有效，Feature 模块清单修订为：

~~~text
agent-directory    usage            projects        insights
dashboard          optimization     distillation    knowledge
reports            security-assessment  security-monitor
skill-catalog      skill-distribution   search
tasks              settings         shared-ui
~~~

现有 local-skills 分为 skill-catalog（来源、列举、市场元数据）和 skill-distribution（安装、同步、卸载、备份恢复）。现有 local-sessions 是 usage 的原始数据能力；若会话恢复保留独立页面，它只能消费 usage 的公开 Session contract。

### 13.4 计划调度与作业运行时

| 概念 | 是否用户配置 | 是否持久化 | 示例 |
|------|--------------|------------|------|
| JobType | 否；内建 JSON | 随包发布 | usage.refresh.v1、reports.generate.v1、distillation.run.v1。 |
| Schedule | 是；受 schema 约束 | 用户状态 | 每天 20:00 日报、每周五 18:00 周报。 |
| JobRun | 否；运行时创建 | 必须 | 某次报告、蒸馏、扫描或安装。 |
| Command | UI/API 发起 | 审计可选 | 立即生成、批准安装。 |
| Workflow | 多步骤/审批时 | 定义和每步状态 | 蒸馏 -> 评估 -> 批准 -> 发布。 |

Scheduler 只把到期 Schedule 或手动 Command 转成 JobRun；它不理解报告或蒸馏业务。Job executor 调用所属模块公开 UseCase；Workflow 只由拥有业务语义的模块定义，不能成为全局万能服务。

~~~ts
interface JobTypeDefinition {
  id: string;
  executorKey: string;
  inputSchemaRef: string;
  queue: "interactive" | "background" | "maintenance";
  timeoutMs: number;
  retry: { maxAttempts: number; backoffSeconds: number[] };
  network: "forbidden" | "allowed";
  requiresApproval: boolean;
}
interface Schedule {
  id: string;
  jobTypeId: string;
  input: Record<string, unknown>;
  trigger: { kind: "interval"; minutes: number } |
           { kind: "daily"; localTime: string } |
           { kind: "weekly"; weekday: 1|2|3|4|5|6|7; localTime: string };
  enabled: boolean;
  timezone: "local";
}
interface JobRun {
  id: string;
  jobTypeId: string;
  scheduleId?: string;
  trigger: "manual" | "schedule" | "startup-recovery" | "event";
  status: "queued" | "running" | "waiting-approval" | "succeeded" |
          "failed" | "cancelled" | "skipped" | "abandoned";
  inputFingerprint: string;
  correlationId: string;
  outputRef?: string;
}
~~~

执行规则：

1. interactive 优先于 background；maintenance 仅在空闲或规定窗口运行。
2. 相同 jobTypeId 和 inputFingerprint 的运行中 Job 必须 single-flight；新请求关联既有 Job 或返回 skipped。
3. 重启后 running 标记 abandoned；只有声明可恢复的 JobType 才创建新 Run 重试。
4. waiting-approval 不得自动继续；批准动作必须写审计事件。
5. 所有可取消 Job 传递 AbortSignal；原子提交后不能伪装成取消。
6. JobRun 不保存对话正文、密钥或绝对路径；产出以 outputRef 指向所属模块安全实体。

任务 JSON、Schedule 用户状态和 JobRun 日志是不同事实源。v1.1 的 TaskDefinition/TaskPreference/TaskRun 仅可作为迁移兼容名；新代码规范名为 JobTypeDefinition、Schedule、JobRun。

### 13.5 AI、知识与人工确认

蒸馏和简报都依赖模型推理，必须显式纳入架构：

| 组件 | 职责 | 禁止 |
|------|------|------|
| ai-orchestration platform | 模型路由、Prompt 模板版本、脱敏、超时、fallback、成本/延迟观测 | 不拥有业务资产，不写 Skill 目录。 |
| distillation | 会话转候选资产、创建 Job、审批流 | 不直接覆盖本地 Skill 或记忆。 |
| knowledge | 资产、版本、来源 hash、状态与关联 | 不直接读取外部原始日志。 |
| reports | 聚合数据与知识引用渲染、保存 ReportRun | 不决定扫描计划。 |
| skill-distribution | 按安全 verdict 和明确目标安装已批准包 | 不绕过审批或安全扫描。 |

固定蒸馏流：选择会话 -> DistillationRequest -> JobRun -> 最小化/脱敏上下文 -> 模型候选 -> schema/安全评估 -> waiting-approval -> 用户批准 -> KnowledgeAsset version -> 可选安装计划。

KnowledgeAsset 至少有 kind、contentHash、version、provenance、createdBy、status、securityVerdict。语义去重只能给出合并建议；合并和发布都需要用户确认。模型不可用、网络未同意或成本预算超限时，Job 必须可解释地失败并保留草稿；费用仍由现有 provider/route/model pricing resolver 计算。

### 13.6 安全、优化、搜索与洞察

- security-assessment 扫描用户明确选择的 SKILL.md、目录或包，输出版本化 Finding 和处置历史。
- security-monitor 只接收真实、获得授权的观察事件；未实现 OS Hook、代理或工具 Hook 时只能告警，不能宣称可阻断外部 Agent。
- optimization 从 usage、缓存、Skill 元数据和项目统计产生 Finding/Recommendation。“一键优化”必须先生成含 diff、影响和回滚的 ChangeProposal，用户确认后才写入。
- search 订阅各模块的脱敏公开事件，维护本地索引，不能在输入框中 fan-out 扫描所有模块。
- insights 是读模型，组合 usage、安全、知识、Job 和分发状态；Dashboard 只渲染 InsightSnapshot。

~~~ts
interface SearchDocument {
  id: string;
  entity: "agent" | "skill" | "session" | "report" | "knowledge" | "finding";
  title: string;
  excerpt?: string;
  updatedAt: string;
  route: string;
}
~~~

### 13.7 配置所有权修订

| 配置/状态 | 所有者 | 格式 | 随包 | 用户修改 |
|-----------|--------|------|------|----------|
| 工具路径、Reader、平台能力 | tool-registry | JSON | 是 | 否。 |
| 模型路由、费率、fallback | pricing | JSON | 是 | 否。 |
| 内建规则库 | security | JSON | 是 | 否。 |
| JobType、队列、超时、权限 | tasks | JSON | 是 | 否。 |
| 初始 Prompt/报告模板 | reports/distillation | JSON 或受控文本资源 | 是 | 否。 |
| Schedule、任务启停、网络同意 | settings/tasks | 本地 JSON | 否 | 是，受 schema 限制。 |
| 知识、报告、Finding、JobRun | 所属模块 | 本地存储 | 否 | 仅经 UseCase。 |
| UI 导航/能力可见性 | module catalog 安全投影 | JSON/生成文件 | 是 | 否。 |

### 13.8 对实施路线的影响

- 保留 M0、M1、M2：基线、共享内核、usage 样板。
- M3 先迁 agent-directory、usage/projects，再建立 insights/dashboard。
- 原 M4 扩展为 JobType + Schedule + JobRun runtime，且必须先于 distillation、reports、monitor 和 optimization。
- 安全先实现 assessment；monitor 等待真实可授权事件源。
- 市场/Skill 拆为 catalog 与 distribution，在 knowledge 资产流稳定后接入。
- 原 task UI 只展示 Job/Schedule；业务模块各自拥有模板、范围选择和审批 UI。

### 13.9 自检增补

已修正：将原型的“Agent 编排”识别为生态目录/迁移；将日报、周报、蒸馏、巡检升级为可恢复 Job；将 AI 推理、脱敏、fallback、成本显式纳入；将“实时防御”拆为评估与观察。

待确认：

1. 蒸馏的模型供应商、数据发送范围、成本/延迟预算和审批级别。
2. 运行时防御的真实事件源及允许动作：告警、阻止本应用操作，或 Hook/代理级阻断。
3. 开源版是否提供在线 Skill 市场目录；本方案默认离线/缓存优先。
4. 报告和记忆是否需要多用户共享；本方案按单用户本地资产设计。
