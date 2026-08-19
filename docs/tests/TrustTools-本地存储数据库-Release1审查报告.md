# TrustTools 本地存储数据库 Release 1 独立审查报告(合并归档)

| 属性 | 值 |
|------|-----|
| 文档类型 | 审查报告归档 |
| 项目名称 | TrustTools |
| 版本 | v1.0 |
| 创建日期 | 2026-08-19 15:47:46 |
| 更新日期 | 2026-08-19 15:47:46 |
| 生成工具 | agile-feature-dev(Phase 5 审查归档) |
| 文档状态 | 草稿 |

> 本文件归档 Phase 5 两个独立审查 Sub-Agent(代码/安全审查、测试/验收追踪审计)对 Release 1 交付(commit 951f4ee / a78a355 / aabd385 / 481bea8 / d858c80)的结论,并跟踪修复状态。审查均只读,所有发现均有实测复现证据。

## 1. 审查结论

| 审查 | 判定 | 一句话理由 |
|---|---|---|
| 测试与验收追踪审计(qa-expert + test-auditor) | PASS-WITH-ISSUES | 67/67 单测全绿、19 Task 中 15 完全通过/4 部分通过;2 项 P1(占用/锁冲突零测试、verify 脚本协同篡改盲区)与 4 项 P2 |
| 代码审查 + 安全审查(code-reviewer-pro + security-auditor) | **FAIL** | restoreFromBackup 可把未校验 SQLite 文件覆盖为生产库并把真实 L2 数据挪走(P0);单写不变量被 Windows 大小写别名与 backup 第二可写连接双重绕过;隐私守卫校验表示与落库表示不同,15 类禁存输入全部通过;任务清单规定的测试命令虚绿 |

## 2. 发现清单与修复状态

### P0(必须修复)

| # | 发现 | 修复状态 |
|---|---|---|
| P0-1 | restoreFromBackup 跳过无 manifest 记录的 SHA-256 校验、无路径约束、无 application_id/user_version 校验、无用户确认参数,任意 SQLite 文件可覆盖生产库 | 修复批次 A |
| P0-2 | restore 隔离→复制之间无补偿,复制失败即生产库消失 | 修复批次 A |

### P1(应修复)

| # | 发现 | 修复状态 |
|---|---|---|
| P1-1 | 任务清单规定的 `--test <目录>` 命令虚绿(只跑 1 个空 test exit 0) | 修复批次 B |
| P1-2 | Host 单例可被 Windows 大小写别名绕过(两个可写连接) | 修复批次 A |
| P1-3 | backup 自行打开第二个可写连接,绕过单写不变量与 PRAGMA 断言 | 修复批次 A |
| P1-4 | application_id/user_version 从未写入/校验(§9-6 数据库替换防护缺失) | 修复批次 C |
| P1-5 | 事务用 BEGIN(DEFERRED)而非 BEGIN IMMEDIATE | 修复批次 A |
| P1-6 | node:sqlite 出现在 capability-probe/backup(infrastructure 之外),门禁不查平台层 | 修复批次 B |
| P1-7 | privacy-guard 校验未序列化对象,toJSON 可完整绕过 | 修复批次 B |
| P1-8 | 禁存内容检测 15 类绕过(实测:key 键名/同形字/mnt 路径/数组元素/analysis 数字与实体名/无 scheme URL/git 等命令) | 函数部分修复批次 B;SQL 引擎级 CHECK 修复批次 C |
| P1-9 | verify-database-schema 4/8 类破坏判 OK(不剥注释、列 CHECK 跨列匹配、MIGRATIONS 引用不校验) | 修复批次 B |
| P1-10 | manifest.json 单点损坏 → 完好备份全部"消失",planRecovery 直落 no-backup | 修复批次 A |
| P1-11 | 备份保留策略(7 日 + 迁移前强制备份)未实现 | 修复批次 C |
| P1-12 | T-03-04「无备份 → 创建空库 + 标记」路径未实现(3 个死参数) | 修复批次 A |

### P2(建议改进,选取修复)

| # | 发现 | 修复状态 |
|---|---|---|
| P2-1 | 枚举列全部放宽为可空(状态机可被 NULL 逃逸;secure_secrets 可在无 encryption_kind 下存明文 BLOB) | 修复批次 C |
| P2-2 | 七列 UNIQUE 对 NULL 不生效,缓存隔离在无 Profile 场景失效(实测 4 行同身份共存) | 修复批次 C |
| P2-3 | 计数/格式列缺 CHECK(负 rows_read、date_key 无格式、capability 无枚举、name 无 1-64 限制) | 修复批次 C |
| P2-4 | DatabaseError.cause 链携带绝对路径(util.inspect/observability 落盘) | 修复批次 C |
| P2-5 | 备份 promote TOCTOU,renameSync 可静默覆盖已成功备份 | 修复批次 C |
| P2-6 | normalizeBackupJournalMode 不校验 PRAGMA 返回值,静默失败时备份被踢出可用清单 | 修复批次 C |
| P2-7 | sha256OfFile 全量读入内存(listVerifiedBackups 对 7 份备份逐个整读) | 修复批次 C |
| P2-8 | 平台无 checkpoint API,业务可通过 exec 自行 checkpoint | 修复批次 C |
| P2-9 | 能力探针每次 open 在数据目录建 `dsh-wal-probe-` 临时库(前缀/位置/缓存) | 修复批次 C |
| P2-10 | WAL 探针失败与断言失败返回不同错误码(同因两码) | 修复批次 C |
| P2-11 | restore 时把健康库挪进 `.corrupt.<ts>/` 语义误导 | 修复批次 A |
| P2-12 | not-open 错误码闲置,close 后复用返回 sql-error | 修复批次 A |
| P2-13 | inspect-database 未复用严格连接参数、参数解析过宽、回显绝对路径 | 修复批次 B |
| P2-14 | eslint 不覆盖 scripts/**/*.mts(两个新脚本从未被 lint) | 修复批次 B |
| P2-15 | renderer bundle 无 DatabaseSync 的脚本级断言不存在 | 修复批次 B |
| P2-16 | restoreFromBackup verify→copy TOCTOU(三次独立打开) | 修复批次 A(与 P0-2 合一) |
| P2-17 | 跨进程单写者无显式所有权声明(仅进程内 Map) | 后续迭代(M2 前置,登记) |
| P2-18 | 重复代码(formatTimestamp/firstColumnValue/rmTempDir 多处复制) | 后续迭代(登记) |

### INFO(观察项)

- INFO-1 做得好的地方:契约零 node 依赖、迁移器事务+ledger 同行、checksum 归一化、dual-source 机制、约束测试真断言。
- INFO-2 平台尚未接入组合根(符合 WON'T 范围);AC-04/05/08/21 为契约级达成,端到端待 M2。
- INFO-3 全部测试注入 sqliteVersion "99.0.0";建议补 packaged Electron 下真实基线 smoke(后续)。
- INFO-4 verify/inspect 用裸 node 跑 .mts,依赖 Node ≥22.6 类型剥离(README/CI 锁定最低版本)。
- INFO-5 inspect 的 integrity_check 只取首行(可接受)。
- INFO-6 node-sqlite-database.test.ts 的 extension 用例断言过弱(修复批次 C 顺带)。
- INFO-7 data-migration.contracts.ts 质量良好;Zod 4 升级留意 safeParseReturnType 别名。
- INFO-8 CLEAN_ROOM 合规:无第三方数据库依赖、无外部代码复制、契约层隐私红线已建,执行层见 P1-7/8。

## 3. 加固迭代计划(已全部完成)

| 批次 | 范围 | 状态 | Commit |
|---|---|---|---|
| 修复批次 A | P0-1/2、P1-2/3/5/10/12、P2-11/12/16(恢复与单写安全) | ✅ 已提交 | 2df8596 |
| 修复批次 B | P1-1/6/7/8(函数)/9、P2-13/14/15(门禁/隐私/脚本) | ✅ 已提交 | a3c7e7c |
| 修复批次 C | P1-4/8(SQL)/11、P2-1~10(schema 加固与收尾) | ✅ 已提交 | 1b8bc64 |
| 后续迭代 | P2-17(跨进程单写所有权)、P2-18(重复代码抽取)、bundle WARN 升级(legacy-usage-collector 的 server-fn 拆分)、INFO-3 打包态 smoke、组合根接入(M2+) | 登记 | — |

## 4. 修复后复审结果(2026-08-19)

**Release 1 最终门禁链(编排者亲自执行,全绿):**

| 门禁 | 结果 |
|---|---|
| `npm run lint`(eslint .) | 0 error(4 个既有 UI react-refresh warning,与本功能无关) |
| `npx tsc --noEmit` | 0 error |
| `npm run test:database` | **113/113 pass** |
| `npm run test:scripts` | **22/22 pass** |
| `npm run verify:database-schema` | OK(dual-source sha256 一致、application_id 0x54544442、11 表 STRICT、14 枚举 CHECK、NOT NULL 清单、顶层语句闭集) |
| `npm run verify:browser-server-boundary` | OK(含 platform-node-sqlite-outside-infrastructure 与 business-node-sqlite-import 规则) |
| `npm run verify:bundle-no-sqlite` | OK(112 浏览器 chunk 零命中;1 个既有 server-fn 残留 WARN 登记 M2) |

**审查者绕过实验复核(全部封堵,由加固批次的对应测试锁定):**
- P0-1 hostile-DB / 无 manifest / 目录外路径 / 未确认恢复 → 全部稳定拒绝(6 个 recovery 用例)
- P1-2 Windows 大小写别名第二连接 → `already-open`(runtime 探测断言)
- P1-7 toJSON 绕过 → canonical 校验拒绝(4 个用例)
- P1-8 15 类禁存输入 → 全拦截(NFKC+同形字折叠+路径/命令/数字规则收紧)
- P1-9 双源协同篡改 9 组样本 → 9/9 拦截(旧脚本 5 类假阴性已消除)

**架构文档已同步修订至 v1.2**(NOT NULL/DEFAULT/CHECK、application_id/user_version、COALESCE 表达式唯一索引、备份保留策略),实现与文档一致。

## 5. 遗留登记(M2+ 迭代)

1. `legacy-usage-collector.server-*.js` 含 DatabaseSync 且位于 server-fn lazy 依赖表(bundle WARN)——需拆分 usage 采集器 server-function 或改动态 import。
2. 跨进程单写所有权(文件锁 broker)——开发态双进程场景落地前必做。
3. 平台尚未接入组合根(composition.server.ts)——M2 按 shadow-write 流程接入。
4. 隐私守卫 forbiddenEntities 词表需 Repository 接线时传入证据实体名。
5. 打包态 Electron 真实基线(smoke:sqlite_version() >= 3.53.1)回归。
