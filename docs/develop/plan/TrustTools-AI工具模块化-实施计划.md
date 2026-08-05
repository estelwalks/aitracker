# TrustTools AI 工具模块化 — 实施计划（执行版）

| 属性 | 值                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 依据 | 架构设计 v1.5 / 定价架构 v1.1 / 敏捷任务清单 v1.4 / 测试策略 v1.4 / 架构审计 v1.3                               |
| 分支 | `feature/init`（按要求保持当前分支，不新建 codex/ 分支）                                                        |
| 范围 | 全量 M0 → M6，每 Task 独立测试 + commit                                                                         |
| 前置 | 先提交未完成的 Skill WIP（`resolveAgentRoots` 从 `agent-rules.ts` 迁到 `scanner.server.ts`）作为独立前置 commit |

## 0. 执行原则与约束

- 绞杀式迁移：先建 registry → 旧目录改为从 registry 派生的兼容导出 → 逐消费者切流 → 最后删除旧事实源。迁移结束前不删除旧导出。
- 每 Task 收尾执行：`npm run format`（仅改动文件）→ `npm run lint` → `npx tsc --noEmit` → 相关 `node --test` → 独立 commit。
- 隐私红线：配置/Reader/manifest 不得读取或持久化对话正文；公共 manifest 不得含绝对路径、环境变量名、Reader Key、恢复命令、`paths`。
- 路径安全：所有配置路径为相对路径或受控基底（`home`/白名单 env）；校验器拒绝绝对路径、`..`、NUL、超长字段。
- 不改写已推送历史（Lovable 连接）；每步保持可构建。
- Agent 目录本期一律 `unsupported`（审计 P2：无真实样本不得开启写入）。
- 工具定义固定为仓库内 `definitions/*.tool.json`：只在 build/prebuild 读取；不支持用户指定目录、市场目录、网络目录、override 文件或运行时重新加载。
- 平台目标：macOS、Windows 10、Windows 11；Linux 仅预留 XDG path profile 和 `planned` capability，未经 fixture/Reader/打包验证不得扫描或标为 supported。
- 所有受支持来源均有 JSON：27 个产品目录工具 + `aipy`/`cline` legacy（`catalogVisible=false`）；删除 `usage-adapters.json` 与 `custom:*` 的运行时扩展入口。
- 配置分为工具定义、共享策略和专项规则包三层：工具 JSON 仅保存工具专属声明/引用，不复制平台、通用 Reader、扫描预算、市场策略、分类、定价或内建安全规则。
- 禁止保留用户 `tool-overrides.json`、外部 adapter 或任意目录 loader；用户安全规则属于独立用户状态，不得改变工具探测、Reader、价格、会话命令或内建安全规则包。

## 1. 前置 commit：Skill WIP

提交 `agent-rules.ts` / `scanner.server.ts` 的未提交改动（`resolveAgentRoots` 迁移 + 浏览器 bundle 纯净化说明）。

- 验收：`tsc --noEmit`、`node --test src/lib/tools/catalog.test.ts src/lib/local-skills/scanner.server.test.ts` 通过。
- commit: `refactor(skills): 迁 resolveAgentRoots 至 scanner.server 以保持 agent-rules 浏览器纯净`

## 2. Epic M0 — 冻结基线与验收（3 Task）

- **M0-T1 机器可读基线**：固化 27 个产品目录工具 + AiPy/Cline legacy（id/nameZh/catalogVisible/platform paths）、9 Skill Agent、usage/context adapter 源+paths、3 session 源、`MODEL_PRICES` 与 `OFFICIAL_PRICES`，以及 `COMMON_MAPPING`、扫描器预算/缓存、Skill Market 排序、用量分类、内建安全规则版本和 TokenTracker bridge alias。配 parity 测试断言当前各 catalog 与基线逐项相等，并记录用户安全状态与内建规则包的边界。
- **M0-T2 对照 fixture**：在 `__baseline__/fixtures/` 放匿名化的 detection/skill-roots/pricing/session-resume fixture（复用现有测试数据），供后续 parity 用例。
- **M0-T3 验证脚本 + feature flag + 回退说明**：
  - `scripts/verify-tool-registry.mjs`：编译 registry、打印工具数/能力数/价格规则数/诊断，非 0 诊断则 exit 1。
  - `src/lib/tool-registry/feature-flag.ts`：`isToolRegistryEnabled()`（读 `TRUSTTOOLS_TOOL_REGISTRY`，默认迁移未完成阶段按需开启）。
  - `npm run verify:tool-registry` 脚本注册到 package.json。
  - 回退说明写入本文件 §8。

## 3. Epic M1 — 注册表内核与配置契约（4 Task）

目录 `src/lib/tool-registry/`：

- **M1-T1 `contracts.ts` + `schema.ts`**：用 Zod 定义 `ToolDefinition`（id/configVersion/catalogVisible/display/platforms/detection/storage/capabilities/pricing）、能力判别联合（usage/context/skills/agents/sessions/market/security）、Reader Key、`ModelRateRule`、平台 target/group、路径基底类型，并从 schema 推导 TypeScript 类型；启用 `resolveJsonModule`。
- **M1-T2 共享 JSON 与平台 resolver**：新增 `_shared/platform-profiles.json`、`generic-reader-defaults.json`、`scanner-policy.json`、`skill-market-policy.json`、`usage-taxonomy.json`、`pricing-manifest.json` 和 `_rules/security-rules.json`；实现引用展开优先级 `shared < platform group < platform target < tool`，拒绝循环/未知引用/同级冲突。
- **M1-T3 `loader.ts` + `validate.ts`**：解析内建 JSON、补齐默认值；校验器返回带文件名的 `ValidationDiagnostic[]`，覆盖 JSON 语法、29 个来源的唯一 ID、平台 location、planned/supported 状态、context Reader、绝对/遍历/NUL 路径、非法 capability、未知 Reader、价格重叠、策略引用和受限安全规则。
- **M1-T4 `registry.ts` + 公共 manifest**：
  - `compileToolRegistry(defs)`：按 id 建 Map、按 capability 建索引、编译路径/价格计划、生成 `PublicToolManifest`。
  - API：`getTool`/`requireTool`/`listTools({capability})`/`resolvePlatformPlan`/`getUsagePlan`/`getContextPlan`/`getSkillPlan`/`getAgentPlan`/`getSessionPlan`/`listSessionTools`/`getToolDisplay`/`findModelRate({toolId,model,occurredAt})`/`getPublicTools()`。
  - `scripts/generate-tool-imports.mjs` 只扫描仓库内固定 definitions 目录，生成 `definitions.generated.ts` 的显式 JSON import 清单；`scripts/generate-tool-manifest.mjs` 从 registry 生成 `public-manifest.generated.ts`（均 gitignore，prebuild 生成）；`getPublicTools()` 为运行时纯投影（服务端用）。
  - 测试：生成文件字符串扫描不含敏感字段（TC-REG-003）。
- **M1-T5 内建版本与缓存键**：由 canonical JSON（含 shared profile/rule set）计算 `toolRegistryVersion`（sha256）；写入生成产物并接入缓存元数据。测试：修改任一 JSON hash 必变、损坏 JSON 阻塞 build、应用运行时无目录扫描/外部文件读取（TC-REG-004）。

质量门：registry/validator/pricing compiler 单测 100% 分支意图；本 Epic 不改任何业务消费者。

## 4. Epic M2 — 工具目录与安装探测迁移（4 Task）

- **M2-T1 29 个 JSON 定义**：`definitions/*.tool.json`，27 个产品目录工具 + `aipy`/`cline` legacy；每个含 display/platforms/detection + 全 capability `unsupported`。legacy source 设置 `catalogVisible=false`。文件名必须等于 `<id>.tool.json`。
- **M2-T2 生成清单 + 跨平台一致性测试**：由固定内建目录生成 `definitions.generated.ts`，导出 `RAW_TOOL_DEFINITIONS`；测试断言定义数=29、id 与文件名一致、27 个可见工具的 id/nameZh、legacy 状态和 macOS/Windows/Linux resolver 输出均与 M0 基线/预期相等。禁止在应用运行时遍历该目录。
- **M2-T3 兼容导出 + 探测切流**：`src/lib/tools/catalog.ts` 的 `AI_TOOLS`/`AI_TOOL_IDS`/`usageLogParsingFor` 改为从 registry 派生的兼容导出（保持签名不变）；`detection.server.ts` 读 `listTools()`/detection plan。Sources/onboarding 间接经 `AI_TOOLS` 自动跟随。feature flag 关闭时回退旧静态数组（保留旧常量于 `catalog.legacy.ts` 直到 M6）。
- **M2-T4 三态/跨平台回归**：对比 27 个可见工具 installed/not-installed 三态及 macOS、Windows 10、Windows 11 probe 路径与基线一致；Linux 仅验证 XDG/planned plan 且不触发扫描；`detection.server.test.ts` 全绿。

## 5. Epic M3 — Skill/Agent/市场能力迁移（4 Task）

- **M3-T1 Skill 数据迁入 JSON**：将 `SKILL_AGENT_RULES` 的 roots/markers/maxDepth/envHome 写入对应 9 个工具的 `storage.skills`，并按 macOS/Windows/Linux path profile 声明；其余工具 `skills: unsupported`。Agent 一律 `agents: unsupported`。
- **M3-T2 `getSkillPlan()`/`getAgentPlan()`**：实现受控 env 解析（`CODEX_HOME`/`GROK_HOME`）+ 跨平台路径解析/安全检查；`agent-rules.ts` 改为从 registry 派生兼容导出；scanner 改读 `getSkillPlan`。保留 `resolveAgentRoots` 签名。
- **M3-T3 市场目标派生**：market install target / 安装校验 / 类型从 `capabilities.market === "install-target"` && `capabilities.skills.mode === "read-write"` 派生；安装排序、展示分组和策略从 `_shared/skill-market-policy.json` 读取，不再保留 `SKILL_AGENT_ORDER`；无 Skill 能力工具不出现在安装目标。
- **M3-T4 parity/E2E**：`CODEX_HOME` 空/非空、Antigravity 多根、冲突同步、缺失 Agent capability 的 parity（与 M0 fixture 一致）；`scanner.server.test.ts` 全绿。

## 6. Epic M4 — 用量、上下文采集与 Reader 注册（6 Task）

- **M4-T1 移除外部 adapter 入口**：删除 `usage-adapters.json` 读写、`ExternalUsageAdapter*`、`loadExternalUsageAdapters()` 与 `custom:*` source；保留/迁移内建 AiPy、WorkBuddy、Cline adapter。设置页/API 若存在入口改为说明“不支持运行时扩展”。
- **M4-T2 Reader 契约**：`readers/contracts.ts` 定义 `UsageReader`、`ContextReader`，注册内建 Reader Key；generic JSON/JSONL/SQLite reader 参数化于 JSON definition mapping；未知 key 启动期失败测试。
- **M4-T3 adapter 数据迁入 JSON**：`BUILTIN_USAGE_ADAPTERS` 的 paths/format/mapping/maxFileSize 迁入 29 个定义对应的 `capabilities.usage`；通用 mapping/default 从 `_shared/generic-reader-defaults.json` 引用，AiPy/WorkBuddy 的 query/mapping 作为数据迁入。`adapters/catalog.ts` 改为派生兼容导出。
- **M4-T4 原生 Usage/Context Reader 注册**：Claude/Codex 原生扫描注册为 UsageReader；`claude-context.ts`/`codex-context.ts` 以 `capabilities.context.reader` 显式注册，配置声明可用维度；用量分类从 `_shared/usage-taxonomy.json` 派生。未支持工具必须是 `context: unsupported`。
- **M4-T5 scanner/bridge 切流**：scanner、adapter config 改用 `resolvePlatformPlan()`、`getUsagePlan()`、`getContextPlan()` 和 `scanner-policy.json`；`tokentracker-bridge` 不再自动执行或保留来源 alias，必要时仅作为隔离的手工迁移工具。保留旧目录影子对照（feature flag）。
- **M4-T6 fixture 回归**：匿名 JSON/JSONL/SQLite + Codex/Claude context fixture 新旧事件及 context breakdown 逐字段相等；坏文件只产生该工具诊断；验证不读取外部 adapter 文件、缓存版本失效和性能回归。

## 7. Epic M5 — 会话恢复与价格迁移（4 Task；定价子计划 17 人日）

- **M5-T1 SessionReader 契约**：`readers/contracts.ts` 增 `SessionReader`；3 个 session 源（claude-code/codex/grok）路径 + resume token 模板迁入 JSON definition 的 `capabilities.sessions`（mode=resume，reader=key，command=token 数组模板）。
- **M5-T2 sessions 全量派生**：scanner、`SessionSource`、server function 允许筛选来源、`buildResumeCommand()`、UI label 均改由 `getSessionPlan()`/`listSessionTools()`/`getToolDisplay()` 派生；保留 ID 安全校验与隐私断言。
- **M5-T3 声明式离线价格规则**：按《`docs/develop/plan/TrustTools-模型定价与转换规则-实施计划.md`》将 `MODEL_PRICES`、`OFFICIAL_PRICES`、模型名 matcher 和供应商特例迁入内建 pricing rule packs；编译 `(toolId, matcher, priority, effectiveDate)` 索引，使用 BigInt nanoUSD；无匹配按 JSON fallback 产生 `estimated` 或 `unpriced`，同优先级重叠构建失败。
- **M5-T4 pricing 消费者迁移**：`estimateEventCost` 改用 source-aware resolution；`sourceName()` 改用 `getToolDisplay()`。移除运行时 LiteLLM/模型价格快照覆盖，模型价格只来自内建 rule pack；汇率 URL/TTL 仅保持展示币种能力。补离线、日期、重叠、unknown、estimated/unpriced 测试。

## 8. Epic M6 — 切流、清理、质量门禁（5 Task）

- **M6-T1 逐领域打开新路径**：对照 M0 基线，每项差异显式接受或修复并记录；所有共享策略必须经 Registry 编译生效。
- **M6-T2 删除旧事实源与运行时入口**：删除 `AI_TOOLS`/`SKILL_AGENT_RULES`/内建 adapter catalog/`COMMON_MAPPING`/`USAGE_ADAPTER_PRESETS`/`SKILL_AGENT_ORDER`/旧静态 `MODEL_PRICES`/session 白名单与展示名映射/TokenTracker bridge alias/`catalog.legacy.ts`，以及 `tool-overrides.json`、`usage-adapters.json`、`custom:*` 的读写路径和无引用兼容导出；保留迁移映射文档，不得保留可被业务读取的平行常量。
- **M6-T3 内建安全规则包切流**：将内建扫描 pattern/分类迁入 `_rules/security-rules.json`，仅接受受限 schema 与构建期安全正则校验；保留 TypeScript 的 ReDoS、长度和超时防护，用户安全状态不得改变内建规则执行。
- **M6-T4 跨平台质量门**：`npm run lint`、`npx tsc --noEmit`、全量 Node tests、E2E、macOS build 与 Windows build；macOS/Windows 10/Windows 11 分别在真实或 CI runner 上执行探测/Skill/usage/session smoke。Linux 执行 schema/XDG/planned-state tests，不执行 reader/安装承诺，直至单独启用 Linux milestone。
- **M6-T5 文档更新**：README、架构图、贡献指南、“新增工具/共享策略/专项规则”操作手册；`verify:tool-registry` 纳入 CI 序列说明。

### 回退说明

- 任一 Epic 出现 parity 不一致：关闭 `TRUSTTOOLS_TOOL_REGISTRY` feature flag → 消费者回退旧静态目录/兼容导出；无需数据迁移。
- 缓存回退：恢复上一次正常 `toolRegistryVersion` 的用量缓存快照（`~/.trusttools/cache/local-usage-index-v10.json` 携带版本 hash）。
- 任何对照不一致、配置校验失败或隐私断言失败，阻塞后续 Task，不得通过更新快照掩盖差异。

## 9. 本会话交付承诺

按上述顺序逐 Task 实现并 commit；每 Task 附验收报告（lint/tsc/单测/parity）。M6-T4 执行完整 e2e + build + build:electron。若中途遇到需产品确认的开放项（Agent 格式、通用估算费率），按审计要求以 `unsupported`/`unpriced` 保守处理并在 commit 说明中标注，不凭推断开启能力。
