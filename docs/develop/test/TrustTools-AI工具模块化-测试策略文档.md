# TrustTools AI 工具模块化测试策略

| 属性     | 值                           |
| -------- | ---------------------------- |
| 文档类型 | 测试策略文档 (TEST-STRATEGY) |
| 项目名称 | TrustTools-AI工具模块化      |
| 版本     | v1.0                         |
| 创建日期 | 2026-08-05 14:42:59          |
| 更新日期 | 2026-08-05 14:42:59          |
| 生成工具 | test-design                  |
| 文档状态 | 草稿                         |

## 修订记录

| 版本 | 修改时间            | 修改内容                           |
| ---- | ------------------- | ---------------------------------- |
| v1.0 | 2026-08-05 14:42:59 | 模块化注册表迁移的风险驱动测试策略 |

## 1. 质量目标

发布安全的最低条件是：配置不能扩展权限或泄露隐私；迁移后所有现有工具能力和账单结果不变；单个工具配置或日志异常不会影响其他工具；回退可以恢复旧实现。

## 2. 风险清单

| ID  | 风险                                   | 概率 | 影响 | 优先级 | 核心验证                                        |
| --- | -------------------------------------- | ---: | ---: | ------ | ----------------------------------------------- |
| R1  | 配置遗漏/重复导致 27 工具目录变化      |   中 |   高 | P0     | 配置与 M0 基线逐项 parity。                     |
| R2  | 恶意路径、环境变量或 override 越界     |   中 |   高 | P0     | validator、realpath、public manifest 脱敏测试。 |
| R3  | Codex/Claude/通用 adapter 解析结果变化 |   中 |   高 | P0     | 同 fixture 的旧新 event 深度比较。              |
| R4  | Session resume 命令或 ID 安全回归      |   低 |   高 | P0     | 三工具 fixture、恶意 ID、只复制不执行。         |
| R5  | 同名模型被错误价格匹配                 |   中 |   高 | P0     | source-aware price 索引、日期/重叠/旧键迁移。   |
| R6  | Skill/Market 写入根错误                |   中 |   高 | P1     | 多根、CODEX_HOME、冲突、临时目录 E2E。          |
| R7  | 生成 manifest 把私有配置打进 UI        |   中 |   中 | P1     | 生成产物字符串扫描和 bundle 检查。              |
| R8  | 缓存未随配置变更失效                   |   中 |   中 | P1     | fingerprint 变更、旧快照回退和原子写入。        |
| R9  | 单 Reader/文件故障扩大                 |   中 |   中 | P1     | 故障注入、诊断、上次快照和其他工具连续性。      |

## 3. 范围与非范围

覆盖 registry、工具 config、用户 override、探测、Skill/Agent/Market 计划、usage/session Reader 选择、价格索引、缓存 fingerprint、公共 manifest、现有页面回归及 Electron 构建。

不在本次覆盖范围：尚未获得真实样本的 Agent 文件格式、未知工具的新日志协议、远程动态插件/目录及“自动执行恢复命令”。这些能力保持 `unsupported` 或只读状态。

## 4. 测试分层与关键用例大纲

| 层级        | 用例组                                                          | 数量 | 阻塞级别 |
| ----------- | --------------------------------------------------------------- | ---: | -------- |
| 单元        | Registry/validator：ID、路径、capability、Reader、价格重叠      |  24+ | P0       |
| 单元        | 路径基底、环境覆盖、override 合并、fingerprint                  |  14+ | P0/P1    |
| 契约        | 27 工具、9 Skill Agent、usage/session/market 能力的基线 diff    |   8+ | P0       |
| 集成        | generic/native Reader、session resume、pricing snapshot 迁移    |  18+ | P0       |
| E2E         | Sources、Skills、Market、Sessions、Dashboard 的可见能力与错误态 |  10+ | P1       |
| 非功能/运维 | 配置编译耗时、单配置故障隔离、生成产物安全、回滚                |   8+ | P1       |

必须优先实现的可执行用例：

1. `TC-REG-001`：27 个 config 编译后 ID、display、detection 输出与 M0 固化基线完全一致。
2. `TC-REG-002`：重复 ID、未知 Reader、`../`、绝对路径、NUL 和不合法 capability 均产生定位诊断且不生成 registry。
3. `TC-REG-003`：public manifest 不含 `CODEX_HOME`、绝对 home、Reader Key、session command 或 `paths` 字段。
4. `TC-SKL-001`：Codex 空/非空 `CODEX_HOME`、多根目录和 marker 的解析结果与旧 scanner 一致。
5. `TC-USG-001`：Codex、Claude、generic JSON/JSONL/SQLite fixture 的新旧事件逐字段相等；坏文件只产生该工具诊断。
6. `TC-SES-001`：Codex/Claude/Grok session 汇总和 resume command 相等；`foo; rm -rf /` 始终 `resumeSafe=false`。
7. `TC-PRC-001`：相同 model、不同 `source` 的规则使用各自价格；同优先级重叠构建失败。
8. `TC-PRC-002`：`toolId:model` 动态快照优先，旧 model key 仅在无歧义时兼容并产生迁移计数。
9. `TC-OVR-001`：损坏 override 退回内建定义；非法覆盖 Reader/command/pricing 被拒绝；写入使用 temp+rename。
10. `TC-E2E-001`：禁用工具在 Sources/Skills/Market 中一致隐藏或禁用，其他工具和页面功能不受影响。

## 5. 环境、数据与运维演练

- 使用临时 HOME、临时 `CODEX_HOME`、伪造工具根目录和匿名 JSON/JSONL/SQLite fixture；测试不得访问真实用户 home 或真实对话。
- M0 基线快照随仓库提交；任何有意差异必须包含 `expected-diff.md`、原因、责任人和批准记录。
- 在 CI 中依次执行 registry verifier、相关 Node tests、`npm run lint`、`npx tsc --noEmit`、`npm run test:e2e`、`npm run build`、`npm run build:electron`。
- 演练两种回退：关闭新 registry feature flag；恢复上一次正常 `registryFingerprint` 的缓存。验证不需要数据迁移或用户手动清理。

## 6. 准入、准出与开放风险

准入：M0 基线已冻结，所有 Reader fixture 已匿名化，feature flag 和兼容导出均可用。

准出：全部 P0/P1 用例通过；registry verifier 无诊断；新旧 parity 无未批准差异；公共 manifest/bundle 脱敏断言通过；构建与 E2E 通过；每个 Task 有独立验收报告和可回退 commit。

开放风险：Agent 目录格式尚未确认，故不作为本次准出能力；动态价格源的 SLA/授权待确认，网络失败必须维持现有缓存/离线 fallback 语义。

## 7. 自检摘要

- 已覆盖：配置、路径、集成、缓存、回滚、价格、隐私和 UI 可见性的高风险路径。
- 遗留待确认：团队对性能目标、Agent 格式和动态价格源的业务要求；它们已被隔离为后续 capability 开启门槛。
- 假设：现有 Node 单测、Playwright 与 Electron build 可在 CI 运行（中等置信）。
