# TrustTools AI 工具模块化实现与架构偏差问题清单

| 属性     | 值                                  |
| -------- | ----------------------------------- |
| 文档类型 | 架构审计报告 (ARCH-AUDIT)           |
| 项目名称 | TrustTools-AI工具模块化             |
| 版本     | v1.3                                |
| 创建日期 | 2026-08-06 15:27:08                 |
| 更新日期 | 2026-08-06 17:07:33                 |
| 生成工具 | architecture-audit、document-header |
| 文档状态 | 评审中                              |

## 修订记录

| 版本 | 修改时间            | 修改内容                                             |
| ---- | ------------------- | ---------------------------------------------------- |
| v1.0 | 2026-08-06 15:27:08 | 审查最新实现与架构设计文档的偏差并建档               |
| v1.1 | 2026-08-06          | 校正定价所有权边界：价格归属模型计费路由，不归属工具 |
| v1.2 | 2026-08-06 17:07:33 | P3-1 已修复：主架构文档 v1.6 回写 D2/D3 批准差异     |
| v1.3 | 2026-08-06          | 删除外部采集 CLI、桥接入口及相关引用                 |
| v1.4 | 2026-08-06          | P1-1/P1-2/P1-3/P1-5/P2-1/P2-2 全部实施完成（见各 Finding 状态） |

## Findings

### P1：定价所有权错误绑定到工具，无法表达多模型、多渠道计费

- **受影响设计**：模型定价架构成功标准 1–3、6；§4 所有权；§6 编译与集成策略，以及工具定义中的 `pricing` 段。
- **问题**：现有设计让工具 JSON 的 `pricing.rulePackRefs`、`billingMode` 和 `fallbackProfileRef` 承担价格选择职责；实现也由 `ToolPricingPolicy` 传入 `resolvePrice()`。但 AI 工具并不是价格所有者：同一工具可使用任意兼容模型和多个 API/订阅账户；同一模型又可能通过官方 API、聚合平台、云厂商代理或企业网关以不同价格计费。以“Claude Code 使用 DeepSeek API”为例，费率应取决于 DeepSeek 官方 API、OpenRouter 或企业网关等**实际计费渠道**，而不是 Claude Code。
- **当前表现**：29 个工具定义的 `rulePackRefs` 全为空，`resolvePrice()` 仍遍历全量已编译规则，且 `scope.providers` 未参与匹配。这里不应简单把每个工具的 pack 引用补齐：这会把工具可能支持的模型集合错误地固化为价格归属，并在工具支持自定义 Provider 时必然失效。
- **影响**：缺少渠道证据时，未来会把同名模型的价格错归因；同一工具的订阅与 API 使用无法准确区分；运营人员也无法只新增一个模型或一个渠道，而不触碰多个工具定义。`estimateEventCost()` 还会将 `estimated`、`unpriced`、`not-billable` 降级为旧的 unknown，`TRUSTTOOLS_PRICING_ESTIMATES` 可在运行时改写 JSON 语义，导致展示和导出无法准确解释成本状态。
- **证据**：`src/lib/pricing/resolve.ts:72-77,184-220`；`src/lib/pricing/tool-policy.ts:19-27`；`src/lib/pricing/index.ts:107-143`；29 个 `src/lib/tool-registry/definitions/*.tool.json` 的 `rulePackRefs` 全为空。多渠道同名模型的费率差异表明，source 只能作为识别上下文，不能成为价格表所有者。
- **修订方向**：撤销“按工具补齐 rule pack 引用”的整改建议，改为重构定价边界：
  1. 工具 JSON 仅声明 `modelObservation`（日志字段、模型名称归一化 profile、Provider/Endpoint/账户类型等计费证据提取规则、Token 语义）；工具不持有费率、价格包或固定 `billingMode`。
  2. 新增独立的 `model-catalog.json`、`billing-routes.json`、`model-alias-rules.json`、`route-selection-rules.json`、`rate-packs/*.json` 与 `fallback-profiles.json`。费率主键为 `billingRouteId + canonicalModelId + region + effectiveAt`，并由计费路由、模型、区域和生效期共同决定。
  3. 解析流水线须保留 `rawModel`、`canonicalModelId`、`billingRouteId`、路由证据、规则版本与置信状态；先从 endpoint/provider/account plan 等证据选择 route，再查询 route 下的模型费率。
  4. 证据不足时不得默认采用“模型官方价”；应返回 `unpriced`。如业务需要展示参考价，必须选择声明的参考路由并标记 `estimated`，且 UI/导出保留 `exact`、`estimated`、`unpriced`、`not-billable` 四态与原因。fallback 行为仅由随包 JSON 决定，不允许环境变量改写。
  5. 删除或废弃 `ToolPricingPolicy`、`pricing.rulePackRefs`、工具级 `billingMode`；将工具特有的“推理 Token 是否已包含在输出中”等规则保留为用量解析语义，而非货币定价规则。
- **状态（✅ 已实施）**：契约层（`contracts.ts` BillingRoute/RouteSelection/ModelCatalog/ModelAlias + 6 类新 JSON + 29 工具 `modelObservation`，a78ae01）；Compiler 路由维度索引（bd622d4）；route-first 解析 + 四态保真 + 删除 `ToolPricingPolicy`/env 改写（9118cd5）。parity：12 baseline 金额不变、置信 exact→estimated（批准差异），带 endpoint 证据恢复 exact。

### P1：定价歧义检测只覆盖相同 matcher，无法履行构建期拒绝承诺

- **受影响设计**：模型定价架构成功标准 6、§5.4 决策树与优先级。
- **问题**：compiler 仅当两个规则的 `matchKey` 完全相等时报告重叠；不同但可相交的同层 matcher（如两个不同 token-sequence）不会在构建期失败。运行时才把同层匹配降级为 `unpriced`。在定价所有权校正后，现有 `toolId` scope 也不再是正确的歧义域。
- **影响**：运营人员新增 JSON 后可能把歧义带入客户端，违背“同一计费路由、模型、区域、日期、输入不能匹配两条同优先级费率”的发布门禁。
- **证据**：`src/lib/pricing/compile.ts:232-260`；`src/lib/pricing/resolve.ts:223-240`。
- **修订方向**：在 compiler 对相同 `billingRouteId`、模型、区域、priority、有效期的 matcher 做交集检测，或收紧 matcher 组合并用可证明无交集的规则集合替代；补充反例 fixture，确保歧义在 build/prebuild 阶段失败。
- **状态（✅ 已实施）**：bd622d4。`overlapping-rates` 按 billingRouteId+canonicalModelId+region+effective 判冲突；`rule-overlap` 改为可判定 matcher 交集检测（exact/alias/prefix/suffix/token-sequence 全组合）；9 个反例/合法 fixture 补充，歧义在 build 期失败。

### P1：Session Reader 仍由硬编码路径和函数分派，未由 Registry 驱动

- **受影响设计**：总体架构 §6、§7；实施计划 M5-T1/M5-T2。
- **问题**：session scanner 固定拼接 `.claude`、`.codex`、`.grok`，并直接调用三个专用扫描函数；`SessionSource` 仍是固定联合类型。`sessions.reader` 当前只参与 resume command 的生成，不选择实际 Reader 或扫描根目录。
- **影响**：新增或调整会话工具仍必须修改 scanner/type，而不是只注册受控 Reader 并更新工具 JSON；会话能力不满足“同一配置直接回答并驱动能力”的目标。
- **证据**：`src/lib/local-sessions/scanner.server.ts:1045-1055`；`src/lib/local-sessions/types.ts:11`；`src/lib/local-sessions/resume-id.ts:24-35`。
- **修订方向**：建立 `SessionReaderKey → SessionReader` 的受控工厂；由 `listSessionTools()`、`getSessionPlan()` 和平台路径计划生成扫描任务；将固定类型收敛为 Registry 派生的运行时校验类型。
- **状态（✅ 已实施）**：1e8e312。`tool-registry/readers/session-readers.ts` 受控工厂（内建/自定义分表注册）；scanner 由 `listSessionTools + getSessionPlan + resolvePlatformPaths` 驱动；`SessionSource` 收敛为镜像 + `(string & {})` 开放分支；新增「注册 fake reader 即可扫描」用例。

### 已关闭：外部采集 CLI 桥接边界

- **处置**：已删除外部 CLI 的 vendored 源码、桥接模块、测试、环境变量和打包/文档引用；本地用量扫描仅消费 TrustTools 自有 Reader 与受控通用 Adapter。
- **验证要求**：发布前以仓库级文本扫描确认不存在外部 CLI 名称、路径、环境变量或执行入口。

### P1：安全规则的“安全正则/ReDoS 防护”只停留在注释，用户规则可阻塞扫描

- **受影响设计**：总体架构 §6.2；实施计划 M6-T3；测试策略 TC-SEC-001。
- **问题**：内建和用户规则的安全校验都只检查长度和 `new RegExp()` 是否能编译，没有检测灾难性回溯结构；扫描会对每一行执行用户正则。同时单个上传文件可达 100MB。
- **影响**：恶意或误配置的用户规则，例如具有嵌套量词的模式，可显著阻塞 UI 线程；与“严格安全正则校验”和“TypeScript ReDoS 防护”的承诺不符。
- **证据**：`src/lib/security/security-rules.schema.ts:39-55`；`src/lib/security/rules.ts:46-68`；`src/lib/security/input-validation.ts:4,42-46`。
- **修订方向**：引入安全正则检测或受限匹配 DSL；拒绝危险嵌套/回溯模式；设置逐行和总扫描预算，补充 ReDoS 负向测试。用户规则与内建规则均应复用同一安全 gate。
- **状态（✅ 已实施）**：ab753e5。`redos.ts` 自研线性检测器（嵌套/重叠量词、多重交替加量词、反向引用、量词叠加四类危险形态，零依赖）；内建与用户规则复用同一 gate；scanner 逐行/总预算 + `truncated` 标记；15 个 ReDoS 负向/正向/预算测试；内建 26 规则全过（builtin-15 按本意改写 + 等价性测试）。

### P2：platform-profiles.json 未实际驱动 base、XDG 或默认状态解析

- **受影响设计**：总体架构 §6.1、§6.2；实施计划 M1-T2。
- **问题**：`platform-profiles.json` 声明的 `basePlatforms`、`xdgFallback`、`defaultStatus` 没有被路径解析器消费。loader 以固定 `BASE_PREFIX` 投影路径，resolver 也没有校验 location 的 base 是否适用于当前 target。
- **影响**：平台 JSON 不是完整权威来源；错误的 base/target 组合不会被阻止。Linux 虽为 planned，但后续启用时不能按声明解析 `XDG_CONFIG_HOME` / `XDG_DATA_HOME`。
- **证据**：`src/lib/tool-registry/definitions/_shared/platform-profiles.json:8-24`；`src/lib/tool-registry/loader.ts:57-75`；`src/lib/tool-registry/registry.ts:291-345`。
- **修订方向**：以 shared profile 构造真实 platform resolver，校验 base-target 兼容性，并支持 XDG 环境变量与 fallback；为 macOS、Windows 10、Windows 11、Linux planned 分别增加 fixture。
- **状态（✅ 已实施）**：85dedf6。loader 投影由 profile 派生（basePlatforms + xdgFallback）；`projectBaseWithEnv` 支持 XDG_CONFIG_HOME/XDG_DATA_HOME；`resolvePlatformPlan` base-target 校验 + `skippedLocations` 诊断 + `defaultStatus` 兜底；四平台 fixture + 非法组合测试，29 工具组合 0 不匹配（parity 保持）。

### P2：部分工具名单、展示名和 Skill 顺序仍保留硬编码 fallback

- **受影响设计**：总体架构成功标准 1、§6.2；实施计划 M6-T2。
- **问题**：Skill order 在 public manifest 缺失时回退到固定 9 工具数组；legacy source id 和部分 source label 也在 TypeScript 中列出。
- **影响**：生成产物不同步或新增工具时，运行时可静默回退到旧名单；新增工具仍可能需要修改业务代码，削弱“配置为权威来源”的目标。
- **证据**：`src/lib/local-skills/agent-rules.ts:38-51`；`src/lib/local-usage/types.ts:13-18`；`src/lib/local-usage/presentation.ts:86-91`；`src/lib/pricing/index.ts:277-282`。
- **修订方向**：删除静态工具集合和标签 fallback；生成产物缺失/不一致应在 build 期失败，展示名称和 legacy 状态统一从 Registry 或 public manifest 投影。
- **状态（✅ 已实施）**：fad8bfe。`SKILL_AGENT_ORDER` fallback 删除（manifest 缺失即抛错）；`LEGACY_ADAPTER_SOURCES`/`sourceLabel`/`sourceName` 硬编码分支删除，统一从 public manifest / `getToolDisplay` 投影；`PublicTool` 增 `legacy` 标记；生成产物重新生成。

### P3：主架构文档仍未回写已批准的目录漂移

- **受影响设计**：总体架构 §5、§6.2。
- **问题**：实际 pricing pack 位于 `src/lib/pricing/rules/`，安全规则位于 `src/lib/security/`。迁移决策记录 D2/D3 已确认该差异，但主架构设计仍把它们列在 `tool-registry` 目录布局中。
- **影响**：架构设计不再是单一实施依据，后续维护者可能在错误目录新增规则或错误理解依赖边界。
- **证据**：`docs/develop/plan/tool-registry-json-migration-decisions.md` 的 D2/D3；`src/lib/pricing/rules/`；`src/lib/security/security-rules.json`；总体架构 §5。
- **修订方向（✅ 已实施，主架构文档 v1.6）**：将 D2/D3 的批准差异回写入主架构文档并更新目录图，明确 pricing/security 的生成和校验入口。
- **状态**：已实施（2026-08-06，主架构文档 v1.6 修订记录「回写决策记录 D2/D3 批准差异：pricing/security 目录漂移、生成/校验入口与依赖方向」）。

## 审计范围、已验证项与限制

审计对照了：

- `docs/develop/architecture/TrustTools-AI工具模块化-架构设计文档.md`（v1.5）；
- `docs/develop/architecture/TrustTools-模型定价与转换规则-架构设计文档.md`（v1.1）；
- 对应实施计划、测试策略和迁移决策记录；
- `src/lib/tool-registry/`、`src/lib/pricing/`、`src/lib/local-usage/`、`src/lib/local-sessions/`、`src/lib/security/` 的最新代码。

以下命令在审计时通过：

- `npm run verify:tool-registry`
- `npm run verify:pricing-rules`
- `npx tsc --noEmit`
- `npm run lint`
- 188 个相关 Node 单测（tool-registry、pricing、security、local-sessions、local-usage）。

这些结果证明现有结构、生成物和已覆盖的 parity 场景可通过；但当前测试没有覆盖 rule pack/provider 路由、跨 matcher 歧义、用户正则 ReDoS、SessionReader 调度和 profile 实际解析，因此不能作为上述 Finding 已关闭的证据。

## 总体风险摘要

注册表 JSON 化、29 工具定义、离线规则包和基础校验已经形成可用基础。当前主要风险集中在“声明配置没有完全成为运行时权威来源”：定价的正确所有权尚未从工具迁移至“模型 + 计费路由”，会话扫描仍有绕过配置的路径；安全规则的可配置性也尚未达到设计要求的安全边界。建议优先完成定价边界重构及其他 P1，再将文档状态从“评审中”推进为“已批准”。
