# Tool-Registry 迁移预期差异记录（P3-T5）

| 属性     | 值                           |
| -------- | ---------------------------- |
| 文档类型 | 迁移差异记录 (EXPECTED-DIFF) |
| 项目名称 | AITracker-AI工具模块化      |
| 版本     | v1.0                         |
| 创建日期 | 2026-08-06                   |

29 个 `definitions/*.tool.json` 经 loader 编译后与旧 `*.config.ts` 逐字段 parity
（`definitions.parity.test.ts` 双读断言）**全部一致**；以下为已批准的有意差异，
均属文档 v1.5 要求的预期改进或纯新增字段，不构成行为回归。双读 parity 测试
允许以下差异（其余任何差异 = 构建失败，禁止修改测试掩盖）。

## D-A：平台探测收敛（文档 §6.1 要求）

| 工具  | 字段            | 旧行为                                                           | 新行为                                                                                                     | 批准             |
| ----- | --------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------- |
| cline | detection       | 3 根含 `.config/Code/User/globalStorage/...`（旧实现全平台探测） | `.config/` 根仅 macos+linux targets（Windows 不再探测 `~/.config/*`，该目录在 Windows 不存在，属无害收敛） | caows 2026-08-06 |
| 所有  | detection/usage | 点目录根（`.claude` 等）全平台探测                               | targets 明确四平台，语义等价                                                                               | caows 2026-08-06 |
| 所有  | linux           | 无平台概念                                                       | `linux: planned` 一律不产生扫描计划（TC-PLAT-002）                                                         | caows 2026-08-06 |

## D-B：loader 默认补齐（与消费端原有补齐语义等价）

| 字段                      | 旧行为                                    | 新行为                                                           | 批准             |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------- | ---------------- |
| usage.mapping             | config 未声明时消费端 `?? COMMON_MAPPING` | JSON 省略时 loader 补齐 `generic-reader-defaults.defaultMapping` | caows 2026-08-06 |
| usage.maxFileSizeBytes    | config 未声明时消费端 `?? 8MB`            | JSON 省略时 loader 补齐默认 8388608                              | caows 2026-08-06 |
| skills.markers / maxDepth | 消费端 `?? DEFAULT_MARKERS / 3`           | loader 补齐 `skill-market-policy` 默认                           | caows 2026-08-06 |

## D-C：纯新增字段（无行为影响）

| 字段                                                    | 说明                                                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| platforms                                               | 全部 `{macos: supported, windows: supported, linux: planned}`（D5）                                                      |
| detection.locations / executableSpec / rootSpecs        | v1.5 平台感知形式（投影保持旧扁平字段）                                                                                  |
| executable.shared                                       | 仅 claude-code[claude] / codex[codex] / grok[grok]（D12）                                                                |
| capabilities.context                                    | 仅 claude-code（claude-context-v1）/ codex（codex-context-v1），native（D10）                                            |
| pricing.billingMode / fallbackProfileRef / rulePackRefs | 有 usage → api-metered + unpriced-v1 + []；无 usage → unsupported + unpriced-v1 + []（D11，与 tool-policy 现有派生一致） |
| usage.paths[].targets                                   | 平台信息保留（消费端忽略）                                                                                               |

## D-E：usageLogParsingFor 派生修正（P4-T1）

| 工具      | 字段               | 旧行为                                                           | 新行为                                                                 | 批准             |
| --------- | ------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------- |
| workbuddy | usageLogParsingFor | adapter（冻结 catalog 常量 NATIVE_USAGE_PARSERS 不含 workbuddy） | native（registry 派生的 usage.mode=`workbuddy-native`，config 为权威） | caows 2026-08-06 |

## D-D：版本与缓存

| 项                     | 说明                                                                                                                          | 批准             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| canonicalSource 全量化 | 从字段投影改为全量 canonical JSON（D6）；`toolRegistryVersion` 随任何 JSON 改动变化，升级后用户缓存一次性重建（预期，可接受） | caows 2026-08-06 |
| registry 数据源        | getDefaultRegistry 从 `tools/index.ts`（TS）切到 `definitions.generated.ts`（JSON loader）；双读 parity 保证逐字段一致        | caows 2026-08-06 |

## 复核记录

- 复核人：Claude Code（sub-agent 独立复核 + orchestrator 程序化双读）
- 结果：29/29 定义与旧 config 投影后逐字段一致，0 差异（2026-08-06）

## D-F：aipy/cline 从遗留隐藏改为用户扩展可见（2026-08-06）

| 工具       | 字段           | 旧行为                                            | 新行为                                                              | 批准             |
| ---------- | -------------- | ------------------------------------------------- | ------------------------------------------------------------------- | ---------------- |
| aipy/cline | catalogVisible | false（遗留采集来源，隐藏于产品目录/manifest/UI） | true（用户新增的扩展 AI 工具，与 27 工具一样展示于数据来源页等 UI） | caows 2026-08-06 |

- 影响：产品目录 27 → **29**；public manifest 与 AI_TOOLS 含 aipy/cline（display 仅 nameZh，路径/reader 仍不外泄）；baseline 冻结的 27 工具语义不变（前 27 顺序匹配）。
- 保留约束：schema 防御性校验（catalogVisible=false 仅允许 legacy 来源）不变，当前无工具使用 false。
