# AITracker 架构与业务文档索引

| 文档 | 用途 |
|---|---|
| [system-architecture.zh-CN.md](system-architecture.zh-CN.md) | 当前运行架构：Electron、本地 Web 服务、组合根、任务、数据库、隐私边界 |
| [business-structure.zh-CN.md](business-structure.zh-CN.md) | 当前业务结构：模块、核心流程、数据所有权、用户旅程、术语 |
| [Development Guide](../DEVELOPMENT.md) | 本地开发、构建、测试、打包和生成物约定（英文简版） |
| [开发·测试·验证·发布实操手册](../DEVELOPMENT_WORKFLOW.zh-CN.md) | 从零上手：环境准备、日常开发、测试矩阵、验证门禁、调试与发布流程（中文详细版） |
| [多渠道安装与发布架构设计文档](../design/aitracker-架构设计文档.md) | npx、Homebrew、WinGet、更新与发布制品专项设计 |
| [报告分析设计](../design/aitracker-报告分析设计.md) | 日报/周报/月报的产品定位、分析覆盖度现状、差距根因与改进方案 |
| [后续开发计划](../plan/aitracker-后续开发计划.md) | 基于当前代码的优先级、阶段和验收标准 |

## 什么时候读哪份？

- **新人第一次读仓库**：先读业务结构，再读系统架构。
- **改数据、任务、安全或 Electron 边界**：读系统架构。
- **改 Dashboard、Usage、Skills、Distillation、Knowledge**：读业务结构。
- **做发布或安装渠道**：先读实操手册的发布章节，再读发布架构与敏捷任务清单。
- **准备环境 / 上手跑项目**：读开发·测试·验证·发布实操手册。
- **排期新功能**：先读后续开发计划确定优先级，再深入对应的子计划。
