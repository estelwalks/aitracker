# 架构设计文档：模型配置统一

文档类型代码：ARCH
版本：v1.0
日期：2026-02-01

## 1. 系统架构（改动范围）

```
┌─ 渲染进程（浏览器/WebView）───────────────────────────────────────────┐
│  设置页「模型配置」（ModelProfilesSection）──server fn──> S-500 存储    │
│  蒸馏页模型选择器（Profile 列表）              ──server fn──> S-500 存储 │
│  安全检测页（SecurityAssessmentPage）          ──IPC/HTTP──> 扫描服务    │
│  Dashboard 洞察卡片                          ──POST fn──> AI 洞察服务   │
└───────────────────────────────────────────────────────────────────────┘
                 │                              │              │
   ┌─────────────┴─────────┐    ┌───────────────┴───┐   ┌─────┴──────────┐
   │ composition.server.ts │    │ ai-insight.server │   │ SecurityScanner│
   │ modelProfiles 仓库     │    │  resolveProfile   │   │ Service        │
   │ (model-profiles.v1.json)  │  (openai/anthropic)│   │ 读取同文件       │
   └───────────────────────┘    └───────────────────┘   └────────────────┘
```

### 1.1 模块划分

| 层 | 归属 | 职责 |
|----|------|------|
| S-500 模型 Profile 存储 | `src/modules/ai-orchestration/model-profile.server.ts` | 唯一事实来源（已有，不改） |
| 设置页 | `src/modules/settings/presentation/*` | 只保留 ModelProfilesSection |
| 安全检测适配 | `electron/security-scanner-service.ts` | `#modelConfig()` 从 Profile 文件派生 skill-scanner ModelConfig |
| AI 洞察 | `src/modules/dashboard/ai-insight.server.ts` | 解析生效 Profile 构造 provider（支持两协议） |
| 报告 | `src/modules/reports/api.server.ts` | 移除 env 回退 |
| 蒸馏 | `src/modules/distillation/api.server.ts` | 移除 env 模型选项 |

## 2. 数据模型

### 2.1 安全检测模型派生（不再独立存储）

```typescript
// SecurityScannerService.#modelConfig() —— 新实现
// 读取 ~/.trusttools/tasks/model-profiles.v1.json（与 S-500 完全同一文件）
{
  profiles: [{ id, name, mode: "official"|"custom", protocol, apiKey?, endpoint?, model? }],
  activeProfileId: string|null
}
// → skill-scanner ModelConfig:
{
  provider: profile.protocol,               // openai | anthropic
  endpoint: official ? OFFICIAL_ENDPOINT : (profile.endpoint ?? 协议默认),
  apiKey: profile.apiKey,
  liteModel: model,                         // 统一模型
  proModel: model,                          // 统一模型（不再区分）
  timeoutMs: 120_000,
}
// 无生效 Profile 或缺少 apiKey → undefined（full 扫描返回 model-required）
```

### 2.2 AI 洞察 provider（支持双协议）

复用 model-profile.server.ts 的 `chatUrl/chatHeaders/parseChatText` 模式：
- openai：`POST {endpoint}/chat/completions`，`Authorization: Bearer`
- anthropic：`POST {endpoint}/messages`，`x-api-key` + `anthropic-version`

## 3. 接口设计（删除项）

| 接口 | 方法 | 处置 |
|------|------|------|
| `desktopIpc.getSecurityModelConfig` / `setSecurityModelConfig` | IPC | 删除（contracts/preload/main） |
| `GET/POST /api/security/model-config` | HTTP | 删除（security-http-api） |
| `SecurityClient.getModelConfig/setModelConfig` | 前端 client | 删除（desktop-client/browser-client） |
| `SecurityModelConfigView/Input` | 类型 | 删除（contracts.ts、security-view.ts、browser-client schema） |
| `SecurityModelConfigSection.tsx` | 组件 | 删除文件 |
| `use-security-client.ts` | hook | 删除文件（无其他使用者） |
| `TRUSTTOOLS_LLM_*` 读取 | env | 从报告/蒸馏/洞察消费路径移除 |

## 4. 关键技术决策

1. **安全检测不新增 IPC**：主进程直接读 Profile 文件，避免把 API Key 送进渲染进程。
2. **前端 full/quick 判定**：SecurityAssessmentPage 通过现有 server fn（`listModelProfiles` 的生效项）判断是否有可用模型，而不是 IPC getModelConfig。
3. **AI 洞察异步化**：`createDashboardAIInsightService({ resolveProfile })`，refresh 时解析生效 Profile；read() 保持同步返回缓存视图；未配置 Profile 时返回 not-configured。
4. **测试隔离**：Electron 服务测试注入 TRUSTTOOLS_USAGE_HOME 与临时 Profile 文件；AI 洞察测试注入 fake resolveProfile。

## 5. 扩展性设计

- 若未来恢复多模型区分，只需在适配层拆分 lite/pro 字段来源，存储层不变。
- Profile 文件版本字段保留，后续可加 schemaVersion 迁移。
