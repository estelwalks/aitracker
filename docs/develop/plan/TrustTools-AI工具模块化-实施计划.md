# TrustTools AI 工具模块化 — 实施计划（执行版）

| 属性 | 值 |
| --- | --- |
| 依据 | 架构设计 v1.1 / 敏捷任务清单 v1.0 / 测试策略 v1.0 / 架构审计 v1.0 |
| 分支 | `feature/init`（按要求保持当前分支，不新建 codex/ 分支） |
| 范围 | 全量 M0 → M6，每 Task 独立测试 + commit |
| 前置 | 先提交未完成的 Skill WIP（`resolveAgentRoots` 从 `agent-rules.ts` 迁到 `scanner.server.ts`）作为独立前置 commit |

## 0. 执行原则与约束

- 绞杀式迁移：先建 registry → 旧目录改为从 registry 派生的兼容导出 → 逐消费者切流 → 最后删除旧事实源。迁移结束前不删除旧导出。
- 每 Task 收尾执行：`npm run format`（仅改动文件）→ `npm run lint` → `npx tsc --noEmit` → 相关 `node --test` → 独立 commit。
- 隐私红线：配置/Reader/manifest 不得读取或持久化对话正文；公共 manifest 不得含绝对路径、环境变量名、Reader Key、恢复命令、`paths`。
- 路径安全：所有配置路径为相对路径或受控基底（`home`/白名单 env）；校验器拒绝绝对路径、`..`、NUL、超长字段。
- 不改写已推送历史（Lovable 连接）；每步保持可构建。
- Agent 目录本期一律 `unsupported`（审计 P2：无真实样本不得开启写入）。

## 1. 前置 commit：Skill WIP

提交 `agent-rules.ts` / `scanner.server.ts` 的未提交改动（`resolveAgentRoots` 迁移 + 浏览器 bundle 纯净化说明）。
- 验收：`tsc --noEmit`、`node --test src/lib/tools/catalog.test.ts src/lib/local-skills/scanner.server.test.ts` 通过。
- commit: `refactor(skills): 迁 resolveAgentRoots 至 scanner.server 以保持 agent-rules 浏览器纯净`

## 2. Epic M0 — 冻结基线与验收（3 Task）

- **M0-T1 机器可读基线**：新增 `src/lib/tool-registry/__baseline__/baseline.ts`（纯数据 + `as const`），固化 27 工具（id/nameZh/detectRoots）、9 Skill Agent（toolId/roots/envHome/markers/maxDepth）、usage adapter 源+paths、3 session 源、`MODEL_PRICES` 规则。配 `baseline.test.ts` 断言当前各 catalog 与基线逐项相等。
- **M0-T2 对照 fixture**：在 `__baseline__/fixtures/` 放匿名化的 detection/skill-roots/pricing/session-resume fixture（复用现有测试数据），供后续 parity 用例。
- **M0-T3 验证脚本 + feature flag + 回退说明**：
  - `scripts/verify-tool-registry.mjs`：编译 registry、打印工具数/能力数/价格规则数/诊断，非 0 诊断则 exit 1。
  - `src/lib/tool-registry/feature-flag.ts`：`isToolRegistryEnabled()`（读 `TRUSTTOOLS_TOOL_REGISTRY`，默认迁移未完成阶段按需开启）。
  - `npm run verify:tool-registry` 脚本注册到 package.json。
  - 回退说明写入本文件 §8。

## 3. Epic M1 — 注册表内核与配置契约（4 Task）

目录 `src/lib/tool-registry/`：

- **M1-T1 `contracts.ts`**：`ToolDefinition`（id/configVersion/display/detection/storage/capabilities/pricing）、能力判别联合（usage/skills/agents/sessions/market/security）、`ReaderKey`/`SessionReaderKey`、`ModelRateRule`、路径基底类型。纯类型，零运行时。
- **M1-T2 `define-tool.ts` + `validate.ts`**：`defineTool()` 仅做 `satisfies ToolDefinition` 收窄；纯校验器返回 `ValidationDiagnostic[]`，覆盖：重复 ID、非 kebab ID、绝对/遍历/NUL 路径、非法 capability 组合、未注册 Reader Key、价格同优先级重叠。
- **M1-T3 `registry.ts` + 公共 manifest**：
  - `compileToolRegistry(defs)`：按 id 建 Map、按 capability 建索引、编译路径/价格计划、生成 `PublicToolManifest`。
  - API：`getTool`/`requireTool`/`listTools({capability})`/`getUsagePlan`/`getSkillPlan`/`getAgentPlan`/`getSessionPlan`/`findModelRate({toolId,model,occurredAt})`/`getPublicTools()`。
  - `scripts/generate-tool-manifest.mjs` 从 registry 生成 `public-manifest.generated.ts`（gitignore，prebuild 生成）；`getPublicTools()` 为运行时纯投影（服务端用）。
  - 测试：生成文件字符串扫描不含敏感字段（TC-REG-003）。
- **M1-T4 `overrides.server.ts`**：`~/.trusttools/tool-overrides.json` 读取→Zod 校验→合并白名单字段（`enabled`/受限 discovery root/显示偏好）→原子 temp+rename；`registryFingerprint`（sha256 of canonical ids+reader keys+path plans）。损坏文件退回内建。测试：损坏覆盖、非法改 Reader/command/pricing 被拒、temp+rename（TC-OVR-001）。

质量门：registry/validator/pricing compiler 单测 100% 分支意图；本 Epic 不改任何业务消费者。

## 4. Epic M2 — 工具目录与安装探测迁移（4 Task）

- **M2-T1 27 个 config**：`tools/*.config.ts`，每个含 detection/display + 全 capability `unsupported`（usage/skills/agents/sessions/market/security 均为 unsupported，pricing 可选）。逐文件 `defineTool()`。
- **M2-T2 注册 + 一致性测试**：`tools/index.ts` 显式静态 import 白名单导出 `TOOL_DEFINITIONS`（27 个）；测试断言配置数=27、id 与文件名一致、id/nameZh/detectRoots 与 M0 基线逐项相等（TC-REG-001）。
- **M2-T3 兼容导出 + 探测切流**：`src/lib/tools/catalog.ts` 的 `AI_TOOLS`/`AI_TOOL_IDS`/`usageLogParsingFor` 改为从 registry 派生的兼容导出（保持签名不变）；`detection.server.ts` 读 `listTools()`/detection plan。Sources/onboarding 间接经 `AI_TOOLS` 自动跟随。feature flag 关闭时回退旧静态数组（保留旧常量于 `catalog.legacy.ts` 直到 M6）。
- **M2-T4 三态/双平台回归**：对比 27 工具 installed/not-installed 三态及 macOS/Windows probe 路径与基线一致；`detection.server.test.ts` 全绿。

## 5. Epic M3 — Skill/Agent/市场能力迁移（4 Task）

- **M3-T1 Skill 数据迁入 config**：将 `SKILL_AGENT_RULES` 的 roots/markers/maxDepth/envHome 写入对应 9 个工具的 `storage.skills`；其余工具 `skills: unsupported`。Agent 一律 `agents: unsupported`。
- **M3-T2 `getSkillPlan()`/`getAgentPlan()`**：实现受控 env 解析（`CODEX_HOME`/`GROK_HOME` 替换目录段保留末段）+ 路径安全检查；`agent-rules.ts` 改为从 registry 派生 `SKILL_AGENT_RULES`/`SKILL_AGENTS`/`SKILL_ROOT_SUFFIXES` 兼容导出；`scanner.server.ts` 的 `resolveAgentRoots`/`RULE_BY_AGENT` 改读 `getSkillPlan`。保留 `resolveAgentRoots` 签名。
- **M3-T3 市场目标派生**：market install target / 安装校验 / 类型从 `capabilities.market === "install-target"` && `capabilities.skills.mode === "read-write"` 派生；无 Skill 能力工具不出现在安装目标。
- **M3-T4 parity/E2E**：`CODEX_HOME` 空/非空、Antigravity 多根、冲突同步、缺失 Agent capability 的 parity（与 M0 fixture 一致）；`scanner.server.test.ts` 全绿。

## 6. Epic M4 — 用量采集适配器与 Reader 注册（5 Task）

- **M4-T1 Reader 契约**：`readers/contracts.ts`（`UsageReader` 接口）、`readers/usage-readers.ts`（`ReaderKey`→内建 reader 工厂）；generic JSON/JSONL/SQLite reader 参数化于 config 的 mapping；未知 key 启动期失败测试。
- **M4-T2 adapter 数据迁入 config**：`BUILTIN_USAGE_ADAPTERS` 的 paths/format/mapping/maxFileSize 迁入各工具 `capabilities.usage`（mode=adapter，reader=generic-*）；`aipy`/`workbuddy` 的自定义 mapping/query 作为数据/reader 参数迁入。`adapters/catalog.ts` 改为从 registry 派生兼容导出。
- **M4-T3 原生 reader 注册**：Claude/Codex 原生扫描注册为 `claude-rollout-v1`/`codex-rollout-v1`（从现有 `local-usage` reader 迁入 `readers/claude-code.ts`/`readers/codex.ts`）。
- **M4-T4 scanner/bridge 切流**：scanner、adapter config、`tokentracker-bridge` 改用 `getUsagePlan()`；保留旧目录影子对照（feature flag）。
- **M4-T5 fixture 回归**：匿名 JSON/JSONL/SQLite + Codex/Claude fixture 新旧事件逐字段相等（TC-USG-001）；坏文件只产生该工具诊断；缓存 fingerprint 变更失效；性能回归。

## 7. Epic M5 — 会话恢复与价格迁移（4 Task）

- **M5-T1 SessionReader 契约**：`readers/contracts.ts` 增 `SessionReader`；3 个 session 源（claude-code/codex/grok）路径 + resume token 模板迁入 config `capabilities.sessions`（mode=resume，reader=key，command=token 数组模板）。
- **M5-T2 sessions scanner 切流**：`local-sessions/scanner.server.ts` 改为 session reader registry 调度；保留 `isResumeSafeId` 安全校验与隐私断言；resume command 从 token 模板生成，`foo; rm -rf /` 始终 `resumeSafe=false`（TC-SES-001）。
- **M5-T3 声明式价格规则**：`MODEL_PRICES` 转为每工具 `ModelRateRule`（match 为声明式 `exactOrDatedSnapshot`/`includesAll` 数据，非函数）；`pricing/index.ts` 编译 `(toolId, priority, effectiveDate)` 索引；`findModelRate({toolId,model,occurredAt})` 无匹配返回 null；同优先级重叠构建失败（TC-PRC-001）。
- **M5-T4 pricing 消费者迁移**：`estimateEventCost` 接收 `event.source`（toolId）；动态快照键升级 `toolId:model`，旧 `model` 键双读兼容 + 歧义诊断（TC-PRC-002）；补缓存/日期/重叠/无匹配测试。`pricing/catalog.ts` 改为从 registry 派生兼容导出。

## 8. Epic M6 — 切流、清理、质量门禁（4 Task）

- **M6-T1 逐领域打开新路径**：对照 M0 基线，每项差异显式接受或修复并记录。
- **M6-T2 删除旧事实源**：删除 `AI_TOOLS`/`SKILL_AGENT_RULES`/内建 adapter catalog/旧静态 `MODEL_PRICES`/`catalog.legacy.ts` 及无引用兼容导出；保留真正被用的派生兼容层（若仍有外部引用）。
- **M6-T3 全量质量门**：`npm run lint`、`npx tsc --noEmit`、全量 `node --test`、`npm run test:e2e`、`npm run build`、`npm run build:electron`；手动 7 页面巡检（/、/skills、/market、/security、/sessions、/sources、/settings）。
- **M6-T4 文档更新**：README、架构图、贡献指南、“新增工具”操作手册；`verify:tool-registry` 纳入 CI 序列说明。

### 回退说明
- 任一 Epic 出现 parity 不一致：关闭 `TRUSTTOOLS_TOOL_REGISTRY` feature flag → 消费者回退旧静态目录/兼容导出；无需数据迁移。
- 缓存回退：恢复上一次正常 `registryFingerprint` 的用量缓存快照（`~/.trusttools/cache/local-usage-index-v10.json` 携带指纹）。
- 任何对照不一致、配置校验失败或隐私断言失败，阻塞后续 Task，不得通过更新快照掩盖差异。

## 9. 本会话交付承诺

按上述顺序逐 Task 实现并 commit；每 Task 附验收报告（lint/tsc/单测/parity）。M6-T3 执行完整 e2e + build + build:electron。若中途遇到需产品确认的开放项（Agent 格式、动态价格源 SLA），按审计要求以 `unsupported`/现有 fallback 保守处理并在 commit 说明中标注，不凭推断开启能力。
