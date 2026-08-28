# TrustTools V3.0 全量深度审查报告

| 属性     | 值                                        |
| -------- | ----------------------------------------- |
| 文档类型 | 架构审计报告 (ARCH-AUDIT)                 |
| 项目名称 | trusttools_webapp (AITracker V3.0)        |
| 版本     | v1.0                                      |
| 创建日期 | 2026-08-28                                |
| 更新日期 | 2026-08-28                                |
| 文档状态 | 评审中                                    |
| 关联     | 修复计划《TrustTools-V3.0-审查修复-敏捷任务清单》v1.0 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
| ---- | -------- | -------- |
| v1.0 | 2026-08-28 | 全量只读审查：整体设计与具体实现缺陷分析（主代理精读核心链路 + 6 个并行子代理深挖各模块，关键发现二次复核）。 |

## 0. 审查范围与方法

- **范围**：`src/`（1071 文件、22 模块 + platform 层）、`electron/`（15 文件）、`scripts/` 校验体系、`tests/e2e/`、设计文档（`docs/architecture|requirement|plans`）。
- **方法**：主代理精读核心链路（composition root、数据库宿主/迁移、快照运行时、任务调度器、扫描管线、Electron 安全面、本地 Web 服务器、IPC 契约），并行 6 个子代理深挖（扫描管线、数据模块、智能模块、Electron、平台层、前端/质量），全部 P0/P1 与关键 P2 均经二次复核源码。
- **基线**：`npx tsc --noEmit` 通过（exit 0）；`npm run verify:database` 体系存在且测试覆盖强。
- **结论总览**：**无 P0**（未发现可远程利用的漏洞或直接的数据损坏/隐私泄露路径）；**13 个 P1**（数据正确性 5、合规 2、安全 1、功能可用性 2、i18n 1、性能 1、数据丢失 1）；**18 个 P2** 精选 + 若干 P3。整体架构水平明显高于一般项目，但存在两类系统性问题：**文档承诺与实现漂移**、**代码完备但未接线**。

## 1. 总体设计评价

### 1.1 设计上出色的地方（建议保持）

1. **模块化单体的纪律性**：ADR-001 约束 + `*.server.ts` 命名约定 + 动态 `import()` 隔离服务端代码 + `verify-browser-server-boundary`（实测通过）。渲染进程 bundle 不含 SQLite/扫描器，是这套架构最扎实的防线。
2. **快照运行时（Snapshot Coordinator）**：统一"采集→提交→读"路径，单飞去重、LKG（last-known-good）、abort-before-commit、SQLite 代际持久化（retain=2 + CASCADE），页面 O(1) 读。
3. **SQLite 使用近乎教科书**：单连接单写者 + 跨进程 writer lock + `BEGIN IMMEDIATE` + WAL + `synchronous=FULL` + PRAGMA 断言（`foreign_keys`/`trusted_schema`/`busy_timeout`）+ 能力探针；迁移带 checksum/`user_version` 同事务、拒绝降级/空洞/篡改；`application_id` 防数据库替换。
4. **隐私纵深**：正文不入缓存、命令 `safeSignature`、路径 `~/` 归一 + HMAC、`toPublicUsageSnapshot` 剥离、SQL CHECK 禁存敏感形态、LLM 输出五层校验 + NFKC 同形字折叠。
5. **调度器质量高**：共享单定时器、持久化 calendar cursor 跨重启补跑、单飞 + 队列上限 + heavy 资源预算、抖动退避重试、启动屏障、崩溃恢复（`recoverRunning`）。
6. **错误范式成熟**：证据优先（null≠0）、`sourceFailure` 兜底、诊断码稳定、负向测试覆盖强（backup/recovery/privacy-negative）。

### 1.2 设计层面最值得警惕的系统性问题

| 编号 | 问题 | 性质 |
| ---- | ---- | ---- |
| D1 | **文档承诺 → 实现系统性漂移**：三大卖点（Token 归一、双链对账、证据优先）在实现层面只兑现一半；CLAUDE.md/架构文档多处与实际不符（30s TTL 实为 60s、`usage_events` 建而不用、`TRUSTTOOLS_LLM_*` 已退役、token 三种传递方式未实现、safeStorage 未兑现） | 文档治理 |
| D2 | **实现+测试完备但零接线**：备份/恢复/完整性子系统（backup.test 14 例、recovery.test 15 例）生产零调用；`findForbiddenDtoFields`、`compact()`（VACUUM）、`genericReaderSpecFor` 等均为死代码 | 架构落地 |
| D3 | **质量门禁全部手动且无 CI**：仓库无 `.github`；`verify-module-boundaries` 默认 report-only（当前已有 9 条活跃违规仍 exit 0）；`verify-runtime-policy`/`verify-read-model-budgets` 不在任何自动链；`verify-bundle-no-sqlite` 对 server 分块只 WARN | 工程化 |
| D4 | **合规红线与产品行为未对齐**：蒸馏把用户选中的原始对话片段上传给配置的 LLM（P1-2），与 CLEAN_ROOM/需求文档"只传匿名聚合"直接冲突——需要产品决策而非纯技术修复 | 合规 |

## 2. P1 发现清单（13 项，附证据）

### 2.1 安全 / 隐私

**P1-1 [安全] 打包产物中服务端实现以无 token 静态资源泄露**
- 位置：`electron/local-web-server.ts:317-326`（静态资源先于 token 校验）；`scripts/verify-bundle-no-sqlite.mjs:47,171-179`（对 `*.server-*.js` 排除断言、命中只 WARN）
- 问题：`.output/public/assets/composition.server-*.js`（243KB）由本地服务器无 token 直接静态服务，内容含 AES-256-GCM 密钥布局与 `secure/secrets.key` 路径、`aitracker.v1.db` 路径、`Bearer ${apiKey}` 请求构造、hmacKey 派生、全部 DB schema 与 SQL。任何本地进程可 curl，任何网页可用 `<script src>` 探测拉取。
- 建议：对 `/assets/*.server-*.js` 同样要求 token，或把 server 分块移出 `public/`；该门禁改 FAIL。

**P1-2 [合规] 蒸馏把原始对话片段（含正文）+ 会话标题 + 项目名发送给 LLM**
- 位置：`src/modules/distillation/domain.ts:89-122`（`extractSegmentMessages`/`segmentMarkdown`）、`application/index.ts:291`（拼入 AI input）
- 问题：用户提示词/助手回复原文原样发送，`PRIVATE_PATH_RE/CREDENTIAL_VALUE_RE` 脱敏只作用于输出（`candidateText`），入站发送前零脱敏；注释声称 "never … uploaded" 与实际相反；`api.server.ts:275-291` 生成完成后自动 approve 落库。
- 建议：发送前复用 `sanitizeDistilledText`；UI 增加"将发送原始对话片段"显式确认；修订合规文档明确该例外（需产品拍板）。

**P1-3 [隐私] dormant 的 dashboard AI 洞察携带项目名，且绕过审计/预算**
- 位置：`src/modules/dashboard/ai-insight.server.ts:240-241,569-582`
- 问题：`topProjects[].label`（形如 `~/work/project`）放入发给 LLM 的 payload，`SENSITIVE_CONTENT` 正则（L56）拦不住 `~/…` 形态；该服务自建 executor，不走 composition root 的 `ai_executions` 审计与日预算。目前无页面调用（dormant），但 server fn 已注册可达。
- 建议：删除该服务，或改用匿名计数桶 + 走 `root.aiExecutor`。

### 2.2 数据正确性（核心采集管线）

**P1-4 [丢数] Grok 去重键不含 sessionId → 跨会话静默丢事件**
- 位置：`src/lib/local-usage/scanner.server.ts:1613-1616,2050-2066`
- 问题：`eventId` 存在时 identity = `[eventId, model]`；真实 fixture 的 eventId 是每会话递增序号（`turn-1`…），两个会话首轮同模型即碰撞，unique 合并后整条被丢弃。这是唯一"方向相反"（丢数据而非虚高）的 P1。
- 修复：identity 至少加入 `sessionId`，补多会话回归测试。

**P1-5 [计价失真] reasoning token 系统性不计价**
- 位置：`src/lib/pricing/resolve.ts:324`、`index.ts:165-166`；`scanner.server.ts:1210,1816-1817,1942-1947`
- 问题：默认 `reasoningIncludedInOutput=true` 且全仓无任何工具 JSON 声明 `tokenSemantics`；但 WorkBuddy/DSH/Antigravity 的 reasoning 与 output 互斥（reasoning 单独计入 total）→ 这些源推理 token 永远按 $0 计价。实测 `deepseek-v4-pro` 1M reasoning 应 $2.175 只算 $1.305。
- 修复：工具定义 `modelObservation.tokenSemantics` 显式声明。

**P1-6 [计价失真] cacheWrite 无价时整体回退通用估算**
- 位置：`src/lib/pricing/calculate.ts:107-110`、`resolve.ts:393-405`；openai.rules.json 全部 16 条 cacheWrite=null
- 问题：命中真实费率但 cacheWrite 费率为 null 即整体返回 null → 丢弃已知真实费率改用 `api-generic-v1`（$1/$3）。Codex 事件常带 cache 写入 token → Codex 成本系统性估算。实测 `gpt-5.6-sol` 1M cacheWrite 应 $35 只算 $5.25。
- 建议：已知分量按真实费率、仅 cacheWrite 单独降级。

**P1-7 [口径] Antigravity 估算事件混入真实总计，与架构文档 §4 直接相悖**
- 位置：`src/lib/local-usage/scanner.server.ts:1723-1848`、`aggregate.ts:131-137`
- 问题：文档明言"禁止读取正文进行字符估算……不得混入真实总计"；实现读取 `content/thinking` 估算，aggregate 不区分 `measurement`，estimated 与 observed 同入 totals/bySource/byModel/daily。
- 建议二选一：按文档降回 unsupported，或更新文档并在 totals 层隔离。

**P1-8 [口径] totalTokens 跨源语义不一致 → 总 token/环比/燃烧榜源间不可比**
- 位置：`src/lib/local-usage/aggregate.ts:53` 与各 reader（Claude/Codex/OpenClaw/Grok 不含 reasoning；WorkBuddy/DSH/Antigravity/Gemini 含）
- 问题：同是"总 token"，Claude 用户 reasoning 从总览消失，Gemini/DSH 用户却计入。
- 建议统一 `total = input+cacheRead+cacheWrite+output+reasoning`，展示层再拆细分。

### 2.3 功能可用性 / 数据丢失

**P1-9 [全索引瘫痪] 搜索隐私守卫误伤：标题含 "token/prompt/secret/content" 的合法文档使整个搜索索引读写失败**
- 位置：`src/modules/search/domain.ts:13-14,77`；`infrastructure/sqlite-search-index-repository.server.ts:104-117,140`
- 问题：`FORBIDDEN` 正则 `\b(?:token|prompt|content|…)` 匹配任何独立词；`assertSearchDocument` 抛 TypeError → `createSnapshot` 整体失败 → write 失败；读路径对全部已存文档重新校验 → 一条坏记录使搜索页永久 `errors.search.readFailed`。仓库层 `assertProjectionSafe` 是另一套更窄规则，两套守卫矛盾。
- 建议：误报词仅对 `textSummary` 的路径/凭据形态生效；单文档违规只跳过该文档。

**P1-10 [静默丢内容] 报告正文 60K 静默截断**
- 位置：`src/modules/reports/domain.ts:99`（`safeReportText` slice 60_000）；`server-fns.ts:148`（传输层允许 2MB）
- 问题：用户粘贴 60K–2MB 正文保存后无提示截断。
- 建议：统一上限并在 UI 提示。

**P1-11 [性能] sessions 读路径全量拉取 + N+1**
- 位置：`src/modules/sessions/infrastructure/sqlite-session-snapshot-repository.server.ts:36-77`；`application/index.ts:79-93`
- 问题：无 LIMIT 全表 `SELECT *`，每行再查 `session_unknown_models`；应用层 JS 分页。设计文档要求 keyset 分页；10 万会话 = 10 万行 + 10 万次子查询/次加载。
- 建议：SQL 层 keyset 分页 + `IN` 批量取 unknown_models。

**P1-12 [i18n] modules 展示层硬编码中文 + 校验脚本盲区**
- 位置：`src/modules/distillation/presentation/distill/ExpCard.tsx:395-441`、`skill-distribution/presentation/MarketPanel.tsx:59-73`、`reports/presentation/ReportsPage.tsx:53,122`；`scripts/check-hardcoded-text.mjs:112`（只扫描 `src/routes` 与 `src/components`）
- 问题：保存弹窗/市场领域胶囊/报告周期标签在 en/ja/ko 界面固定显示中文，且市场领域中文 label 兼作比较键；CI 全绿。
- 建议：文案迁移 locale 字典（`distill.*`）；扫描范围扩展到 `src/modules/*/presentation`。

**P1-13 [正确性] 工具趋势图用 UTC 日期切片，与本地日口径冲突**
- 位置：`src/modules/skill-catalog/application/tool-overview.ts:222`（`event.timestamp.slice(0, 10)`）；同文件 L191,588 events 计数 `+1` 未按 `event.events` 展开
- 问题：负时区用户晚间事件画到次日，Dashboard 与工具页同日数据不一致；events 计数与 dashboard v2 口径冲突。
- 建议：统一本地日期键；统一 `event.events ?? 1`。

## 3. P2 发现清单（18 项）

| 编号 | 级别 | 问题 | 位置 |
| ---- | ---- | ---- | ---- |
| P2-1 | 逻辑 bug | **分类索引二次哈希**：hydrated 快照 `bucket.project` 是 ref_hash，`classificationService.resolve` 二次哈希全部 miss，`api.server.ts:861-871` 把哈希串喂给 `classifyIncrementally` → 提交垃圾 unknown 行（hash-of-hash）；重启后每次 dashboard 加载触发 | `sqlite-usage-snapshot-repository.server.ts:223`、`sqlite-classification-index.server.ts:25-33`、`dashboard/api.server.ts:861-871` |
| P2-2 | 状态机 | 快照协调器 warningCodes 永不清理（成功后沿用旧码），"collection-failed/cancelled/invalidated" 永久残留于 fresh 快照与 DB | `platform/snapshot-runtime/coordinator.ts:190` |
| P2-3 | 状态机 | **LKG 被重新提交并标 fresh**：预算超时/健康降级时旧数据以新 generatedAt 提交，"最后更新于刚刚"显示的是从未发生的采集 | `usage-snapshot-runtime.server.ts:63-78`、`coordinator.ts:143-147` |
| P2-4 | 安全 | HMAC"密钥"由 `sha256("aitracker:"+dataRoot)` 确定性派生，dataRoot 公开可枚举 → project 哈希只是混淆，注释"Installation-scoped secret"名不副实 | `src/app/database-runtime.server.ts:75-77` |
| P2-5 | 安全 | 桌面 API key 加密未用 safeStorage：生产走文件密钥，注释（composition L201-204）声称 safe-storage codec 与实际矛盾 | `src/app/composition.server.ts:244` |
| P2-6 | 数据安全 | **release-data-reset 在 marker 丢失时静默 `rm -rf ~/.aitracker`**：marker 存于 userData，userData 被清理后下次启动无确认删除全部本地数据 | `electron/release-data-reset.ts:124-129,247-284` |
| P2-7 | 健壮性 | **启动屏障过强**：必需启动任务超时/取消（usage 120s / sessions 180s / skills 180s）→ 整个应用拒绝启动（Electron 错误框退出；web dev 首次加载阻塞），重试必失败 | `tasks/application/scheduler.ts:565-572`、`bootstrap.server.ts` |
| P2-8 | 性能 | usage.refresh 每分钟全量代际重写（全量 INSERT + 级联 DELETE），写放大 + WAL 增长 | `job-catalog.generated.ts:40-44`、`snapshot-generation.server.ts:136-203` |
| P2-9 | 架构门禁 | 9 条活跃模块边界违规（tasks→reports/schedule.ts、security-assessment→ai-orchestration/model-profile.server.ts 等），`verify-module-boundaries` 默认 report-only，无 CI | `scripts/verify-module-boundaries.mjs:449-453` |
| P2-10 | 竞态 | 蒸馏每日配额 check-then-act 可超限（先 read 后 increment 跨多个 await） | `distillation/application/index.ts:239-250,324-330` |
| P2-11 | 治理 | AI 审计 capability 分类错误：security/dashboard 的 LLM 调用全部归为 "distillation" | `src/app/composition.server.ts:497-501` |
| P2-12 | 性能 | 分类索引 `getMany` 逐 ref 单查（N+1）；dashboard/工具聚合 O(rows×events) 线性过滤 | `sqlite-classification-index.server.ts:50-58`、`dashboard/application/v2.ts:258-260` |
| P2-13 | 容量 | search 重建 `DELETE … NOT IN (?,?,…)` 占位符随文档数线性增长，超 32766 即失败 | `sqlite-search-index-repository.server.ts:176-182` |
| P2-14 | schema | 迁移 0001 含 8+ 张零引用死表（usage_events 家族），`verify-database-schema` 钉死 `MIGRATIONS.length===1` 无法清理 | `migrations/0001_initial_schema.ts:396-468` |
| P2-15 | i18n | ja/ko 路由 `<title>` 整段回落英文（第二份手工维护字典 route-messages），SSR 首帧与 hydration 后标题不一致 | `src/lib/i18n/route-messages.ts:61-66` |
| P2-16 | 健壮性 | 前端失败态缺失：`/agents` 失败永久骨架屏无重试；sources 重扫 10 分钟定时器链无卸载清理；insight 模块级缓存 Map 无界 | `routes/agents.lazy.tsx:34-40`、`sources/query/presentation/index.tsx:138-152`、`insights/page/presentation/use-page-insight.ts:66-69` |
| P2-17 | 采集 | generic 适配器（cursor/kimi/roo/copilot/cline/opencode）完全无去重（测试显式断言重复累计）；workbuddy 去重绕过缓存复用路径；sessions 链无增量缓存全量重扫；Gemini 整文件 JSON.parse 无大小上限；DSH zstd 解压后整文件驻留内存 | `scanner.server.ts:2352-2393,1264-1324,2005`、`dsh-zstd.ts:121-155` |
| P2-18 | 数据 | 技能 `lastUsedAt` 生产恒 null（收集器不传 usageEvents）；4 处生产路径绕过 SkillSnapshotRuntime 直接全量重扫 | `local-skills/scanner.server.ts:943`、`skill-snapshot-runtime.server.ts:71` |

## 4. P3 与文档漂移（节选）

- `verify-read-model-budgets` 只覆盖 dashboard 一个投影；`findForbiddenDtoFields` 生产零调用；三处 forbidden 字段列表手工同步。
- 环比门槛 `minimumComparableEvents = 1` 与注释"避免单事件波动"自相矛盾（`dashboard/application/v2.ts:30-31`）。
- `reports/schedule.ts:1` 跨模块深层导入 `tasks/application/task-storage.ts`（`Schedule` 已有公开出口）；`nextReportScheduleAt` 与调度器 `nextRunAt` 双份实现。
- reports run 先置 succeeded 再写文档，失败时状态失真；executor 抛异常时 run 永久 running（`reports/application/index.ts:229,263`）。
- 无 CSP、无 `uncaughtException/unhandledRejection` 处理器、`activate` 双重注册竞态（`electron/main.ts:972-978,1019-1022`）、after-pack 无 Developer ID 时去 hardened runtime 重签、macOS 未公证。
- e2e 魔法数字 36（工具总数）、大量固定等待（flaky 隐患）；`route-open-performance` 只采数不设预算门禁。
- `docs/V3.0_TrustTools/` 本地含 336MB 旧项目快照（node_modules 未入库，建议清理）。
- CLAUDE.md 声称的 `?token=/Bearer/x-capability-token` 三种令牌传递全部未实现（实际 cookie-only 且更安全，属文档契约漂移）；`TokenStatus "challenge"` 为死代码。
- Codex 双链取量优先级相反（session 链优先 total 差分、usage 链优先 lastUsage），两链对同一日志结果不同（`local-sessions/scanner.server.ts:923-943` vs `local-usage/scanner.server.ts:997-1013`）；双链对账承诺整体未兑现（无对账测试、aipy totalTokens 两链不一致）。
- 工作区存在 214 个未提交文件（8755+ 插入），同步 Lovable 时注意分支状态。

## 5. 修复优先级建议

**第一梯队（数据可信度，改动小、收益大）**：P1-4（一行修复）、P1-5（JSON 声明）、P1-6（按分量计价）、P1-8（口径统一）、P2-1（分类索引哈希）。

**第二梯队（安全/合规）**：P1-2（需产品决策）、P1-1（资源门禁）、备份接线（D2）、P2-6（确认对话框）、P1-3（dormant 服务）。

**第三梯队（可用性/门禁）**：P1-9（搜索守卫）、P1-10（截断统一）、P1-11（keyset 分页）、P1-12（i18n）、CI + verify 全链 blocking（D3）。

**第四梯队（打磨）**：P2-2/3（状态语义）、P1-13（UTC/本地日）、e2e 去魔法数字、死代码清理（`usage_events` 表、`components/dashboard/`、`route-messages`、`genericReaderSpecFor`）、P2-7（启动屏障语义）。

## 6. 复现验证方法（关键项）

```bash
# Grok 跨会话丢数：构造两个会话目录各写一条 turn-1 → 期望 2 事件实际 1
node --import tsx --test src/lib/local-usage/scanner.server.test.ts
# reasoning 漏计：estimateEventCost({source:'dsh', model:'deepseek-v4-pro', reasoningOutputTokens:1e6, ...})
# LKG 假 fresh：createUsageCollector({budget:{maxDurationMs:1}}) 后 readLatest().status
# 静态资源泄露：curl http://127.0.0.1:<port>/assets/composition.server-*.js （无 token 返回 200）
# 备份零接线：grep -rn "createOnlineBackup|planRecovery" src electron scripts（仅模块自身/测试）
# 分类二次哈希：采集→重启→dashboard 加载→查 project_classifications 是否有 hash-of-hash 垃圾行
# i18n 盲区：node scripts/check-hardcoded-text.mjs --report 通过，但 grep -rn "已保存到" src/modules
# 搜索误伤：写入 title="Token 使用统计" 的文档 → 观察整索引读写失败
# 模块边界：node scripts/verify-module-boundaries.mjs --blocking（当前 9 条违规应失败）
```
