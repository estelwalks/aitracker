# 需求规格说明书：设置-模型配置统一（Model Config Unify）

文档类型代码：SRS
版本：v1.0
日期：2026-02-01
依据：V3.0 原型 `docs/V3.0_TrustTools/project-sparkle-hub-92-c957c2e6-main-4`（`src/components/ModelSettings.tsx`、`src/lib/ai-config.ts`、`src/routes/settings.tsx`）与需求文档 `docs/requirement/*`

## 1. 背景与目标

当前应用的「设置 → 模型配置」页面包含三块内容：通用 AI 模型 Profile（S-500）、安全检测独立模型配置（provider/endpoint/apiKey/轻量模型/高级模型/超时）、LLM 环境变量状态展示。模型消费方各自为政：安全检测读取独立的 `security-model-config.json`（轻量/高级双模型），蒸馏/报告部分回退 `TRUSTTOOLS_LLM_*` 环境变量，今日洞察（AI 洞察）完全依赖环境变量。

原型图的「设置-模型配置」页面只有一套多 Profile 模型配置（左列表右表单、测试连接、设为生效），没有安全检测独立配置，也没有环境变量概念。

**目标**：设置-模型配置页面与原型完全一致；去除所有多余配置；安全检测不再单独配置；不再区分轻量/高级模型，统一使用一个模型；所有使用模型的功能（安全检测、今日洞察/AI 洞察、日报周报、蒸馏）全部读取「设置-模型配置」中的配置。

## 2. 功能范围

### 2.1 核心功能（MUST）

| 编号 | 需求 | 说明 |
|------|------|------|
| FR-M1 | 设置页「模型配置」与原型一致 | 仅保留「通用 AI 模型 Profile」区块：左侧配置列表（激活/删除、当前生效）、右侧新增/编辑表单（模式/名称/协议/Endpoint/模型/API Key）、测试连接、保存并启用/保存修改。 |
| FR-M2 | 移除安全检测独立模型配置 | 删除设置页 `SecurityModelConfigSection`、IPC `get/setSecurityModelConfig`、`/model-config` HTTP 路由、`security-model-config.json` 存储、轻量/高级模型（liteModel/proModel）概念。 |
| FR-M3 | 安全检测使用统一模型配置 | 深度检测（full）时读取「生效中」的模型 Profile 作为唯一模型（liteModel=proModel=Profile.model）；未配置 Profile 时只能快速检测（静态）。 |
| FR-M4 | 今日洞察/AI 洞察使用统一模型配置 | Dashboard AI 洞察不再读取环境变量，改为读取生效模型 Profile（支持 OpenAI 兼容与 Anthropic 两种协议）。 |
| FR-M5 | 日报/周报使用统一模型配置 | 报告生成仅依赖生效模型 Profile，移除环境变量回退。 |
| FR-M6 | 蒸馏使用统一模型配置 | 蒸馏模型选项只来自模型 Profile（+离线兜底），移除环境变量模型选项。 |
| FR-M7 | 移除 LLM 环境变量状态展示 | 设置页不再展示/依赖 TRUSTTOOLS_LLM_* 状态。 |

### 2.2 非目标（不做）

- 不改动 skill-scanner 包本身（node_modules 依赖；liteModel/proModel 字段在适配层填入同一模型）。
- 不改动扫描计划（自动扫描调度）功能。
- 不新增云端/账号体系。

## 3. 数据需求

### 3.1 字段清单

| 字段 | 来源 | 类型 | 说明 |
|------|------|------|------|
| 模型 Profile（id/name/mode/protocol/apiKey/endpoint/model） | `~/.trusttools/tasks/model-profiles.v1.json`（已有 S-500 存储） | JSON | 唯一事实来源；安全检测服务端直接读取该文件。 |
| `security-model-config.json` | 旧安全检测独立配置 | JSON | **删除**（不再读写）。 |
| TRUSTTOOLS_LLM_* | 环境变量 | — | **不再作为配置来源**（ai-orchestration/config.ts 保留函数但不再被消费方使用，或直接删除引用）。 |

### 3.2 数据流向

```
设置页「模型配置」表单 → model-profiles.v1.json（0600）→ 生效 Profile
  ├─ 报告：composition root resolveModelId → profile-backed provider
  ├─ 蒸馏：模型选择器（Profile 列表）→ profile-backed provider
  ├─ 今日洞察/AI 洞察：refresh 时解析生效 Profile → provider（openai/anthropic）
  └─ 安全检测：SecurityScannerService 直接读文件 → skill-scanner ModelConfig
       （provider/endpoint/apiKey/model，liteModel=proModel=model）
```

## 4. 外部依赖

- `skill-scanner`（node_modules）：ModelConfigSchema 要求 liteModel/proModel 必填 → 适配层两个字段填同一模型名。
- Electron 主进程文件系统访问（安全检测读取 Profile 文件）。
- 无第三方服务新增。

## 5. 风险评估

| 风险 | 应对 |
|------|------|
| Electron 与 src 的 Profile 文件路径不一致 | 统一按 `homeDirectory + .trusttools/tasks/model-profiles.v1.json`（与 S-500 存储一致；Electron 侧 homeDirectory 已用 TRUSTTOOLS_USAGE_HOME 覆盖规则）。 |
| 删除 IPC 契约影响面大 | 同步更新 contracts/preload/main/http-api/各 client/测试，用 tsc + 单测兜底。 |
| 已存在的 `security-model-config.json` 残留 | 删除读取路径即自然废弃；clearSecurityData 中的清理保留（幂等）。 |
| AI 洞察从同步 env 解析改为异步 profile 解析导致服务构造变化 | read() 保持同步（缓存视图），refresh() 异步解析；profile 变更后由用户点击刷新生效。 |
