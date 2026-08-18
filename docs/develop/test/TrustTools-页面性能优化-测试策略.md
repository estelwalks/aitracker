# TrustTools 页面性能优化 — 测试策略（P7-T7-01）

| 属性 | 值 |
|------|-----|
| 文档类型 | 测试策略 (TEST-STRATEGY) |
| 项目名称 | TrustTools |
| 版本 | v1.0 |
| 创建日期 | 2026-08-18 |
| 关联 | TrustTools-页面性能优化-敏捷任务清单.md（G0~G7）、ADR-009 |

## 1. 测试目标

性能优化的验证不以"能跑"为终点，而是以证据门禁为准：载荷字节、扫描/请求次数、并发峰值、取消残留、结果正确性与浏览器边界在每次提交与发布阶段都被自动校验。

## 2. 风险 — 测试层 — Gate 追踪矩阵

| 风险 | 等级 | 测试层 | Gate | 覆盖位置 |
|------|------|--------|------|----------|
| 聚合算法迁移导致数字不一致 | 高 | Unit/Contract | G1/G7 | `summary-projector.test.ts`、`shadow-compare.test.ts`（金标差异=0） |
| 首次空态体验被误判为没数据 | 中 | E2E | G4 | 页面 empty/stale 状态；`snapshotStatus` 进 DTO |
| 快照 schema 演进损坏旧数据 | 高 | Integration | G2/G7 | `coordinator.test.ts` 损坏恢复、`usage-envelope.server.test.ts` copy-forward |
| 任务默认未启用导致数据长期 stale | 高 | Integration | G3 | scheduler 默认启用测试（usage/skills/sessions/exchange） |
| 取消传播不完整 | 高 | Unit/Integration | G5 | `abort.test.ts`、collector signal 贯穿目录循环 |
| 资源预算突破/泄漏 permit | 高 | Unit | G5 | `resource-budget.test.ts`（1/16/8、中止释放、幂等） |
| 汇率离线/过期行为错误 | 高 | Unit | G3 | `exchange-rate.test.ts`（23:59 不发网、24:00 后台、LKG） |
| 浏览器/server 边界回归 | 高 | Build | G6 | `verify-browser-server-boundary.mjs`、`verify-bundle-budget.mjs` |
| DTO 超预算/含敏感字段 | 高 | Contract | G1/G7 | `verify-read-model-budgets.mts`、`measure.test.ts` 禁止字段 |
| 生成物漂移 | 中 | Contract | G0 | `verify-runtime-policy.mjs`、`verify-job-catalog.mjs` |
| 架构门禁基线漂移 | 中 | Build | G0/G6 | `verify-module-boundaries.mjs --blocking`（当前 0 违规） |

## 3. 测试层次

### 3.1 Unit（`node --import tsx --test`）

- 策略 schema 边界：未知字段/负值/越界/重复任务/未登记 executor（`runtime-policy.schema.test.ts`，10 项）。
- rollout 合法迁移：单调前进、仅回退 legacy、kill switch 优先级（`performance-rollout.test.ts` + repository 测试，13 项）。
- projector：金标一致性（四窗口 totals/trend/models/projects/comparison）、日 buckets 求和、缓存命中、revision 失效、250 KB 预算（`summary-projector.test.ts`，6 项）。
- 状态机：hydrate 单次、single-flight、LKG、abort-before-commit、损坏恢复、stale 可读、invalidate（`coordinator.test.ts`，11 项）。
- 取消与预算：withTimeout user/timeout 区分、dispose；semaphore 1/16/8、中止等待、幂等 release（`abort.test.ts` 5 项 + `resource-budget.test.ts` 7 项）。
- 汇率：23:59 cache、24:00+ stale→后台、离线 LKG、无缓存 fallback（`exchange-rate.test.ts` 5 项）。
- WSL 拓扑：非 Windows 空、失败降级、UNC 根（`wsl-topology.server.test.ts` 4 项）。
- Knowledge 批量：listLatest cursor 分页、50/100 上限（`repository.test.ts` 2 项）。

### 3.2 Contract

- 生成物漂移：`verify:runtime-policy`、`verify:job-catalog`、`verify:module-catalog`。
- DTO 禁止字段/容量：`verify-read-model-budgets.mts`（4 个 fixture，断言 forbidden=0 / rawEvents=false / ≤250 KB）。
- 任务 ID 映射：`contracts.test.ts` 校验 7 个任务定义。

### 3.3 Integration

- Usage envelope：copy-forward 一次、旧文件零写入、损坏回退、失败 LKG（`usage-envelope.server.test.ts` 7 项）。
- composition：`composition.server.test.ts`、`composition.integration.test.ts`（含 rollout repository 接线）。
- scheduler：single-flight、重试、默认启用（`scheduler.test.ts`、`task-api.test.ts`）。
- 汇率刷新任务：executor-registry 绑定 exchange（`executor-registry/index.test.ts`）。

### 3.4 Performance

- 固定脱敏 fixture（empty/small/current-scale/10x，`npm run perf:fixtures`）。
- 统一基准（`npm run perf:benchmark` → `docs/develop/test/baselines/*.json`）：git SHA、环境、fixture hash、P50/P95/P99、DTO 字节。
- 预算：`tests/performance/budgets.v1.json`（DTO 250/150 KB、loader P95 150 ms、并发 1/16/8、bundle 250/120/40 KB gzip）。

### 3.5 Build

- `npm run prebuild`（生成器）、`verify:architecture:blocking`、`verify:browser-server-boundary`、`verify:bundle-budget`、`tsc --noEmit`、`npm run build`、`npm run build:electron`。

### 3.6 E2E（Playwright）

计划补充：无快照、stale、刷新失败、离线汇率、WSL 不可用、多窗口 Widget、SSR/hydration、lazy chunk 错误。

## 4. 覆盖率目标

- 核心状态/调度逻辑 ≥ 90%（coordinator、refresh use case、resource budget）。
- 投影与数据转换 100%（金标断言）。
- 边界值 100%（策略 schema、汇率时间边界、rollout 迁移）。
- 异常分支 ≥ 80%（collector 失败、写失败、取消、损坏文件）。

## 5. 门禁分层

| 层 | 阻断项 | 工具 |
|----|--------|------|
| 普通提交 | DTO 字节、扫描/请求次数、并发、隐私、结果正确性；延迟退化 >20% 阻断 | unit/contract/perf 脚本 |
| 固定性能环境 | loader P95 ≤150 ms、缓存导航 P95 ≤500 ms 绝对预算 | `verify-bundle-budget` + perf 套件 |
| Release Candidate | 目标 Windows 完整 cold/warm/10x + Electron 首次运行基准 | 手工/CI 证据 |

## 6. 隐私断言

所有 fixture 为合成数据（无真实路径/prompt/API key）；DTO 门禁检查禁止字段（command/prompt/secret/path 等）；观测日志仅存稳定标识符与 error code。
