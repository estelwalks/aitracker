# 原型对齐完善敏捷任务清单

| 属性     | 值                                                                 |
| -------- | ------------------------------------------------------------------ |
| 文档类型 | 敏捷任务清单 (AGILE-TASK)                                          |
| 项目名称 | trusttools_webapp                                                  |
| 对齐基准 | `docs/V3.0_TrustTools/project-sparkle-hub-92-c957c2e6-main`（原型） |
| 创建日期 | 2026-08-16                                                         |
| 生成工具 | agile-feature-dev                                                  |
| 文档状态 | 计划中                                                            |

## 背景结论（Phase 0-1 完成）

当前实现是「原型视觉/交互的模块化真实数据化重写」：`/`、`/agents`、`/distill`、
`/reports`、`/security`、`/skills`、`/sources`、`/tracker` 八个主页面结构顺序与
原型一致且真实数据化（超越原型部分）。主要缺口集中在四类：

1. **三个整页缺失/断档**：`/memory` 记忆库（knowledge 后端已就绪但无 UI）、
   `/widget` 小组件（无路由也无设置分类）、`/chats/$id` 会话详情（从「全文对话 +
   片段蒸馏 + 简报」退化为纯摘要卡）。
2. **蒸馏链路入口断裂**：首页 AgentWorkstreams、会话列表每行、会话详情框选区的
   「蒸馏」动作全部消失；选材粒度从「消息片段」降为「整场会话」。
3. **设置/模型配置降级**：多模型 Profile 管理 → 单 LLM 配置；「小组件」分类消失。
4. **次要面板缺失**：RuntimeBlockPanel、ChatHistorySidebar、简报弹窗、Markdown 渲染器。

## 产品决策（用户已确认）

- **会话详情 /chats/$id**：与原型保持一致，恢复全文对话展示、片段框选蒸馏、生成简报、
  ChatHistorySidebar；去除「intentionally no transcript」的隐私合规备注。
  实现约束：transcript 仅本地读取、内存展示，**不持久化、不上传**（CLEAN_ROOM 的
  collect/persist/upload 边界仍遵守，本地查看自身日志属正当用途）。
- **本期范围**：全部补齐（memory + widget + 会话详情 + 蒸馏入口 + 多模型 Profile + 次要面板）。

## Epic: V3.0 原型对齐完善

### Story S-100：/memory 记忆库整页（3 人日）— 高

验收标准：新增 `/memory` 路由与侧栏入口；页面含 JarvisInsight、搜索、类型 Segmented
（全部/画像/任务记忆）、按来源分组、记忆卡片 CRUD、去蒸馏入口；复用 knowledge 后端
（KnowledgeAssetKind="memory" 资产）；四语言 i18n。

- [ ] T-101：knowledge 模块查询/写入门面（server fns：list/create/update/delete + 校验）
- [ ] T-102：/memory 路由 + 记忆库页面 UI（分组/筛选/CRUD/去蒸馏入口）
- [ ] T-103：i18n 四语言 + 单元测试 + 质量门禁 + commit

### Story S-200：/widget 小组件整页（3 人日）— 中

验收标准：新增 `/widget` 路由与侧栏入口；浮窗 420px 三 Tab（安全/用量/今日）、
桌面小/中/大号小组件、菜单栏图标预览；设置页新增「小组件」分类与 WidgetConfigPanel；
四语言 i18n。

- [ ] T-201：widget 组件族移植（JarvisWidget/TrayWidget/DesktopWidgets/MenuBarIcon/SoulOrb/WidgetConfigPanel）
- [ ] T-202：/widget 路由 + 设置页「小组件」分类接线
- [ ] T-203：i18n 四语言 + 单元测试 + 质量门禁 + commit

### Story S-300：/chats/$id 会话详情恢复（4 人日）— 高

验收标准：会话详情含 ChatHistorySidebar 会话历史侧栏、全文消息气泡（thinking 折叠）、
起点/终点片段框选 + 全选/重置、ModelPicker + 蒸馏发起、生成简报弹窗（ReportView）、
CLI 恢复卡；transcript 仅内存读取不持久化；四语言 i18n。

- [ ] T-301：transcript 读取层（本地日志安全读取，仅内存，含隐私边界测试）
- [ ] T-302：ChatHistorySidebar + 消息气泡列表 + 片段框选交互
- [ ] T-303：蒸馏发起（选区→跳转 /distill 预选）+ 生成简报弹窗
- [ ] T-304：i18n 四语言 + 单元测试 + 质量门禁 + commit

### Story S-400：蒸馏入口恢复（2 人日）— 高

验收标准：首页 AgentWorkstreams 每行「蒸馏」动作（通知 + 跳转）、会话列表每行蒸馏
入口、会话详情选区条；DistillButton 组件；四语言 i18n。

- [ ] T-401：DistillButton 组件 + 通知机制
- [ ] T-402：首页 AgentWorkstreams / 会话列表 / 会话详情接线
- [ ] T-403：i18n 四语言 + 单元测试 + 质量门禁 + commit

### Story S-500：设置页多模型 Profile（3 人日）— 中

验收标准：设置页「模型配置」分类支持多套命名 Profile（新增/编辑/删除/切换生效/测试
连接）；蒸馏与报告模型选择接入 Profile 列表；四语言 i18n。

- [ ] T-501：模型 Profile 存储与契约（多 Profile CRUD + 校验）
- [ ] T-502：设置页多 Profile UI + 测试连接
- [ ] T-503：蒸馏/报告模型选择接入 + i18n + 单元测试 + 质量门禁 + commit

### Story S-600：次要面板与完善（2 人日）— 低

验收标准：/security 扫描完成后展示 RuntimeBlockPanel；/reports 正文用 Markdown 渲染；
会话列表补 JarvisInsight hero 与工具胶囊过滤；蒸馏素材支持消息级片段选材（尽力）。

- [ ] T-601：RuntimeBlockPanel（security）
- [ ] T-602：Markdown 渲染器（reports）
- [ ] T-603：会话列表筛选增强 + 蒸馏素材片段选材（尽力而为）
- [ ] T-604：i18n 四语言 + 单元测试 + 质量门禁 + commit

### Story S-700：全量回归与交付（1 人日）

验收标准：全量 lint + tsc + test 通过（除已登记的时间炸弹/基线问题外 0 失败）；
e2e 冒烟通过；更新实施进度文档；产出交付报告。

- [ ] T-701：全量质量门禁（lint + tsc + 全量单测 + verify:tool-registry）
- [ ] T-702：e2e 冒烟（关键路由可达 + 标题/导航断言）
- [ ] T-703：更新实施进度文档 + 交付报告

### 依赖关系

| Task | 依赖 | 阻塞 |
|------|------|------|
| T-102 | T-101 | 否 |
| T-103 | T-101, T-102 | 否 |
| T-202 | T-201 | 否 |
| T-302 | T-301 | 否 |
| T-303 | T-301, T-302 | 否 |
| T-402 | T-401 | 否 |
| T-502 | T-501 | 否 |
| T-503 | T-501, T-502 | 否 |
| S-700 | 全部 | 否 |

## Phase 4 强制流程（每个 Task 完成后）

1. `npx prettier --write` 相关文件 + `npx eslint`（0 errors）
2. `npx tsc --noEmit`（0 errors）
3. 相关单测全部通过
4. `git add` + `git commit`（feat/fix 规范）
5. 输出 Task 验收报告
