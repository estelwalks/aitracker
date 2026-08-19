# 后端功能补齐 — 交付记录

| 属性     | 值                                                             |
| -------- | -------------------------------------------------------------- |
| 文档类型 | 交付记录 (DELIVERY)                                            |
| 项目名称 | trusttools_webapp                                              |
| 分支     | feature/ui-rebuild                                             |
| 创建日期 | 2026-08-16                                                     |
| 文档状态 | 已验证（tsc 0 / lint 0 / 单测 943+12 基线 / e2e 22/22）         |

## 目标

补齐缺失的后端功能，使原型全部功能闭环（前端 UI 已在前一轮交付，本轮补后端支撑）。

## 交付清单（6 个 Story，8 个提交）

| Story | 提交 | 内容 |
|-------|------|------|
| B-100 会话片段蒸馏 | `81f596a` | `SegmentRef/SegmentMaterial` 契约 + `DistillationPorts.transcriptPort`；用户显式选择的片段文本拼接进 AI 输入（仅内存，绝不持久化，测试断言 candidate JSON 无原文）；片段读取失败降级为仅元数据蒸馏；validator 拒绝越界/重复/超限片段；`src/lib/distill-segment.ts` URL codec；TranscriptPanel「蒸馏所选」经 `?segment=` 预选跳转；/distill 自动勾选会话 + 片段提示条 |
| B-200 报告定时调度 | `a133e4c` | `syncReportScheduleToTasks` server fn（`tt.report.schedule` → `reports.generate` 任务偏好）；daily/weekly/monthly 调度映射（扩展 ScheduleSchema 支持 monthly + scheduler nextRunAt 月末钳制）；composition 补挂 taskApi；ReportSchedule 保存后同步 + toast；单测 7 + 端到端持久化验证 |
| B-300 sources 一键迁移 | `8acd87d` | `migrateSourceSkills` server fn（服务端枚举 Skill 目录，路径不出服务端，复用 syncLocalSkill，自动剔除源 agent）；SourceMigrationModal（目标多选 + 冲突策略）；迁移按钮接线；单测 12 |
| B-400 报告接入 Profile | `a5949e7` + `331a11c` | generateReport 门禁改为「活动 Profile OR 环境变量」；`createReportGenerationPort` 可注入 `resolveModelId`（活动 Profile id）；适配器按 modelId≠默认值时设 providerId="profile" 复用 S-500 provider；失败优雅降级 offline；单测 4（含端到端 HTTP 捕获验证真实调用） |
| B-500 记忆计数入小组件 | `4e15c2e` | widget-data `outputs.memory`（已批准知识资产数，并入 30s 共享轮询，失败→null）；MediumWidget「沉淀」槽位改知识库计数；knowledge 公共入口导出 |
| B-600 蒸馏官方额度 | `a30de7a` + `04d7d69` + `815d5aa` + `651cf94` | 服务端每日额度记账（`distill-quota.v1.json` 原子写，limit 常量 20，renderer 不可篡改）；真实模型消耗额度、offline 不计数、用尽拒绝、端口缺失降级不限额；读模型含 remaining；DistillConfig 展示 + 启动拦截 + 「管理模型」深链 `/settings?section=model`；单测 12 |
| 协作恢复提交 | `651cf94` `815d5aa` `04d7d69` | 并发 agent 交错 git 操作（reset/stash/amend 共享文件）后的恢复性提交，保证 B-600 改动完整回到 HEAD |

## 质量门禁（全量）

| 检查 | 结果 |
|------|------|
| `tsc --noEmit` | ✅ 0 errors |
| `eslint .` | ✅ 0 errors / 4 warnings（react-refresh 既有） |
| 全量单测（955 个，+50 新增） | ✅ 943 通过 / 12 失败（与任务开始前逐一相同：tool-registry 基线 6 + optimization 时间炸弹 5 + perf 负载 1，无新增回归） |
| e2e Playwright（22 个） | ✅ 22/22 全绿 |
| verify:tool-registry / module-catalog | ✅ OK |
| verify:architecture | 回基线 16 项（无新增违规） |
| i18n | ✅ 2046 keys 四语言一致 |

## 并发协作说明

6 个子代理并行实施期间发生多次 git 交错（stash/reset/amend 共享文件），已全部处理：
- 所有 49 个被卷进 stash 的文件均已确认无丢失（或在提交中，或在工作树）
- 过期 `stash@{0}` 与 `backup/b500-recovery` 已清理
- 恢复性提交保证各 Story 改动完整共存于 HEAD

## 后续可选项（不在本轮范围）

- 修复 12 个基线失败测试（tool-registry 基线重冻结 + optimization 时间炸弹 + perf 阈值）
- Electron 侧 runtime 防御真实事件采集（security-monitor 目前为领域层）
