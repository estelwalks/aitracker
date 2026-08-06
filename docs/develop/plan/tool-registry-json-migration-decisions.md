# Tool-Registry JSON 迁移决策记录（P3-T0）

| 属性     | 值                                            |
| -------- | --------------------------------------------- |
| 文档类型 | 实施决策记录 (DECISION)                       |
| 项目名称 | AITracker-AI工具模块化                       |
| 版本     | v1.0                                          |
| 创建日期 | 2026-08-06                                    |
| 关联     | 架构 v1.5 / 审计 v1.3 / 任务 v1.4 / 测试 v1.4 |

本记录固化 `*.config.ts`（v1.1 TS）→ `definitions/*.tool.json`（v1.5 JSON）迁移的关键裁决。每项均给出理由与影响面；与架构文档字面不一致处即「批准 diff」，随文档 v1.5 更新归档（P6-T3）。

## D1：29 个 config.ts → JSON 的转换方式

- **裁决**：一次性半自动脚本 `scripts/convert-tool-configs.mjs`（tsImport 加载 config → 按前缀决策表分类 `locations` → 输出 JSON → 人工复核）。
- **理由**：29 个定义机械转写易漏字段，脚本保证字段完备；平台分类有语义（D4），需人工复核重点工具。
- **影响**：脚本仅本地运行一次，P5-T1 删除。

## D2：security-rules.json 位置漂移

- **裁决**：留在 `src/lib/security/security-rules.json`（M6-T3 已迁移生效，26 规则 + 构建期安全 gate）；`tool-registry/definitions/_rules/README.md` 放指针，P6-T3 更新架构文档标注漂移。
- **理由**：迁移已切流，移动只增风险；文档目录仅为建议布局。
- **批准 diff**：目录布局偏离。

## D3：pricing 模块位置漂移

- **裁决**：rule pack 留在 `src/lib/pricing/rules/`（Phase 1-2 已批准）；tool JSON 的 `pricing.rulePackRefs` 仅引用 packId，loader 经 `pricing-definitions.generated.ts` 解析。
- **理由**：避免移动整个 pricing 模块破坏 12 个消费者 import。
- **批准 diff**：目录布局偏离（架构 v1.5 建议 `tool-registry/pricing/`）。

## D4：扁平 roots → locations 的平台分类（前缀决策表）

- **裁决**：

  | 前缀                           | targets                            | base             |
  | ------------------------------ | ---------------------------------- | ---------------- |
  | `Library/Application Support/` | macos                              | `appData`        |
  | `AppData/Roaming/`             | windows10, windows11               | `appDataRoaming` |
  | `.config/`                     | macos, linux                       | `configHome`     |
  | `.local/share/`                | macos, linux                       | `dataHome`       |
  | 其他点目录（`.claude` 等）     | macos, windows10, windows11, linux | `home`           |

- **全 target 展开后的路径集合必须与现 `detection.roots` 逐项相等**（parity 保证 TC-REG-001）。
- **预期差异（expected-diff.md 记录）**：Windows 不再探测 `~/.config/*`、`~/.local/share/*`（今日探测也不存在，属无害收敛）；Linux 按 XDG 展开。

## D5：platforms 语义

- **裁决**：工具级可用性默认 `{macos: "supported", windows: "supported", linux: "planned"}`；capability 级平台状态由 `resolvePlatformPlan` 处理，`linux: "planned"` 一律不产生扫描计划。
- **理由**：27 工具均为跨平台产品；Linux 首期仅建模不承诺（架构 §6.1）。

## D6：canonicalSource 重定义

- **裁决**：从字段投影改为**全量 canonical JSON**（全部定义 + 共享包，sorted keys）→ 任何 JSON 改动失效缓存。
- **理由**：符合架构 §8.1「toolRegistryVersion = sha256(canonical JSON 全集)」；升级自动一次性重建缓存（大库首扫变慢，可接受）。

## D7：目录顺序保真

- **裁决**：新增 `definitions/manifest.json`（有序 29 个 `{id, path}`，顺序 = 现 `tools/index.ts`，aipy/cline 末尾）；生成脚本按此顺序输出。
- **理由**：UI 顺序是冻结基线，漂移会触发 baseline 失败。

## D8：PERSISTENT_CACHE_VERSION / 缓存文件名

- **裁决**：留在 TS（实现版本史）；`scanner-policy.json` 只配置 lookback/每来源上限/行长上限/容差/缓存文件名策略。
- **理由**：缓存实现机制是受控执行面，不是运营可编辑数据。

## D9：aipy SQL query 防写加固

- **裁决**：query 进 JSON；schema refine 必须以 `SELECT` 开头、不含 `;`/`ATTACH`/`DROP`/`INSERT`/`UPDATE`/`DELETE`/`PRAGMA`。
- **理由**：JSON 是数据，防注入语义必须构建期强制；扫描器侧 sqlite reader 仍只读执行。

## D10：context capability

- **裁决**：新增独立 capability：claude-code = `claude-context-v1`（dimensions 与 `isCachedContext` 收集项一致：tools/skills/commands/mcp/toolOutputs）、codex = `codex-context-v1`；其余 `unsupported`。
- **理由**：context 是独立能力，不能仅作为 UsageReader 的隐式副作用（架构 §6）。P3 只声明+注册 reader key，P4-T3 切流。

## D11：findModelRate 保留

- **裁决**：保留（无内联规则时返回 null）；Phase 1-2 已把定价解析移到 `src/lib/pricing/resolve.ts`，tool JSON 的 pricing 段只承载 `billingMode`/`fallbackProfileRef`/`rulePackRefs` 策略元数据。
- **理由**：消费者 `findModelRate` 调用面小，P4-T5 由 `tool-policy.ts` 消费新字段后即可废弃内联费率。

## D12：executable 声明

- **裁决**：仅对已知命令的 3 个 session 工具 + native reader 工具（claude/codex/grok）填 `{shared, windows}`，其余空数组。
- **理由**：现有 config 未声明、无人消费；纯新增字段，无行为影响。

## 模板：expected-diff 记录（P3-T5 时逐项填）

| #   | 工具 | 字段 | 旧行为 | 新行为 | 批准 |
| --- | ---- | ---- | ------ | ------ | ---- |
|     |      |      |        |        |      |
