# TrustTools 页面加载性能诊断与架构调整方案

> 生成日期：2026-08-18
> 依据：全站路由 loader 链路追踪 + 本机（Windows + WSL Ubuntu-20.04）实测
> 范围：所有 14 个路由页面的服务端数据链路、共享扫描器、缓存体系

---

## 一、问题本质

所有页面都在 **TanStack Start SSR 路由 loader 内同步阻塞**：loader 完成前页面不渲染。而 loader 依赖的
本机数据链（用量/会话/Skill 扫描、项目分类、安装探测）**绝大部分没有缓存或 TTL 过短**，导致"每次打开
页面都在重算一遍全量数据"。实测单页 10–21 秒，全部消耗在服务端文件系统工作上，与网络无关。

---

## 二、页面 × 成本总览（实测/代码推算）

| 页面 | loader 内服务端工作 | 缓存 | 成本（实测） | 风险 |
|---|---|---|---|---|
| `/` 首页 | `loadDashboardReadModel`：用量扫描 + 会话扫描 + Skill 扫描 + 安装探测 + **项目分类** + 组合根计数 | 仅用量快照 30s TTL；其余全无 | 热 ≈5.5s（分类）/ 快照过期 10–21s | **高** |
| `/agents` 工具概览 | `getSkillWorkspace` + 上述整条 dashboard 链 | 同上 | 同首页 | **高** |
| `/skills` | dashboard 链 + `getMarketSkills`（轻）+ `getDistillationQuery`（→ 1 次会话扫描） | 同上 | 同首页 + 0.75s | **高** |
| `/tracker` | `getTrackerQuery` → 用量快照 + 3× 内存聚合 | 30s 快照 | 命中 ≈0s / 过期 5–15s | 中 |
| `/sources` | 用量快照 + **2× 安装探测** + Skill 扫描（内部再 1× 探测） | 仅 30s 快照 | 命中 ≈0.8s / 过期 10s+ | **高** |
| `/chats` 列表 | `getSessionsQuery` → `scanLocalSessions` 全量 | **无**（每次筛选/翻页都重扫） | 0.75s+（随会话量线性增长） | **高** |
| `/chats/$id` 详情 | **2× 并发全量会话扫描** + transcript 全目录走查 | 无 | 1.5s+ | **高** |
| `/reports` | 报表文件读 + **`loadSessionDensity` 1–10× 全量会话扫描** | 无 | 会话 >100 时 0.75–7.5s+ | **高** |
| `/distill` | 组合根（缓存命中）+ **1× 会话扫描** + 小文件 | 组合根缓存；会话无 | 0.75s+ | 中 |
| `/security` | loader 空；客户端全量 Skill 发现 1 次；450ms 轮询仅扫描中且零 IO | 无（发现/历史） | 页面打开 ≈0.3s | 中 |
| `/memory` | loader 空；客户端 N+1 串行小文件读 | 无（文件很小） | 几十 ms | 低 |
| `/widget` | 客户端 `useWidgetData`：**每 30s 拉一次完整 dashboard 链** + 每 30s 安全历史 | 无独立缓存 | **常驻时每 30s 重算 5.5s+ 分类与全部扫描** | **高（放大器）** |
| `/settings` | `readStorageUsage`：**串行递归**目录走查 | 无 | 本机 4ms（数据少）/ 目录增长后秒级 | 中低 |
| root loader | `getRatesSnapshot`：1h 文件缓存 + 30s 内存，过期时网络（10s 超时） | 有 | 通常 <50ms | 低 |

### 实测关键数字（本机）

| 环节 | 实测 | 缓存 |
|---|---|---|
| `scanLocalUsage` 热扫描 | 4.8s（无文件变化、OS 缓存热）～15.2s（WSL 唤醒 + 日志变化） | 30s 内存 TTL + v10 持久索引（仅免解析、不免走查） |
| `scanLocalUsage` 冷扫描（索引失效） | 14.9s | — |
| WSL 探测（`discoverWindowsWslHomes` ×2） | 发行版空闲唤醒 3.5–3.9s / 热 150ms | **无** |
| `classifyDashboardProjectRefs`（130 路径） | **5.1–5.6s（稳定）** | **无** |
| `scanLocalSessions` 全量 | 0.18–0.75s | **无** |
| `scanLocalSkills`（含目录走查 + 逐 skill 全文件测量） | 0.41s | **无** |
| `detectToolInstallations`（30 工具） | 0.36s | **无**，每页重复 2–3 次 |
| `scanLocalSessions` 明细聚合 / tracker 聚合 | 36ms | 纯内存 |
| 组合根 `getCompositionRoot` | 16ms（冷）→ 重复 ≈0ms | 模块级 + globalThis 双缓存单例 |
| 组合根下每个 store 读 | 2–7ms（建锁文件 + 读文件 + zod 校验） | **无** |
| 安全引擎（20 文件） | 224ms | 仅扫描中轮询（零 IO） |

---

## 三、架构级根因（按影响力排序）

1. **缺乏统一的数据缓存层**。全库只有用量快照（`src/lib/local-usage/snapshot.server.ts`）具备
   "TTL 内存缓存 + single-flight 去重"模式。sessions / skills / detection / classification / storage
   全部裸扫描，且互相零复用。这是所有页面慢的根源。

2. **同一份数据在同一页面内被反复重算**。
   - `detectToolInstallations(AI_TOOLS, homedir())`：`/sources` 一页 2 次（`getUsageSources` +
     `scanLocalSkills` 内部），dashboard 链 1 次 → 每页 2–3 次相同探测；
   - `getLocalSkills`：`/agents` 一页 2 次（`getSkillWorkspace` + `loadDashboardReadModel`）；
   - `scanLocalSessions`：dashboard → `/chats` → `/chats/$id` 导航链最多 **5 次**独立全量扫描；
     `/reports` 的密度聚合按页循环调用，会话 >100 时 **最多 10 次**全量重扫
     （`src/modules/reports/api.server.ts` `loadSessionDensity` L44–85 → `sessions.query` 每页
     `repository.list()` 全量 `scanLocalSessions`）。

3. **WSL 探测内嵌于用量扫描且无缓存**（`scanner.server.ts` `discoverWindowsWslHomes`）。
   每次扫描必然并行 2 次 `wsl.exe -l -q` + 每发行版一次 `wsl.exe -d … sh -lc`；发行版空闲后首次
   调用 3.5–3.9s 唤醒。任何页面在快照过期后打开都连带付出。

4. **项目分类是 dashboard 独有热点且无缓存**（`project-classification.server.ts`）。
   130 个唯一项目路径 × 祖先链 marker 探测（6 marker + `.git` 解析 + 子树 bounded 走查），
   稳定 5.5s，被 `/`、`/agents`、`/skills` 三页共享，且 widget 每 30s 重算。

5. **widget 30s 轮询与快照 30s TTL 同频共振**（`widget-data.ts` `REFRESH_INTERVAL_MS=30_000`）。
   浮窗/托盘常驻时，服务端处于"扫描 → 过期 → 再扫描"的持续循环，多实例各持一份 interval；
   用户打开任何页面都撞上扫描。

6. **Electron 每次启动先做全量 loader 预热**（`electron/main.ts` `prewarmLocalData`，最多等 30s）
   才显示窗口——启动即扫描，30s TTL 过后首次导航再次扫描。

7. **客户端无缓存层**：全项目未用 TanStack Query（无 `staleTime`），页面级 fetch（security/memory/
   widget）每次挂载重拉；路由 loader 无 stale-while-revalidate、无 loaderMaxAge 配置。

8. **次要项**：`readStorageUsage` 串行递归 + 无缓存；组合根 store 读无内存缓存（`resolveOutputAvailability`
   每页 3 次文件读 ≈30ms）；安全"每日 10 次 AI 审查上限"（`src/lib/security/daily-limit.ts`
   `consumeDailyScan`）是死代码，从未在扫描路径调用。

---

## 四、架构调整方案

### 第 0 层：统一缓存基础设施（所有后续改动的底座）

**新增 `src/lib/cache/async-ttl.ts`**，实现与 `snapshot.server.ts` 同构但通用的：

```ts
export interface TtlCacheOptions { ttlMs: number; negativeTtlMs?: number }
export function cachedAsync<T>(key: string, load: () => Promise<T>, opts: TtlCacheOptions): Promise<T>
export function invalidateCache(key: string): void
export function invalidateCacheByPrefix(prefix: string): void
```

- 语义：TTL 内命中直接返回；未命中时 **single-flight**（并发请求共享同一个在途 Promise）；支持
  negative cache（探测失败短时间不再重试，如 WSL 不可用）；`invalidate*` 供 POST 刷新动作调用。
- 键规约：`${scope}:${version}:${JSON.stringify(arguments)}`（如 `wsl-homes:v1:win32`、
  `detect-tools:v1:${homedir}`），版本号随探测逻辑变化递增。
- 全部缓存挂在模块级变量（进程内），与现有 `snapshot.server.ts` 一致；测试用
  `resetCaches()` 清空。

### 第 1 层：五个 P0 改造（解决约 90% 痛点，预计单页 10–21s → 0.5–2s）

**P0-1 会话快照缓存（收益最大）** — 新增 `src/lib/local-sessions/snapshot.server.ts`，
包装 `scanLocalSessions`（TTL 30–60s + single-flight），并把三个入口统一走缓存：
- `src/modules/sessions/infrastructure/legacy-session-adapter.server.ts` 的 `list()`
- `src/modules/dashboard/api.server.ts` 的 `scanDashboardSessions`（L48–55）
- `src/modules/distillation/api.server.ts`（经 sessions 端口间接受益）

一处改动同时消除：`/chats` 每次筛选重扫、`/chats/$id` 2× 并发重扫、dashboard 每次会话扫描、
`/distill` 整页扫描、`/reports` 密度聚合 1–10× 重扫放大（`loadSessionDensity` L44–85）。
刷新动作（`refreshSessionsQuery` / resume 前校验）走 `invalidateCache` 后重扫。

**P0-2 项目分类缓存** — `src/modules/dashboard/project-classification.server.ts`：
- `classifyDashboardProjectRef` 结果按 `(home, ref)` 内存 TTL 缓存（5 分钟）；
- `classifyDashboardProjectRefs` 内部先查缓存再补缺失项；
- 失效时机：无显式失效必要（目录 marker 变化极低频），TTL 到期自然过期；
  如担心新鲜度，可随 `refreshLocalUsageSnapshot` 一并失效。

预期：130 路径 5.5s → 首次 5.5s、其后每次打开 ≈0s。

**P0-3 安装探测与 Skill 扫描缓存 + 注入去重**：
- `src/lib/tools/detection.server.ts` 外层加 `cachedAsync("detect-tools:v1:${home}", …)`，TTL 60s；
  键含 `PATH` 摘要，避免 PATH 变化后误命中；
- `src/lib/local-skills/scanner.server.ts` `scanLocalSkills` 增加可选参数
  `installationFacts`（已探测结果注入），消除 `getUsageSources` 与 `scanLocalSkills` 页内 2× 重复；
- `scanLocalSkills` 结果按既有 `fingerprint`（sha256）做 TTL 缓存（TTL 60s + fingerprint 不一致即失效）；
  `measureSkillDirectory` 的全文件读取成本随之消除。

**P0-4 WSL 探测缓存** — `scanner.server.ts` `discoverWindowsWslHomes`：
- 结果按 `wsl-homes:v1` 缓存，TTL 5–10 分钟；
- 失败（无发行版 / 命令异常）negative cache 30–60s；
- 两个 provider（`.claude` / `.codex`）合并为一次 `wsl.exe -l -q` + 每发行版一次 HOME 查询，
  结果同时供两条链使用；
- 仅当用量快照缓存过期（真正要扫描）时才执行探测，避免探测本身成为常驻负载。

预期：发行版休眠唤醒 3.5s+ → 绝大多数扫描命中缓存 ≈0.15s。

**P0-5 widget 轮询单例化并共享缓存** — `src/modules/widget/presentation/widget-data.ts`：
- 30s interval 改为**模块级单例调度器 + 引用计数**（最后一个订阅者离开才停表），消除多实例 N 份轮询；
- 轮询结果天然命中 P0-1/P0-2/P0-3 缓存（dashboard 链），不再每 30s 重算分类与扫描；
- `use-security-scan-overview.ts` 的第二个 30s interval 并入同一 tick；
- 轮询周期与快照 TTL 解耦（快照 TTL 提升后轮询命中率自然上升）。

### 第 2 层：P1 改进（进一步消除重复与阻塞）

**P1-1 用量快照 TTL 分级** — `snapshot.server.ts` `getCachedLocalUsageSnapshot` 增加
`maxAgeMs` 入参：tracker/sources 用 120s，dashboard 用 30–60s；配合组合根后台 `usage.refresh`
调度任务（`composition.server.ts` L419，现默认 disabled）启用主动续鲜，页面打开尽量命中。

**P1-2 `/reports` 密度单遍扫描** — `src/modules/reports/api.server.ts` `loadSessionDensity`：
不再按页循环 `sessions.query`，改为一次取全量摘要（复用 P0-1 缓存 + 单次 `scanLocalSessions`）
后内存聚合；`loadReports` 只读一次 `reports.v1.json`（listReports/listRuns 共享同一份文档）。
顺带让 `src/modules/sessions/application/index.ts` `createSessionQueryService.query`（L71–94）
不再每页 `repository.list()` 全量重扫（分页在内存全量上做）。

**P1-3 路由 loader 不阻塞首屏**：
- 路由 loader 增加 `loaderMaxAge`（如 30–60s），客户端导航在窗口内直接复用 loader 结果；
- 对重页面（`/`、`/agents`、`/skills`）采用 stale-while-revalidate：loader 先返回缓存快照
  （含 `generatedAt` 旧时间戳 + `stale: true` 标记），页面立即渲染，客户端再调 POST 刷新
  服务端缓存，下次打开即新数据；配合各页面已有的"手动刷新"入口。

**P1-4 settings 存储用量** — `prune.server.ts` `readStorageUsage`：`directorySize` 改为有界并发
遍历（`Promise.all` 每层限并发 32），结果 TTL 缓存 60–120s（清理/保留动作后失效）。

### 第 3 层：P2 优化（低成本收尾）

- **P2-1** 启用客户端缓存：security / memory / widget 页面引入 TanStack Query（`staleTime: 30–60s`），
  避免每次挂载重拉；SSR 页面不引入，避免水合复杂度。
- **P2-2** 组合根 store 读加内存缓存：`node-atomic-json-store.ts` `read()` 加短 TTL（如 5s）+ 写入失效，
  消除 `resolveOutputAvailability` 每页 3 次文件读（≈30ms）与 knowledge N+1 读。
- **P2-3** 安全功能修复（非性能）：把 `consumeDailyScan`（`src/lib/security/daily-limit.ts`）接进
  `SecurityScannerService.start()`（`electron/security-scanner-service.ts`），落实"每日 10 次"上限；
  安全页 `listSkills()` 发现结果按目录 mtime 缓存。
- **P2-4** Electron prewarm：保留（受益于所有缓存），但把 30s 等待改为"缓存就绪即返回"，避免启动
  阻塞窗口显示；prewarm 请求命中已有持久索引时通常 <2s。

---

## 五、实施顺序与预期收益

| 阶段 | 改动 | 预计投入 | 预期收益 |
|---|---|---|---|
| P0-1 | 会话快照缓存 | 0.5–1 天 | `/chats` 0.75s→~0、`/reports` 10×→1×、详情页 2×→1×，dashboard/distill 共享 |
| P0-2 | 项目分类缓存 | 0.5 天 | 三页共享的 5.5s → ~0 |
| P0-3 | 探测/Skill 缓存 + 注入去重 | 0.5 天 | `/sources` 0.8s→~0.1s，消除页内 2× 重复 |
| P0-4 | WSL 探测缓存 | 0.5 天 | 扫描 3.5s+ → ~0.15s |
| P0-5 | widget 单例轮询 | 0.5 天 | 消除常驻后台扫描循环 |
| P1-1/2 | TTL 分级 + reports 单遍 | 0.5–1 天 | 命中率提升，放大消除 |
| P1-3 | loader 非阻塞 | 1 天 | 首屏渲染不再等待扫描 |
| P1-4 | settings 并发 + 缓存 | 0.5 天 | 目录增长后仍 <100ms |
| P2 | 收尾项 | 1 天 | 内存/功能收尾 |

**总体验收标准**：缓存命中时所有页面 loader <1s；widget 常驻时后台无持续扫描；冷启动（缓存失效）
全量重算只发生在显式刷新或 5 分钟级后台任务，不再阻塞任何页面打开。

---

## 六、验证方法

1. 恢复 `scripts/measure-load*.mts` 类计时脚本，逐项对比：`scanLocalUsage`（热/冷）、
   `scanLocalSessions`、`scanLocalSkills`、`detectToolInstallations`、`classifyDashboardProjectRefs`、
   `loadDashboardReadModel` 端到端；
2. 页面级验收：连续打开 `/` → `/agents` → `/skills` → `/chats` → `/chats/$id` → `/reports` 各两次，
   记录第二次（缓存命中）耗时；观察 widget 浮窗开启时 `wsl.exe` 进程出现频率（应大幅下降）；
3. 回归：`npm run lint`、`npx tsc --noEmit`、`npm run test:e2e`、既有 node:test 单测
   （缓存层需补 `*.test.ts`：TTL 命中、single-flight、invalidate、negative cache）。

---

## 七、风险与注意事项

- **缓存失效正确性**：所有缓存键必须含版本与关键参数（homedir/PATH/registry fingerprint），
  注册表定义变更（`REGISTRY_FINGERPRINT`）后探测/扫描缓存须一并失效；
- **并发去重是缓存的一部分**：single-flight 必须覆盖"过期瞬间的并发请求"，否则高峰期仍会重复扫描；
- **内存上限**：缓存值均为聚合后的 DTO（非原始事件），单条目 KB 级；仍建议给缓存总条目设上限
  （如 1k 条）防异常增长；
- **widget 与桌面端**：`widget-data.ts` 改动影响 Electron 浮窗/托盘，需回归桌面 IPC 路径；
- **不要动**：`snapshot.server.ts` 30s TTL 的并发去重语义（测试依赖）、持久索引格式
  （`local-usage-index-v10.json` 升级需按 `PERSISTENT_CACHE_VERSION` 流程走）、
  `*.server.ts` 命名约定与动态 import 模式。
