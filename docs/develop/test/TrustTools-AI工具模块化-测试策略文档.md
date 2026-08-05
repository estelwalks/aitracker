# TrustTools AI 工具模块化测试策略

| 属性     | 值                           |
| -------- | ---------------------------- |
| 文档类型 | 测试策略文档 (TEST-STRATEGY) |
| 项目名称 | TrustTools-AI工具模块化      |
| 版本     | v1.4                         |
| 创建日期 | 2026-08-05 14:42:59          |
| 更新日期 | 2026-08-05 16:55:05          |
| 生成工具 | test-design                  |
| 文档状态 | 草稿                         |

## 修订记录

| 版本 | 修改时间            | 修改内容                                                |
| ---- | ------------------- | ------------------------------------------------------- |
| v1.4 | 2026-08-05 16:55:05 | 补齐共享策略、安全规则和遗留运行时入口验收              |
| v1.3 | 2026-08-05 16:35:57 | 定价测试改为内建离线规则包与转换/fallback 验证          |
| v1.2 | 2026-08-05 16:12:35 | 补充 legacy/context/价格与跨平台测试矩阵                |
| v1.1 | 2026-08-05 16:00:55 | 调整为内建 JSON loader 测试，移除 override/指定目录加载 |
| v1.0 | 2026-08-05 14:42:59 | 模块化注册表迁移的风险驱动测试策略                      |

## 1. 质量目标

发布安全的最低条件是：配置不能扩展权限或泄露隐私；迁移后所有现有工具能力和账单结果不变；单个工具配置或日志异常不会影响其他工具；回退可以恢复旧实现。

## 2. 风险清单

| ID  | 风险                                          | 概率 | 影响 | 优先级 | 核心验证                                      |
| --- | --------------------------------------------- | ---: | ---: | ------ | --------------------------------------------- |
| R1  | 配置遗漏/重复导致 27 工具目录变化             |   中 |   高 | P0     | 配置与 M0 基线逐项 parity。                   |
| R2  | JSON 语法/Schema 错误、恶意路径或环境变量越界 |   中 |   高 | P0     | loader、realpath、public manifest 脱敏测试。  |
| R3  | Codex/Claude/通用 adapter 解析结果变化        |   中 |   高 | P0     | 同 fixture 的旧新 event 深度比较。            |
| R4  | Session resume 命令或 ID 安全回归             |   低 |   高 | P0     | 三工具 fixture、恶意 ID、只复制不执行。       |
| R5  | 同名模型被错误价格匹配                        |   中 |   高 | P0     | source-aware price 索引、日期/重叠/旧键迁移。 |
| R6  | Skill/Market 写入根错误                       |   中 |   高 | P1     | 多根、CODEX_HOME、冲突、临时目录 E2E。        |
| R7  | 生成 manifest 把私有配置打进 UI               |   中 |   中 | P1     | 生成产物字符串扫描和 bundle 检查。            |
| R8  | 缓存未随内建 JSON 版本变更失效                |   中 |   中 | P1     | `toolRegistryVersion` 变更和旧快照回退。      |
| R9  | 单 Reader/文件故障扩大                        |   中 |   中 | P1     | 故障注入、诊断、上次快照和其他工具连续性。    |
| R10 | AiPy/Cline/custom adapter 未统一迁移          |   中 |   高 | P0     | 29 定义 parity；外部 adapter 文件不再读取。   |
| R11 | macOS/Windows/Linux 路径或状态误解析          |   中 |   高 | P0     | platform resolver fixture 与 OS smoke。       |
| R12 | Context、静态官方价格仍有硬编码               |   中 |   高 | P0     | Reader/rule set 必须由 registry 派生。        |
| R13 | 工具仍为 TS 配置或外部 override 重新被读取    |   中 |   高 | P0     | 固定 JSON import、源码/运行时负向测试。       |
| R14 | 共享策略或内建安全规则迁移后输出漂移          |   中 |   高 | P0     | 策略 parity、规则 schema 与安全防护测试。     |

## 3. 范围与非范围

覆盖 29 个内建 `*.tool.json`、共享 platform/generic reader/scanner/market/taxonomy/pricing JSON、内建 `security-rules.json`、schema loader、探测、context/usage/session Reader 选择、Skill/Agent/Market 计划、价格索引、`toolRegistryVersion` 缓存失效、公共 manifest、macOS/Windows/Linux 状态及 Electron 构建。

不在本次覆盖范围：尚未获得真实样本的 Agent 文件格式、未知工具的新日志协议、远程动态插件/目录及“自动执行恢复命令”。这些能力保持 `unsupported` 或只读状态。

## 4. 测试分层与关键用例大纲

| 层级        | 用例组                                                                            | 数量 | 阻塞级别 |
| ----------- | --------------------------------------------------------------------------------- | ---: | -------- |
| 单元        | Registry/validator：ID、路径、capability、Reader、价格重叠                        |  24+ | P0       |
| 单元        | JSON loader、路径基底、环境覆盖、版本 hash                                        |  14+ | P0/P1    |
| 契约        | 27 可见工具 + 2 legacy、9 Skill Agent、usage/context/session/market 能力基线 diff |  10+ | P0       |
| 集成        | generic/native usage/context Reader、session resume、离线 pricing rule pack 迁移  |  20+ | P0       |
| E2E         | Sources、Skills、Market、Sessions、Dashboard 的可见能力与错误态                   |  10+ | P1       |
| 非功能/运维 | 配置编译耗时、单配置故障隔离、生成产物安全、回滚                                  |   8+ | P1       |

必须优先实现的可执行用例：

1. `TC-REG-001`：27 个产品目录 + AiPy/Cline legacy 共 29 个 `*.tool.json` 经 loader 编译后 ID、display、visibility、detection 输出与 M0 基线完全一致。
2. `TC-REG-002`：JSON 语法错误、重复 ID、未知 Reader、`../`、绝对路径、NUL 和不合法 capability 均产生带文件名的诊断且不生成 registry。
3. `TC-REG-003`：public manifest 不含 `CODEX_HOME`、绝对 home、Reader Key、session command 或 `paths` 字段。
4. `TC-SKL-001`：Codex 空/非空 `CODEX_HOME`、多根目录和 marker 的解析结果与旧 scanner 一致。
5. `TC-USG-001`：Codex、Claude、generic JSON/JSONL/SQLite fixture 的新旧事件逐字段相等；坏文件只产生该工具诊断。
6. `TC-SES-001`：Codex/Claude/Grok session 汇总和 resume command 相等；`foo; rm -rf /` 始终 `resumeSafe=false`。
7. `TC-PRC-001`：相同 model、不同 `source` 的规则使用各自价格；同优先级重叠构建失败。
8. `TC-PRC-002`：断网、空缓存、无外部配置目录时，内建 pack 的 source-aware 转换、费率和 estimated/unpriced 结果保持一致。
9. `TC-REG-004`：修改任一内建 JSON 后生成的 `toolRegistryVersion` 改变，旧缓存不被复用；应用运行时不会读取指定目录或外部文件。
10. `TC-E2E-001`：不支持能力的工具在 Sources/Skills/Market 中一致隐藏或禁用，其他工具和页面功能不受影响。
11. `TC-PLAT-001`：macOS、Windows 10、Windows 11 对同一工具配置分别返回正确 path plan；Windows group 默认共享且仅差异时精确覆盖。
12. `TC-PLAT-002`：Linux XDG base 正确展开，所有未验证 capability 显示 `planned` 且不触发扫描。
13. `TC-CTX-001`：Codex/Claude context reader 和 breakdown 的新旧 fixture 等价；不支持工具不出现 context UI。
14. `TC-REG-005`：`usage-adapters.json` 即使存在也不被读取，且不存在 `custom:*` source。
15. `TC-REG-006`：生成的固定 import 清单只含 29 个 `*.tool.json`、显式 shared/specialized pack；应用运行时没有 `*.config.ts`、`tool-overrides.json` 或任意外部目录配置读取。
16. `TC-POL-001`：generic mapping、扫描预算/缓存、Skill Market 排序、用量 taxonomy 均由共享策略包派生，和 M0 基线结果一致；缺失引用或同级冲突阻塞编译。
17. `TC-SEC-001`：`security-rules.json` 的规则输出与 M0 基线一致；非法/高风险 pattern 被构建期拒绝，用户个人安全状态不能改变内建规则执行，运行期 ReDoS 防护仍生效。
18. `TC-BRG-001`：TokenTracker bridge 不再自动执行、不再以 alias 改写来源；孤立手工迁移路径不参与正常扫描或计费。

## 5. 环境、数据与运维演练

- 使用临时 HOME、临时 `CODEX_HOME`、伪造工具根目录和匿名 JSON/JSONL/SQLite fixture；测试不得访问真实用户 home 或真实对话。
- M0 基线快照随仓库提交；任何有意差异必须包含 `expected-diff.md`、原因、责任人和批准记录。
- 在 CI 中依次执行 registry verifier、相关 Node tests、`npm run lint`、`npx tsc --noEmit`、E2E、macOS/Windows build；加入“不读取外部 override/adapter、无 TS tool config、共享策略引用完整、内建安全规则安全”负向检查。Windows 10/11 各一套 smoke。Linux 首期执行 schema/XDG/planned-state job，Reader/打包 job 在 Linux milestone 启用。
- 演练两种回退：关闭新 registry feature flag；恢复上一次正常 `toolRegistryVersion` 的缓存。验证不需要数据迁移或用户手动清理。

## 6. 准入、准出与开放风险

准入：M0 基线已冻结，所有 Reader fixture 已匿名化，feature flag 和兼容导出均可用。

准出：全部 P0/P1 用例通过；registry verifier 无诊断；新旧 parity 无未批准差异；公共 manifest/bundle 脱敏断言通过；无外部 tool override/adapter 读取、无业务可读的 TS 工具配置或平行共享常量；构建与 E2E 通过；每个 Task 有独立验收报告和可回退 commit。

开放风险：Agent 目录格式尚未确认，故不作为本次准出能力；通用估算 fallback 的正式基准费率待运营核验，未确认时必须返回 `unpriced` 而非零价。

## 7. 自检摘要

- 已覆盖：配置、路径、集成、缓存、回滚、价格、隐私和 UI 可见性的高风险路径。
- 遗留待确认：团队对性能目标、Agent 格式和通用估算费率的业务要求；它们已被隔离为后续 capability 开启门槛。
- 假设：现有 Node 单测、Playwright 与 Electron build 可在 CI 运行（中等置信）。
