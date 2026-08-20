# TrustTools 数据采集规范

| 属性   | 值                                        |
| ---- | ---------------------------------------- |
| 文档类型 | 数据采集规范 (Data Collection Spec)            |
| 项目名称 | TrustTools                               |
| 版本   | v1.3                                     |
| 创建日期 | 2026-08-17                               |
| 更新日期 | 2026-08-17                               |
| 代码基线 | main-4                                   |
| 文档状态 | 草稿                                       |
| 关联文档 | 《产品需求文档》§11（原型 mock 口径，本文档为其「真实采集」口径的展开） |

## 修订记录

| 版本   | 修改时间       | 修改内容                                                                                         |
| ---- | ---------- | -------------------------------------------------------------------------------------------- |
| v1.0 | 2026-08-17 | 首版：基于 main-4 逐页梳理真实数据来源、获取方式、数据类型与计算方式                                                       |
| v1.1 | 2026-08-17 | 结构重组为「按页面划分」：逐页数据字典升为主干（每页自包含「替换动作」），原「mock → 真实映射表」按文件拆解合并进各页；真实数据源清单降级为文末附录；补 `/reports` 页 |
| v1.2 | 2026-08-17 | 补「今日洞察」产品逻辑：§3.1 产品定位与展示形态、§3.2 洞察逻辑（数据 → 业务含义 → 话术），讲清每个洞察为什么这么展示、话术怎么生成                    |
| v1.3 | 2026-08-17 | 补首页「未接入」整页空态逐区块；新增「模型适配度」洞察维度：分叉护栏（清晰度/一次命中率组合判据）+ 同厂商升档表 + agents/首页/tracker 逐页话术                    |

---

## 0. 阅读指引

本文档以**页面为主线**，回答三个问题，供研发把原型从「确定性 mock」切换到「真实本地采集」：

1. **来源**：每个页面的每个指标从用户机器的哪个文件 / 目录采集。
2. **获取方式**：读什么格式（JSONL / JSON / SQLite / 目录探测），解析哪个字段。
3. **替换动作**：落到哪个文件、哪个 mock 调用，改成什么真实采集（聚合 / 缩放 / 占比 / 展示层不变）。

> **原型现状（main-4）**：全部 14 个页面都是确定性 mock，无后端。真正「非 mock」的只有三样：
> ① `context-engine.ts` 的**解析算法**——已经是真实逻辑（输入 3 路分流 / 输出 4 路拆分 / 工具归类 / exec 分解），只差喂真实 jsonl 的 usage 数据；
> ② `sources.ts` 的 `catalog`——32 个 Agent 的真实落盘目录 + 下载地址，可直接复用；
> ③ localStorage 持久化（偏好 / 记忆 / 蒸馏历史 / 导出目录）——真实读写，不用替换。
> 
> 其余 `rnd(seed, max)` 与硬编码数组均为占位。研发接入真实数据时，**只需替换「取数」这一层，聚合 / 缩放 / 占比逻辑不变**（每页「替换动作」列明最小改动面）。

---

## 1. 全局约定

### 1.1 数据存储根目录

- 所有本地数据写入 `~/.trusttools/`，SQLite 单文件，不散落到用户目录其他位置。
- 清除数据必须二次确认。

### 1.2 确定性 mock 的两个哈希（需替换的对象）

原型用字符串种子哈希保证「同一 seed 每次渲染结果恒定」。替换真实采集后这些函数整体删除。

| 哈希实现   | 公式                                                | 出现位置                                                                                 |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 多项式    | `h = (h*31 + charCode) >>> 0`                     | agent-view.ts / sources.ts / dash-analytics.ts / skill-scan.ts / security-history.ts |
| FNV-1a | `h ^= charCode; h = Math.imul(h, 16777619) >>> 0` | mock-data.ts / chats.ts                                                              |

统一封装 `rnd(seed, max) = hash(seed) % max`，另有抖动 `jitter(seed) = 0.75 + rnd(seed,1000)/1000*0.5`（0.75~1.25）。

### 1.3 定价与成本

| 场景           | 原型取值                                                                       | 真实口径                                                                  |
| ------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Agent / 模型成本 | `round(tokens/1e6 * 2.4)`，即 $2.4/1M 统一价（agent-view.ts / dash-analytics.ts） | 走 **LiteLLM 价格表**，按模型分档（input / output / cacheRead / cacheWrite 各自单价） |
| 配额 / 日报成本    | `tokens(K) * 0.0215`，即 ¥0.0215/K（quota.ts / reports.ts）                    | 同上，LiteLLM 实时价                                                        |
| 单模型单价        | `modelDetail.pricing`（¥/K 四档）                                              | 同上                                                                    |

> ⚠️ 原型内部存在**两套价格口径**：`agent-view.ts` 用 `$2.4/1M`，`quota.ts` 用 `¥0.0215/K`（≈ $3/1M）。研发统一替换为 LiteLLM 单价时需一并消除此不一致。

### 1.4 时间范围缩放（原型假逻辑，真实应改为真实时间窗聚合）

| key   | label  | factor |
| ----- | ------ | ------ |
| today | 今天     | 0.05   |
| 7d    | 近 7 天  | 0.28   |
| 30d   | 近 30 天 | 1      |
| all   | 全部     | 2.4    |

> 原型用 `factor` 对 mock 总量做乘性缩放模拟时间窗；真实实现应改为**按时间戳过滤 jsonl 记录后聚合**，不再用 factor。

### 1.5 localStorage 持久化 Key（真实，无需替换）

| Key                                                                  | 用途                | 模块                 |
| -------------------------------------------------------------------- | ----------------- | ------------------ |
| `tt.memory.items`                                                    | 记忆库条目             | memory-store.ts    |
| `tt-prefs`                                                           | 通用偏好              | prefs.tsx          |
| `tt-widget-prefs`                                                    | 小组件偏好             | widget-prefs.ts    |
| `tt.skill-export-dir`                                                | 技能导出目录            | export-dir.ts      |
| `tt.distill.history`                                                 | 蒸馏历史              | distill-history.ts |
| `tt.distill.guide`                                                   | 蒸馏引导开关            | distill.tsx        |
| `tt.report.<key>.md` / `tt.report.<key>.notes`                       | 已生成日报正文 / 批注      | reports.tsx        |
| `tt.ai.model.config` / `tt.ai.model.profiles` / `tt.ai.model.active` | AI 模型配置 / 列表 / 当前 | ai-config.ts       |

---

## 2. 逐页数据字典

> 每页自包含三件事：**指标 → 原型 mock 来源 → 真实来源与计算方式**，页尾「替换动作」列明最小改动面（哪个文件、哪个 mock 调用、改成什么）。真实数据源目录的完整清单见文末**附录 A**。

### 2.1 首页 `/`

| 指标                                   | 原型 mock 来源                                             | 真实来源与计算方式                                                                                            |
| ------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| KPI 卡（今日 Token / 月成本 / 缓存命中率 / 活跃技能） | `mock-data.kpis` 硬编码                                   | 全量 jsonl 聚合：今日 token = Σ 当日会话 `usage.total`；缓存命中率 = Σ cacheRead / Σ input；月成本 = Σ token × LiteLLM 单价 |
| Token 趋势                             | `dash-analytics.dailySeries`                           | 按日聚合 jsonl：`total = Σ 当日 usage.total`；`cacheRate = cacheRead/input`；`sessions = distinct sessionId`  |
| 贡献热力图                                | `mock-data.heatmap`（高斯双峰）                              | 按小时聚合会话时间戳：强度 = 该小时 token 量 / 峰值 × 100                                                               |
| 模型占比                                 | `dash-analytics.modelSlices(agentModels)`              | 按 `message.model` 字段 group by：`share = 该模型 tokens / Σ tokens`                                        |
| 项目消耗                                 | `dash-analytics.projectRows(byProject)`                | 按 `cwd` / 项目路径 group by：每项目 token / 会话数 / 占比                                                         |
| 安全巡检摘要                               | `agent-view.securityPulse`                             | 扫描 `~/.claude/skills/*/SKILL.md`：scanned / safe / warn / danger 计数（见 §2.8）                           |
| 燃烧榜（技能 / 项目 / 会话三维）                  | `agent-view.roastList / roastProjects / roastSessions` | 解析 jsonl 计算浪费：浪费 = 重复读取 + 缓存未命中 + 输出丢弃，`waste 权重 × tokens` 倒序                                        |

**替换动作：**

- `mock-data.ts`：`kpis / trendDaily* / providerShare / recentModels / activities` → 全量 jsonl 聚合（日 / 周 / 月 / 模型 / 活动流）
- `mock-data.ts`：`heatmap` → 按小时聚合会话时间戳
- `mock-data.ts`：`byProvider / byProject / byModel` → 按 provider / cwd / model group by 聚合
- `agent-view.ts`：`securityPulse / roastList / roastProjects / roastSessions` → 扫描 SKILL.md / 解析 jsonl 计算浪费
- `dash-analytics.ts`：`modelSlices / projectRows` 的输入（`agentModels` 的 modelPool + 权重）→ `message.model` / `cwd` 真实分布

### 2.2 Agent 工牌墙 `/agents`

| 指标               | 原型 mock 来源                                              | 真实来源与计算方式                                                                       |
| ---------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 工牌列表             | `agent-view.agentViews`（由 `sources.dataSources` 32 项映射） | `sources.catalog` 目录探测 + jsonl 解析：`installed = 目录存在`；`live = 有会话日志`；按 tokens 倒序 |
| 单 Agent tokens   | `rnd(name:tok, 9_400_000)+120_000`                      | 该 Agent 全部 jsonl：`Σ usage.total`                                                |
| 单 Agent cost     | `tokens/1e6*2.4`                                        | 同上：`Σ token × LiteLLM 单价`                                                       |
| 单 Agent sessions | `rnd(name:ses,180)+3`                                   | 该 Agent 会话文件数：`distinct sessionId`                                              |
| 技能数 / 扫描数 / 风险数  | `skills.filter(agents.includes)` + `scanSkill`          | 该 Agent 关联的 SKILL.md（见 §2.4）                                                    |
| 24h 迷你趋势         | `spark`（`rnd(name:sp{h},100)`）                          | 该 Agent 近 24h 按小时聚合：每小时 token 归一化                                               |

**替换动作：**

- `agent-view.ts`：`rnd(name+":tok", 9_400_000)+120_000` → `Σ 该 Agent jsonl usage.total`
- `agent-view.ts`：`rnd(name+":ses", 180)+3` → `distinct sessionId 计数`
- `agent-view.ts`：`tokens/1e6*2.4`（统一价）→ `Σ token × LiteLLM 单价`
- `agent-view.ts`：`rnd(name+":sp{h}", 100)`（24h 趋势）→ 近 24h 按小时聚合 token
- `agent-view.ts`：`usageMetrics` 的 `rnd(seed:cache, 62)` 等 → `cacheRead / input` 真实命中率；input/output/reasoning 从 usage 直取

### 2.3 体检档案 `/agents`（维度下钻，数据源为 agent-v1.ts）

> `agent-v1.ts` 的 `AgentV1` 是真实解析结果的**快照**：`claudeCode` / `codexCli` 为手写完整样例，其余 8 个由 `liteAgent()` 生成（`estimated: true`）。真实实现 = 用 `context-engine.ts` 解析该 Agent 的 jsonl 得到同结构。

| 维度                     | AgentV1 字段             | 真实来源（jsonl 字段）                                        | 计算方式                                                                                                        |
| ---------------------- | ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 基础消耗                   | `basics`               | `usage` 五字段                                           | input / output / cacheRead / total / cacheHitRate = cacheRead/input / sessions / turns / costUsd            |
| Message Breakdown（3 维） | `breakdown3`           | `classifyInputTokens` + `computeOutputTokenBreakdown` | 见 §2.9，聚合为「Conversation history / User input / Assistant response」                                          |
| 7 维内部分类                | `classes7`             | 同上拆桶                                                  | user_input / conversation_history / system_prefix / reasoning / assistant_response / tool_calls / subagents |
| Top 分类消耗               | `topCategories`        | `categorizeTool` 后 group by                           | 14 类语义分组，按 token 倒序                                                                                         |
| Top 工具 / exec          | `topTools` / `topExec` | tool_use name / exec_command                          | `summarizeExecCommands` 四维（by_type / by_executable / by_command / by_exit）                                  |
| 配置资源盘点                 | `resources`            | 目录探测                                                  | SKILL.md / CLAUDE.md / MCP 配置计数                                                                             |
| 消耗趋势                   | `trend14`              | 按活跃日聚合                                                | 近 14 活跃日 token 序列                                                                                           |
| 上下文构成                  | `context`              | `splitToolCallTokens` + `extractSkills`               | 工具 / Skill / MCP 的 token 与占比                                                                                |
| 子 Agent                | `sub`                  | tool_use 中 `Agent` / `Task`                           | 数量 / 类型 / 输入 token / fork 关系                                                                                |
| 项目 × Agent             | `projectMatrix`        | 按 `cwd` group by                                      | 每项目 sessions / tokens / sharePct                                                                            |

**替换动作：**

- `agent-v1.ts`：`liteAgent`（8 个 estimated）→ 用 `context-engine` 解析该 Agent jsonl
- `agent-v1.ts`：`projectMatrix` → 按 `cwd` group by 真实聚合

### 2.4 技能库 `/skills`

| 指标                     | 原型 mock 来源                    | 真实来源与计算方式                                                                                       |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| 技能列表                   | `mock-data.skills`            | `~/.claude/skills/*/SKILL.md` + 各 Agent 技能目录：解析 frontmatter（name / description / allowed-tools） |
| 健康度（活跃 / 低频 / 休眠 / 废弃） | `skill.health`                | 最近调用时间：距今 7 天内活跃 / 30 天内低频 / 90 天内休眠 / 超 90 天废弃                                                 |
| 调用数 / 日均 / 趋势          | `skill.calls / daily / trend` | jsonl 中 `Skill` tool_use 计数：`calls = Σ Skill 调用`；`daily = calls / 天数`                           |
| 安装状态                   | `skill.installed`             | 各 Agent 技能目录探测：每 Agent 是否有该技能                                                                   |
| 扫描结论                   | `skill-scan.scanSkill(id)`    | 规则扫描 SKILL.md（见 §2.8）                                                                           |

**替换动作：**

- `mock-data.ts`：`skills`（skillCatalog）→ 解析 `~/.claude/skills/*/SKILL.md` frontmatter
- `skill-scan.ts`：`scanSkill`（`hash%100` 假阈值）→ 自研内容匹配引擎（复用 `skill-report.DIM_RULES` 元数据，检测逻辑新写）

### 2.5 安全市场 `/market`

| 指标     | 原型 mock 来源                                            | 真实来源与计算方式                              |
| ------ | ----------------------------------------------------- | -------------------------------------- |
| 市场技能   | `mock-data.marketSkills / marketCats / marketDomains` | 远端市场接口（首版可本地 mock 目录）：拉取技能目录 + 分类 + 领域 |
| 安装目标置灰 | 交叉比对 `dataSources`                                    | 本地检测结果：未检测到的 Agent 置灰（`disabled`）      |

> 注意：`/market` 复用 `pageInsights("skills")`，无独立洞察数据。

### 2.6 蒸馏 `/distill`

| 指标                                        | 原型 mock 来源                               | 真实来源与计算方式                                                     |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| 原材料（会话 / 项目、Agent 配置）                     | `distill-kinds.MATERIALS`                | 历史会话 + CLAUDE.md 等：选中的会话 / 配置文件                               |
| 提示词文件清单                                   | `TOOL_PROMPT_FILES`                      | 目录探测：各 Agent 已存在的规则文件                                         |
| 产物（Skill / Workflow / Prompt / 画像 / 任务记忆） | `distill-kinds.buildFiles / buildMemory` | 由选中素材生成文件树（prompt=1 / workflow=2 / pack=7 文件），落 Skill 库 / 记忆库 |
| 蒸馏历史                                      | `tt.distill.history`（localStorage）       | 同左（真实持久化）                                                     |

> 本页核心是**生成逻辑**（`buildFiles / buildMemory` 按素材拼文件树），无「采集」动作；真实化只需把「原材料」从 mock 会话换成真实会话 / 配置文件。

### 2.7 记忆库 `/memory`

| 指标   | 原型 mock 来源                                    | 真实来源与计算方式                              |
| ---- | --------------------------------------------- | -------------------------------------- |
| 记忆条目 | `memory-store.useMemories`（`tt.memory.items`） | localStorage：真实读写（3 条种子 + 用户新增 / 蒸馏写入） |
| 来源分布 | `mock-data.memorySources`                     | 按 source 字段 group by：各 Agent 条目计数      |

> 记忆库是**已接真实持久化**的页面，仅「来源分布」的初始值来自 mock-data，后续应以真实条目统计。

**替换动作：**

- `mock-data.ts`：`memories / memorySources` → `tt.memory.items` 真实条目统计

### 2.8 安全 `/security`

| 指标      | 原型 mock 来源                                            | 真实来源与计算方式                                                                                                                              |
| ------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 11 安全维度 | `mock-data.securityDimensions`                        | 规则引擎（`skill-report.DIM_RULES`）：静态 11 维 rce / exfil / secret / persist / destruct / obfus / inject / privesc / files / network / prompt |
| 扫描结论    | `skill-scan.scanSkill(id)`（`hash%100` 假阈值）            | 自研内容匹配引擎 + `skill-report.reportOf(id)`：按 DIM_RULES 逐条匹配 SKILL.md，输出 severity / 证据行号 / CWE / 修复建议                                       |
| MCP 安全  | `security-history.mcpServers`（7 条硬编码）/ `buildHistory` | 扫描 `.mcp.json`：MCP 服务清单 + 漏洞扫描                                                                                                         |

> `DIM_RULES` 元数据（11 条规则 + CWE + 修复建议）是**静态真实内容可直接复用**，但命中检测当前仍是 mock，需新写匹配逻辑；`buildHistory` 当前仅覆盖 Skill（记录中 `mcp: 0`），**MCP 检测首版未实现**。

**替换动作：**

- `skill-scan.ts`：`scanSkill`（`hash%100` 假阈值）→ 自研内容匹配引擎（复用 `skill-report.DIM_RULES` 元数据，检测逻辑新写）
- `security-history.ts`：`mcpServers / buildHistory` → 扫描 `.mcp.json` + 真实漏洞记录

### 2.9 Token 追踪 `/tracker`

> 核心引擎 `context-engine.ts` **已是真实逻辑**，原型只 mock 了它的输入（usage 数据）。真实实现只需把解析好的 jsonl usage 喂进去。

| 层级       | 函数                                             | 真实输入                                       | 输出                                                      |
| -------- | ---------------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| 输入 3 路分流 | `classifyInputTokens(usage, state)`            | `usage` 五字段 + `systemPrefixSeen`           | user_input / conversation_history / system_prefix       |
| 输出 4 路拆分 | `computeOutputTokenBreakdown(content, usage)`  | `message.content[]` 字符长度 + `output_tokens` | reasoning / tool_calls / subagents / assistant_response |
| 工具下钻     | `splitToolCallTokens(content, toolCallTokens)` | tool_use 字符占比                              | 每工具 token                                               |
| 工具归类     | `categorizeTool(name)`                         | tool_use.name                              | 14 类语义分组                                                |
| Skill 提取 | `extractSkills(content, tokens)`               | `Skill` tool_use                           | 每 Skill token                                           |
| exec 分解  | `summarizeExecCommands(commands, exits)`       | exec_command 命令 + 退出码                      | by_type / by_executable / by_command / by_exit          |
| 整数分配     | `allocateByLargestRemainder(total, weights)`   | 权重                                         | 保证 sum === total 的整数分配                                  |

> 本页**无替换动作**——算法层已真实，只需上游（§2.1 / §2.2）把 `usage` 换成真实 jsonl 解析结果。

### 2.10 数据来源 `/sources`

| 指标                                       | 原型 mock 来源               | 真实来源与计算方式                                                                                           |
| ---------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------- |
| Agent 目录清单                               | `sources.catalog`（真实）    | 同左：32 项目录 + 下载地址（**可直接复用**）                                                                         |
| status / filesRead / filesTotal / events | `rnd(name:status,100)` 等 | 目录探测 + 文件计数：`status = 目录存在 ? (有日志 ? data : found) : missing`；`filesTotal = 目录内文件数`；`events = 会话事件数` |
| lastScan                                 | `07-31 HH:mm` 假时间        | 真实扫描时间戳：`Date.now()`                                                                                |

**替换动作：**

- `sources.ts`：`dataSources` 的 `status / filesRead / filesTotal / events` → 目录探测 + 文件计数（`catalog` 目录本身保留）

### 2.11 会话列表 `/chats` 与详情 `/chats/:id`

| 指标    | 原型 mock 来源                    | 真实来源与计算方式                                                                                     |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| 会话列表  | `chats.chatList`（13 条手写）      | 各 Agent 会话文件（附录 A）：解析每条会话的标题 / 来源 / 项目 / 时间                                                   |
| 会话元信息 | `chatMeta(c)`                 | 会话文件 hash + 内容：model / cwd / hash / sessionFile / tokens / cost / turns / edits / durationMin |
| 恢复命令  | `resumeCommand(c)`            | 同左：CLI 会话 `cd <cwd> && claude --resume <hash>`（真实）                                            |
| 技术栈标签 | `chatTags(c)`（`TAG_RULES` 正则） | 项目目录标志文件探测：`package.json→Node` / `pyproject.toml→Python` 等（**逻辑真实，输入改真实项目路径**）                |

**替换动作：**

- `chats.ts`：`chatList`（13 条手写）→ 解析附录 A 各 Agent 会话文件
- `chats.ts`：`chatMeta` 的 `18_000+(h%420)*1000` → 会话 `usage` 真实 token 求和

### 2.12 日报 `/reports`

| 指标       | 原型 mock 来源                                     | 真实来源与计算方式                                                                                      |
| -------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 周期 / 时间线 | `reports.makePeriod / timeline`（真实日期计算）        | 真实日期（`TODAY` = 数据集内最新日）                                                                        |
| 周期内会话    | `reports.itemsIn`（过滤 `chatList`）               | 各 Agent 会话文件按日期过滤                                                                              |
| AI 日报草稿  | `reports.draftOf`（`reportStats(items)` + 文案模板） | 按周期聚合会话 stats（projects / turns / edits / minutes / tokens / cost / top），落 `tt.report.<key>.md` |
| 命中率 / 风险 | `hit = 58+(len%7)*3`、`risk = len%3`（假）         | 真实缓存命中率 + 风险计数                                                                                 |

**替换动作：**

- `chats.ts`：`chatList` → 真实会话文件（同 §2.11）
- `reports.ts`：`draftOf` 的 `reportStats(items)` → 真实按周期聚合（projects / turns / edits / minutes / tokens / cost / top）
- `reports.ts`：`hit=58+(len%7)*3` → 真实缓存命中率；`risk=len%3` → 真实风险统计
- `reports.ts`：安全概况里的 `8+(len%5)` / `3+risk` 假数字 → 真实扫描计数

### 2.13 桌面小组件 `/widget`

| 指标                     | 原型 mock 来源                                              | 真实来源与计算方式                                                                                                  |
| ---------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 今日输出 / 周输出 / 趋势        | `widget-metrics.outputToday / outputWeek / outputTrend` | 全量 jsonl 聚合：按日 / 周聚合 output_tokens                                                                         |
| 资产库存 / 今日 Token / 工具分布 | `widget-metrics.assetStock / tokenToday / todayByTool`  | 同左：技能数 / 今日 token / 按工具聚合                                                                                  |
| 配额                     | `quota.ts`                                              | 配置 + 聚合：5 小时 / 7 天 / 24 小时 / 30 天四类窗口的剩余额度 vs 阈值（`quotaWindows` / `quotaRisk` / `usageToday` / `usage30d`） |

### 2.14 设置 `/settings`

| 指标      | 原型 mock 来源                        | 真实来源与计算方式                                     |
| ------- | --------------------------------- | --------------------------------------------- |
| 通用偏好    | `prefs.readPrefs()`（`tt-prefs`）   | localStorage：真实读写                             |
| 小组件偏好   | `widget-prefs`（`tt-widget-prefs`） | localStorage：真实读写                             |
| AI 模型配置 | `ai-config`                       | localStorage + 远端 `fetch /models`：模型列表 + 测试连接 |

---

## 3. 今日洞察（Jarvis 摘要）

> 「今日洞察」是拟人化管家「贾维斯」的**口语化结论层**——没有独立数据源，全部是模板文案 + 下方 mock 数据的插值。它与报表的区别：**报表给数字，洞察给「结论 + 下一步行动」**。14 页里 10 页有洞察、4 页没有，且每页配置各不相同。

### 3.1 产品定位与展示形态

**定位**：把用量 / 成本 / 安全 / 效率这些冷数字，转译成一句有口吻的「管家汇报」。每条文案遵循 **事实 → 评价 → 行动建议** 三段式：

> 「${worst} 的缓存命中率只有 40%」= 事实 →「多为重复读上下文」= 评价 →「建议把提示词写具体」= 行动

**交互机制**（`JarvisInsight.tsx`）：

- **打字机**逐字输出 + **自动轮播**（放完一句自动切下一条）
- 右上「**换一条**」按钮 + 底部**进度点**（当前句高亮）
- 两种尺寸 variant：

| variant  | 用途                 | 视觉                            | 节奏            |
| -------- | ------------------ | ----------------------------- | ------------- |
| `hero`   | 首页全局播报 / agents 全局 | 大卡片、呼吸光圈、`欢迎回来` 开场、正文 17–19px | 22ms/字 · 9s/句 |
| `inline` | 页内洞察               | 紧凑卡片、正文 14px                  | 18ms/字 · 6s/句 |

**三条生成路径（优先级从高到低）**：

1. 外部传入 `lines` → 直接用（`pageInsights()` 或页面内联硬编码）
2. 选中单 Agent（`focus`）→ `buildAgentInsights` 微观洞察
3. 默认 → `hero ? buildGlobalBroadcast : buildInsights`

**标题规则**：`focus` 时 `{Agent名} · 专属洞察`，否则 `今日洞察`。

**空数据兜底**：无 live Agent 时，hero 显示「欢迎回来。我还没有采集到任何会话数据，先去「Agent 编排」接入一个本地Agent…」，inline 显示「还没有采集到会话数据，先去「Agent 编排」接入一个Agent吧。」

### 3.2 洞察逻辑（数据 → 业务含义 → 话术）

每条洞察的本质，是从一个数据指标读出「业务含义」，再转成「你该做什么」。核心因果链如下：

| 洞察维度     | 数据指标                                    | 业务含义（为什么）                                            | 话术方向              |
| -------- | --------------------------------------- | ---------------------------------------------------- | ----------------- |
| 依赖度      | top Agent tokens / 总 tokens             | 算力（钱）集中在谁身上 = 谁是你的主力，主力决定你的效率天花板                     | 点出主力 + 占比         |
| 缓存效率     | `cache = cacheRead / input`             | 命中率高 = 上下文复用得好、同样活花钱少；低 = 每次重复加载同样的系统提示词/项目背景，是「冤枉钱」 | 表扬最优 / 批评最差，建议写具体 |
| 价值换算     | `calls × 2.5 / 60`                      | 把「花了多少」翻译成「省下多少人工时间」，给用户正向反馈、建立续用动机                  | 省下约 N 小时          |
| 安全       | `verdict` / `scanLog` / `runtimeBlocks` | 扫描结论 + 拦截数；0 风险建信任，有风险驱动处置                           | 安心背书 / 引导去安全页     |
| 蒸馏候选     | `distillable`                           | 会话是否可解析 = 能否沉淀成可复用资产（产品北极星）                          | 引导去蒸馏工作台          |
| 提示词质量    | `pq.score`（返工/澄清推导）                     | 消耗大但产出低 = 提示词模糊；反之用得值                                | 毒打 / 夸奖           |
| Skill 浪费 | `burn.waste%`                           | 定位到具体 Skill 的无效消耗，给出可执行建议                            | 点名 Skill + advice |
| 模型适配度    | 指令清晰度 + 一次命中率 + 当前活跃模型              | 清晰度已高仍高返工 = 模型能力天花板，该换更强模型；反向轻载则换更小省钱             | 引导同厂商升/降一档（去设置 → 模型） |

> **模型适配度（新增维度 · 首版 SHOULD · 当前代码未实现）**：唯一「双向」维度——过载升档、轻载降档、匹配不啰嗦，与现有「换小模型省钱」合并成统一叙事，避免「既劝换大又劝换小」的矛盾。判据用两个信号的**组合**区分「该换模型」还是「该写清楚」：
>
> | 信号组合 | 归因 | 话术 |
> | --- | --- | --- |
> | 指令清晰度**低** | 提示词模糊 | 现有「写具体一点」 |
> | 清晰度**高** + 一次命中率**低** | 模型能力不够 | **新增：引导连接更强模型** |
> | 上下文复用低 | 重复读背景 | 现有「缓存命中率低」话术 |
>
> 护栏：**只有「清晰度已经不低、模型仍返工」才归因模型**，不把用户写不清楚的锅甩给模型。同厂商升档表（只升一档、不跨厂商拉踩，复用 `ai-config.vendorName`）：
>
> | 厂商 | 升档路径 |
> | --- | --- |
> | DeepSeek | `deepseek-chat → deepseek-reasoner` |
> | Anthropic | `haiku → sonnet → opus` |
> | OpenAI | `4o-mini → 4o → o 系列` |
>
> 话术示例：`你在 {agent} 上用 {model} 处理的任务，指令已写清楚，但一次命中率只有 {P}%、约 {R}% 在返工，已超出 {model} 的舒适区。建议去「设置 → 模型」把同厂商的 {推荐} 加进来，同样能少返工一大半。`

四个 builder 的差异，本质是**洞察颗粒度与口吻**不同（决定各页用哪个）：

| builder                | 定位                              | 口吻           | 适用           |
| ---------------------- | ------------------------------- | ------------ | ------------ |
| `buildInsights`        | **整体诊断**：全局数据说明了什么问题            | 中性「我帮你算了笔账」  | inline 兜底    |
| `buildGlobalBroadcast` | **全景汇报**：拟人管家「欢迎回来」值守           | 拟人、开场问候      | 首页 hero      |
| `buildAgentInsights`   | **单 Agent 微观诊断**：这个 Agent 用得值不值 | 「毒打 vs 夸奖」二元 | agents focus |
| `pageInsights`         | **场景引导**：这个页面你该怎么用              | 操作建议         | 7 页 inline   |

三者合一，就是「今日洞察」的完整叙事：

- **诊断型**（`buildInsights` / `buildAgentInsights`）回答「你的数据说明了什么问题」——把 cache 命中率、token 分布、风险数翻译成「谁用得好、谁在浪费、哪里有风险」。
- **汇报型**（`buildGlobalBroadcast`）回答「我替你做了什么」——拦截了多少高危、省下多少小时、沉淀了什么资产，建立「贾维斯在替你值守」的信任。
- **引导型**（`pageInsights`）回答「你该怎么用」——蒸馏怎么选材、日报怎么协作、新 Skill 先扫描再启用，是场景化的操作提示。

> 落地锚点（研发对齐用）：`buildAgentInsights` 的分支阈值 `pq.score < 60`（毒打/夸奖）、`cache >= 55`（可复制/重复读）、`danger+warn===0`（安全）；`buildInsights` 用 `risky===0` 切安全话术。完整逐字模板见 `JarvisInsight.tsx` 与 `page-insights.ts`。

### 3.3 逐页展示逻辑（未接入 → 已接入）

「未接入 AI」的判定：没有任何「已安装且有会话数据」的 Agent —— `live = agents.filter(a => a.live && a.tokens > 0)`，`live.length === 0` 即未接入，`> 0` 即已接入。以下按页面列出两种状态下的展示文案。

#### 首页 `/`（`buildGlobalBroadcast`，variant=hero）

**未接入（`live.length === 0`）**：整页退化为「空态引导」，不是只有一句播报，而是**各区块统一归零 + 单一引导动作**。逐区块如下：

| 区块                     | 未接入表现                                                          | 依据                                                           |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| 今日洞察（hero）             | 只播报 1 句引导，不轮播 4 句                                              | `buildGlobalBroadcast` 空态分支：`live.length===0` 直接 `return` 单句 |
| TrustHero · 覆盖         | 仍显示 `installedAgents.length`（已装数量），但副标题「`0` 个活跃」               | `installedAgents` 与 `liveAgents` 分离：装了 ≠ 有会话数据               |
| TrustHero · 安全态势       | `0/0`（未扫描）                                                     | 无会话数据 → 无扫描对象                                                |
| TrustHero · 资产         | 仍显示硬编码 `38`（Skill 12 · 记忆 26）                                  | 资产独立于会话采集，未接入不影响存量                                           |
| TrustHero · 今日消耗       | `0 tokens · ¥0 · 缓存 0%`                                        | `totalTokens=0` → `todayTok = totalTokens×0.05 = 0`          |
| 8 张 KPI 卡              | 消费 4 项归零（Token 0 / 费用 ¥0 / 会话 0 / 缓存 0%）；Agent 活跃 `0 个`、休眠=已装数 | `totals` 由 `views` 求和，`views` 空 → 全 0                        |
| ToolSwitcher           | 空，无 Agent 可切                                                   | `views.slice(0,10)` 为空数组                                     |
| 图表区（趋势 / 模型 / 项目 / 热力） | 无数据，渲染为空                                                       | 全部以 `views` 为数据源                                             |

> 引导句原文：**「欢迎回来。我还没有采集到任何会话数据，先去「Agent 编排」接入一个本地Agent，我就能开始为你值守了。」** —— 全页唯一可执行的行动 = 引导去 `/sources` 接入。

> 落地注意：① 当前 mock 下**未接入永不触发**（`agentViews` 的 live Agent tokens 恒 > 0），这是**真实实现才出现的空态**，研发接真实数据时需专门测 `tokens=0` 分支；② KPI 卡「蒸馏产出 / 日报生成」用 `Math.max(1, …)` 兜底为 1、资产卡硬编码 38，都是原型占位，真实实现下应随「无数据」归零或读真实存量。

**已接入（`live.length > 0`）**：4 句轮播（每句「事实 → 评价 → 行动」）：

1. **值守汇报**：`欢迎回来。{range}有 N 个 Agent 正在为你工作，我共拦截了 B 次高危访问，帮你省下约 H 小时。建议稍后去「蒸馏工作台」把 {distillCand} 今天的精彩对话沉淀一下。`
2. **资产盘点**：`资产盘点：累计 X tokens、N 次调用，折合 $C。其中 {top} 一个人就吃掉了 Y%，是你当之无愧的主力。`
3. **安全（条件）**：`risky===0` →「安全方面你可以放心：我对 S 个 Skill 做了全量体检，暂未发现风险项，运行时防御仍在持续监控。」；否则 →「安全提醒：N 个Agent的 Skill 扫描出可疑项，另有 B 次运行时拦截记录，建议去「安全与防御」确认一下。」
4. **效率**：`效率方面，{worst} 的缓存命中率只有 Z%，大量上下文在被反复重读。把提示词写得更具体，这部分开销至少能降三成。`

> 模型适配延伸（待实现）：首页第 4 句「效率」可再分支——当 worst 的缓存问题不突出、但「清晰度高 + 一次命中率低」时，追加模型升档引导（见 §3.2），与缓存话术二选一。

#### agents `/agents`（`buildGlobalBroadcast` + `buildAgentInsights`）

| 状态        | 判定                                 | 展示文案                          |
| --------- | ---------------------------------- | ----------------------------- |
| 未选中 + 未接入 | `focus===null` 且 `live.length===0` | 同首页「未接入」1 句                   |
| 未选中 + 已接入 | `focus===null` 且 `live.length>0`   | 同首页「已接入」4 句                   |
| 选中单 Agent | `focus!==null`                     | 5 句微观诊断 + 1 句模型适配（条件触发；选中即有数据，无空状态） |

> **模型适配话术（agents focus · 第 6 句 · 条件触发）**：在「提示词质量」夸奖分支之后追加——当 `pq.score` 已达标、但「一次命中率」仍偏低（模型返工）时播报：`你在 {agent} 上用 {model} 处理的任务指令已写清楚，但一次命中率只有 {P}%、约 {R}% 在返工，已超出 {model} 舒适区。建议去「设置 → 模型」把同厂商的 {推荐} 加进来。`（同厂商升档表见 §3.2）

#### 其余 inline 页面（`pageInsights`，7 页）

没有独立整段空状态文案，空状态 = 「数字归零」或「三元切换话术」：

| 页面              | 空状态（无数据）                                     | 有数据                                      |
| --------------- | -------------------------------------------- | ---------------------------------------- |
| sources         | 「已接入 **0** 个本地Agent，采集正常…」                   | 「已接入 **N** 个本地Agent，采集正常…」               |
| skills / market | 「本地共 **0** 个 Skill，其中 **0** 个已启用…」           | 「本地共 **N** 个 Skill，其中 **M** 个已启用…」       |
| reports         | 首句「**今天暂无主力Agent**…」；尾句「本期**没有**安全告警…」       | 首句「**X 是今天的主力**…」；尾句「本期**有 N 项**安全待查…」   |
| tracker         | 首句「**暂时没有明显的浪费项**，消耗结构挺健康。」；尾句被 filter 掉     | 首句「**烧钱冠军是「X」**，…低产出高消耗。」；尾句「…缓存命中率 Z%…」 |
| distill         | 首句「今天有 **0** 段会话可以蒸馏，其中 **本地Agent** 的记录最完整…」 | 首句「今天有 **C** 段会话可以蒸馏，其中 **X** 的记录最完整…」   |
| chats           | 首句「共有 **0** 段会话记录…」；尾句「**会话来源较分散**…」         | 首句「共有 **C** 段会话记录…」；尾句「**X 的会话最多**…」     |

> tracker 的 `byModel[0]` 句目前只有「换小模型省钱」单向话术；模型适配维度落地后补反向「换强模型提质」（同厂商升一档，见 §3.2）。

#### memory `/memory`（页面内联，3 句固定）

3 句固定模板，仅第 1 句数字随数据变：

1. `记忆库里有 N 条记忆：画像 P 条、任务记忆 T 条。`
2. `画像帮我记住你是谁、喜欢怎样；任务记忆帮我记住我们定过什么规矩。`（固定）
3. `在蒸馏工作台选「画像」或「任务记忆」，产物会自动沉淀到这里。`（固定）

空状态 = N / P / T 全为 0，无独立文案。

#### 无洞察的 4 页

`/security`、`/settings`、`/widget`、`/chats/:id` 不挂 `JarvisInsight`，无「今日洞察」，自然也不存在两种状态。

### 3.4 逐页洞察配置（14 页对照）

| 页面           | 洞察配置                               | 洞察来源                                                           | 数据源                                                              |
| ------------ | ---------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/`（首页）      | `variant="hero"`，无 `lines`/`focus` | `buildGlobalBroadcast`                                         | `agentViews` + `usageMetrics` + `runtimeBlocks`                  |
| `/agents`    | `variant="hero"` + `focus`         | `buildAgentInsights`（有 focus）/ `buildGlobalBroadcast`（无 focus） | `usageMetrics` + `promptQualityOf` + `skillBurnOf` + `scanLogOf` |
| `/sources`   | `variant="hero"` + `lines`         | `pageInsights("sources")`                                      | `liveAgents`                                                     |
| `/skills`    | `lines`（inline）                    | `pageInsights("skills")`                                       | `skills` + `marketSkills`                                        |
| `/market`    | `lines`（inline）                    | `pageInsights("skills")`（**复用 skills 案例，无独立 market 案例**）       | `skills` + `marketSkills`                                        |
| `/reports`   | `variant="hero"` + `lines`         | `pageInsights("reports")`                                      | `agentViews` + `usageMetrics`                                    |
| `/tracker`   | `variant="hero"` + `lines`         | `pageInsights("tracker")`                                      | `roastList[0]` + `byModel[0]` + `byProject[0]` + `usageMetrics`  |
| `/distill`   | `variant="hero"` + `lines`         | `pageInsights("distill")`                                      | `agentViews`（distillable）+ `chatList`                            |
| `/chats`     | `variant="hero"` + `lines`         | `pageInsights("chats")`                                        | `chatList` + `agentViews`                                        |
| `/memory`    | `variant="hero"` + 内联 `lines` 数组   | **页面内硬编码**（不走 pageInsights / builder）                          | `items.length` + `counts.profile` / `counts.task`（真实持久化数据）       |
| `/security`  | 无                                  | —（**未挂 JarvisInsight**）                                        | —                                                                |
| `/settings`  | 无                                  | —                                                              | —                                                                |
| `/widget`    | 无（走 `widget-metrics` 独立数据）         | —                                                              | —                                                                |
| `/chats/:id` | 无                                  | —                                                              | —                                                                |

> 两个注意点：
> ① `pageInsights("security")` 的 case **从未被任何页面调用**（security 页没挂 JarvisInsight），是死代码；
> ② `/memory` 的洞察是**页面内联硬编码**，插值来自记忆库条目统计（真实持久化数据），是唯一「洞察数字已真实」的页面。

### 3.5 微观分析函数（agent-report.ts，全部 mock，需接真实）

| 函数                       | 返回类型                                                  | 当前取值                                   | 真实来源                                         |
| ------------------------ | ----------------------------------------------------- | -------------------------------------- | -------------------------------------------- |
| `skillBurnOf(agent)`     | `SkillBurn[]`（name / tokens / calls / waste / advice） | `rnd` 权重 × `agent.tokens×0.62`         | 该 Agent 各 Skill 真实 token 消耗排序，waste = 无效调用占比 |
| `promptQualityOf(agent)` | `PromptQuality`（score / items / summary）              | `rnd(clar/one)` + `usageMetrics.cache` | 指令清晰度 / 上下文复用 / 一次命中率，需从会话信号（返工轮次、澄清次数）推导    |
| `scanLogOf(agent)`       | `{runs, scanned, danger, warn, logs}`                 | `scanSkill` + `rnd(runs)`              | 真实扫描日志（次数 / 命中 / 拦截动作）                       |

**替换动作：**

- `agent-report.ts`：`skillBurnOf / promptQualityOf / scanLogOf`（`rnd` 权重 / 评分 / 日志）→ 真实 Skill 消耗排序 / 会话信号推导质量 / 真实扫描日志

### 3.6 运行时拦截（RuntimeBlocks.tsx）

- `runtimeBlocks`：**5 条硬编码**拦截记录（时间 / Agent / 原因 / 目标），非真实拦截。
- 对应 FR-030「运行时拦截面板」，PRD 已标注 **mock 占位、无真实会话执行前检查**。
- 真实实现需一个「会话执行前检查」hook，把拦截事件写入 `runtimeBlocks`。

**替换动作：**

- `RuntimeBlocks.tsx`：`runtimeBlocks`（5 条硬编码）→ 会话执行前检查 hook 写入真实拦截事件

### 3.7 pageInsights 各页文案依赖

| 页面       | 依赖的 mock 数据                                                     |
| -------- | --------------------------------------------------------------- |
| distill  | `agentViews`（distillable）+ `chatList.length`                    |
| reports  | `agentViews`（top / sessions / risky）+ `usageMetrics`            |
| security | `securityPulse` + `securityDimensions` + `risky`（**死代码，未被调用**）  |
| tracker  | `roastList[0]` + `byModel[0]` + `byProject[0]` + `usageMetrics` |
| skills   | `skills` + `marketSkills`                                       |
| sources  | `liveAgents`                                                    |
| chats    | `chatList` + `agentViews`                                       |
| 默认（兜底）   | `agentViews`（top / tokens / cost / risky）                       |

> 所有洞察文案都是「口语化结论」模板，**数字全部来自已列的 mock 数据**。真实实现只需替换底层 `agentViews / usageMetrics / skills / roastList` 等为真实聚合，洞察文案逻辑（模板 + 插值）无需改动。

**替换动作：**

- `page-insights.ts`：`pageInsights(page)` 各页文案模板的插值数字 → 替换底层 `agentViews / usageMetrics / skills / roastList` 为真实聚合（文案模板不动）

---

## 4. 落地优先级建议

1. **P0 — 采集引擎**：实现 Claude Code + Codex 的 jsonl 解析（复用 `context-engine.ts` 全部算法），产出 `Usage` → 喂给 `/tracker`、`/agents` 体检档案、首页 KPI / 趋势 / 模型占比。
2. **P1 — 目录探测**：用 `sources.catalog`（已就绪）替换 `dataSources` 的 mock status / 计数，点亮 `/sources` 与工牌墙的「已安装 / 有数据」。
3. **P2 — 技能与安全**：解析 `~/.claude/skills/*/SKILL.md`，接 `skill-report.DIM_RULES` 真实扫描，替换 `/skills`、`/security`、`/market` 置灰逻辑。
4. **P3 — 会话与记忆**：解析会话文件替换 `chatList` / `chatMeta`；记忆库已真实持久化，仅补来源统计。
5. **P4 — 小组件 / 日报 / 蒸馏**：复用 P0 聚合结果，替换 `widget-metrics` / `reports.draftOf` / 蒸馏产物生成。

> 定价（LiteLLM）、远端市场、macOS 原生客户端（Swift / WidgetKit）为独立依赖，不在本地采集范围内。

---

## 附录 A　真实数据源速查（来源 → 获取方式 → 数据类型）

> 目录清单来自 `src/lib/sources.ts` 的 `catalog`（这部分是真实的）。每个 Agent 的 `status / filesRead / filesTotal / events` 是 mock，真实应由目录探测 + 文件计数得到。

### A.1 深度采集（可解析完整会话，支撑 Token 追踪 / 蒸馏）

| Agent          | 数据目录                                                                                     | 文件格式          | 关键字段（会话级）                                                                                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code    | `~/.claude/projects/**/*.jsonl`                                                          | 每行一条 JSONL 事件 | `message.usage`（`input_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens` / `output_tokens` / `reasoning_output_tokens`）、`message.content[]`（thinking / text / tool_use）、`sessionId`、`cwd` |
| Codex          | `~/.codex/sessions/**/rollout-*.jsonl`                                                   | 同上 JSONL      | `input_tokens` / `cached_input_tokens` / `cache_creation_input_tokens` / `output_tokens` / `reasoning_output_tokens`、`token_count` 增量、`text_response` 锚点                                                    |
| Gemini CLI     | `~/.gemini/tmp`、`~/.gemini`                                                              | 会话日志          | 消息轮次、token 计数                                                                                                                                                                                               |
| OpenCode       | `~/.local/share/opencode/storage/message`、`~/.opencode`                                  | 消息存储          | 消息轮次                                                                                                                                                                                                        |
| Aider          | `~/.aider`、`~/.aider.chat.history.md`                                                    | Markdown 历史   | 轮次、模型                                                                                                                                                                                                       |
| Cline          | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks`     | 任务 JSON       | 消息、token                                                                                                                                                                                                    |
| Roo Code       | `~/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks` | 任务 JSON       | 消息、token                                                                                                                                                                                                    |
| Continue       | `~/.continue/sessions`                                                                   | 会话 JSON       | 消息                                                                                                                                                                                                          |
| Kimi Code      | `~/.kimi/sessions`、`~/.kimi/logs`                                                        | 会话 JSON       | 消息                                                                                                                                                                                                          |
| Qwen Code      | `~/.qwen/sessions`                                                                       | 会话 JSON       | 消息                                                                                                                                                                                                          |
| Amp            | `~/.amp/threads`                                                                         | 线程 JSON       | 消息                                                                                                                                                                                                          |
| Goose          | `~/.config/goose/sessions`                                                               | 会话 JSON       | 消息                                                                                                                                                                                                          |
| CodeBuddy      | `~/.codebuddy/sessions`                                                                  | 会话 JSON       | 消息                                                                                                                                                                                                          |
| Grok CLI       | `~/.grok/sessions`、`~/.grok/logs`                                                        | 会话 JSON       | 消息                                                                                                                                                                                                          |
| DeepSeek Coder | `~/.deepseek/sessions`                                                                   | 会话 JSON       | 消息                                                                                                                                                                                                          |

### A.2 仅探测（IDE / 桌面端，无标准化会话日志，只判「安装 / 未安装」）

| Agent            | 探测目录                                                                           | 类型  |
| ---------------- | ------------------------------------------------------------------------------ | --- |
| Cursor           | `~/Library/Application Support/Cursor/User/globalStorage`、`~/.cursor`          | IDE |
| Cursor Nightly   | `~/Library/Application Support/Cursor Nightly/User/globalStorage`              | IDE |
| Windsurf         | `~/.codeium/windsurf`、`~/Library/Application Support/Windsurf`                 | IDE |
| Zed              | `~/.config/zed/conversations`、`~/Library/Application Support/Zed`              | IDE |
| Trae             | `~/Library/Application Support/Trae/User/globalStorage`                        | IDE |
| Void             | `~/Library/Application Support/Void/User/globalStorage`                        | IDE |
| Antigravity      | `~/Library/Application Support/Antigravity/User/globalStorage`                 | IDE |
| Copilot          | `~/.config/github-copilot`、`~/Library/Application Support/github-copilot`      | 插件  |
| Augment          | `~/Library/Application Support/Code/User/globalStorage/augment.vscode-augment` | 插件  |
| Sourcegraph Cody | `~/Library/Application Support/Code/User/globalStorage/sourcegraph.cody-ai`    | 插件  |
| JetBrains AI     | `~/Library/Application Support/JetBrains`                                      | 插件  |
| MarsCode         | `~/.marscode`                                                                  | 插件  |
| Tabnine          | `~/.tabnine`                                                                   | 插件  |
| Supermaven       | `~/.supermaven`                                                                | 插件  |
| Codeium          | `~/.codeium`                                                                   | 插件  |
| Devin            | `~/.devin`                                                                     | 桌面端 |
| Warp             | `~/Library/Application Support/dev.warp.Warp-Stable`                           | 桌面端 |

### A.3 技能（Skill）

| 来源             | 路径                                                                            | 格式                                                                    |
| -------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Claude Code 技能 | `~/.claude/skills/*/SKILL.md`                                                 | Markdown + YAML frontmatter（`name` / `description` / `allowed-tools`） |
| 项目级约定          | `<project>/CLAUDE.md`、`<project>/AGENTS.md`、`.cursor/rules/*.mdc`、`GEMINI.md` | Markdown                                                              |
| 全局身份           | `~/.claude/CLAUDE.md`                                                         | Markdown                                                              |

### A.4 配置与历史

| 来源             | 路径                     | 用途             |
| -------------- | ---------------------- | -------------- |
| Claude Code 配置 | `~/.claude.json`       | 项目历史、会话索引、模型配置 |
| Claude Code 历史 | `~/.claude/history`    | 命令历史           |
| MCP 配置         | 各客户端 `.mcp.json` / 配置项 | MCP 服务清单与安全扫描  |
