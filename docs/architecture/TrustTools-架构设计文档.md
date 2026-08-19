# TrustTools UI 与总览模块重构架构设计文档

| 属性 | 值 |
|------|-----|
| 文档类型 | 架构设计文档 (ARCH) |
| 项目名称 | TrustTools |
| 版本 | v2.0 |
| 创建日期 | 2026-08-10 10:55:00 |
| 更新日期 | 2026-08-10 12:38:37 |
| 生成工具 | agile-feature-dev |
| 文档状态 | 草稿 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v2.0 | 2026-08-10 12:38:37 | 依据新原型引入工具视角 Dashboard V2 与 Skills 资产运营台 read model。 |
| v1.0 | 2026-08-10 10:55:00 | 定义页面 read model、模块边界与 UI 迁移策略。 |

---

## 1. 架构原则

采用模块化单体：`routes → module query/api → application → contracts/adapters`。路由仅加载和传递数据；presentation 不直接调用扫描器、文件系统或其他模块的深层实现。

原型只提供视觉层和交互层的目标。`AppShell`、`styles.css`、`components/tt.tsx` 和既有 dashboard 组件作为可复用基础，禁止整页复制原型 Mock 代码。

## 2. 模块划分

```text
src/components/                 设计令牌与通用 UI
src/modules/dashboard/          首页 Dashboard V2 读模型、刷新命令、展示组件
src/modules/skill-catalog/      Skill 资产运营台读模型、筛选与治理操作
src/modules/sessions/           会话统计公共查询
src/modules/agent-directory/    工具身份、能力与安装/健康公开投影
src/modules/security-assessment/安全证据公共查询（后续可接入）
```

首页 read model 组合 usage、pricing、skills、projects、insights、sessions、agent-directory 的公开 DTO，并用数据源状态标记降级；工具概览 read model 保持 `installationRef` 不透明，不传 roots、绝对路径、URL 或内容。

## 3. 数据与展示设计

| UI 区块 | 展示模型 | 实现策略 |
|---------|----------|----------|
| App Shell | 导航、搜索、连接状态、主题与语言 | 基于现 AppShell 增量重构，保留 `/sessions` |
| Dashboard Hero | 洞察、数据源可用性、工具探测和扫描时间 | `DashboardV2ReadModel.system`，未采集/未扫描明确表示 |
| KPI Rail | 区间费用、Token、缓存节省、会话、工具覆盖、Token 构成 | 由 dashboard application 统一计算，横向滚动分页 |
| Source/Agent Gallery | 公开 toolId、显示名、真实 Token/事件/缓存/最后活动/Skill 覆盖 | dashboard application 按 source 聚合；只按 registry 映射，不由 UI 猜测名称 |
| 趋势与拆分 | 统一过滤的时间序列与来源/模型/项目聚合 | 展示层只渲染 V2 series，保留面积/柱状/折线与模型/项目 tab |
| 上下文与贡献图 | token 构成、context tools/skills/tool outputs 计数、真实自然日活动 | 无原始 command、提示词、会话 ID；无观测则 empty/unavailable |
| 工具资产运营台 | summary、coverage、facets、items、分页 | skill-catalog application 生成 VM；保留扫描和确认式治理操作 |

## 4. 关键决策

1. `DashboardV2ReadModel` 由 dashboard application 统一构建，使用唯一的 period/filter 后事件集合；页面不得导入 local-usage scanner 或再次实现核心聚合。
2. 工具身份仅来自 agent-directory/public manifest；usage source 的映射在 server/application 处确定，renderer 只消费公开 ID 和显示名。
3. 费用继续由 pricing 模块估算，显示 exact/estimated/unknown 语义；会话指标使用 sessions 公共契约，没有数据时显示不可用，禁止按区间比例推演。
4. 工具上下文仅展示 token 分类和统计计数，不展示 command、参数、原文、sessionId、safe signature 或路径。
5. 不在本次为 Skill 健康度或安全状态建立虚假规则；仅呈现已有 assessment 的结论，否则为 unknown。
6. 新 UI 文字接入四语言 i18n；数字与日期继续经 locale formatter 渲染。

## 5. 测试与演进

- 为 dashboard V2 application 覆盖区间、空值、未知价格、时区、单一来源、合计守恒和降级数据源。
- 为工具页 workspace read model 覆盖私有字段剥离、coverage、筛选/排序/分页与更新状态。
- 通过 lint、TypeScript、i18n、架构边界和 build；使用浏览器验证选择卡联动、响应式和 SSR/hydration 无 server-module 泄漏。
