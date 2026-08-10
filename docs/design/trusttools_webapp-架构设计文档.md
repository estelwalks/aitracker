# 首页总览与工具概览模块化重构架构设计文档

| 属性     | 值                  |
| -------- | ------------------- |
| 文档类型 | 架构设计文档 (ARCH) |
| 项目名称 | trusttools_webapp   |
| 版本     | v1.4                |
| 创建日期 | 2026-08-10 15:16:44 |
| 更新日期 | 2026-08-10 19:50:04 |
| 生成工具 | agile-feature-dev   |
| 文档状态 | 草稿                |

## 修订记录

| 版本 | 修改时间            | 修改内容                                                             |
| ---- | ------------------- | -------------------------------------------------------------------- |
| v1.0 | 2026-08-10 15:16:44 | 初始版本                                                             |
| v1.1 | 2026-08-10 18:19:30 | 增补 reader 修复、字段证据与 Token 对账架构                          |
| v1.2 | 2026-08-10 19:01:25 | 增补 TokenTracker 对照后的三类原生 Usage reader 与估算隔离决策       |
| v1.3 | 2026-08-10 19:24:53 | 三类原生 reader 落地并通过缓存幂等、跨副本去重与 registry 校验       |
| v1.4 | 2026-08-10 19:50:04 | 扩展 Dashboard/Sources/导航原型层，并定义受控 LLM 洞察与迁移清单架构 |

## 1. 模块边界

`dashboard` 负责首页总览的只读投影：API 载入聚合快照，`application/v2.ts` 计算同范围视图与 Hero 视图，`presentation/DashboardV2Page.tsx` 只保存页面筛选状态并渲染。

`skill-catalog` 负责工具概览与 Skill 工作台：`application/tool-overview.ts` 将同一 `DashboardV2Snapshot` 按工具聚合；`presentation/SkillsPage.tsx` 渲染工具概览后复用现有的 Skill 受控操作。页面路由仅协调两个浏览器安全的读模型。

`sources` 继续拥有来源扫描投影，但增加原型所需的工具类型、相对目录、读取进度、关联 Skill 和迁移能力状态；只有 `~/` 相对目录可跨服务端边界。`AppShell` 拥有路由别名和状态式折叠，不承载数据聚合。

## 2. 数据流

```text
目录/可执行文件探测 + 原生/通用 Usage reader + Session reader
              ↓
字段覆盖证据 + Token 语义归一 + Usage/Session 对账
              ↓
本地使用采集 + 监控/安全 + Skill 扫描
              ↓
DashboardV2Snapshot / MonitoringStatus / SkillWorkspaceSnapshot
              ↓
dashboard application/v2 ───────→ 首页总览
              ↓
skill-catalog application/tool-overview ─→ 工具概览
              ↓
sources projection / migration-availability ─→ Sources
              ↓
safe dashboard aggregate ─→ insight orchestration ─→ configured LLM
              ↓                                      ↘ status/cache
Dashboard hero / refresh action
```

所有展示契约仅含聚合指标。路径、原始日志、会话内容与扫描细节保留在服务端适配器层。

## 3. 关键决策

- 单一时间投影：`createDashboardV2View` 是首页所有范围指标的唯一计算入口；工具视图使用 `buildToolOverview` 对相同快照作工具维度聚合。
- 证据优先：`null` 代表来源不可用，和观察到的 `0` 严格区分；比较周期不足事件数时不展示环比。
- 工具状态优先级：有范围内活动 > 已检测 > 可用目录项 > 不可用目录项。
- UI 可替换：原型结构映射到演示组件，但数据计算保留在 application 层，避免展示组件自行推导业务数据。
- 字段级证据：覆盖状态随聚合 DTO 进入展示层；只有 `observed` 的零值才允许显示为零。
- Token 归一：input 包含 cache-read、output 包含 reasoning 时只记一次；reasoning 仅作为 output 的细分。
- 双链对账：Usage 与 Session reader 对同一源使用相同去重键和 Token 语义，测试允许显式说明的采样差异，不接受重复累计。
- 隐私安全：命令只保留安全签名/类别；不得为补齐展示读取或传输原始提示词与对话内容。
- LLM 适配器：在 `ai-orchestration` 增加服务端 OpenAI-compatible provider；composition root 仅在三个 `TRUSTTOOLS_LLM_*` 环境变量完整时注册。洞察输入是 schema 化聚合，输出是受限 JSON；没有配置时路由保持 offline，且 UI 显示未配置。
- 洞察缓存：服务端保存短 TTL 的最后成功/失败状态，Dashboard loader 只读缓存；用户显式“刷新洞察”才触发网络调用，避免页面加载隐式消耗和重复请求。
- Sources 迁移能力：当前没有可验证的第三方导出/导入协议，因此 presentation 只投影 disabled 原因；不生成下载包、不调用第三方写入，也不伪造成功 toast。未来迁移必须以独立 bounded context 实现版本化 schema、目标工具适配器、用户确认和完整性校验。
- 路由兼容：新增 `/chats`、`/tracker` 作为主展示路由或别名，保留 `/sessions`、`/market` 以免破坏旧链接。

## 4. Reader 修复与扩展

- Claude：Session reader 使用消息级去重，输出会话、turn、subagent 与一致 Token 汇总。
- Codex：统一 envelope 解包；支持当前 `exec`、`patch_apply_end` / custom tool 事件。
- Gemini：从 `~/.gemini/tmp/*/chats/session-*.json` 读取累计 Token 快照，按同文件相邻快照作非负差分；快照重置时重新建立基线，`tool` 归入 output，`thoughts` 作为 reasoning 细分。
- Grok：只累计 `params.update.sessionUpdate=turn_completed` 下 `usage.modelUsage` 的逐轮真实用量；`inputTokens` 先扣除 cache-read。`signals` 中的 context-window 水位不进入真实总计。
- OpenClaw：只读 `agents/*/{sessions,session-sqlite-import-archive}` 的 assistant usage；使用稳定事件 ID 或隐私安全字段指纹跨 active/archive/reset 副本去重。
- Antigravity：当前日志未提供真实 Token 字段。禁止读取正文进行字符估算，保持 Usage unsupported；未来若产品明确启用估算，必须新增独立 provenance/quality 类型且不得混入真实总计。
- 通用 reader：保留 Token/模型/项目能力，但为 context、tool、Skill、message、真实 SID 标记 unsupported/unavailable。
- Detection：组合候选目录与 executable 证据，分别输出 installed、dataDetected、usageSupported、sessionSupported。
- Registry 支持口径：29 个工具中 6 个 native、7 个 adapter、16 个 unsupported；Gemini/Grok 为 adapter→native 质量升级，OpenClaw 为新增 native，因此支持总数由 12 增至 13。

## 5. 验证边界

应用单元测试覆盖 reader 实际 envelope、消息去重、Token 对账、聚合、时间范围、空值和排序；路由/演示测试覆盖可见文本与交互。浏览器在 `localhost:8080` 验收实现，在只读 `localhost:8081` 对照视觉与交互。
