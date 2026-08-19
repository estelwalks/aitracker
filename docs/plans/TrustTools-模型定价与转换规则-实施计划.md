# TrustTools 模型定价与转换规则实施计划

| 属性     | 值                                   |
| -------- | ------------------------------------ |
| 文档类型 | 实施计划 (IMPLEMENTATION-PLAN)       |
| 项目名称 | TrustTools                           |
| 版本     | v1.1                                 |
| 创建日期 | 2026-08-05 16:27:11                  |
| 更新日期 | 2026-08-05 16:55:05                  |
| 生成工具 | architecture-design、document-header |
| 文档状态 | 草稿                                 |

## 修订记录

| 版本 | 修改时间            | 修改内容                         |
| ---- | ------------------- | -------------------------------- |
| v1.0 | 2026-08-05 16:27:11 | 初始离线定价规则实施计划         |
| v1.1 | 2026-08-05 16:55:05 | 对齐共享策略包边界及路由规则命名 |

## 0. 实施目标、范围与原则

本计划落实《模型定价与转换规则架构设计》：将模型名转换、静态定价、未知模型策略和来源证据迁入多份内建 JSON rule packs。客户端运行时不读取指定目录、不加载用户 JSON、不联网获取模型价格；规则更新只能随新版客户端发版。

本计划替代 AI 工具模块化总计划中关于 `MODEL_PRICES`、`OFFICIAL_PRICES`、model matcher 和运行时 LiteLLM 模型价格的细化实现。工具目录、用量 Reader、会话恢复仍按原总计划推进；Pricing Registry 只消费其稳定 `toolId` 与 token 事件。

强制原则：

- 先冻结现有金额、模型名和来源行为，再迁移；不通过更新快照掩盖差异。
- 所有金额以 JSON 十进制字符串输入、以 `bigint nanoUsd` 计算；禁止新增 `number` 金额累计逻辑。
- 所有模型查询必须传 `toolId`、`rawModel`、`occurredAt`；禁止恢复 `findModelPrice(model)` 这种无来源 API。
- 规则只可使用 schema 列出的受限 matcher；禁止 JSON regex、JavaScript 表达式、子串包含匹配和网络 URL loader。
- `estimated`、`unpriced`、`not-billable` 与 `exact` 是业务结果，不是错误；UI、导出和聚合必须保留其差异。
- 每个 Task 完成后执行格式化、lint、类型检查、相关单测并独立提交；不改写已推送的 Lovable 历史。

## 1. 当前事实、迁移边界与基线

| 当前事实                                                                                | 迁移目标                                                           |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/pricing/catalog.ts`：`ModelPrice.matches`、`exactOrSnapshot`、`includesAll`。  | 移入 provider/tool rule pack；不再以函数作为模型规则。             |
| `src/lib/pricing/dynamic.server.ts`：`OFFICIAL_PRICES`、LiteLLM 匹配、Doubao 阶梯特例。 | 全部转为 JSON rates/rules；模型价格网络查询退出权威路径。          |
| `src/lib/pricing/index.ts`：仅按 `model` 查找，使用 number 计算。                       | 改用 source-aware `resolveAndEstimate()` 和 BigInt nanoUSD。       |
| `PricingSnapshot` 混合模型价格与汇率来源。                                              | 模型 rule version 与汇率 snapshot 分离；离线规则独立可用。         |
| 既有外部定价研究结论。                                                                  | 仅保留经内部复核的模型别名与费率证据；不引入外部运行时或匹配实现。 |

### M0 验收基线

在任何行为修改前，生成并提交：

- `src/lib/pricing/__baseline__/pricing-events.jsonl`：匿名的 source/rawModel/timestamp/token 事件，覆盖 `MODEL_PRICES`、`OFFICIAL_PRICES`、Doubao 阶梯、未知模型、cache write、Codex reasoning。
- `src/lib/pricing/__baseline__/expected-resolution.json`：现有金额、原始匹配来源及可接受差异清单。现有未知零价必须标为“预期修正”，而不是 parity 失败。
- `src/lib/pricing/__baseline__/conversion-cases.json`：仅选取已有真实工具映射的 source normalization 例子（Claude、Cursor、WorkBuddy、Antigravity、Zed）；每条附 expected canonical ID，禁止直接引入未经核验的所有 LiteLLM 条目。
- `docs/develop/plan/pricing-rule-migration-map.md`：旧常量/函数到 pack rule ID 的一对一映射、官方来源、核验人和迁移状态。

## 2. 目标目录与交付物

```text
src/lib/tool-registry/
├── definitions/_shared/
│   ├── pricing-manifest.json
│   └── pricing/
│       ├── defaults.rules.json
│       ├── openai.rules.json
│       ├── anthropic.rules.json
│       ├── google.rules.json
│       ├── china-providers.rules.json
│       └── tool-routing.rules.json
├── pricing/
│   ├── contracts.ts
│   ├── compile.ts
│   ├── normalize.ts
│   ├── resolve.ts
│   ├── calculate.ts
│   ├── public.ts
│   └── *.test.ts
└── definitions.generated.ts
scripts/
├── generate-pricing-imports.mjs
└── verify-pricing-rules.mjs
```

每份 `*.rules.json` 至少包含：`schemaVersion`、`packId`、`revision`、rules、rates、source metadata。`defaults.rules.json` 是唯一允许定义 generic normalizer 与 fallback profile 的文件；其他 pack 不得复制默认 profile。每个 `*.tool.json` 仅引用 `pricing.rulePackRefs`、`billingMode` 和 `fallbackProfileRef`。

## 3. Epic M0 — 基线与规则治理（2 人日）

### M0-T1：冻结行为和样本（0.5 人日）

- 抽取当前 `MODEL_PRICES`、`OFFICIAL_PRICES`、LiteLLM 动态匹配、Doubao tiers 与订阅来源处理，写入上述 baseline。
- 添加至少一个模型名冲突样本：同 raw model 在不同 `toolId` 需要不同价格或不同 fallback。
- 验收：baseline 可在断网临时 HOME 下重放；样本不含提示词、对话正文、项目绝对路径、API key。

### M0-T2：制定 rule authoring 规范（0.5 人日）

- 写 `docs/develop/plan/pricing-rule-authoring-guide.md`：新增模型、别名、变更生效日、弃用 rule、填写来源、添加 fixture 的模板。
- 明确 source 证据的最低字段：`kind`、`label`、`url`、`verifiedAt`、owner；`verifiedAt` 超过 90 天产生 CI warning，超过 180 天阻断发布（阈值可在 defaults JSON 配置）。
- 验收：指南能让非 TypeScript 作者完成一个 exact rule 的 PR，且 reviewer 可验证金额和生效期。

### M0-T3：建立规则验收命令（1 人日）

- 注册 `npm run verify:pricing-rules`，即使 registry 尚未完成也可独立运行 schema/fixtures 预检。
- 输出规则包版本、模型 rate 数、转换 rule 数、estimated/unpriced fixture 数、过期来源数和冲突诊断。
- 验收：任一无效 JSON、缺少证据、未引用 rate、未声明 fallback 的计费工具都以非零退出。

## 4. Epic M1 — 定价契约与离线编译器（3 人日）

### M1-T1：定义 Zod/TypeScript 契约（1 人日）

- 新增 `pricing/contracts.ts`：`PricingPack`、`ConversionRule`、`RateRule`、`FallbackProfile`、`ToolPricingPolicy`、`PricingLookupInput`、`PricingResolution` 与 `PricingConfidence`。
- 支持 matcher `exact`、`alias`、`prefix`、`suffix`、`token-sequence`、`any`；其值仅允许 ASCII 规范化模型 ID 分段，拒绝 regex、空值、控制字符、超过 256 字符的模型名。
- 数字价格采用正整数字符串 `usdNanoPerMillion`，缓存写入可为 `null`；日期为 ISO `YYYY-MM-DD`。
- 验收：类型不允许缺 toolId/occurredAt；schema 覆盖 price token 字段、tier、有效期、source metadata 和 fallback policy。

### M1-T2：固定 manifest、loader 和 import generation（1 人日）

- 新增 `pricing-manifest.json` 与 `scripts/generate-pricing-imports.mjs`；仅允许 `_shared/pricing/` 下 manifest 显式列出的 `.rules.json`。
- 生成静态 import 清单，由客户端直接 import；生成过程拒绝 `..`、绝对路径、重复 pack ID、未列出文件和循环 `extends/rateRef`。
- 计算 canonical JSON 的 `pricingRegistryVersion`，将其纳入本地结果/cache key。
- 验收：运行时关闭 fs/network mock 后仍可加载全部 rules；修改任一 rule 会变更 version；删除 manifest 引用会构建失败。

### M1-T3：Compiler 与冲突分析（1 人日）

- `compile.ts` 展开 tool pack refs、fallback refs、rate refs，构造每个 tool 的排序索引。
- 检测同 scope + matcher + effective interval + priority 的重叠，检测同一 canonical model 同日期两个 rate，检测未被引用的 rate（warning）和未被引用的 profile（warning）。
- 排序不得使用 JSON 数组位置作为隐式 tie-breaker。
- 验收：冲突 fixture 指明两个 rule ID/文件名；合法的历史分段和不同 tool scope 可以同时存在。

## 5. Epic M2 — 转换、匹配与通用 fallback（4 人日）

### M2-T1：实现固定 generic normalizer（0.5 人日）

- `normalize.ts` 实现 NFKC、trim、lowercase、`_`/空白到 `-`、连续连字符折叠、首尾连字符去除。
- 保留 `rawModel`，输出 `normalizedModel`；遇 NUL/控制字符/空结果返回带 reason 的 `unpriced`，不抛出未处理错误。
- 验收：normalizer 为线性复杂度、跨平台稳定，针对 Unicode/超长/异常输入有单测。

### M2-T2：实现受限转换 matcher（1.5 人日）

- `resolve.ts` 按 scope、matcher 精确度、priority、effective date 执行 rule；支持 alias 到 canonical ID，不能递归无限展开。
- `prefix`/`suffix` 必须按 `-` token 边界匹配；`token-sequence` 是完整 token 列表的顺序匹配，不是任意 substring。
- 对每次命中返回 `conversionRuleId`、`rateRuleId`、`canonicalModelId` 和 reason；匹配多条时返回 compiler 阻断诊断，不能在运行时随机选取。
- 验收：把已复核 aliases 写为 JSON fixture，展示 raw 名字不变、canonical 转换正确。

### M2-T3：实现通用配置 fallback（1 人日）

- `defaults.rules.json` 定义 `generic-normalize-v1`、`api-generic-v1`、`subscription-zero-marginal-v1`、`unpriced-v1`；每个计费工具 JSON 明确 `billingMode + fallbackProfileRef`。
- `api-generic-v1` 费率初始值必须由运营确认，未确认前 feature flag 仅返回 `unpriced`。启用后结果必为 `estimated`，包含 profile ID 和“非官方账单”标签。
- 验收：未知 API 模型不为零且不标 exact；订阅模型为 `not-billable`；无 policy 的工具在编译期失败。

### M2-T4：实现 BigInt 成本计算（1 人日）

- `calculate.ts` 用 nanoUSD 分别计算 input/output/cache read/cache write/reasoning，定义 reasoning 是否并入 output 的工具 policy（Codex 等现有特殊规则迁入 JSON）。
- tier rule 以输入相关 token 总数选取，并复现现有 Doubao 阶梯；缓存写入费率为空时按 tool fallback policy 处理，禁止用 0 填补。
- 验收：百万 token、零 token、极大 token、cache write、tier 边界、历史日期均精确可重算；展示层才转回 decimal/USD。

## 6. Epic M3 — JSON 迁移与工具目录关联（3 人日）

### M3-T1：创建 rules packs（1 人日）

- 从 `MODEL_PRICES`、`OFFICIAL_PRICES`、Doubao special case 和已确认模型映射创建 defaults/OpenAI/Anthropic/Google/中国供应商/tool-routing packs；该名称只表示内建模型路由，不支持用户 `tool-overrides.json`。
- 每条 rate 写 source URL、核验日、effective range、rate ID；每条 alias 写 rule ID、scope、证据 fixture。
- 验收：迁移表中的每个旧项目都存在一个新 rule ID 或被显式标记删除原因。

### M3-T2：为所有工具声明定价 policy（1 人日）

- 在 27 个可见工具和 AiPy/Cline legacy 的 tool JSON 中新增 `pricing` capability：`billingMode`、`rulePackRefs`、`fallbackProfileRef`、reasoning policy。
- 未能可靠计费的工具使用 `pricing: unsupported` 或 `unpriced-v1`，不可默认为 API 计费。
- 验收：registry 可列出每个工具的价格 policy；全局共享 pack 不在各工具重复复制。

### M3-T3：迁移 parity 与差异批准（1 人日）

- 通过 M0 fixture 比较旧/新 `knownUsd` 和 token 分项；已知规则金额必须相等或在 `expected-diff.md` 中记录经核验的修正。
- 仅以下改变可被批准：未知零价变 `estimated/unpriced`、发现旧 source 无上下文造成的错误价格、历史规则补正。
- 验收：没有无说明差异；输出每个 rawModel 的转换链路与 rate source。

## 7. Epic M4 — 消费者切流与离线运行时（3 人日）

### M4-T1：迁移核心 API（1 人日）

- 在 `src/lib/pricing/index.ts` 新增 source-aware resolver，逐步替换 `findModelPrice(model)` 与 `estimateEventCost(event)` 调用方。
- `LocalUsageEvent.source` 必须先由 Tool Registry 解析为 `toolId`；legacy source 同样获得 policy。禁止把 display name 作为价格键。
- 验收：所有 pricing call site 均传入 toolId、timestamp；TypeScript lint/类型检查不再允许无 source API。

### M4-T2：拆分动态模型价格职责（1 人日）

- 删除或停用 `dynamic.server.ts` 对 LiteLLM 和 `OFFICIAL_PRICES` 的模型价格覆盖；保留/重构汇率快照为独立模块，不能影响 USD 定价。
- 迁移 `PricingSnapshot` 为汇率 snapshot；价格结果带 registry version、confidence 与 source label。
- 验收：网络 mock 失败、无 home cache、首次离线启动都得到相同的 USD resolution；汇率失败仅影响展示币种换算来源标签。

### M4-T3：更新 UI、导出和诊断（1 人日）

- 仪表盘/模型聚合/会话成本使用 `exact`、`estimated`、`unpriced`、`not-billable` 四态；known + estimated 分别小计，未知模型列出 raw model 与“建议补规则”信息。
- `public.ts` 仅投影安全字段，不显示本地路径、完整日志或无关配置；导出包含 rule/version/source label，方便复算。
- 验收：未知模型不显示 `$0`；预计费用有显著标记；切换语言与币种不改变 USD 基准金额。

## 8. Epic M5 — 清理、文档与发布门禁（2 人日）

### M5-T1：删除旧事实源（0.5 人日）

- 删除 `MODEL_PRICES`、`OFFICIAL_PRICES`、matcher helper、模型价网络下载与无引用兼容导出；保留历史 baseline/迁移映射。
- 验收：`rg` 不再找到业务逻辑中的 `findModelPrice(model)`、`OFFICIAL_PRICES` 或 `MODEL_PRICES`；只有迁移文档/测试名称可保留提及。

### M5-T2：质量门禁与离线发布演练（1 人日）

- CI 执行 `generate-pricing-imports`、`verify:pricing-rules`、Node tests、`npm run lint`、`npx tsc --noEmit`、Electron build。
- macOS、Windows 10、Windows 11 以无网络 runner/拦截 fetch 的方式完成 pricing smoke；Linux 先运行 schema/compiler/离线 resolver job。
- 验收：四目标平台（Linux 为预留测试）均不因断网或无用户价格目录失败；构建产物包含所有 manifest 引用 JSON。

### M5-T3：运营交接与回滚演练（0.5 人日）

- 完成作者指南、来源复核清单、unknown 模型报告、版本升级/回滚说明；选择一份历史 pack 对事件重算。
- 验收：非开发角色按文档新增一条模拟模型 exact rule，CI 成功；错误 rule 被阻止，回滚后旧事件可按旧版本重算。

## 9. 测试矩阵与发布准出

| 测试层级   | 必测内容                                                                                  | 阻塞级别 |
| ---------- | ----------------------------------------------------------------------------------------- | -------- |
| Schema     | JSON 格式、ID/引用、日期、整数金额、matcher token、source evidence、fallback policy。     | P0       |
| Compiler   | pack/version、循环、同级冲突、过期区间、未引用 rule、manifest 路径与静态 import。         | P0       |
| Resolver   | source scope、exact/alias/prefix/suffix、generic normalize、unknown/订阅/估算四态。       | P0       |
| Calculator | BigInt、四种 token、reasoning、tier、cache write 为空、历史日期和大数。                   | P0       |
| Parity     | 旧静态规则、官方特例和经过批准的行为修正。                                                | P0       |
| 离线集成   | 清空缓存、断网、无外部目录、macOS/Windows 10/Windows 11 smoke、Linux schema/XDG planned。 | P0/P1    |
| UI/导出    | exact/estimated/unpriced/not-billable 标签、币种展示、规则版本与来源、隐私投影。          | P1       |

准出条件：所有 P0 用例通过；`verify:pricing-rules` 零 error；已配置模型不存在未批准金额差异；所有计费工具都声明 fallback 或 `unsupported`；未知模型从不被渲染为“准确的 $0”；无网络/无缓存启动通过；旧模型价格代码没有业务引用。

## 10. 依赖、排期与回滚

```mermaid
flowchart LR
  M0["M0 基线/治理"] --> M1["M1 契约/Compiler"]
  M1 --> M2["M2 转换/BigInt"]
  M2 --> M3["M3 JSON 迁移"]
  M3 --> M4["M4 消费者切流"]
  M4 --> M5["M5 清理/离线发布"]
```

预计实施量约 17 人日，另预留 20% 用于补充真实模型名 fixture 与价格核验。M1/M2 可在总工具 Registry 的 contracts 稳定后并行开展；M3 依赖 tool JSON 的 pricing capability；M4/M5 必须顺序执行。

回滚策略：切流前保留旧 pricing API 在 feature flag 后；切流后一个发布周期仍保留只读的基线重放命令。线上发现错误时，优先发布仅修改 JSON 的补丁版本；若 compiler 或计算器回归，则关闭 feature flag 回到旧实现。不得通过运行时下载“临时规则”修复，因为这破坏离线和可审计边界。

## 11. Task 完成模板

```text
Task 验收报告：
- 配置校验：npm run verify:pricing-rules（通过）
- 格式化：npm run format -- <changed files>（通过）
- 类型检查：npx tsc --noEmit（通过）
- 单元/契约：<pricing tests>（通过）
- 离线回归：禁网 + 空缓存 + baseline replay（通过）
- 差异：无；或链接 expected-diff.md + 核验人（已批准）
- Git commit：refactor(pricing): <任务摘要>（已提交）
```

不在本期范围：远程规则分发、运营后台、客户端本地编辑器、从任意本地目录热加载、供应商实时抓价覆盖、订阅费用分摊和多租户审批流。这些能力若进入范围，必须先完成独立 ADR 与安全评审。
