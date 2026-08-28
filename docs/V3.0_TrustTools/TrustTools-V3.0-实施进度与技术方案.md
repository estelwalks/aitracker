# TrustTools V3.0 PRD v1.2 对齐 — 实施进度与技术方案

| 属性     | 值                                              |
| -------- | ----------------------------------------------- |
| 文档类型 | 实施进度与技术方案 (IMPL-PROGRESS)              |
| 项目名称 | TrustTools V3.0                                 |
| 对齐基线 | `TrustTools-V3.0-产品需求文档.md` v1.2（33 FR） |
| 代码基线 | `feature/init` 分支                             |
| 创建日期 | 2026-08-03                                      |
| 文档状态 | 进行中                                          |

> 本文档记录按 PRD v1.2 全量对齐的实施进度、已完成模块的技术方案、以及待办模块的实现要点，供后续接续开发使用。实施遵循 `~/.claude/skills/development/agile-feature-dev/` 的敏捷流程（拆 Task → 子代理并行 → 强制验收 lint+tsc+test+commit）。

---

## 1. 总体目标与范围

将现有代码（基于较早 PRD 思路实现，导航含 Memory/Token 分析）对齐到 PRD v1.2：

- 导航重构为 7 项：首页大盘 / Skill 管理 / Skill 市场 / 安全检测 / 会话恢复 / 数据来源 / 设置
- 删除 Memory 模块；Token 分析不再是导航项，其能力合并进首页大盘
- 新增两个模块：会话恢复（FR-024~026）、数据来源独立页（FR-009）
- 补齐首页大盘、安全检测、设置等模块的细节缺口
- 横切能力：数据导出（FR-032）、版本更新检测（FR-033）、数据保留与存储上限（FR-029/NFR-023）

---

## 2. 关键技术决策

### 2.1 单一事实源：27 工具目录（A1）

- 新建 `src/lib/tools/catalog.ts`，导出 `AI_TOOLS`（27 项，PRD §1.4 顺序，含 `id`/`nameZh`/`detectRoots`/`skillRootSuffix`）、`AI_TOOL_IDS`、`SKILL_TOOL_NAMES`。
- `KNOWN_LOCAL_USAGE_SOURCES`、`SKILL_AGENTS`、`MARKET_AGENTS` 全部改为从 catalog 派生。
- 27 工具中只有 5 个有 skill 目录（Claude Code、Codex CLI、Cursor、Gemini CLI、OpenCode），故 Skill/Market agent 收敛为 5 个（PRD 的"27 工具"指 token 采集/会话扫描范围，skill 安装目标是有 skill 目录的子集）。
- 遗留适配器源（`aipy`/`cline`）保留在 `LocalUsageSource` 联合类型中，不破坏 `BUILTIN_USAGE_ADAPTERS`。

### 2.2 会话恢复仅 3 工具（D1，经用户确认）

基于已验证的本地日志样本，确认只有 **Claude Code / Codex / Grok** 三个工具有可复制的 resume 命令：

- Claude Code：`~/.claude/projects/**/*.jsonl`，`claude --resume <id>`
- Codex：`~/.codex/sessions|archived_sessions/rollout-*.jsonl` + `session_index.jsonl`，`codex resume <id>`
- Grok：`~/.grok/sessions/**/updates.jsonl` + `summary.json`，`grok --resume <id>`
- 其余 24 工具虽有会话文件但无确定 resume 语法，不进入会话列表。

### 2.3 持久化通道

设置、每日额度、检测历史、版本检测结果统一走 Electron IPC prefs（`userData/trusttools-prefs.json`，原子 temp-file rename）+ localStorage 镜像。已修复审计报告 P0-02（随机端口导致 localStorage 跨重启失效）。

### 2.4 本地日志字段语义

- token 闭集 6 元组：input / output / cached_input(缓存读) / cache_creation(缓存写) / reasoning_output(推理) / total + 会话数(sessionId 去重)
- Codex raw input 含 cached，需减去
- 上下文下钻（FR-005）两轴：Axis A 工具/模型排名（每工具，聚合桶）；Axis B 上下文构成 Messages/Tool/Reasoning/MCP/Skill（仅 Claude/Codex/Grok 有富日志，按需从 transcript 计算）

---

## 3. Epic / Task 完成矩阵

| Epic         | Task                      | FR          | 状态          | 说明                                                                      |
| ------------ | ------------------------- | ----------- | ------------- | ------------------------------------------------------------------------- |
| A 信息架构   | A1 27工具事实源           | 027         | ✅ 已提交     | catalog.ts，29→27 对齐                                                    |
| A            | A2 路由删除/新增          | —           | 🟡 骨架完成   | sources/sessions 路由已建；删 tokens/memory 待 B 完成后                   |
| A            | A3 导航 7 项              | 027         | ✅ 已提交     | AppShell/i18n/__root                                                      |
| B 首页大盘   | B1 全局区间+刷新          | 001/002     | 🟡 数据层完成 | presentation 加 all 区间；UI 待做                                         |
| B            | B2 KPI+环比               | 003         | 🟡 数据层完成 | computeMoM/previousPeriodTotal 已加；UI 待做                              |
| B            | B3 趋势+上下文+热力图     | 004/005/006 | ✅ 已提交     | 模型分布按原型对齐移出（差异见首页大盘-模块核对报告）                     |
| B            | B4 明细表推理Token/会话数 | 007         | ⬜ 待做       | aggregateUsageBySession 可复用                                            |
| B            | B5 首次引导+空状态        | 013         | ⬜ 待做       | 27 工具名 + 开始扫描                                                      |
| B            | B6 海报入口+布局          | 008/012     | ⬜ 待做       | 海报直接打开 + 导出入口                                                   |
| C 数据来源   | C1 server fn              | 009         | ✅ 已提交     | get-usage-sources.ts                                                      |
| C            | C2 页面                   | 009         | ✅ 已提交     | sources.tsx 三态                                                          |
| D 会话恢复   | D1 模块骨架               | 024/025/026 | ✅ 已提交     | local-sessions/（3工具）                                                  |
| D            | D2 页面                   | 024/025/026 | ✅ 已提交     | sessions.tsx                                                              |
| E Skill/市场 | E 列表/详情/同步/安装     | 014~023     | ✅ 已提交     | 9 skill agent；识别规则配置化 agent-rules.ts（见 Skill管理-模块核对报告） |
| F 安全检测   | F1 11维度规则库           | 018/019     | ✅ 已提交     | 23 条规则覆盖 11 维度                                                     |
| F            | F2 交互+历史持久化        | 018/019/020 | ✅ 已提交     | 剩余次数/规则库版本/100MB/历史30天                                        |
| G 设置/横切  | G1/G2 设置页+保留         | 029/NFR-023 | 🟡 G2 完成    | prune.server.ts 已写待提交；G1 设置页重构待做                             |
| G            | G3 数据导出               | 032         | ✅ 已提交     | export/ 模块（CSV/JSON）                                                  |
| G            | G4 版本检测               | 033         | ✅ 已提交     | version-check + useVersionCheck hook                                      |
| G            | G5 托盘+卸载/升级         | 030/031     | ⬜ 待做       | main.ts 首次关闭提示 + 兼容检测                                           |
| H 回归       | H 质量门禁+巡检           | —           | ⬜ 待做       | 删 tokens/memory 测试 + 全量验证                                          |

**进度：21 个 Task 中 12 个完成，3 个数据层/骨架完成，6 个待做。**

---

## 4. 已完成模块的技术方案

### 4.1 catalog.ts（A1，FR-027）

- `src/lib/tools/catalog.ts`：`AiTool { id, nameZh, detectRoots: readonly string[], skillRootSuffix: string|null }`
- 27 工具 id 映射：claude-code, codex, cursor, kiro, gemini-cli, opencode, openclaw, every-code, hermes, github-copilot, kimi-code, omp(oh-my-pi), codebuddy, workbuddy, grok(Grok Build), kilo-cli, kilocode, antigravity, pi, craft(Craft Agents), roo-code, zed(Zed Agent), goose, droid(Droid), mimo(Mimo Code), zcode(ZCode), anythingllm(AnythingLLM Desktop)
- detectRoots 为 HOME 相对路径（macOS 优先），`SKILL_TOOL_NAMES` 派生 5 个 skill agent

### 4.2 安全检测 11 维度规则库（F1，FR-018/019）

- `src/lib/security/rules.ts`：`SECURITY_RULE_KINDS` 改为 11 维度，`SECURITY_RULES_VERSION = "2026.08.1"`
- `src/lib/security/scanner.ts`：23 条静态正则规则覆盖全部 11 维度（远程命令执行/数据泄露/密钥泄露/持久化/破坏性操作/代码混淆/注入攻击/权限提升/文件访问/网络外联/提示注入），每维度 ≥1 条
- `SecurityReport` 新增 `rulesVersion: string`
- 遗留 3 类用户规则静默丢弃（不崩溃）
- 测试：scanner.test 8 + rules.test 6，每维度 ≥1 命中

### 4.3 安全检测交互（F2，FR-018/019/020）

- `src/routes/security.tsx`：
  - 显示**剩余**次数（`DAILY_SCAN_LIMIT - used`）
  - 规则库版本号 + 「更新规则库」按钮（占位，toast 提示当前版本）
  - 100MB 单文件限制（"文件过大"提示），修复额度顺序（校验通过后再扣次，失败不消费）
  - 报告头展示 rulesVersion
- `src/lib/security/history.ts`（新）：检测历史持久化近 30 天（IPC prefs + localStorage 双写，100 条上限，risks 截断 50），`load/save/clearSecurityHistory` + `trimReportForHistory`
- 历史面板：搜索 + 判定筛选 chip（全部/安全/可疑/危险）+ 点击回看 + 清除

### 4.4 会话恢复模块（D1，FR-024/025/026）

- `src/lib/local-sessions/`（types/resume-id/scanner.server/server-fns/index + test）
- `SessionRecord`：sessionId, source, title, projectKey, projectRef(cwd), model, startedAt, endedAt, durationMs(活动时间), turns, editTurns, retryTurns(=0), totals(6元组), subagentCalls, resumeSafe, resumeCommand
- 3 个 reader（claude/codex/grok），按已验证的本地日志语义实现：
  - Claude：按 sessionId 合并多文件，过滤非会话文件（journal.jsonl 等）
  - Codex：session_index.jsonl 标题，raw input 减去 cached
  - Grok：summary.json 标题（generated_title > session_summary），unix 秒/毫秒时间戳检测
- `durationMs` = 相邻记录间隔 ≤30min 之和（活动时间，非墙钟）
- resume 命令仅 shell 安全 id（`^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`）生成，恶意 id（如 `foo; rm -rf /`）→ resumeSafe=false
- 隐私：仅读元数据绝不读正文；retryTurns 因需 prompt 哈希置 0
- server-fns：`getLocalSessions`（GET 含筛选 source/projectId/range/keyword）+ `refreshLocalSessions`（POST），动态 import scanner
- 测试：13 个，覆盖三工具解析/合并/resume 安全过滤/隐私断言/活动时间

### 4.5 数据来源页（C1/C2，FR-009）

- `src/lib/local-usage/get-usage-sources.ts`：`getUsageSources`/`refreshUsageSources` server fn + 纯函数 `deriveUsageSources`
  - 从 `snapshot.sources` + catalog 派生三态（有数据=available&events>0 / 无日志=detected / 未安装）
  - HOME 归一化为 `~/`
- `src/routes/sources.tsx`：27 工具列表 + 状态点 + 汇总卡片（已接入/27、事件、未采集、异常）+ 搜索 + 状态筛选 chip（带计数）+ 重新扫描 + 未安装下载引导
- 测试：5 个（三态 + 总计 + HOME 归一化）

### 4.6 会话恢复页（D2，FR-024/025/026）

- `src/routes/sessions.tsx`：loader 调 `getLocalSessions`（启动自动扫描）
- 列表：工具 badge + 标题 + 元信息（项目/模型/时间/时长/Token/轮次/改动）+ 工作目录提示
- 「复制恢复命令」按钮（复制 `cd ${projectRef} && ${resumeCommand}`，1.6s 已复制态，resumeSafe=false 禁用+提示）
- 刷新 + 服务端筛选（搜索/项目/时间/工具）+ 汇总 + 空状态

### 4.7 数据导出（G3，FR-032）

- `src/lib/export/`（types/csv/json/download/index + test）
- `ExportRow`：日期/工具/模型/项目/输入/输出/缓存读/缓存写/推理/费用
- `toExportCsv`（RFC 4180 转义，CRLF，sourceLabels 映射）+ `toExportJson`（中文键）+ `downloadExport`（浏览器 Blob，SSR guard）
- UI 入口待首页大盘（B6）集成

### 4.8 版本更新检测（G4，FR-033）

- `src/lib/app-version.ts`：`APP_VERSION`/`APP_RELEASE_DATE`/`APP_REPO_URL` 单一常量
- `src/lib/version-check.server.ts`：`checkForUpdates` server fn，GitHub Releases 查询，5s 超时静默降级，`compareVersions` 语义比较
- `src/lib/version-check.ts`：`useVersionCheck` hook，启动静默检测，结果缓存 prefs，`hasUpdate` 红点状态 + `dismiss`（查看关于后消失）
- UI 接线（侧边红点 + 关于页）待 G1 设置页

### 4.9 数据保留与存储（G2，FR-029/NFR-023）—— 已写待提交

- `src/lib/local-usage/prune.server.ts`：
  - `directorySize(dir)` 递归统计（symlink-safe）
  - `readStorageUsage()` → `StorageUsage { directory, bytes, fileCount, softCapBytes(500MB), utilization }`
  - `pruneLegacyIndices()` 删 v1-v9 旧索引，保留 v10
  - `readRetentionDays()` 从 prefs 读（默认 90）
  - server fn `getStorageUsageFn`（GET）+ `pruneLocalDataFn`（POST）
- 测试：3 个（递归求和、缺失目录、嵌套）
- 设置页占用展示 + 保留策略 UI 待 G1

### 4.10 首页数据层（B 前置，FR-001/003）—— 已写待提交

- `src/lib/local-usage/presentation.ts`：
  - `UsagePeriod` 加 `"all"`（全部历史，1970 起算）
  - `resolveUsageRange` 处理 all
  - `computeMoM(current, prev)`：环比百分比，prev=0/非有限返回 null（UI 显"−−"）
  - `resolvePreviousRange`：等长上一区间（all/year/custom 无定义→null）
  - `previousPeriodTotal(events, metric, period)`：上一区间指标求和
- `src/routes/index.tsx`：periodOptions 加"全部"，periodLabels 补 all/week

---

## 5. 待办模块的技术方案

### 5.1 B 系列：首页大盘 UI 重构（FR-001~010/012/013/032）

**关键**：当前 `index.tsx`（1063 行）含预算预警（PRD 已移除）、安全剩余次数卡（应在安全页）等遗留逻辑，需清理并合并 tokens.tsx 能力。建议拆 `src/components/dashboard/*` 子组件。

- **B1 全局区间+刷新**：顶部全局时间区间选择器（今日/近7天/近30天/全部/自定义），period 提升为页面级驱动所有模块；刷新按钮调 `refreshLocalUsageSnapshot()` + `router.invalidate()`
- **B2 KPI+环比**：第一行 4 卡（区间总费用 / Token总量含环比 via `computeMoM` / 缓存命中节省费用含命中率 via `cacheRate` / 本地Skill总数可点击跳 /skills）；第二行 6 卡（总Token/总费用/输入/输出/缓存读/缓存写）；全部区间环比显"−−"
- **B3 趋势+上下文+模型+热力图**：合并 tokens.tsx 趋势图（堆叠/折线切换+图例+均值线+摘要）；上下文构成两轴（Axis A 工具/模型排名 + Axis B Messages/Tool/Reasoning/MCP/Skill，仅 Claude/Codex/Grok 有富数据，其余降级）；模型分布（环形/柱状切换）；热力图补周偏移+悬停浮层
- **B4 明细表**：合并 tokens.tsx 明细表，列含 名称/消耗Token/费用/占比进度条/缓存命中率/输入/输出/推理Token/会话数 + 行内 Messages/Tool/Reasoning/MCP/Skill 小条；按日/按模型切换；推理Token=`reasoningOutputTokens`，会话数=`aggregateUsageBySession` 去重，缓存命中率=`cacheRate`
- **B5 首次引导**：未检测到工具时显示欢迎引导（一句话定位 + 3 能力图标 + 27 工具名 via `AI_TOOLS` + 「开始扫描」）；有工具无日志列出状态+原因；加载失败错误+重新加载
- **B6 海报+导出+布局**：首页「导出海报」直接打开 `TokenPoster`（Top 模型 Top3）；「导出数据」按钮用 `src/lib/export/`（toExportCsv/toExportJson/downloadExport + ExportRow，source→sourceLabel）；复用 dashboardSections/ResponsiveGridLayout

### 5.2 A2 收尾：删除遗留路由

- 删 `src/routes/tokens.tsx`、`src/routes/memory.tsx`、`src/lib/local-memory/`（整目录）
- 清理 `settings/store.ts` 的 memory* 字段 + `settings.tsx` 引用
- 重新生成 `routeTree.gen.ts`（`npx vite build` 或 `npx tsr generate`），确认 TokensRoute/MemoryRoute 消失
- 移除 `-index.test.ts` 中 react-grid-layout CSS 导入导致的测试问题

### 5.3 E：Skill 管理 + 市场对齐（FR-014~023）

- `skills.tsx`：适配 5 agent（有 skill 目录的）；安装位置折叠「+N」；详情改右侧 Drawer；单条/批量卸载确认弹窗
- **跨 Agent 同步（FR-017）**：新增 `syncLocalSkill()` server fn（单条/批量），同步范围弹窗（全部/指定），冲突处理（覆盖/跳过 + 全部覆盖/跳过）+ 结果汇总
- `market.tsx`：统计卡片、排序（下载量/最新/Star/Token）、防抖搜索、分页；详情抽屉单选安装（27 工具未检测禁选）、下载进度条、失败重试、磁盘不足提示、取消清理；网络不可用降级

### 5.4 G1：设置页重构（FR-029）

- `settings.tsx` 三分类（通用/外观/关于，左侧导航+指示条）
- 通用：语言（中文禁用）、开机自启、数据存储路径、**数据保留策略**（30/60/90/180/永久，默认 90，存 `retentionDays`）、**当前占用空间**（via `getStorageUsageFn`，"X MB / 500MB"）、清除数据（二次确认）
- 外观：2 主题卡片；关于：版本（`APP_VERSION`）/发布日期/检查更新（`useVersionCheck`，展示 latest/changelog/下载链接 + dismiss 红点）/源码仓库
- 清理 `store.ts`：移除 `providerBudgets`/`alertThreshold`/`memory*`，新增 `retentionDays`

### 5.5 G5：Electron 托盘 + 卸载/升级（FR-030/031）

- `electron/main.ts`：macOS/Windows 点击关闭默认隐藏到托盘并继续运行；托盘「退出」才真正退出应用
- 托盘菜单已有「打开/开机自启/退出」；补「显示主窗口/退出 TrustTools」语义
- 升级安装：启动检测 `~/.trusttools/` 兼容性（schema version），不兼容弹窗提示备份后清除
- 更新 `contracts.ts` + `preload.cts` + `main.ts` 三处（CLAUDE.md 要求同步）

### 5.6 H：质量门禁与回归

- 删/更新 tokens/memory 相关测试断言；`-index.test.ts` 去 react-grid-layout CSS 导入
- 全量：`npm run lint`、`npx tsc --noEmit`、各 `*.test.ts`、`npm run build`
- 逐页巡检：`npm run dev`（首页/技能/市场/安全/会话/数据来源/设置）+ Playwright 冒烟

---

## 6. 提交记录

| commit    | 内容                                      | FR              |
| --------- | ----------------------------------------- | --------------- |
| `48e3267` | A1 27工具catalog + F1 安全11维度规则库    | 027/018/019     |
| `932782b` | A2/A3 导航7项 + sources/sessions 路由骨架 | 027             |
| `88d227e` | D1 会话恢复模块（Claude/Codex/Grok）      | 024/025/026     |
| `de4b64f` | G3 数据导出 CSV/JSON 模块                 | 032             |
| `ae07791` | C1/C2 数据来源页 + D2 会话恢复页          | 009/024/025/026 |
| `17c735b` | F2 安全检测交互/历史 + G4 版本检测        | 018/019/020/033 |

**工作树待提交**（已写好，待 tsc/lint 验证窗口）：

- `presentation.ts` + `index.tsx`：B 数据层（all 区间 + 环比）
- `prune.server.ts` + `prune.server.test.ts`：G2 数据保留/体积统计

---

## 7. 验证方式

```bash
npx tsc --noEmit                              # 类型检查
npm run lint                                  # ESLint + Prettier
node --import tsx --test <模块>.test.ts        # 单文件测试
npm run build                                 # Vite 生产构建
npm run dev                                   # 浏览器 127.0.0.1:8080
npm run dev:desktop:first-run                 # Electron 首启隔离环境
```

逐页巡检要点：首页大盘（区间联动/环比/明细列/海报/导出）、Skill 管理（5 agent/同步/删除确认）、市场（单选安装/离线降级）、安全检测（11 维度/剩余次数/历史持久化）、会话恢复（扫描/复制命令/筛选）、数据来源（三态/筛选/重扫）、设置（保留策略/占用/检查更新）。

---

## 8. 复用的现有能力（避免重写）

- `local-usage/scanner.server.ts` 探测逻辑（available/detected/malformedLines）→ FR-009
- `presentation.ts` 聚合（filterUsageEvents/resolveUsageRange/totalsFromDaily/cacheRate/aggregateUsageBySession/breakdownComposition + 新增 computeMoM）→ 区间/环比/明细
- `TokenPoster.tsx`、`UsageHeatmap.tsx` → 海报/热力图
- `refreshLocalUsageSnapshot()` / 30s 缓存 → 刷新与自动刷新
- IPC prefs 持久化（contracts.ts + settings/store.ts + daily-limit.ts + security/history.ts）→ 设置/额度/历史/版本
- `local-skills` 扫描/卸载/回收站、`local-market` 多目标安装与受限解包 → FR-014~023

---

## 9. 风险与约束

- **独立实现**：新模块使用 TrustTools 自有类型、目录、命名和测试（见 `docs/compliance/CLEAN_ROOM.md`）
- **B 系列 index.tsx 过大**：拆 `src/components/dashboard/*` 子组件
- **分类器间歇故障**：实施期间命令安全判定服务间歇不可用，导致 tsc/lint/commit/子代理启动受阻；已完成 6 个 commit 均在分类器可用窗口验证通过
- **会话恢复仅 3 工具**：UI 文案明确"当前支持恢复的工具"，避免用户误以为全覆盖
