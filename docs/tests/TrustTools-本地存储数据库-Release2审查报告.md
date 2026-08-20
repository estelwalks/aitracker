# TrustTools 本地存储数据库 Release 2（SQLite 全面切换）独立审查报告

| 属性 | 值 |
|------|-----|
| 文档类型 | 审查报告归档 |
| 项目名称 | TrustTools |
| 版本 | v1.0 |
| 创建日期 | 2026-08-20 |
| 生成工具 | agile-feature-dev(Phase 5 审查归档) |
| 文档状态 | 草稿 |

> 本文件归档 Release 2「SQLite 全面切换」的两个独立审查 Sub-Agent（QA/测试验收追踪审计 + 代码/安全审查）结论，并跟踪修复状态。审查均只读，发现均有实测证据。

## 1. 交付范围回顾

Release 2 将项目从「JSON 文件存储 + 渐进迁移」收敛为**新项目 SQLite-only 单一存储**：

- 移除全部 legacy 读取回退（5 个 `create*ReadFallback` 工厂 + `withLegacySnapshotImport`）。
- 移除全部数据迁移接缝（7 组 `importLegacy*` + 旧文档形状解析）。
- 删除旧文件存储代码（`platform/persistence/infrastructure`、`atomic-*-store`、旧 JSON task 仓库、JSON 文档仓库工厂）。
- 补全 SQLite 缺口（迁移 0005 `snapshot_blobs`+`search_documents`、WSL 快照仓库、搜索索引仓库、retention 数据库化）。
- 清理 legacy 命名/死配置（`legacy-*` 适配器改名、`cacheFileName`、Electron `dataDirectory`）。
- 文档同步（ADR v1.2 / 架构文档 v1.3 / CLAUDE.md / README）与 e2e stale-home 夹具 SQLite 种子化。
- 全量测试：新增 `test:unit`/`test:all`，修复组合根测试隔离回归。

## 2. 审查结论

| 审查 | 判定 | 一句话理由 |
|---|---|---|
| 测试与验收追踪审计(qa-expert + test-auditor) | PASS-WITH-ISSUES | 门禁/测试/残留盘点与 R-01~R-07 追踪基本达成；1 项 P1（`legacy.read` 门禁覆盖缺口）与若干 P2 |
| 代码审查 + 安全审查(code-reviewer-pro + security-auditor) | PASS-WITH-ISSUES | P0=0；2 项 P1（quota UTC/本地日不一致、search `source_ref` 禁存守卫缺口）+ 2 P2 + 3 P3 |

## 3. 发现清单与修复状态

### P0（必须修复）

| # | 发现 | 状态 |
|---|---|---|
| — | 无 | — |

### P1（应修复）

| # | 发现 | 修复状态 |
|---|---|---|
| P1-1 | 配额 `sqlite-quota-store` `read()` 用 UTC 日、`increment()` 用本地日，跨时区午夜键不一致 → 配额绕过/误拦截 | ✅ `259af8f` |
| P1-2 | search `source_ref`/`document_id` 未纳入禁存守卫，`C:/...`、`sk-`/`ghp_` 可落库 | ✅ `8b6f02a` |
| P1-3 | `snapshot_blobs`（WSL 拓扑）无隐私守卫与负向测试 | ✅ `07f5db4` |
| P1-4 | `verify:sqlite-only` 门禁未覆盖 `legacy.read`/`readLegacy`（R-01 追溯缺口） | ✅ `77131a3` |

### P2（建议改进，选取修复）

| # | 发现 | 修复状态 |
|---|---|---|
| P2-1 | `verify:bundle-no-sqlite` 未并入聚合门禁 | ✅ `d07ff31`（并入 `verify:database`） |
| P2-2 | `runtime-policy` 的 `rollout.defaultStage` 残留 `legacy`/`shadow` 死阶段 | ✅ `7ee4f1c` |
| P2-3 | 门禁测试死夹具（`generate-static-config.mjs`） | ✅ `c677149` |
| P2-4 | search「重启恢复」测试未真正重开连接 | ✅ `ebe5490` |
| P2-5 | 单写锁 `pid` 复用导致陈旧锁永久无法回收（Windows，fail-closed 可用性缺陷） | 登记（后续迭代，需锁记录加进程启动标识） |
| P2-6 | `app_preferences` SQL 层 CHECK 弱于仓库守卫（纵深防御偏弱） | 登记（仓库层为唯一写入者，暂不必要） |
| P2-7 | e2e locale 测试仍假设 `localStorage` 镜像，与 src 零 `localStorage` 漂移 | 登记（需确认 i18n 持久化路径） |
| P2-8 | 历史文档（`docs/V3.0_TrustTools/*`、回滚手册、数据迁移清单）仍描述旧 JSON/localStorage 机制 | 登记（历史快照，主文档已同步） |

### P3（观察项）

| # | 发现 | 处理 |
|---|---|---|
| P3-1 | search 全量重建 `NOT IN` 变量数受 SQLite 上限约束 | 登记（文档集恒定小，无需处理） |
| P3-2 | `envelopeFromRow` 对 BigInt 直接 `Number()` 未走 safe-integer 校验 | 登记（极小区段计数，低风险） |
| P3-3 | `local-usage/scanner.server.ts` 直接静态 import `node:sqlite`（只读第三方工具库，非平台库） | 登记（ADR §2 明确的只读外部 SQLite 例外） |

## 4. 最终门禁链（编排者 + 审查者复核，全绿）

| 门禁 | 结果 |
|---|---|
| `npm run test:all`（test:unit + test:scripts + test:database） | ✅ 全绿（unit 1206 pass / scripts 30 pass / database 137 pass） |
| `npx tsc --noEmit` | ✅ 0 error |
| `npm run lint` | ✅ 0 error（4 个既有 UI react-refresh warning） |
| `npm run verify:sqlite-only` | ✅ OK |
| `npm run verify:database`（含 bundle-no-sqlite） | ✅ OK（bundle-no-sqlite：116 browser chunk 零命中；2 条 server-fn split residual WARN 已登记） |
| `npm run verify:database-schema` | ✅ OK（0001–0005 双源一致、application_id、STRICT/枚举/索引/CHECK 闭集） |
| `npm run verify:browser-server-boundary` | ✅ OK |
| `npm run verify:tool-registry` | ✅ OK |
| `npm run verify:architecture` | ✅ OK（report mode；1 个既有 intrinsic cycle） |
| `npm run build` / `build:electron` | ✅ 成功 |

## 5. 遗留登记（后续迭代）

1. 单写锁跨进程 pid 复用回收（P2-5）——锁记录增加进程启动标识 + 陈旧回收 age 下限，保持 fail-closed。
2. `app_preferences` SQL 层禁存 CHECK 强化为仓库守卫的超集（P2-6）。
3. e2e locale/localStorage 夹具与 i18n 持久化路径对齐（P2-7）。
4. 历史归档文档（`docs/V3.0_TrustTools` 等）与新实现的对账标注（P2-8）。
5. `verify:bundle-no-sqlite` 的 2 条 server-fn split residual WARN（`composition.server`、`usage-collector.server`）——server-function 拆包拆分（Release 1 已登记项）。
6. `check:i18n` 的 `check-hardcoded-text.mjs` 依赖 Unix `find`，Windows 开发环境无法运行——跨平台化（既有环境限制，非本次改动引入）。
