# 敏捷任务清单：模型配置统一

文档类型代码：AGILE-TASK
版本：v1.1（补充 S-005 原型细节对齐故事）

## Epic: 设置-模型配置统一（对齐原型、单一模型来源）

### Story S-001: 设置页与原型完全一致 ✅（已交付 2a77d59）
**验收标准**：设置-模型配置分类下仅显示「通用 AI 模型 Profile」区块（左列表右表单），无安全检测模型配置、无 LLM 环境变量状态。

#### Tasks
- [x] T-1: 设置页改造 - 移除 SecurityModelConfigSection、LLM 环境变量状态块、通用页安全模型入口；更新 4 语言文案

### Story S-002: 安全检测使用统一模型 ✅（已交付 0327dd7）
**验收标准**：安全检测无独立模型配置存储/接口/UI；深度检测读取生效模型 Profile（单一模型，无轻量/高级之分）。

#### Tasks
- [x] T-2: electron 服务端 - SecurityScannerService.#modelConfig 改读 model-profiles.v1.json；删除 IPC/HTTP/存储/契约
- [x] T-3: 前端 - 删除 SecurityClient.get/setModelConfig、SecurityModelConfigView、页面 modelConfig 状态，full/quick 改由 server fn 判定；清理 i18n

### Story S-003: 各模型消费方统一读取设置页配置 ✅（已交付 8e8cff5）
**验收标准**：今日洞察/AI 洞察、日报周报、蒸馏全部只使用模型 Profile。

#### Tasks
- [x] T-4: AI 洞察改读生效 Profile（双协议 provider）
- [x] T-5: 报告移除 env 回退
- [x] T-6: 蒸馏移除 env 模型选项

### Story S-005: 模型配置页细节对齐原型、去除多余说明（本次交付）
**验收标准**：①表单含「使用官方模型/自定义模型」radio 卡片、协议类型按钮、API Key+Base URL、模型+「获取模型列表」（服务端代理，Key 不出浏览器）、请求路径/鉴权方式说明；②左列表底部显示「当前生效」；③删除 desc/storageNote/reportsUseEnv 等提及「安全检测/日报周报/蒸馏/今日洞察」的多余说明；④四语言同步。

#### Tasks
- [x] T-9: 服务端 - 新增 listRemoteModels server fn（GET /models 代理 + 已知 Provider 回退清单），单测 6 例
- [x] T-10: 前端 - ModelProfilesSection 对齐原型布局，删除多余说明；ScanScheduleSection 删除 schedule.desc；i18n 四语言增删 key

### Story S-004: 验证与交付
**验收标准**：lint/tsc/单测全绿（Windows 环境 0600 权限位用例为环境预存在失败，已在 pristine 复现），构建通过；代码合入 main 并推送远端。

#### Tasks
- [x] T-7: 全量验证（prettier/eslint/tsc/单测）
- [x] T-8: 提交、合并 main、push

### 依赖关系
| Task | 依赖 | 阻塞 |
|------|------|------|
| T-2 | T-1 | 否 |
| T-3 | T-2 | 是（契约先行） |
| T-4 | — | 否 |
| T-5 | — | 否 |
| T-6 | — | 否 |
| T-9 | — | 否 |
| T-10 | T-9 | 是（使用 listRemoteModels） |
| T-7 | T-1..T-6、T-9、T-10 | 是 |
| T-8 | T-7 | 是 |
