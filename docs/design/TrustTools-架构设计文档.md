# TrustTools UI 与总览模块重构架构设计文档

| 属性 | 值 |
|------|-----|
| 文档类型 | 架构设计文档 (ARCH) |
| 项目名称 | TrustTools |
| 版本 | v1.0 |
| 创建日期 | 2026-08-10 10:55:00 |
| 更新日期 | 2026-08-10 10:55:00 |
| 生成工具 | agile-feature-dev |
| 文档状态 | 草稿 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v1.0 | 2026-08-10 10:55:00 | 定义页面 read model、模块边界与 UI 迁移策略。 |

---

## 1. 架构原则

采用模块化单体：`routes → module query/api → application → contracts/adapters`。路由仅加载和传递数据；presentation 不直接调用扫描器、文件系统或其他模块的深层实现。

原型只提供视觉层和交互层的目标。`AppShell`、`styles.css`、`components/tt.tsx` 和既有 dashboard 组件作为可复用基础，禁止整页复制原型 Mock 代码。

## 2. 模块划分

```text
src/components/                 设计令牌与通用 UI
src/modules/dashboard/          首页读模型、刷新命令、展示组件
src/modules/skill-catalog/      工具资产读模型、筛选与治理操作
src/modules/sessions/           会话统计公共查询
src/modules/security-assessment/安全证据公共查询（后续可接入）
```

首页 read model 组合 usage、pricing、skills、projects、insights、sessions 的公开 DTO，并用数据源状态标记降级；工具概览 read model 保持 `installationRef` 不透明，不传 roots、绝对路径、URL 或内容。

## 3. 数据与展示设计

| UI 区块 | 展示模型 | 实现策略 |
|---------|----------|----------|
| App Shell | 导航、搜索、连接状态、主题与语言 | 基于现 AppShell 增量重构，保留 `/sessions` |
| KPI Rail | 区间费用、Token、缓存节省、会话、工具覆盖、Token 构成 | 由 dashboard application 统一计算，横向滚动分页 |
| 趋势与拆分 | 统一过滤的时间序列与来源/模型/项目聚合 | 复用现有图表与明细组件，新增展示适配器 |
| 工具列表 | summary、facets、items、分页 | skill-catalog application 生成 VM；UI 不从原始 snapshot 推导敏感数据 |

## 4. 关键决策

1. 费用继续由 pricing 模块估算，显示 exact/estimated/unknown 语义。
2. 会话指标使用 sessions 公共契约；没有数据时显示不可用，禁止按区间比例推演。
3. 不在本次为 Skill 健康度或安全状态建立虚假规则；仅呈现已有真实字段或明确的“未检测”。
4. 新 UI 文字接入四语言 i18n；数字与日期继续经 locale formatter 渲染。

## 5. 测试与演进

- 为 dashboard read model 覆盖区间、空值、未知价格、时区、单一来源和降级数据源。
- 为工具页 read model 覆盖私有字段剥离、筛选/排序/分页与更新状态。
- 通过 lint、TypeScript、i18n、架构边界和 build；具备环境时补充响应式页面验证。
