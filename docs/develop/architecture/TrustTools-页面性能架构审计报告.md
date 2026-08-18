# TrustTools 页面性能架构审计报告

| 属性 | 值 |
|------|-----|
| 文档类型 | 架构审计报告 (ARCH-AUDIT) |
| 项目名称 | TrustTools |
| 版本 | v1.2 |
| 创建日期 | 2026-08-18 10:59:43 |
| 更新日期 | 2026-08-18 11:15:27 |
| 生成工具 | architecture-audit |
| 文档状态 | 已批准 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v1.2 | 2026-08-18 11:15:27 | 用户确认目标架构、公共运行时策略及默认周期，审计门禁转为通过。 |
| v1.1 | 2026-08-18 11:07:59 | 补充运行时新鲜度、刷新周期和缓存策略分散的审计结论。 |
| v1.0 | 2026-08-18 10:59:43 | 完成代码、构建产物、运行数据与现有架构方案的性能专项审计。 |

---

## 1. 审计结论

当前页面性能问题不是单一的“缺缓存”，而是数据读取链路、读模型、后台任务和浏览器构建边界共同造成的系统性问题。核心结论如下：

1. 页面 loader 仍直接触发文件系统遍历、子进程探测、项目分类和网络请求，违反现有架构中“页面读取快照、扫描在后台执行”的约束。
2. Dashboard 读模型同时返回原始 `snapshot` 和包含事件的 `v2` 数据。以当前本机 6,227 条事件计，最小 JSON 约 5.15 MB，远高于合理的本地页面载荷。
3. 项目已经具有持久化 `UsageApplication`、原子快照存储和任务调度器，但 Dashboard、Skills、Sources、Widget 等仍走旧的进程内缓存或裸扫描，形成两套事实读取语义。
4. `withBudget` 只停止等待，没有取消底层扫描；超时任务会继续占用 I/O，并可能与下一次扫描重叠。
5. 浏览器构建图仍包含 `*.server.ts`/Node 侧依赖。构建产物出现公开的 `composition.server` chunk 和大量 Node 模块 browser externalization 警告。
6. 根路由汇率读取在缓存过期时可能进行最长 15 秒的网络请求，使任意页面都可能受到远程网络影响。

因此，不建议把 `performance-architecture-plan.md` 中的通用 `cachedAsync(JSON.stringify(args))` 直接作为最终架构。它可以短期降低重复调用，但会形成第三套缓存语义，并掩盖数据所有权、失效、并发、取消和载荷设计问题。

## 2. 审计范围与方法

### 2.1 范围

- `src/routes`、`src/modules`、`src/lib/local-*`、任务运行时、Electron 本地服务器与启动流程。
- `docs/develop/architecture` 下现有架构设计与 ADR。
- `docs/develop/performance-architecture-plan.md` 的假设、建议和 API 准确性。
- TypeScript 校验、架构门禁、Vite 客户端/SSR 构建及本机真实数据基准。

### 2.2 验证结果

| 检查 | 结果 | 说明 |
|------|------|------|
| `npx tsc --noEmit` | 通过 | 当前类型检查可通过。 |
| `npm run verify:architecture:blocking` | 失败 | 发现 15 项模块深层导入；当前代码与 ADR-006 所述空迁移基线不一致。 |
| `npx vite build` | 通过但有风险警告 | 2,903 个客户端模块；存在 server/Node 依赖进入浏览器图、API 弃用和大 chunk。 |
| 本机热/冷读取基准 | 已执行 | 使用当前真实数据，结果见 §3。 |

本报告中的时间是单机样本，不用于承诺跨设备绝对值；数据规模、重复工作和载荷字节数可直接用于判断架构风险。

## 3. 关键证据

### 3.1 当前真实数据读取成本

| 操作 | 首次 | 再次 | 数据量/备注 |
|------|------|------|-------------|
| Usage 扫描 | 8,446 ms | 0 ms | 6,212 条事件；第二次命中现有 30 秒内存缓存。 |
| Session 扫描 | 631 ms | 610 ms | 9 个会话；无读取缓存。 |
| Skill 扫描 | 504 ms | 472 ms | 12 个 Skill；无读取缓存。 |
| 工具安装探测 | 354 ms | 413 ms | 30 个工具；无读取缓存。 |
| 项目分类 | 1,691 ms | 1,166 ms | 6,224 个引用、132 个唯一引用；无缓存。 |

Usage 热缓存掩盖了其他重复扫描。Session、Skill、工具探测、WSL 探测和项目分类在页面或刷新链路中仍会重复执行。

### 3.2 Dashboard 载荷重复

使用当前 6,227 条事件对读模型进行 JSON 序列化，得到：

| 对象 | 字节数 |
|------|--------|
| Usage 原始对象 | 2,153,691 |
| Dashboard `snapshot` | 1,893,039 |
| Dashboard V2 | 3,261,185 |
| 当前读模型两者合计下限 | 5,154,243 |

该读模型随后还被 `/skills`、`/agents` 和 Widget 等消费者复用。`/skills` 在 `showToolOverview={false}` 时仍加载完整 Dashboard 数据，属于明确的无效 I/O 和序列化。

### 3.3 浏览器端重复计算

`createDashboardV2View` 在本机当前数据上的单次纯计算耗时：

| 时间范围 | 耗时 |
|---------|------|
| 今天 | 146.18 ms |
| 7 天 | 232.92 ms |
| 30 天 | 229.93 ms |
| 全部 | 264.17 ms |

Dashboard 初次渲染会计算多个相似视图；Widget 会计算四个时间范围，单轮约 0.87 秒以上。即使服务器读取变快，主线程仍会被大对象反序列化与重复聚合阻塞。

### 3.4 构建产物与边界

主要客户端产物的 raw/gzip 大小：

| 产物 | Raw | Gzip |
|------|-----|------|
| `createLucideIcon-*.js` 命名共享块 | 445,480 B | 148,417 B |
| `ComposedChart-*.js` | 400,943 B | 103,357 B |
| 主 `index-*.js` | 292,806 B | 91,135 B |
| 主 CSS | 163,938 B | 26,005 B |
| `composition.server-*.js` 客户端公开块 | 136,731 B | 41,338 B |

构建日志还显示 `fs`、`path`、`child_process` 等 Node 模块被 externalize。可见的触发点包括：

- `src/lib/version-check.ts` 静态导入 `version-check.server`。
- Sources presentation 直接导入和导出 `../api.server`。
- 多个模块 barrel 同时导出 contracts、application、presentation、query，扩大了客户端可达图。

## 4. Findings

### P1：页面读取路径执行重型扫描和网络 I/O

- **影响**：首次打开或缓存失效时，页面可能等待数秒；数据增长后延迟近似线性增加。
- **证据**：Usage 冷扫描 8.4 秒；项目分类另需 1.2–1.7 秒；根路由汇率刷新可等待 15 秒。
- **与架构的冲突**：现有架构已规定 Dashboard/Sources 读取快照、页面打开不得扫描。
- **建议**：loader 只读取最近一次可用快照和紧凑投影；扫描、分类、网络刷新统一进入任务执行器。

### P1：Dashboard 读模型携带并重复原始事件

- **影响**：服务器序列化、HTTP 传输、SSR 注水、浏览器解析、内存和 React 计算同时放大。
- **证据**：当前最小 JSON 约 5.15 MB；同一模型被不需要明细的 Skills 页面复用。
- **建议**：原始事件保持 server-only；为 Dashboard、Agents、Skills、Widget、Sources 分别提供页面专用读模型。

### P1：存在两套权威读取链路

- **影响**：相同事实可能有不同新鲜度、错误状态和刷新行为；继续添加通用 TTL 会形成第三套语义。
- **证据**：持久化 `UsageApplication`/AtomicJsonStore/任务运行时已存在，但主要页面仍使用 legacy snapshot 或直接 scanner。
- **建议**：以领域快照协调器为唯一读取入口，计划、启动、手动刷新都调用同一 refresh use case。

### P1：超时不等于取消

- **影响**：页面已经返回错误后，底层扫描仍持续执行；下一次请求可再次启动工作，造成磁盘、WSL 子进程和 CPU 竞争。
- **证据**：现有 budget 实现采用 Promise race，scanner 未接收或传播 `AbortSignal`。
- **建议**：从任务到目录迭代、文件读取和子进程完整传播取消；超时必须终止可终止资源。

### P1：浏览器/服务器模块边界泄漏

- **影响**：客户端 chunk 膨胀、运行时行为依赖打包器兼容桩，并增加渲染进程意外触达服务端实现的风险。
- **证据**：公开 `composition.server` chunk、Node externalization 警告、presentation 静态导入 server 文件。
- **建议**：建立 browser-safe RPC 入口和严格 server-only 入口；CI 对相关构建警告与产物名称设阻断门禁。

### P1：Reports 查询可能重复全量 Session 扫描

- **影响**：分页密度统计最多循环 10 页，而 repository 每次 `list` 都重新扫描本地会话，延迟随页数放大。
- **建议**：一次读取 SessionSnapshot 后完成投影；分页只对快照或索引查询。

### P2：工具、Skill、WSL 和项目分类缺少可控的事实缓存

- **影响**：重复路径探测、`wsl.exe` 调用、目录测量和分类读取；大量 `Promise.all` 缺乏全局 I/O 预算。
- **建议**：将 WSL 拓扑与安装探测作为小型事实快照；分类按唯一引用和指纹增量更新；增加有界并发。

### P2：Widget 轮询完整模型并重复聚合

- **影响**：每 30 秒产生大载荷和约 0.87 秒纯计算；每个 renderer/window 有独立定时器。
- **建议**：轮询轻量 revision/status；仅在 revision 变化时获取预聚合的 WidgetReadModel，并在页面不可见时降频或暂停。

### P2：Knowledge 列表存在 N+1 本地存储读取

- **影响**：列出资产后逐项 `get`，而 AtomicJsonStore 每次加锁、读文件和解析，数据增长后退化。
- **建议**：提供批量 repository 查询或写后同步的 read-through state，避免在通用存储层盲目增加 TTL。

### P2：性能方案中的部分事实和 API 已过期

- **证据**：Electron 预热目前已在主窗口创建后异步执行；会话详情当前不再并发双扫描；TanStack Router 当前使用 `staleTime`、`gcTime`、`preloadStaleTime` 和 `staleReloadMode`，不是文档中的 `loaderMaxAge`。
- **影响**：按旧结论实施会投入到已修复问题，或引入无效配置。
- **建议**：由本次设计文档替代其目标架构部分，原文保留为历史分析输入。

### P2：现有架构门禁和 ADR 基线不一致

- **证据**：blocking 校验报告 15 项模块深层导入，但 ADR-006 描述当前迁移基线为空。
- **影响**：门禁不能可靠表达“不得新增”还是“必须清零”，架构状态不可审计。
- **建议**：修复依赖后更新基线；CI 中保持 blocking，不以扩大 allowlist 消除告警。

### P2：缺少可回归的性能预算和诊断

- **影响**：优化只能依赖主观体验；载荷、扫描次数和主线程计算的回退不会被 CI 发现。
- **建议**：记录 loader、projector、collector phase、序列化字节数、扫描文件数和缓存命中；建立脱敏 fixture 基准与 bundle budget。

### P2：运行时策略常量分散且语义混杂

- **影响**：维护者无法从一个位置判断“数据多久算旧”“任务多久执行”“失败后多久重试”；修改一个周期可能漏掉另一层缓存，形成难以解释的有效行为。
- **证据**：任务周期位于 `job-catalog.json`，汇率新鲜度位于 `dynamic.server.ts`，汇率进程内读取 TTL 位于 `server-fns.ts`，Skill 市场证据 TTL 又位于 Skill scanner。
- **建议**：建立唯一、可校验的人类可读运行时策略源；集中声明领域新鲜度、默认刷新计划、超时、重试和资源预算。UI debounce、动画时长和错误去重等局部实现参数不进入该文件。

## 5. 对原性能分析的采纳与修正

| 原建议 | 结论 | 修正 |
|--------|------|------|
| 对扫描增加缓存和 single-flight | 部分采纳 | single-flight 必须由统一 refresh use case/任务持有；页面不直接调用 scanner。 |
| 通用 `cachedAsync` | 不作为主架构 | 只可用于 WSL/安装探测等小型 discovery fact，并要求容量、负缓存、时钟注入和指标。 |
| Session/Skill/Detection TTL | 调整 | 统一为持久化快照的新鲜度策略，页面即使 stale 也立即返回。 |
| Widget 单例 | 调整 | 模块单例不能跨 Electron renderer；改为服务器共享 revision + 客户端 Query 去重。 |
| Route `loaderMaxAge` | 更正 | 使用当前 Router 的 `staleTime`、`gcTime`、`preloadStaleTime`、`staleReloadMode`。 |
| React Query | 有条件采纳 | 只管理客户端交互、轮询和 mutation；同一数据不能同时由 Router 与 Query 双重拥有。 |
| 启动预热后移 | 已实现 | 保持非阻塞，不再作为待实施主项。 |

## 6. 风险排序与处置顺序

| 顺序 | 风险 | 处置原则 |
|------|------|----------|
| 1 | 大读模型与无效页面依赖 | 先缩小载荷和客户端计算，收益最大且迁移风险较低。 |
| 2 | loader 重型 I/O/网络 | 让所有页面只读快照；缺快照也返回壳层并后台刷新。 |
| 3 | 双读取链路 | 统一到持久化领域快照和任务 refresh use case。 |
| 4 | 取消、并发和重复扫描 | 增加真实取消、资源预算、索引和增量分类。 |
| 5 | browser/server 边界与 chunk | 修正入口、路由拆分并建立构建门禁。 |
| 6 | 可观测性和长期预算 | 每阶段同时加入验证，最终删除 legacy 路径。 |

## 7. 审计门禁结论

**结论：通过目标架构设计；不建议直接执行现有 `performance-architecture-plan.md`。**

用户已于 2026-08-18 确认：首次无快照先显示壳层并后台采集、允许保存脱敏聚合快照和 revision、保留自定义日期并使用日 buckets、采用分阶段迁移，以及统一公共运行时策略和默认刷新周期。

对应目标架构见《TrustTools 页面性能架构设计文档》，执行任务见 `docs/develop/plan/TrustTools-页面性能优化-敏捷任务清单.md`。
