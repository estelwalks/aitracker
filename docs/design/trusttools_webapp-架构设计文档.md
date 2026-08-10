# 首页总览与工具概览模块化重构架构设计文档

| 属性     | 值                  |
| -------- | ------------------- |
| 文档类型 | 架构设计文档 (ARCH) |
| 项目名称 | trusttools_webapp   |
| 版本     | v1.0                |
| 创建日期 | 2026-08-10 15:16:44 |
| 更新日期 | 2026-08-10 15:16:44 |
| 生成工具 | agile-feature-dev   |
| 文档状态 | 草稿                |

## 修订记录

| 版本 | 修改时间            | 修改内容 |
| ---- | ------------------- | -------- |
| v1.0 | 2026-08-10 15:16:44 | 初始版本 |

## 1. 模块边界

`dashboard` 负责首页总览的只读投影：API 载入聚合快照，`application/v2.ts` 计算同范围视图与 Hero 视图，`presentation/DashboardV2Page.tsx` 只保存页面筛选状态并渲染。

`skill-catalog` 负责工具概览与 Skill 工作台：`application/tool-overview.ts` 将同一 `DashboardV2Snapshot` 按工具聚合；`presentation/SkillsPage.tsx` 渲染工具概览后复用现有的 Skill 受控操作。页面路由仅协调两个浏览器安全的读模型。

## 2. 数据流

```text
本地使用采集 + 监控/安全 + Skill 扫描
              ↓
DashboardV2Snapshot / MonitoringStatus / SkillWorkspaceSnapshot
              ↓
dashboard application/v2 ───────→ 首页总览
              ↓
skill-catalog application/tool-overview ─→ 工具概览
```

所有展示契约仅含聚合指标。路径、原始日志、会话内容与扫描细节保留在服务端适配器层。

## 3. 关键决策

- 单一时间投影：`createDashboardV2View` 是首页所有范围指标的唯一计算入口；工具视图使用 `buildToolOverview` 对相同快照作工具维度聚合。
- 证据优先：`null` 代表来源不可用，和观察到的 `0` 严格区分；比较周期不足事件数时不展示环比。
- 工具状态优先级：有范围内活动 > 已检测 > 可用目录项 > 不可用目录项。
- UI 可替换：原型结构映射到演示组件，但数据计算保留在 application 层，避免展示组件自行推导业务数据。

## 4. 验证边界

应用单元测试覆盖聚合、时间范围、空值和排序；路由/演示测试覆盖可见文本与交互；Playwright 在 `localhost:8081` 核对两页的真实状态与切换行为。
