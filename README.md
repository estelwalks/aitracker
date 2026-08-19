# TrustTools V3.0 Client

TrustTools V3.0 本地客户端。同一套 React + TypeScript UI 支持浏览器调试和 Electron 桌面运行。

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
`window.trustToolsDesktop` 访问最小类型化 Preload API。

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
npm run verify:database-schema        # 静态校验 migrations 顺序、双源 SQL 一致性与 0001 的 11 表/STRICT/关键约束
npm run inspect:database -- <db路径>  # 只读输出健康信息、表名+行数与索引数，绝不输出任何行内容
```

## 工具注册表（tool-registry）

每个 AI 工具的全部静态知识（探测路径、Skill/Agent 目录、用量采集 paths/mapping、会话恢复命令、价格策略）收敛为 `src/lib/tool-registry/definitions/<id>.tool.json`（v1.5 JSON，30 个：27 个产品目录工具 + DeepSeek Harness/DSH + aipy/cline 遗留采集源）；业务模块只消费注册表的派生结果，不维护自己的工具名单。

- 注册表内核（contracts/schema/loader/validate/registry/manifest）见 `src/lib/tool-registry/`：JSON 仅在构建期由 `scripts/generate-tool-imports.mjs` 读取并嵌入 `definitions.generated.ts`，**运行时不扫描目录、不加载外部 JSON**。
- 平台模型：`macos/windows10/windows11/linux` targets + `windows` group（`_shared/platform-profiles.json`）；`resolvePlatformPlan()` 按 OS 解析探测/扫描路径；Linux 首期仅 `planned` 状态，不触发扫描。
- 共享策略包（`definitions/_shared/`）：generic-reader 默认、scanner 预算、skill-market 顺序、usage taxonomy、platform profiles；定价 rule packs 在 `src/lib/pricing/rules/`。
- 浏览器只导入生成的 `public-manifest.generated.ts`（display + 能力状态 + skillAgentOrder，无路径/Reader Key/命令/价格）；配置变更后执行 `npm run generate:*` 重新生成并提交（`verify:tool-registry` 会做漂移检查）。
- 新增工具：新建 `definitions/<id>.tool.json` → 在 `definitions/manifest.json` 登记 → `npm run generate:tool-imports` → `npm run verify:tool-registry` + 相关单测通过后提交。
- 用量缓存（`local-usage-index-v10.json`）携带 `toolRegistryVersion`（sha256 全量 canonical JSON），任何定义/策略变更自动失效重建。

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

首次启动会先执行完整历史同步，再显示主窗口；检测到本地历史时，首页第一次打开即可看到真实数据。首次扫描后会在 `~/.trusttools/cache/local-usage-index-v10.json` 建立仅包含结构化 Token 事件的文件级索引。后续按增量游标和文件变化刷新，缓存使用临时文件加原子重命名写入。

采集范围覆盖 28 个产品目录工具（含 DeepSeek Harness/DSH，读取 `~/.dsh/sessions/**/session.jsonl.zstd` 的 zstd 会话日志），并额外支持 AiPy 和 Cline 遗留采集源。复杂来源（SQLite、累计快照、OTel、zstd 帧容器和多文件会话）由内置采集运行时处理；AiPy、Claude Code、Codex、WorkBuddy 和 DSH 同时保留 TrustTools 原生 reader 作为校验与降级路径。

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

统一客户端数据访问契约位于：

```text
src/lib/client-data/
├── types.ts
├── mock.ts
├── runtime.ts
└── index.ts
```

当前运行方式：

- 浏览器 Dashboard/Token：TanStack Server Function 调用本地采集器
- Electron：Preload 注入的类型化 IPC Adapter
- Node 包：Node 本地采集 Adapter

Skill、市场、安全检测和 Memory 页面目前仍使用 `src/lib/mock-data.ts` 中的演示数据，等待对应本地扫描器接入。

Electron 客户端不需要 localhost HTTP。未来的 `trusttools preview` 可以单独提供可选的浏览器预览 Host，不作为桌面客户端内部通信方式。

## 页面

- `/`：首页 Dashboard
- `/tokens`：Token 分析
- `/agents`：工具概览与 Skill 管理
- `/market`：Skill 市场
- `/security`：安全检测
- `/memory`：记忆聚合
- `/settings`：本地设置

# TrustTools

TrustTools is a local-first, cross-platform dashboard for AI development assets.

## Open-source hygiene

Before opening a pull request, run `npm run check:opensource-hygiene`. The
check scans source and build configuration for machine-specific absolute paths,
TokenTracker remnants, credential-shaped values, and undeclared private imports.
Documentation, tests, fixtures, generated build output, and dependency folders
are excluded because they may contain deliberate examples or snapshots.
