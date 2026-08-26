# AITracker V3.0 Client

AITracker V3.0 本地客户端。同一套 React + TypeScript UI 支持浏览器调试和 Electron 桌面运行。

## 产品手册

面向最终用户的操作说明请参阅：[AITracker 用户手册](docs/user-guide.md)。

AITracker 是面向 AI 开发者的本地优先工作台：它读取本机 AI 工具的用量与会话数据，在一个桌面应用中提供 Agent 概览、Skill 管理、安全检测、记忆沉淀、蒸馏和日报/周报能力。

### 核心功能

- **首页总览**：查看 Token 消耗、费用估算、会话、缓存命中率、Agent 覆盖和安全状态。
- **Agent 概览**：按 Codex、Claude Code、Cursor、Gemini CLI 等工具查看本地用量与会话活动。
- **Skill 管理与安全市场**：浏览本地 Skill、查看覆盖情况和安全状态。
- **蒸馏工作台**：从选中的会话中生成 memory、persona、Skill、workflow/brief 和 prompt 等结构化产物。
- **记忆库**：查看已沉淀的知识资产，并管理其来源和状态。
- **今日洞察**：基于本地规则展示跨模块数据洞察；配置模型后可获得 AI 增强分析。
- **日报/周报**：按日或周生成报告，支持预览、编辑和历史归档。
- **桌面组件与顶部动态栏**：在 Electron 客户端中查看实时概览、扫描进度和安全状态；可在设置中开关。

### 首次使用

1. 启动 AITracker，等待本地数据首次扫描完成。
2. 打开“设置 → 模型配置”，添加一个兼容的 AI 模型。
3. 填写 API Endpoint、模型名称和 API Key，保存并测试连接。
4. 返回首页或蒸馏、日报页面开始使用。

未配置模型时，应用仍可展示本地采集数据和规则洞察；蒸馏、AI 增强和部分报告能力会显示配置引导，不会伪造模型结果。

### AI 模型配置

模型配置保存在本机。支持官方模型配置和自定义 OpenAI/Anthropic 兼容接口，具体字段以“设置 → 模型配置”页面为准。

建议：

- 不要把 API Key 提交到 Git、截图或公开日志。
- 优先使用远端授权 Key 或短期 Key，并设置供应商侧额度和权限限制。
- 配置完成后使用“测试连接”确认 Endpoint、模型名称和权限均可用。
- 删除模型后，AI 能力会回退到本地规则或离线草稿，并显示明确状态。

### 蒸馏工作台

蒸馏流程为“选择素材 → 选择产物 → 开始蒸馏”。

- 支持按会话、项目、时间范围筛选素材。
- 支持 quick/pro 两种模式；pro 模式可选择会话片段并补充提示词。
- 产物类型包括 memory、persona、Skill、workflow/brief 和 prompt。
- 任务在服务端后台执行，页面最小化或切换后仍会继续运行。
- 进度条显示阶段进度，最高保持在 92%；服务端完成并同步后才显示 100%。
- 蒸馏历史支持单条勾选删除和批量删除。
- 未配置模型时，点击蒸馏会明确提示并引导进入模型配置，不会静默失效。

### 今日洞察

今日洞察默认使用本地规则和真实采集数据生成，显示在首页及各个业务页面的洞察卡中。

配置 AI 模型并允许增强后，洞察卡可显示更深入的关联归因和处置建议。AI 增强不可用时会保留规则洞察，并显示“立即接入”入口。

### 日报与周报

- 支持日报、周报周期切换和历史归档。
- 支持生成后预览、编辑和保存。
- 没有模型时可生成本地规则草稿，页面会提示当前为离线/本地结果。
- 配置模型后，报告可使用模型进行增强生成。

### 安全检测

安全检测用于检查本地 Skill 文件、风险项和扫描历史。规则扫描始终可以本地执行；需要 AI 深度分析时，应用会使用已配置的模型 Endpoint。

扫描过程中可通过桌面动态栏查看阶段和结果。扫描内容、失败原因和历史记录均在本机管理，具体扫描范围以安全检测页面显示为准。

### 桌面端使用

Electron 客户端提供系统托盘、单实例、窗口隐藏/恢复、开机启动和顶部动态栏能力：

- 关闭主窗口时可隐藏到托盘，不等于退出进程。
- 从托盘菜单可以打开 AITracker、显示小组件、在浏览器打开或退出应用。
- 顶部动态栏默认显示实时用量、安全状态和任务进度；可在“设置 → 通用”开关。
- 点击动态栏可展开对应的概览卡片；再次点击或关闭按钮可隐藏。

### 数据与隐私

AITracker 是本地优先应用：

- 本地会话日志和用量数据默认只在当前设备读取和保存。
- 用量采集主要提取 Token、模型、时间、来源和项目等结构化信息，不返回 prompt 或回复正文。
- 选中的会话片段只在当前蒸馏请求中使用，不作为原始会话长期保存。
- API Key 通过桌面端服务端边界和本机密钥存储处理，不应写入前端代码或仓库。
- 使用远端模型时，发送范围取决于当前功能和用户选择；使用前请确认模型供应商的隐私政策。

### 常见问题

**为什么蒸馏按钮点击没有结果？**

先检查“设置 → 模型配置”是否存在可用模型、API Key 和正确 Endpoint。没有模型时按钮会显示配置引导。

**为什么 AI 洞察显示规则结果？**

这表示没有可用模型、额度不足、连接失败或增强结果未通过质量检查。规则洞察仍然有效，点击“立即接入”可进入模型配置。

**切换页面后蒸馏进度会丢失吗？**

不会。任务在后台继续执行，重新进入蒸馏页面会恢复进度。

**如何开发和打包？**

```bash
npm install
npm run dev              # 浏览器开发模式
npm run dev:desktop     # Electron 开发模式
npm run build:desktop   # Web + Electron 构建
npm run dist:mac        # macOS 打包
npm run dist:win        # Windows 打包
```

## 本地运行

```bash
npm install
npm run dev
```

默认访问：

```text
http://127.0.0.1:8080
```

端口由现有 Vite 配置决定。

> **国内网络：** 项目已在 `package.json` 的 `config` 字段中配置 `electron_mirror` 使用 npmmirror.com 镜像（跨平台，Windows/macOS/Linux 均生效），首次 `npm install` 后自动通过 `postinstall` 脚本下载 Electron 二进制文件。

## Electron 桌面运行

```bash
npm run dev:desktop
```

桌面开发模式会先编译 `electron/**`，再启动 Vite 和 Electron。默认开发地址为
`http://127.0.0.1:5173`，可通过环境变量覆盖，避免依赖固定端口：

```bash
TRUSTTOOLS_DEV_HOST=127.0.0.1 TRUSTTOOLS_DEV_PORT=4173 npm run dev:desktop
```

桌面壳启用单实例、系统托盘、窗口隐藏恢复和开机自启动 IPC。Renderer 使用
`contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`，只通过
`window.desktopBridge` 访问最小类型化 Preload API。

## 生产构建

```bash
npm run build:desktop    # 构建 Web 产物 + 编译 Electron TypeScript
npm run dist:mac         # macOS DMG（x64 + arm64，执行 scripts/package-mac.mjs）
npm run dist:win         # Windows NSIS 安装包（x64）
npm run dist             # 按当前平台执行 electron-builder 默认目标
```

分架构打包：

```bash
npm run dist:mac:x64     # macOS x64 DMG
npm run dist:mac:arm64   # macOS arm64 DMG
npm run dist:win:x64     # Windows x64 NSIS
```

现有 Web 构建输出为 Cloudflare 模式的 Nitro Fetch Handler，不能直接通过
`file://` 加载。打包时 `.output` 会作为只读资源进入应用；生产 Electron 主进程在
`127.0.0.1` 的随机空闲端口启动轻量 HTTP 适配器，直接托管静态资源并调用 Nitro
Handler。服务不监听局域网地址，也不使用固定生产端口。

## 测试

```bash
npm run test:e2e       # Playwright 端到端测试
npm run test:perf      # 采集器性能测试
npm run test:database  # 数据库平台全量单测(显式文件列表,勿用 `--test <目录>`——会虚绿)
npm run test:scripts   # 门禁脚本自身的回归测试(browser/server 边界、模块边界、开源合规)
```

## 代码规范

```bash
npm run lint           # ESLint 检查
npm run format         # Prettier 格式化
```

## 验证

```bash
npx tsc --noEmit
npm run build
npm run build:electron
npm run verify:tool-registry   # 编译注册表 + 校验诊断 + 公共 manifest 漂移检查
```

## 数据库平台运维

```bash
npm run test:database                  # 数据库平台全量单测(显式文件列表;`--test <目录>` 会虚绿,勿用)
npm run verify:database-schema         # 静态校验 migrations 顺序、双源 SQL 一致性与 0001 的 11 表/STRICT/关键约束
npm run verify:browser-server-boundary # browser/server 边界 + node:sqlite 仅限 infrastructure 门禁
npm run verify:bundle-no-sqlite        # build 产物(真实浏览器 chunk)不得含 node:sqlite/DatabaseSync/DB 路径/密文
npm run inspect:database -- <db路径>   # 只读输出健康信息、表名+行数与索引数，绝不输出任何行内容

# 聚合门禁 verify:database 末尾会跑 verify:bundle-no-sqlite,该步骤读取
# `.output/public` 构建产物:请先 `npm run build` 再运行 `verify:database`,否则
# 会读到旧产物或被判定为缺少产物而失败。

```

## 工具注册表（tool-registry）

每个 AI 工具的全部静态知识（探测路径、Skill/Agent 目录、用量采集 paths/mapping、会话恢复命令、价格策略）收敛为 `src/lib/tool-registry/definitions/<id>.tool.json`（v1.5 JSON，30 个：27 个产品目录工具 + DeepSeek Harness/DSH + aipy/cline 遗留采集源）；业务模块只消费注册表的派生结果，不维护自己的工具名单。

- 注册表内核（contracts/schema/loader/validate/registry/manifest）见 `src/lib/tool-registry/`：JSON 仅在构建期由 `scripts/generate-tool-imports.mjs` 读取并嵌入 `definitions.generated.ts`，**运行时不扫描目录、不加载外部 JSON**。
- 平台模型：`macos/windows10/windows11/linux` targets + `windows` group（`_shared/platform-profiles.json`）；`resolvePlatformPlan()` 按 OS 解析探测/扫描路径；Linux 首期仅 `planned` 状态，不触发扫描。
- 共享策略包（`definitions/_shared/`）：generic-reader 默认、scanner 预算、skill-market 顺序、usage taxonomy、platform profiles；定价 rule packs 在 `src/lib/pricing/rules/`。
- 浏览器只导入生成的 `public-manifest.generated.ts`（display + 能力状态 + skillAgentOrder，无路径/Reader Key/命令/价格）；配置变更后执行 `npm run generate:*` 重新生成并提交（`verify:tool-registry` 会做漂移检查）。
- 新增工具：新建 `definitions/<id>.tool.json` → 在 `definitions/manifest.json` 登记 → `npm run generate:tool-imports` → `npm run verify:tool-registry` + 相关单测通过后提交。
- 用量快照（SQLite `usage_events` 等）携带 `toolRegistryVersion`（sha256 全量 canonical JSON），任何定义/策略变更自动失效重建；增量缓存为进程内重建索引，不落盘。

## 数据接入

Dashboard 和 Token 分析页面默认建立当前用户本机的历史用量索引，页面再按今天、周、月、年或自定义区间筛选：

- Claude Code：`~/.claude/projects/**/*.jsonl`
- Codex：`~/.codex/sessions/**/rollout-*.jsonl`
- Codex 归档：`~/.codex/archived_sessions/rollout-*.jsonl`
- Aipy：macOS `~/Library/Application Support/aipy-pro/aipy`，Windows `%APPDATA%/aipy-pro/aipy`
- WorkBuddy：`~/.workbuddy/projects/**/*.jsonl`
- DeepSeek Harness / DSH：`~/.dsh/sessions/**/session.jsonl.zstd`（zstd 帧容器，自动识别明文 `.jsonl`）
- 同时自动探测 Cursor、Gemini CLI、Kimi Code、OpenCode、Grok、GitHub Copilot、Cline、Roo Code

无需预先安装 Claude Code 或 Codex；应用会独立探测每个受支持客户端，并区分“未发现客户端”“已发现但暂无日志”和“已有可解析数据”。

采集器只提取 Token 数字、模型、时间、来源和项目路径，不读取或返回 prompt、回复正文。项目路径返回浏览器前会把用户 Home 目录归一化为 `~/`。

首次启动会先执行完整历史同步，再显示主窗口；检测到本地历史时，首页第一次打开即可看到真实数据。首次扫描后会把结构化 Token 事件写入 SQLite 快照（`usage_events` 等），并建立进程内增量索引。后续按增量游标和文件变化刷新，增量缓存为进程内重建，不落盘。

采集范围覆盖 28 个产品目录工具（含 DeepSeek Harness/DSH，读取 `~/.dsh/sessions/**/session.jsonl.zstd` 的 zstd 会话日志），并额外支持 AiPy 和 Cline 遗留采集源。复杂来源（SQLite、累计快照、OTel、zstd 帧容器和多文件会话）由内置采集运行时处理；AiPy、Claude Code、Codex、WorkBuddy 和 DSH 同时保留 AITracker 原生 reader 作为校验与降级路径。

真实采集实现位于：

```text
src/lib/local-usage/
├── scanner.server.ts
├── snapshot.server.ts
├── get-local-usage.ts
├── aggregate.ts
├── presentation.ts
└── types.ts
```

当前运行方式：

- 浏览器页面：通过 TanStack Server Function 调用本地采集器和 SQLite 投影
- Electron：Renderer 继续使用同一套 Server Function；Preload 只提供桌面能力 IPC
- Node/Electron 主进程：由本地服务器、任务运行时和数据库基础设施承载文件访问

Electron 生产客户端不能直接加载 `file://`：打包后的 Nitro 输出由主进程通过
`127.0.0.1` 随机端口的本地 HTTP 适配器托管，详见上文“生产构建”。

## 页面

- `/`：首页 Dashboard
- `/agents`：工具概览与 Skill 管理
- `/skills`：Skill 工作台
- `/market`：Skill 市场
- `/security`：安全检测
- `/memory`：记忆聚合
- `/distill`：蒸馏工作台
- `/reports`：日报/报告
- `/tracker`：Token 追踪
- `/chats`、`/chats/$id`：会话列表与详情
- `/sources`：数据源状态
- `/widget`：桌面 Widget
- `/settings`：本地设置

# AITracker

AITracker is a local-first, cross-platform dashboard for AI development assets.

## Open-source hygiene

Before opening a pull request, run `npm run check:opensource-hygiene`. The
check scans source and build configuration for machine-specific absolute paths,
AITracker remnants, credential-shaped values, and undeclared private imports.
Documentation, tests, fixtures, generated build output, and dependency folders
are excluded because they may contain deliberate examples or snapshots.
