# TrustTools 本地存储数据库技术选型决策

| 属性 | 值 |
|------|-----|
| 文档类型 | 架构决策记录 (ADR) |
| 项目名称 | TrustTools-本地存储数据库 |
| 版本 | v1.2 |
| 创建日期 | 2026-08-19 11:12:47 |
| 更新日期 | 2026-08-20 |
| 生成工具 | tech-selection + document-header |
| 文档状态 | 已接受 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v1.2 | 2026-08-20 | 按新项目模式定稿：移除 legacy 回退/迁移路线，SQLite 为唯一应用存储权威；状态改为 accepted |
| v1.1 | 2026-08-19 11:53:04 | 将运行时基线更新为 Electron 43.4.1 / Node 24.18.1 / SQLite 3.53.1，确认 WAL 版本缺陷已修复并采用 WAL 默认策略 |
| v1.0 | 2026-08-19 11:12:47 | 完成嵌入式数据库、Node 驱动、日志模式和访问层选型 |

---

## 1. 状态

accepted

## 2. 决策范围

为 TrustTools 桌面端选择一个本地小型数据库，用于逐步替代分散的 `AtomicJsonStore`、Electron 偏好文件和业务缓存，并承载今日洞察的可选增强缓存与预算账本。外部 Agent 的 JSON/JSONL/SQLite 日志继续只读，不导入原始正文或源码。

当前约束：

- Electron 已升级到 43.4.1；开发态能力探针显示内置 Node 24.18.1、Chromium 150.0.7871.224、SQLite 3.53.1。
- 模块化单体、本地优先、单用户、Windows/macOS 桌面部署；浏览器 renderer 不允许直接打开数据库。
- 当前仓库已在 `scanner.server.ts` 使用 `node:sqlite` 读取外部数据库。
- 现有业务通过 Repository/Port 访问 `AtomicJsonStore`，适合在基础设施层替换适配器。
- 数据量尚无正式上限；设计假设活跃窗口不超过 100 万 usage event、数据库文件不超过 2 GB。

## 3. 方案对比

| 方案 | 业务适配度 | 交付速度 | 运维/打包 | 性能与查询 | 主要风险 | 结论 |
|---|---|---|---|---|---|---|
| SQLite + `node:sqlite` | 高：事务、关联、FTS5、JSON 均满足 | 高：仓库已使用，零新增运行时依赖 | 低：随 Electron/Node 分发，无独立服务 | 单机读写和百万级本地索引匹配 | Node 24 API 仍未达到 Stability 2；SQLite 版本随 Electron 固定 | **采用**，通过薄 Port、精确版本和启动探针隔离 |
| SQLite + `better-sqlite3` | 高 | 中 | 中高：原生 addon 需按 Electron ABI 重建、签名和多平台验证 | 成熟同步 API，性能良好 | 供应链、ABI、打包和升级成本增加 | 作为 `node:sqlite` 不可用时的备选驱动，不作为首选 |
| libSQL/本地同步客户端 | 中 | 中低 | 中高：增加客户端/同步语义 | 支持远程同步和扩展 | 当前无云同步需求，增加隐私和运维面 | 不采用；出现跨设备同步需求时复审 |
| 保持多份 Atomic JSON | 低到中 | 最高 | 低 | 读全文件、关联/N+1、并发写和增长性较差 | 文件数量和 schema 漂移继续扩大 | 不采用；JSON 存储代码已删除，不再作为任何存储 |

## 4. 决策

1. 采用单文件 SQLite，目标路径为 `~/.trusttools/data/trusttools.v1.db`。
2. 首选驱动为 `node:sqlite` 的 `DatabaseSync`，封装在 `SqliteDatabasePort` 后；业务模块只依赖 Repository，不依赖驱动 API。
3. 不引入 ORM。使用版本化 SQL migration、prepared statement、明确事务和 Zod 边界校验；避免再维护一套 ORM schema 与 SQL schema。
4. 以 Electron 43.4.1 / Node 24.18.1 / SQLite 3.53.1 为首发运行时基线，直接使用 `journal_mode=WAL`、`synchronous=FULL`、`wal_autocheckpoint=1000`、`foreign_keys=ON`、`busy_timeout=5000`、`trusted_schema=OFF`；禁止在多进程中同时持有写连接。
5. 初始化必须确认 `PRAGMA journal_mode=WAL` 返回 `wal`；失败即致命（关闭连接、记录稳定错误码并让启动失败），不存在 JSON 回退路径。checkpoint 仅由 Database Host 管理，备份使用 `sqlite.backup()`，不能只复制 `.db` 而遗漏 `-wal/-shm` 状态。
6. `DatabaseSync` 显式启用 `readBigInts`、`defensive` 和严格命名参数，禁用 extension；Repository 承担 BigInt 边界转换与 DTO 校验。
7. renderer 不获得数据库路径、连接或任意 SQL 能力；不存在 `executeSql` 通用接口。所有读写经 server/Electron trusted boundary 的固定 Repository 方法。
8. API Key 不以明文列存储。模型 Profile 与密钥分表，密钥使用 Electron `safeStorage`/操作系统凭据能力加密后存为 BLOB；无法加密时不自动迁移明文密钥，要求用户重新录入。
9. 原始会话正文、Skill 源码、完整命令、绝对路径和外部数据库内容不进入应用数据库；仅保存现有的浏览器安全投影、聚合量和不可逆指纹。

## 5. 权衡

收益：

- 跨 reports/knowledge/tasks/insights 的事务边界清晰，避免整份 JSON read-modify-write。
- usage/session/search 可按索引分页和聚合，不再解析整份快照。
- 单文件便于版本迁移、完整性检查、备份和恢复。
- 现有 Repository/Port 允许按模块渐进替换，不需要一次重写全部业务。

代价：

- 需要维护 migration、索引、备份与损坏恢复，而不是只维护 Zod 文件 schema。
- `DatabaseSync` 是同步 API，禁止在 UI/renderer 或长事务中调用；批量导入必须分块准备、单事务提交。
- WAL 增加了 checkpoint、`-wal/-shm` 生命周期和磁盘占用管理，但换取读写互不阻塞；通过单 Database Host 和在线 backup 将运维复杂度集中在平台层。
- FTS5、JSON 和 backup 能力必须在启动时探测，不能假定所有未来 Electron 构建一致。

## 6. 后果

- 新增 `platform/database`，拥有连接生命周期、migration、事务、备份、完整性检查和测试 fixture。
- 每个业务模块新增 SQLite Repository adapter；Domain/Application contract 保持不变。
- 无迁移期：全新安装直接使用 SQLite；JSON 存储代码已删除，不存在只读回滚或 legacy 归档。
- 开发态若 Electron 主进程和 Vite server 是两个进程，只允许一个进程成为 Database Host；另一个进程必须通过现有 IPC/本地可信接口调用，禁止双写连接。
- 备份使用 Node `sqlite.backup()`/SQLite Online Backup API；不能在数据库打开时只复制 `.db` 文件。

## 7. 复审触发条件

- 活跃数据库超过 2 GB、usage events 超过 100 万或关键查询 P95 超过 200 ms。
- 需要多用户、云同步、跨设备合并或多个进程同时写入。
- Electron 升级导致 `node:sqlite` API/能力、SQLite 编译选项或内置版本变化，或项目无法接受其非 Stability 2 状态。
- 需要数据库级全文中文分词、向量检索或加密数据库文件。
- WAL checkpoint 延迟、文件膨胀或杀进程恢复不满足发布门禁，需要回退到 rollback journal。

## 8. 依据

- Node 24 官方文档说明 `DatabaseSync` 全部 API 为同步调用，并提供 busy timeout、`readBigInts`、defensive mode 和在线 backup：[Node.js SQLite 文档](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)。
- 当前项目开发态探针实测 Electron 43.4.1 内置 Node 24.18.1 与 SQLite 3.53.1；Electron 版本由依赖精确锁定：[Electron 43 发布记录](https://releases.electronjs.org/release?channel=stable&major=v43)。
- SQLite 官方说明 WAL 允许并发读写但仍只有一个 writer，且数据库、`-wal`、`-shm` 是一组持久状态；WAL-reset 缺陷已在 3.51.3 及之后版本修复：[SQLite WAL](https://www.sqlite.org/wal.html)。
- SQLite 官方推荐在线 Backup API 生成运行中数据库的一致快照：[SQLite Backup API](https://www.sqlite.org/backup.html)。
