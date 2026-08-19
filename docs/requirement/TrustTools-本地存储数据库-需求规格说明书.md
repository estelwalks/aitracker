# TrustTools 本地存储数据库需求规格说明书

| 属性 | 值 |
|------|-----|
| 文档类型 | 需求规格说明书 (SRS) |
| 项目名称 | TrustTools |
| 版本 | v1.0 |
| 创建日期 | 2026-08-19 13:33:02 |
| 更新日期 | 2026-08-19 13:37:27 |
| 生成工具 | agile-feature-dev |
| 文档状态 | 草稿 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v1.0 | 2026-08-19 13:37:27 | 修正:§3.2 追溯引用精确到架构文档 §5.1/§5.2/§5.10;收紧 FR-DATA-001 措辞;补充文件名功能域限定命名说明 |
| v1.0 | 2026-08-19 13:33:02 | 初始版本 |

> 命名说明:文件名采用功能域限定 `TrustTools-本地存储数据库-需求规格说明书.md`,与 `docs/architecture/TrustTools-本地存储数据库-架构设计文档.md` 命名对齐,避免与既有 `TrustTools-需求规格说明书.md`(UI/总览重构)冲突。

---

## 1. 背景与目标

### 1.1 现状问题

TrustTools 当前为模块化单体架构,持久化依赖分散的 JSON 文件存储(`src/platform/persistence/` 的 `NodeAtomicJsonStore` + 各域独立 store)。`src/app/composition.server.ts` 组合根当前创建了 15 份以上 store:

- 任务域:`tasks/preferences.v1.json`、`tasks/runs.v1.json`。
- 快照域:`usage-snapshot.v1.json`、`usage-snapshot-envelope.v1.json`、`project-classification-index.v1.json`、`wsl-topology-snapshot-envelope.v1.json`、`session-snapshot-envelope.v1.json`、`skill-snapshot-envelope.v1.json`、`installation-snapshot-envelope.v1.json`。
- 监控域:`monitoring.v1.json`。
- 业务资产域:`reports.v1.json`、`knowledge.v1.json`、`distill-candidates.v1.json`、`distill-quota.v1.json`。
- 其余:性能 rollout flag、Model Profile 独立 store(`~/.trusttools/tasks/model-profiles.v1.json`)、Electron 主进程 prefs/安全扫描历史、market/exchange/search 等缓存。

由此产生的主要问题:

1. **整文件 read-modify-write**:多个业务集合每次 mutation 都重写整个 JSON 文件,随数据量增长放大写放大与一致性窗口。
2. **无跨模块事务**:各文件独立维护锁、schemaVersion 与损坏恢复,无法实现跨 reports/knowledge/tasks/insights 的原子提交;业务事务(如知识审批+版本、蒸馏审批+资产)无法整体保证。
3. **查询能力受限**:跨实体关联、分页、按时间/状态过滤依赖内存排序,增长后出现 N+1 或大 JSON 全量解析;高频查询(如 Dashboard 聚合、Tracker 排名)无索引。
4. **多事实源**:Electron prefs/localStorage、server JSON 与 scanner JSON 并存,偏好与状态缺乏单一权威。
5. **今日洞察增量放大文件数**:14 个 Surface 的增强缓存若继续按文件扩展,将大幅放大文件数量与一致性成本。

### 1.2 目标

Release 1 在现有模块化单体中引入**服务端专用嵌入式 SQLite 存储层**(平台内核),作为后续各域渐进迁移的地基:

1. 建立 `src/platform/database/` 平台层:契约(`SqliteDatabasePort`)、能力探针、`node:sqlite DatabaseSync` 适配器、单写 `DatabaseHost`、迁移运行器、在线备份、完整性检查/损坏隔离。
2. 交付首期 11 张表 migration(`0001_platform.sql`),覆盖数据库内核、可选模型配置、可选 AI 审计/预算与今日洞察四组表。
3. 交付两个工具脚本(`verify-database-schema.mts`、`inspect-database.mts`),用于 schema 校验与只读检视。
4. **明确不引入**:ORM、业务模块直接写 SQL、renderer 任何 SQL 能力、第三方数据库驱动依赖。
5. 为 M2 起的各域 JSON→SQLite 数据迁移预留 `data_migration_runs` 表与导入接口契约(仅设计预留,不实现迁移逻辑)。

### 1.3 设计依据与范围来源

- 架构设计文档:`docs/architecture/TrustTools-本地存储数据库-架构设计文档.md`(v1.1),重点章节 §2.2 成功标准、§3 推荐存储架构、§4 数据建模规则、§5.0 首期范围、§13 M0/M1、§14 测试设计输入。
- 架构决策记录:`docs/architecture/TrustTools-本地存储数据库-架构决策记录.md`(ADR v1.1,状态 proposed)。
- 隐私红线:`docs/compliance/CLEAN_ROOM.md` —— 不持久化会话正文/Prompt/Skill 源码/完整命令/绝对路径/API Key 明文。

## 2. 功能范围

### 2.1 核心功能(Release 1 交付)

#### 2.1.1 平台内核(`src/platform/database/`)

| 编号 | 需求 |
|---|---|
| FR-PF-001 | 契约层 `contracts.ts`:定义 `SqliteDatabasePort`、`Transaction`、`Backup` 接口,隔离 `node:sqlite` 驱动 API;业务模块只依赖 Repository/Port,不依赖驱动类型 |
| FR-PF-002 | 单写 DatabaseHost `database-host.server.ts`:每个数据库绝对路径只允许一个可写 `DatabaseHost` singleton;`DatabaseSync` 仅在 server/Electron trusted process 创建 |
| FR-PF-003 | 能力探针:启动时读取并记录 `process.versions.electron/node/chrome` 与 `SELECT sqlite_version()`;运行时基线不满足(Electron 43.4.1 / Node 24.18.1 / SQLite 3.53.1)时拒绝开启 SQLite 写路径并保留 legacy adapter |
| FR-PF-004 | 连接参数:显式 `timeout=5000`、`readBigInts=true`、`allowExtension=false`、`allowBareNamedParameters=false`、`allowUnknownNamedParameters=false`、`defensive=true` |
| FR-PF-005 | PRAGMA 初始化:`journal_mode=WAL`、`synchronous=FULL`、`wal_autocheckpoint=1000`、`foreign_keys=ON`、`busy_timeout=5000`、`trusted_schema=OFF`;初始化后必须断言 `PRAGMA journal_mode` 返回 `wal`,否则关闭连接、记录稳定错误码并保留 legacy adapter,禁止静默降级 |
| FR-PF-006 | checkpoint 管理:仅 Database Host 可执行 checkpoint;正常运行依赖 autocheckpoint,空闲维护用 `PASSIVE`,完整退出且无 reader 时可用 `TRUNCATE`;业务 Repository 禁止自行 checkpoint |
| FR-PF-007 | 迁移运行器 `migration-runner.server.ts`:版本化 SQL migration 顺序执行;记录 `schema_migrations`(version/name/checksum/app_version/applied_at_ms/duration_ms);迁移失败回滚;checksum 变更拒绝继续;重复执行无副作用 |
| FR-PF-008 | 在线备份 `backup.server.ts`:使用 `sqlite.backup()` 生成含已提交 WAL 状态的一致备份;备份后用只读连接 `PRAGMA quick_check` 并写 manifest(schema/app/SQLite 版本、size、SHA-256、createdAt);临时文件校验后原子 rename;保留 7 日 + 最近一次大版本迁移前备份;禁止直接复制 `.db` 或自行拼接 `-wal/-shm` |
| FR-PF-009 | 完整性检查与损坏隔离 `integrity.server.ts`:`integrity_check`/`quick_check`/`foreign_key_check`;打开或检查失败时将 `.db`、`-wal`、`-shm` 作为同一故障组隔离到 `.corrupt.<timestamp>/`,从备份恢复(L2 数据不可静默丢弃),无备份时创建空库并从 legacy JSON 导入可恢复域;严禁删除数据库静默重建 |
| FR-PF-010 | 事务 helper:`BEGIN IMMEDIATE` 封装,提交/回滚显式管理;禁止在数据库事务内读取文件、调用网络或运行模型 |
| FR-PF-011 | BigInt 边界:Repository 负责把 64 位 INTEGER(BigInt)安全转换为领域数值或字符串,返回前验证不超过 JavaScript 安全整数;金额权威格式为 `microusd INTEGER`,禁止浮点美元 |
| FR-PF-012 | SQL 安全:所有用户输入经 prepared statement 绑定;动态表名/排序列来自代码白名单;`allowExtension=false`、`trusted_schema=OFF` |
| FR-PF-013 | browser/server boundary:renderer bundle 不含 `node:sqlite`、DB 路径、secret ciphertext 与任意 SQL adapter;`node:sqlite` 只能出现在 `platform/database/infrastructure` 与模块 `*.server.ts` adapter |

#### 2.1.2 首期 11 张表 migration(`0001_platform.sql`)

按架构设计文档 §5.0 首期分组创建以下 11 张表(全部 `STRICT`):

| 编号 | 表 | 分组 | 无模型时是否产生业务行 |
|---|---|---|---|
| FR-MIG-001 | `schema_migrations` | 数据库内核 | 会;保存版本与迁移历史 |
| FR-MIG-002 | `data_migration_runs` | 数据库内核 | 会;保存迁移审计与幂等键 |
| FR-MIG-003 | `app_preferences` | 数据库内核 | 会;保存本地偏好 |
| FR-MIG-004 | `runtime_flags` | 数据库内核 | 会;保存运行时开关 |
| FR-MIG-005 | `secure_secrets` | 可选模型配置 | 不会;未配置模型时保持空表 |
| FR-MIG-006 | `model_profiles` | 可选模型配置 | 不会;保持空表(含 `is_active=1` 部分唯一索引) |
| FR-MIG-007 | `ai_executions` | 可选 AI 审计/预算 | 不会;rules 模式不写入 |
| FR-MIG-008 | `ai_daily_usage` | 可选 AI 审计/预算 | 不会;rules 模式不写入 |
| FR-MIG-009 | `insight_preferences` | 今日洞察 | 仅 preference 可有 `rules` 行 |
| FR-MIG-010 | `insight_enhancement_cache` | 今日洞察 | 不会;增强缓存保持空 |
| FR-MIG-011 | `insight_enhancement_lines` | 今日洞察 | 不会;增强缓存保持空 |

| 编号 | 需求 |
|---|---|
| FR-MIG-012 | 迁移质量:全部表使用 `STRICT`;空库可从 0 升至 latest,每个中间版本可升至 latest,重复执行无变化(幂等);migration checksum(SHA-256)改变时拒绝继续,不静默覆盖历史;migration 中断后重启时已提交步骤不重复、未提交步骤可重试 |

#### 2.1.3 工具脚本

| 编号 | 需求 |
|---|---|
| FR-SCRIPT-001 | `scripts/verify-database-schema.mts`:校验 `application_id`、`user_version`、migration checksum 与核心表存在性;通过/失败以退出码区分,供 CI 门禁使用 |
| FR-SCRIPT-002 | `scripts/inspect-database.mts`:只输出 schema 结构、各表行数与健康状态(integrity/quick_check 结果);**不输出任何业务内容** |

#### 2.1.4 数据迁移预留与隐私红线

| 编号 | 需求 |
|---|---|
| FR-DATA-001 | `data_migration_runs` 幂等导入契约:仅实现表结构与状态机类型/常量/校验契约(状态值 `running|succeeded|failed|skipped`、幂等唯一键 `(source_kind, source_path_hash, source_fingerprint)`),供 M2+ 数据导入任务记录迁移状态机使用;本轮不实现 shadow-write、read-switch 及任何域的具体导入逻辑 |
| FR-DATA-002 | 排除范围声明:M2 之后各域 JSON→SQLite 数据迁移、shadow-write、read switch、52 张表全集、FTS5、`insight_feedback` 均不在本轮交付,仅在设计上预留 |
| FR-PRIV-001 | 禁存内容零落库:会话正文/reasoning/Prompt 正文/Skill 源码/完整命令/命令输出/Provider 原始响应/API Key 明文/绝对路径不进入数据库,仅保存安全投影、聚合量与不可逆指纹 |
| FR-PRIV-002 | renderer 无 SQL 能力:renderer 只能调用固定 Server Function/IPC;不存在 `executeSql`/`tableName`/`whereClause` 等通用接口 |
| FR-PRIV-003 | 密钥保护:`secure_secrets.ciphertext` 仅存 Electron safeStorage/OS 账户绑定加密 BLOB;明文密钥无法加密时不自动迁移,要求用户重录;DB 导出默认排除密钥 |
| FR-PRIV-004 | 路径不可逆:数据库只存 display relative path(仅 `~/` 相对展示路径)或 `HMAC-SHA256(installSalt, normalizedRef)` 的 `ref_hash`;绝对路径只在一次 scanner 调用内存中存在 |

### 2.2 扩展功能(后续里程碑 M2–M6,本轮仅设计预留)

- M2 低风险状态迁移:runtime flags、task preferences/runs、monitoring、HTTP cache;shadow-write 对账;JSON read fallback;retention Job 数据库路径。
- M3 快照与高价值查询迁移:usage → sessions → skills/installations;generation/head 原子切换;keyset pagination;项目 ref 迁移为 HMAC。
- M4 业务资产与安全迁移:Reports、Knowledge、Distillation、Model Profile/secret、安全扫描、分发审计;Electron prefs 收敛到单一 Database Host。
- M5 今日洞察与搜索:Release A 仅 Core 读 Repository;Release B 创建 Insight enhancement/AI budget adapter;Search documents 迁移,FTS5 仅在能力与质量基准通过后启用。
- M6 切换与清理:按域开启 SQLite read,停止旧 JSON 写入并归档(不删除),一个稳定版本后提供用户确认清理。

本轮仅在设计上预留 `data_migration_runs` 表与导入接口契约,**不实现**任何域的具体导入、shadow-write 或 read switch。

### 2.3 未来规划(超出 Release 1)

- 52 张目标基线普通表 + 可选 FTS5 虚拟表 + 可选 `insight_feedback` 表的完整数据模型(架构文档 §5)。
- 全部 11 个域的规范化与索引/keyset 分页查询;View 层(`v_current_usage_events` 等 8 个普通 View)。
- 开发态 Electron/Vite 双进程下 Database Host 的跨进程 broker(在 broker 完成前,Electron 主进程管理的数据保持 JSON 兼容源,禁止双写同一 DB)。
- 全库加密选型(SQLCipher/加密 VFS)或维持字段级密钥加密——待产品确认。
- 可选 FTS5 中文搜索(质量基准通过前保留现有内存评分/参数化 LIKE 路径)。

## 3. 数据需求

### 3.1 数据库文件与布局

- 数据库文件:`~/.trusttools/data/trusttools.v1.db`;SQLite 运行时管理 `-wal`/`-shm`,应用不得当作普通缓存文件清理或单独复制。
- 备份目录:`~/.trusttools/backups/`(`trusttools-YYYYMMDD-HHmmss.db` + `manifest.json`)。
- 目录权限:数据库目录尽力 `0700`,数据库与 WAL/SHM 文件 `0600`;Windows 使用当前用户 ACL。
- 时间存储:UTC epoch milliseconds(`*_at_ms INTEGER CHECK (>= 0)`);本地日预算用 `date_key TEXT`(`YYYY-MM-DD`)。

### 3.2 首期 11 张表字段清单(逐列源自架构设计文档 §5.1 平台/迁移/偏好与缓存、§5.2 模型与 AI 执行、§5.10 今日洞察双模式)

#### 3.2.1 `schema_migrations` —— 数据库内核

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `version` | INTEGER PK | 单调递增 migration 版本 |
| `name` | TEXT NOT NULL UNIQUE | migration 名 |
| `checksum` | TEXT NOT NULL | SQL 文件 SHA-256 |
| `app_version` | TEXT NOT NULL | 执行 migration 的应用版本 |
| `applied_at_ms` | INTEGER NOT NULL | 完成时间 |
| `duration_ms` | INTEGER NOT NULL CHECK (>= 0) | 执行耗时 |

#### 3.2.2 `data_migration_runs` —— 数据库内核(JSON 导入幂等记录,设计预留)

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `run_id` | TEXT PK | 一次 JSON 导入 ID |
| `source_kind` | TEXT NOT NULL | `atomic-json|electron-prefs|security-json|cache-json` |
| `source_path_hash` | TEXT NOT NULL | 路径不可逆哈希,不保存绝对路径 |
| `source_schema_version` | INTEGER | 旧 schema 版本 |
| `status` | TEXT CHECK (running|succeeded|failed|skipped) | 导入状态 |
| `started_at_ms`,`finished_at_ms` | INTEGER | 起止时间 |
| `rows_read`,`rows_written`,`rows_skipped` | INTEGER NOT NULL DEFAULT 0 | 对账计数 |
| `error_code` | TEXT | 稳定错误码 |
| `source_fingerprint` | TEXT NOT NULL | 幂等键组成部分 |

唯一索引:`(source_kind, source_path_hash, source_fingerprint)`。

#### 3.2.3 `app_preferences` —— 数据库内核

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `preference_key` | TEXT PK | 如 `ui.locale`、`settings.retentionDays`、`widget.layout` |
| `value_json` | TEXT NOT NULL CHECK (json_valid) | 值;禁止密钥 |
| `value_type` | TEXT CHECK (string|number|boolean|object|array|null) | 解析保护 |
| `updated_at_ms` | INTEGER NOT NULL | 修改时间 |

桌面 DB 为权威;localStorage 只保留启动镜像或浏览器开发态兼容值。

#### 3.2.4 `runtime_flags` —— 数据库内核

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `flag_key` | TEXT PK | performance rollout、Insight kill switch 等 |
| `value_json` | TEXT NOT NULL CHECK (json_valid) | 受 schema 限制的值 |
| `updated_at_ms` | INTEGER NOT NULL | 修改时间 |

#### 3.2.5 `secure_secrets` —— 可选模型配置

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `secret_id` | TEXT PK | 不透明 ID |
| `purpose` | TEXT CHECK (model-api-key) | 首期仅模型密钥 |
| `ciphertext` | BLOB NOT NULL | Electron safeStorage/OS 加密结果 |
| `encryption_kind` | TEXT CHECK (dpapi|keychain|safe-storage) | 加密后端 |
| `created_at_ms`,`updated_at_ms` | INTEGER NOT NULL | 时间 |

#### 3.2.6 `model_profiles` —— 可选模型配置

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `profile_id` | TEXT PK | 当前 profile.id |
| `name` | TEXT NOT NULL | 1–64 字符 |
| `mode` | TEXT CHECK (official|custom) | 模式 |
| `protocol` | TEXT CHECK (openai|anthropic) | 协议 |
| `endpoint` | TEXT | custom endpoint;server-only |
| `model` | TEXT | 模型 ID |
| `secret_id` | TEXT FK → `secure_secrets` SET NULL | API Key 引用 |
| `is_active` | INTEGER CHECK (0,1) | 活跃标志 |
| `created_at_ms`,`updated_at_ms` | INTEGER NOT NULL | 时间 |

部分唯一索引:`CREATE UNIQUE INDEX ... ON model_profiles(is_active) WHERE is_active=1`,保证最多一个 active。

#### 3.2.7 `ai_executions` —— 可选 AI 审计/预算

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `request_id` | TEXT PK | AIExecutionSummary.requestId |
| `capability` | TEXT NOT NULL | `distillation|report|security|page-insight` |
| `profile_id` | TEXT FK → model_profiles SET NULL | 可空,offline 无 Profile |
| `provider_id`,`model_id` | TEXT | 执行时快照 |
| `prompt_version_id` | TEXT NOT NULL | Prompt 注册项 |
| `prompt_version` | INTEGER NOT NULL | 版本 |
| `input_fingerprint` | TEXT | 脱敏输入哈希,不存 Prompt |
| `status` | TEXT CHECK (completed|offline|fallback|budget|timeout|cancelled|failed) | 完整 AI 状态枚举 |
| `used_fallback` | INTEGER CHECK (0,1) | 是否使用本地结果 |
| `input_tokens`,`output_tokens` | INTEGER | 用量 |
| `cost_microusd` | INTEGER | 可空代表未知 |
| `cost_confidence` | TEXT CHECK (exact|estimated|unknown) | 成本置信度 |
| `error_code` | TEXT | 稳定错误码 |
| `started_at_ms`,`finished_at_ms`,`duration_ms` | INTEGER | 时间 |

索引:`(capability, started_at_ms DESC)`、`(profile_id, started_at_ms DESC)`、`(status, started_at_ms DESC)`。

#### 3.2.8 `ai_daily_usage` —— 可选 AI 审计/预算

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `date_key` | TEXT | 用户本地日 `YYYY-MM-DD` |
| `capability` | TEXT | 能力 |
| `profile_key` | TEXT | Profile ID;offline 使用固定 `offline` |
| `calls`,`input_tokens`,`output_tokens`,`cost_microusd` | INTEGER NOT NULL DEFAULT 0 | 聚合计数 |
| `updated_at_ms` | INTEGER NOT NULL | 时间 |

主键:`(date_key, capability, profile_key)`。调用配额检查与计数增加必须与 `ai_executions` 插入位于同一事务(M5 实施时生效);Insight Enhancer 预算损坏/迁移失败时 fail-closed,Insight Core 不受影响。

#### 3.2.9 `insight_preferences` —— 今日洞察

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `scope_key` | TEXT PK | `global` 或 `surface:<id>` |
| `mode` | TEXT CHECK (rules|enhanced-manual|enhanced-auto) | 默认 rules |
| `profile_id` | TEXT FK → model_profiles SET NULL | 可选 Profile |
| `consent_version` | TEXT | 远程聚合数据授权版本 |
| `consented_at_ms` | INTEGER | 授权时间 |
| `daily_call_limit` | INTEGER | 增强预算;rules 下无意义 |
| `updated_at_ms` | INTEGER NOT NULL | 时间 |

删除 Profile 时偏好保留但变为无 Profile;规则洞察仍正常。

#### 3.2.10 `insight_enhancement_cache` —— 今日洞察

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `cache_key` | TEXT PK | 内容寻址哈希 |
| `surface_id` | TEXT NOT NULL | 14 个 Surface 枚举 |
| `scope_hash`,`evidence_hash` | TEXT NOT NULL | 不含原事实值 |
| `locale` | TEXT NOT NULL | zh-CN/en-US/ja-JP 等 |
| `profile_id` | TEXT FK → model_profiles CASCADE | Profile 删除即清缓存 |
| `prompt_version_id`,`prompt_version` | TEXT/INTEGER | Prompt 版本 |
| `model_label` | TEXT | 安全展示名 |
| `ai_request_id` | TEXT FK → ai_executions SET NULL | 审计引用 |
| `generated_at_ms`,`expires_at_ms` | INTEGER NOT NULL | TTL |
| `status` | TEXT CHECK (ready|invalidated) | 缓存状态 |

UNIQUE `(surface_id, scope_hash, evidence_hash, locale, profile_id, prompt_version_id, prompt_version)`;索引 `(surface_id, expires_at_ms)`。

#### 3.2.11 `insight_enhancement_lines` —— 今日洞察

| 列 | 类型/约束 | 说明 |
|---|---|---|
| `cache_key` | TEXT FK → insight_enhancement_cache CASCADE | 所属缓存 |
| `sequence` | INTEGER | 顺序 |
| `candidate_id` | TEXT | 候选 ID |
| `analysis` | TEXT | 禁止数字、URL、路径、命令与实体名 |
| `action_id` | TEXT | 动作 ID |

主键:`(cache_key, sequence)`。事实句与动作 label 不持久化,始终由 Core 按当前证据本地渲染。

### 3.3 数据分级(L0–L3)

| 级别 | 定义 | 本轮 11 表落位 | 存储策略 |
|---|---|---|---|
| L0 可重建缓存 | 可丢弃重建 | `insight_enhancement_cache`、`insight_enhancement_lines` | 默认 TTL 24h;可设置 TTL、直接删除重建;随 Profile 删除/Prompt 版本变化失效 |
| L1 安全投影 | 外部数据的安全投影 | (本轮无快照表;M3 迁移 usage/session/skill/install 时落位) | 仅浏览器安全字段或本地敏感标识;保留最近 2 个成功 generation |
| L2 用户业务资产 | 强事务、备份、审计 | `app_preferences`、`runtime_flags`、`model_profiles`、`ai_executions`、`ai_daily_usage`、`insight_preferences`、`schema_migrations`、`data_migration_runs`(迁移审计) | 强事务、备份、保留审计;L2 默认不自动按 90 天删除 |
| L3 密钥 | 机密凭据 | `secure_secrets`(仅 ciphertext BLOB) | 不明文;OS 账户绑定加密;renderer 永不读取;DB 导出默认排除密钥 |

### 3.4 数据流向

```text
Renderer 页面 ──Server Functions / Electron IPC──▶ Module Application
                                                          │
                                                          ▼
                                                  Repository Port
                                                          ▲
                              ┌───────────────────────────┘
                              ▼
                   SQLite Repository Adapter (模块 *.server.ts)
                              │
                              ▼
                   DatabaseHost 单写连接 (platform/database)
                              │
                              ▼
                   trusttools.v1.db (WAL)
                              │
               ┌──────────────┼──────────────┐
               ▼              ▼              ▼
       Migration Runner   Backup/Recovery   Integrity Check

只读 Scanner ──▶ 内存安全投影 ──▶ Repository      (文件扫描在事务外完成)
外部 JSON/JSONL/SQLite ──▶ 只读 Collector ──▶ 投影
Legacy JSON Stores ──(迁移期只读/对账)──▶ Repository   (M2 起)
```

要点:

- 依赖方向固定为 `domain/application → repository port ← sqlite adapter → database host`;`node:sqlite` 只能出现在 `platform/database/infrastructure` 与模块 `*.server.ts` adapter 中。
- collector 在事务外完成文件扫描与投影,写事务只做批量 statement + head pointer 切换(M3 快照域);禁止在数据库事务内读文件/网络/模型。
- renderer bundle boundary 阻断 `node:sqlite`、DB 路径、secret ciphertext 与任意 SQL adapter。

## 4. 外部依赖

| 依赖 | 版本基线 | 性质 | 说明 |
|---|---|---|---|
| `node:sqlite`(内置 `DatabaseSync`) | Node 24 内置 | 运行时内置模块,零第三方依赖 | 仅在 server/Electron trusted process 使用;`node:sqlite` 只能出现在平台层与模块 adapter |
| Electron(内置 Node/SQLite) | Electron 43.4.1 / Node 24.18.1 / SQLite 3.53.1 | 运行时基线(ADR 固定) | 开发态本地 Node v24.9.0 用于测试;打包态以 Electron 内置版本为准,启动探针校验 |
| `node:sqlite` 能力 | JSON1、FTS5、online backup、defensive mode、BigInt | 启动探针验证项 | 不假定所有未来 Electron 构建一致 |
| 第三方数据库驱动 | 无 | 不引入 | 仅在 `node:sqlite` 不可用时将 `better-sqlite3` 作为备选 adapter(非本轮) |
| ORM | 无 | 不引入 | 使用版本化 SQL migration + prepared statement + Zod 边界校验 |
| 测试运行 | `node --import tsx --test`(node:test) | 开发工具 | `*.test.ts` 与源文件同目录 |

## 5. 非功能需求与验收标准

### 5.1 非功能需求(源自架构文档 §2.2 成功标准与 §14 测试设计输入)

| 维度 | 需求 |
|---|---|
| 性能 | 页面常用分页/聚合查询 P95 < 200 ms;单条偏好/缓存查询 P95 < 20 ms;启动(migration + capability probe)正常路径 < 500 ms |
| 正确性 | `foreign_key_check`、`integrity_check` 通过;业务事务无部分提交 |
| 恢复 | 应用崩溃后数据库可打开;未完成任务按现有策略标记 abandoned;损坏恢复不静默丢弃 L2 数据 |
| 隐私 | renderer 无 SQL/路径/密钥;禁存内容在 DB 检查中为零;renderer bundle 不含 `node:sqlite`/DB path/ciphertext |
| 迁移 | 每个 JSON 源可重复导入且幂等(M2 起);切换前新旧结果逐项对账;本轮实现 `data_migration_runs` 基础设施 |
| 回滚 | 切换期可恢复到只读 JSON adapter;不需要降级数据库 schema |
| 兼容 | 现有 Domain/Application contract 不因 SQLite 暴露 SQL 或数据库类型 |
| 可维护性 | migration 只向前;checksum 防篡改;表名/排序列白名单;prepared statement 全覆盖 |
| 可观测性 | 启动记录运行时版本与 `sqlite_version()`;稳定错误码(启动失败/探针失败/损坏)可诊断 |

### 5.2 验收标准(AC,共 22 条)

| 编号 | 验收标准 | 来源 |
|---|---|---|
| AC-01 | 现有 Domain/Application contract 不因 SQLite 暴露 SQL 或数据库类型;编译与模块边界检查通过 | §2.2 兼容 |
| AC-02 | `foreign_key_check`、`integrity_check` 通过;业务事务无部分提交 | §2.2 正确性 |
| AC-03 | 页面常用分页/聚合查询 P95 < 200 ms;单条偏好/缓存查询 P95 < 20 ms | §2.2 查询 |
| AC-04 | 启动(migration + capability probe)正常路径 < 500 ms;失败时阻止写入而不是自动破坏性重建 | §2.2 启动 |
| AC-05 | 应用崩溃后数据库可打开;未完成任务按现有策略标记 abandoned | §2.2 恢复 |
| AC-06 | renderer 无 SQL/路径/密钥;禁存内容在 DB 检查中为零 | §2.2 隐私 |
| AC-07 | 每个 JSON 源可重复导入且幂等;切换前新旧结果逐项对账(本轮验证 `data_migration_runs` 幂等契约,域导入 M2 起) | §2.2 迁移 |
| AC-08 | 切换期可恢复到只读 JSON adapter;不需要降级数据库 schema | §2.2 回滚 |
| AC-09 | 空库从 0 升至 latest;每个中间版本升至 latest;重复执行无变化 | §14.1 |
| AC-10 | migration checksum 改变时拒绝继续,不静默覆盖历史 | §14.1 |
| AC-11 | migration 中断后重启:已提交步骤不重复,未提交步骤可重试 | §14.1 |
| AC-12 | 明文 API Key:safeStorage 可用时加密迁移;不可用时不落库并要求重录(本轮验证表结构与加密契约;导入逻辑 M4) | §14.1 |
| AC-13 | 数据库损坏、磁盘满、只读目录、backup 目标占用、Windows rename/杀毒软件占用场景:打开失败或恢复路径符合设计,不静默重建 | §14.2 |
| AC-14 | 备份经 `quick_check` 校验;从备份恢复后 schema 完整、数据一致 | §14.2/M1 质量门 |
| AC-15 | 打包态运行时不得低于 SQLite 3.53.1;`PRAGMA journal_mode` 必须返回 `wal`;任何第二写连接必须失败或被串行化 | M0 质量门 |
| AC-16 | Windows/macOS 临时目录下迁移幂等、崩溃恢复、备份恢复、锁冲突测试通过 | M1 质量门 |
| AC-17 | renderer bundle 不含 `node:sqlite`、DB path、secret ciphertext 和任意 SQL adapter | §14.4 |
| AC-18 | DB 文件扫描不存在 transcript、reasoning、API Key 明文、Bearer、绝对路径、完整命令和 Provider 原始响应 | §14.4 |
| AC-19 | `app_preferences` 拒绝 secret key;`insight_enhancement_lines` 拒绝数字/URL/路径/命令 | §14.4 |
| AC-20 | SQL injection、非法 order by、恶意 JSON、超长 payload 注入被拒绝 | §14.4 |
| AC-21 | 启动 `PRAGMA journal_mode` 断言为 `wal`;能力/版本不匹配时拒绝写路径并保留 legacy adapter | §3.2/M0 质量门 |
| AC-22 | rules 模式下未创建 Profile/secret/cache/AI usage 行,Insight Core 14 页面仍可运行(本轮验证表结构空载) | §14.5 |

### 5.3 FR 与 AC 追溯

| 功能分组 | FR 范围 | 关联验收标准 |
|---|---|---|
| 平台内核 | FR-PF-001 ~ FR-PF-013 | AC-01/02/03/04/05/06/08/13/14/15/16/17/20/21 |
| 首期迁移 | FR-MIG-001 ~ FR-MIG-012 | AC-02/04/09/10/11/16/22 |
| 工具脚本 | FR-SCRIPT-001 ~ FR-SCRIPT-002 | AC-06/09/17/18 |
| 数据迁移预留 | FR-DATA-001 ~ FR-DATA-002 | AC-07/11/12 |
| 隐私红线 | FR-PRIV-001 ~ FR-PRIV-004 | AC-06/17/18/19/20 |

## 6. 风险评估与应对

| # | 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|---|
| R1 | `node:sqlite` 在 Node 24 仍未达到 Stability 2(stable),API 或行为可能在升级中变化 | 中 | 中高 | 薄 Port(`SqliteDatabasePort`)隔离驱动;Electron/Node 版本精确 pin;启动探针验证 API/能力;必要时切换 `better-sqlite3` adapter(ADR 备选方案) |
| R2 | **本地开发 Node v24.9.0 低于运行时基线 24.18.1**,开发态行为与打包态可能不一致 | 中 | 中 | 开发态探针以 packaged Electron 内置版本为准;CI/打包质量门校验 SQLite ≥ 3.53.1;`node:sqlite` 关键路径测试在 Electron 打包态回归;文档记录基线差异 |
| R3 | WAL 文件生命周期管理不当:checkpoint 延迟、`-wal/-shm` 误删/误复制、磁盘占用膨胀、跨进程所有权冲突 | 中 | 高 | 单 Database Host 唯一写者;checkpoint 仅 Host 管理(autocheckpoint/PASSIVE/TRUNCATE);备份用 `sqlite.backup()` 而非复制文件;启动 journal 断言与崩溃恢复门禁;禁止业务层把 `-wal/-shm` 当普通缓存清理 |
| R4 | 数据库损坏恢复路径失控:打开失败/`quick_check` 失败后静默删除重建,或从错误备份恢复 | 中 | 高 | 故障组隔离(`.corrupt.<timestamp>/`);备份先 `quick_check` 再原子 rename;L2 数据恢复需用户确认;无备份时创建空库 + legacy JSON 导入;严禁启动失败直接删除重建 |
| R5 | 开发态 Electron/Vite 双进程同时写同一 DB | 高 | 高 | M0 明确唯一 Database Host;完成跨进程 broker 前,Electron 主进程管理的数据保持 JSON 兼容源,禁止两边直接写同一 DB;第二写连接必须失败或被串行化 |
| R6 | 正式数据量未知(活跃 usage ≤ 100 万、DB ≤ 2 GB 假设低置信) | 中 | 中 | 首先采集匿名计数/字节基线;达到阈值触发复审与索引/保留策略调整 |
| R7 | 今日洞察表空载死数据:无模型用户不会产生 Profile/secret/AI 行 | 低 | 低 | 表设计已按“无模型时无业务行”划分;Insight Core 不写增强表;rules 模式全功能可用 |
| R8 | SQL CHECK 枚举与 TypeScript/Zod contract 漂移 | 中 | 中 | 实施时从现有 Zod contract 生成/对照枚举;Repository 层 Zod 校验为权威边界 |

## 7. 附录

### 7.1 术语表

| 术语 | 含义 |
|---|---|
| DatabaseHost | 平台层单写连接宿主,唯一持有可写 `DatabaseSync` 实例 |
| SqliteDatabasePort | 平台层契约接口,隔离 `node:sqlite` 驱动 API |
| capability probe | 启动时对运行时版本与 SQLite 能力(JSON1/FTS5/backup/defensive/BigInt)的探测与记录 |
| WAL | SQLite Write-Ahead Log 日志模式;`.db-wal`/`.db-shm` 为运行时状态文件 |
| shadow-write | 迁移期新写同时进入 SQLite 与旧 JSON 的双写模式(M2 起) |
| read switch | 按模块开关将读取切到 SQLite Repository(M6 起) |
| ref_hash | 规范化引用经 `HMAC-SHA256(installSalt, normalizedRef)` 的不可逆哈希,替代绝对路径 |
| L0–L3 | 数据分级:可重建缓存 / 安全投影 / 用户业务资产 / 密钥 |

### 7.2 参考文档

- `docs/architecture/TrustTools-本地存储数据库-架构设计文档.md`(v1.1,2026-08-19)
- `docs/architecture/TrustTools-本地存储数据库-架构决策记录.md`(ADR v1.1,2026-08-19)
- `docs/compliance/CLEAN_ROOM.md`(隐私红线)
- `.skills/document-header/SKILL.md`(文档头规范)
- Node.js SQLite 官方文档:https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- SQLite WAL 文档:https://www.sqlite.org/wal.html
- SQLite Online Backup API:https://www.sqlite.org/backup.html
