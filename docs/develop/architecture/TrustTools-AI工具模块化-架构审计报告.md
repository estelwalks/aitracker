# TrustTools AI 工具模块化架构审计报告

| 属性     | 值                        |
| -------- | ------------------------- |
| 文档类型 | 架构审计报告 (ARCH-AUDIT) |
| 项目名称 | TrustTools-AI工具模块化   |
| 版本     | v1.3                      |
| 创建日期 | 2026-08-05 14:42:59       |
| 更新日期 | 2026-08-05 16:55:05       |
| 生成工具 | architecture-audit        |
| 文档状态 | 草稿                      |

## 修订记录

| 版本 | 修改时间            | 修改内容                                 |
| ---- | ------------------- | ---------------------------------------- |
| v1.3 | 2026-08-05 16:55:05 | 审计共享策略、安全规则及遗留入口清理边界 |
| v1.2 | 2026-08-05 16:12:35 | 补齐遗漏能力与跨平台配置统一管理审计结论 |
| v1.1 | 2026-08-05 16:00:55 | 确认 JSON 内建定义及无运行时目录加载边界 |
| v1.0 | 2026-08-05 14:42:59 | 对模块化架构及迁移计划的实施前审计       |

## Findings

### P1 已修正：价格查询缺少工具上下文

- **受影响章节**：架构文档 §6、§8.2；现有 `src/lib/pricing/index.ts` 的 `findModelPrice(model)`。
- **问题与影响**：当前实现仅按 model 查询；若同一模型别名在不同工具/供应商计费不同，会静默采用错误价格，属于费用正确性风险。
- **证据**：现有 `estimateEventCost(event)` 未使用 `event.source`；初稿虽然提出“每工具价格”，但未定义运行时键迁移。
- **修订方向与状态**：已在架构 v1.1 明确所有查询接收 source/toolId，动态快照使用 `toolId:model` 键，并规定旧键双读兼容和歧义诊断。M5-T3/T4 必须以此为验收标准。

### P2：Agent 目录的实际契约尚未验证

- **受影响章节**：架构文档 §6、§12；Epic M3。
- **问题与影响**：用户要求模块化 Agent 目录，但现有工程已验证的是 Skill roots，尚无每个工具 Agent 文件格式、读写权限和安全边界的证据。直接将目录开启为可写能力可能误写用户配置。
- **证据**：现有 `SKILL_AGENT_RULES` 只配置 marker/Skill 目录；没有 Agent 格式 schema 或扫描器。
- **修订方向**：M3 先交付 `agents: unsupported` 的显式模型和只读探测接口；仅针对有真实样本、fixture、格式说明的工具逐个开启读取/写入。写入能力需要额外的备份、原子写入、回滚和 E2E 验收。

### P2：公共 manifest 的打包边界需要硬性保证

- **受影响章节**：架构文档 §5、§7。
- **问题与影响**：若 UI 直接导入包含路径与恢复模板的完整 config，即使 API 投影省略字段，打包产物仍可能含这些数据。
- **证据**：初稿只提出 `public-manifest.ts`，未规定其生成/导入方式。
- **修订方向与状态**：已在架构 v1.2 改为 `public-manifest.generated.ts`，由内建 JSON 经 schema loader 和 registry 生成；M1-T3 必须测试生成文件不含绝对路径、环境变量、Reader Key、command 或 pricing credential。

### P2 已收敛：不引入运行时工具目录加载

- **受影响章节**：架构文档 §4、§5、§8；实施计划 M1/M2。
- **问题与影响**：允许任意指定目录的 JSON/YAML 在运行时加载会扩大路径、兼容、发布一致性和供应链边界；当前需求并不需要该能力。
- **修订方向与状态**：架构 v1.2 改为仓库内固定 `definitions/*.tool.json`，只在 build/prebuild 期生成 import 清单和 public manifest。运行时不扫描目录、不接受外部路径、不提供 override 文件；未来若需扩展，必须先通过单独 ADR 设计签名包与信任链。

### P1 已修正：遗留来源、上下文与静态价格仍存在分散事实源

- **受影响章节**：架构文档 §5、§6、§8、§12；实施计划 M0/M2/M4/M5。
- **问题与影响**：仅迁移产品目录中的 27 个工具会遗漏 AiPy/Cline；`usage-adapters.json` 仍能在运行时产生 `custom:*` 来源；Codex/Claude context breakdown 及 `OFFICIAL_PRICES` 仍依赖硬编码实现，无法满足“工具相关事实统一配置”的目标。
- **修订方向与状态**：架构 v1.5 已要求 27 个可见工具加 AiPy/Cline 两个 `catalogVisible=false` legacy JSON，共 29 个定义；删除外部 adapter 入口；以 `ContextReader` capability 声明原生上下文读取能力；将 `MODEL_PRICES`/`OFFICIAL_PRICES` 迁入专项离线价格规则集。Reader/I/O 实现仍保留 TypeScript，但不得保留动态模型价格拉取或把规则写成可执行代码。

### P1 已修正：跨平台路径未形成可验证的统一模型

- **受影响章节**：架构文档 §5、§6.1、§7、§15；实施计划 M0/M1/M2/M3/M6。
- **问题与影响**：若各工具分别复制 macOS、Windows 路径，Windows 10/11 的共同规则会漂移，Linux 预留也可能被错误地当作已支持能力扫描。
- **修订方向与状态**：架构 v1.5 定义 `macos`、`windows10`、`windows11`、`linux` target，以及 `windows` group；共享 `_shared/platform-profiles.json` 通过引用复用。解析优先级为共享默认 < 平台组 < 平台 target < 工具覆盖。Linux 仅按 XDG 和 `planned` 状态建模，首期不得启动探测、Reader 或打包承诺；macOS、Windows 10、Windows 11 则为 smoke 必测目标。

### P1 已纳入计划：工具元数据与运行时扩展入口尚未彻底收敛

- **受影响章节**：架构文档 §4–§7；实施计划 M2、M4、M6；测试策略 TC-REG-005/006。
- **问题与影响**：当前仓库仍有 27 个 `*.config.ts` 工具配置，`~/.trusttools/tool-overrides.json`、`usage-adapters.json` 和 `custom:*` 仍可改变工具或用量来源。若只增加 JSON 而不删除这些入口，系统会存在两个权威来源，无法保证离线发布的一致性。
- **证据**：代码检索得到 27 个 `src/lib/tool-registry/tools/*.config.ts`，并发现 `overrides.server.ts` 与 external usage adapter loader 的运行时读取路径。
- **修订方向与状态**：总计划 M6-T2 明确删除这些并行入口及其业务引用；固定 import 清单只允许 29 个工具 JSON 与 manifest 列出的内建共享/专项包。测试必须证明即使外部文件存在也不会被读取。

### P1 已纳入计划：共享策略仍有硬编码所有者

- **受影响章节**：架构文档 §6.2；实施计划 M0、M1、M3、M4、M6；测试策略 TC-POL-001。
- **问题与影响**：`COMMON_MAPPING`、`USAGE_ADAPTER_PRESETS`、扫描器预算/缓存、`SKILL_AGENT_ORDER`、用量 taxonomy、session 白名单/展示名和 bridge alias 属于可随工具能力变化的业务规则；散落在 TypeScript 会导致新增工具仍需跨多处改动。
- **修订方向与状态**：它们分别迁入 generic reader、scanner、market、taxonomy 和工具 session/shared policy；工具 JSON 只保存引用。Reader、路径解析、resume 安全、I/O 与缓存执行机制保留在 TypeScript，避免 JSON 成为执行面。

### P2 已纳入计划：内建安全扫描规则缺少受控数据边界

- **受影响章节**：架构文档 §6.2；实施计划 M1、M6；测试策略 TC-SEC-001。
- **问题与影响**：安全扫描 `RULES`/pattern 当前在 TypeScript 中，既不便于审计规则版本，也不能与工具配置治理统一；但把任意用户 regex 直接放入 JSON 会引入 ReDoS 和行为注入风险。
- **修订方向与状态**：内建规则迁入随客户端发布的 `_rules/security-rules.json`，只允许受限 schema、唯一规则 ID、类别、等级和经构建期安全检查的 pattern；匹配解释器、长度限制、超时/ReDoS 防护仍固定在 TypeScript。用户个人安全规则保留为隔离状态，不能覆盖内建规则或任何工具能力。

## 审计假设与总体风险

方案在落实 M6 的共享策略、安全规则与遗留入口清理后，满足模块边界、失败隔离、回滚和可测试性要求，适合在当前单仓库桌面客户端中实施。未发现 P0 阻塞项。剩余主要风险是“外部工具真实目录/日志格式的证据不足”，应以每工具 fixture 和 `unsupported` 的保守状态控制，而不是用推断填补。

运行与发布仍需确认：目标团队规模、性能/SLA、通用估算 profile 的初始费率。模型价格不使用动态价格源或运行时刷新；它们不阻塞 P1 的 registry 内核，但会影响后续 Agent 写入、Linux 真实支持和远程配置中心的独立规划。
