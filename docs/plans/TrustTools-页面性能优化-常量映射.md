# 运行时策略常量映射（T0-01）

> 依据 `docs/develop/plan/TrustTools-页面性能优化-敏捷任务清单.md` T0-01，记录旧常量位置 → 新策略键 → 删除阶段。
> 唯一人工维护源：`src/app/runtime-policy.source.json`（schema 见 `src/app/runtime-policy.schema.ts`）。

## 产品级周期/超时（已迁移到策略源）

| 旧位置 | 旧常量 | 旧值 | 新策略键 | 迁移状态 |
|--------|--------|------|----------|----------|
| `src/lib/pricing/dynamic.server.ts` | `EXCHANGE_TTL_MS` | 1 小时 | `snapshotPolicies.exchangeRates.freshForMinutes` = 1440 | ✅ 已注入（T0-05） |
| `src/lib/pricing/dynamic.server.ts` | `FETCH_TIMEOUT_MS` | 15 s | `snapshotPolicies.exchangeRates.timeoutMs` = 15000 | ✅ 已注入（T0-05） |
| `src/modules/usage/application/index.ts` | `DEFAULT_MAX_AGE_MS` | 5 分钟 | `snapshotPolicies.usage.freshForMinutes` = 15 | ✅ 已注入（T0-05，composition 显式传参；模块默认值保留为兼容回退） |
| `src/lib/local-skills/scanner.server.ts` | `MARKET_EVIDENCE_TTL_MS` | 5 分钟 | `snapshotPolicies.skillMarketEvidence.freshForMinutes` = 360 | ✅ 已注入（T0-05） |
| `src/modules/tasks/definitions/job-catalog.json` | 任务定义 | — | `scheduledJobs`（同文件） | ✅ 已迁移（T0-04，文件删除） |

## 进程内读取缓存（实现细节，非产品周期；T7-08 legacy 清理时统一评估）

| 旧位置 | 旧常量 | 旧值 | 说明 |
|--------|--------|------|------|
| `src/lib/pricing/server-fns.ts` | `RATES_TTL_MS` | 30 s | 进程内读取缓存，避免每个 loader 重复读汇率文件；不是新鲜度策略。 |
| `src/lib/local-usage/snapshot.server.ts` | `CACHE_TTL_MS` | 30 s | ✅ 已删除（T7-08）：legacy 30 秒内存快照缓存随 legacy 读取路径一并移除，页面读取统一走快照运行时。 |
| `src/modules/dashboard/ai-insight.server.ts` | `INSIGHT_TTL_MS` | 5 分钟 | AI 洞察进程内缓存；不属于数据读取策略。 |
| `src/lib/local-market/api.server.ts` | `REQUEST_TIMEOUT_MS` / `SIZE_HEAD_TIMEOUT_MS` | 8 s / 3 s | 市场安装网络超时；局部网络参数，暂留所属模块。 |
| `src/lib/local-market/archive.server.ts` | `DOWNLOAD_TIMEOUT_MS` | 15 s | 市场归档下载超时；同上。 |

## 局部 UI 参数（不进入策略源，架构文档 §3.4 规则 7）

React debounce、动画时长、toast 时长、错误去重等留在所属模块，不在本表维护。

## 删除阶段说明

- `job-catalog.json` / `job-catalog.schema.json` / `scripts/generate-job-imports.mjs`：T0-04 已删除，任务定义并入 `scheduledJobs`，由 `generate-runtime-policy.mjs` + `verify-runtime-policy.mjs` 接管。
- 进程内读取缓存：保留到 T7-08（legacy 删除条件满足后统一清理），届时以本表为准逐项复核。
