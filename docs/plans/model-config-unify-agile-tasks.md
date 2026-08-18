# 敏捷任务清单：模型配置统一

文档类型代码：AGILE-TASK
版本：v1.0

## Epic: 设置-模型配置统一（对齐原型、单一模型来源）

### Story S-001: 设置页与原型完全一致
**验收标准**：设置-模型配置分类下仅显示「通用 AI 模型 Profile」区块（左列表右表单），无安全检测模型配置、无 LLM 环境变量状态。

#### Tasks
- [ ] T-1: 设置页改造 - 移除 SecurityModelConfigSection、LLM 环境变量状态块、通用页安全模型入口；更新 4 语言文案 - 预估 3h

### Story S-002: 安全检测使用统一模型
**验收标准**：安全检测无独立模型配置存储/接口/UI；深度检测读取生效模型 Profile（单一模型，无轻量/高级之分）。

#### Tasks
- [ ] T-2: electron 服务端 - SecurityScannerService.#modelConfig 改读 model-profiles.v1.json；删除 IPC/HTTP/存储/契约 - 预估 5h
- [ ] T-3: 前端 - 删除 SecurityClient.get/setModelConfig、SecurityModelConfigView、页面 modelConfig 状态，full/quick 改由 server fn 判定；清理 i18n - 预估 3h

### Story S-003: 各模型消费方统一读取设置页配置
**验收标准**：今日洞察/AI 洞察、日报周报、蒸馏全部只使用模型 Profile。

#### Tasks
- [ ] T-4: AI 洞察改读生效 Profile（双协议 provider） - 预估 4h
- [ ] T-5: 报告移除 env 回退 - 预估 1h
- [ ] T-6: 蒸馏移除 env 模型选项 - 预估 1h

### Story S-004: 验证与交付
**验收标准**：lint/tsc/单测全绿，构建通过；代码合入 main 并推送远端。

#### Tasks
- [ ] T-7: 全量验证（prettier/eslint/tsc/单测/build） - 预估 2h
- [ ] T-8: 提交、合并 main、push - 预估 0.5h

### 依赖关系
| Task | 依赖 | 阻塞 |
|------|------|------|
| T-2 | T-1 | 否 |
| T-3 | T-2 | 是（契约先行） |
| T-4 | — | 否 |
| T-5 | — | 否 |
| T-6 | — | 否 |
| T-7 | T-1..T-6 | 是 |
| T-8 | T-7 | 是 |
