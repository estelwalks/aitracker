# TrustTools 大模型配置与功能全量测试报告

| 属性 | 值 |
|------|-----|
| 文档类型 | 测试进度记录 (TEST-PROGRESS) |
| 项目名称 | TrustTools |
| 版本 | v1.3 |
| 创建日期 | 2026-08-21 00:47:34 |
| 更新日期 | 2026-08-21 08:47:31 |
| 生成工具 | agile-feature-dev + system-test-automation |
| 文档状态 | 草稿 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
| v1.3 | 2026-08-21 08:47:31 | 新增 Windows ACL 专用测试，验证数据库目录、数据库文件和 writer lock 的访问控制；全量单元测试达到 0 skipped |
| v1.2 | 2026-08-21 08:43:56 | 使用 Windows junction 替代需要管理员权限的符号链接测试，新增 3 个跨平台通过用例；保留 1 个 POSIX 权限位测试边界 |
| v1.1 | 2026-08-21 01:21:33 | 补全参考项目 agent 数据目录、增加 Windows/macOS 来源页投影、补充全系统 E2E 并修复离线 SSR 与 Windows Home 隔离问题 |
| v1.0 | 2026-08-21 00:47:34 | 完成模型配置、调用链、开关、Windows 兼容性和真实模型 smoke test 记录 |

---

## 1. 测试结论

大模型配置链路已验证可用。当前桌面设置中启用的配置被统一执行器正确读取，真实模型调用成功，返回 `completed`，最小请求耗时约 2.97 秒，未记录或输出 API key。

本轮修复覆盖了配置激活、端点拼接、离线降级、报告存储测试、Windows 文件权限/符号链接测试，以及 Windows/macOS/Linux 通用的脚本文件遍历。全量单元测试 1449 个用例中 1445 个通过、4 个按平台能力跳过、0 个失败。

结论边界：当前执行环境是 Windows，已完成 Windows 实测和跨平台纯函数/平台矩阵测试；没有 macOS 主机，因此未执行 macOS 原生 Electron 打包和运行时启动。代码层面使用 Node 原生路径/文件 API，平台矩阵覆盖 Windows 10/11 与 macOS。

## 2. 配置读取与真实模型验证

真实调用使用当前设置中已启用的 profile，通过 `getCompositionRoot().modelProfiles.getActiveView()` 读取，再经 `providerId: profile` 进入统一 AI executor。

| 项目 | 结果 |
|------|------|
| 配置状态 | 已读取到 active profile |
| 协议 | OpenAI-compatible |
| 模型 | `deepseek-v4-flash` |
| API key | 已使用，报告不记录内容 |
| 请求状态 | `completed` |
| 响应校验 | 非空，最小 smoke prompt 返回 `OK` |
| 耗时 | 约 2974 ms |
| 隐私 | 未输出 API key、完整响应、会话正文、路径或 token |

真实调用只执行一次最小请求，避免产生不必要的额度消耗。报告中的结果来自实际网络请求，不是 mock。

## 3. LLM 调用点与开关覆盖

| 功能 | 配置/开关 | 已验证行为 | 结果 |
|------|-----------|------------|------|
| 模型配置 | profile 保存、读取、激活、密钥安全存储 | 未激活 profile 不打开 LLM 通道；激活后统一路由到 profile | 通过 |
| 今日洞察 | `rules` / `enhanced-auto`、kill switch | 关闭时只走本地规则；开启且有 active profile 时走增强器；不可用时降级本地结果 | 通过 |
| 日报/周报 | active profile 作为模型配置入口 | 有 profile 时调用配置模型；无 profile 生成确定性离线草稿；失败保留可读结果并记录 offline | 通过 |
| 蒸馏工作台 | 显式 offline / profile、每日额度 | offline 不联网；profile 读取 active 配置并调用；额度和失败状态稳定返回 | 通过 |
| 安全检测 LLM review | enabled / disabled、active profile | 关闭时不调用；无 profile 不调用；开启且配置有效时调用；模型失败时安全结果可降级 | 通过 |
| Dashboard AI insight | profile provider、OpenAI/Anthropic endpoint | 自定义 endpoint 已包含 `/chat/completions` 或 `/messages` 时不重复拼接 | 通过 |

关键测试文件：

- `src/modules/ai-orchestration/model-profile.test.ts`
- `src/modules/ai-orchestration/infrastructure/file-secret-codec.server.test.ts`
- `src/modules/insights/page/application.server.test.ts`
- `src/modules/insights/enhancer/application.test.ts`
- `src/modules/security-assessment/application/llm-review.server.test.ts`
- `src/modules/distillation/api.server.test.ts`
- `src/modules/reports/api.server.test.ts`
- `src/modules/dashboard/ai-insight.server.test.ts`

## 4. 修复内容

1. 修复 Dashboard 独立 AI insight 对已完整 endpoint 重复追加路径的问题：OpenAI 不再重复追加 `/chat/completions`，Anthropic 不再重复追加 `/messages`。
2. 修正配置 profile 测试：保存 profile 后显式执行 `setActive`，确保测试覆盖“设置已启用”的真实语义。
3. 修正报告测试对旧 Markdown 文件目录的依赖，改为验证当前 SQLite 内联正文和离线降级策略。
4. 修正报告 adapter 测试的 provider、prompt version 和 offline 草稿断言，使其与当前统一编排契约一致。
5. 修正 Windows 文件密钥权限和符号链接能力差异，避免把 Windows 平台限制误判为产品失败。
6. 将 `scripts/check-app-config-sync.mjs` 的 Unix `find` 替换为 Node 原生递归遍历，消除 Windows 上命令不可用的问题。

## 5. 自动化测试证据

### 5.1 通过项

| 命令/范围 | 结果 |
|-----------|------|
| 全量 unit：`npm run test:unit` | 1445 passed / 4 skipped / 0 failed |
| AI orchestration + secret codec | 31/31 passed |
| Dashboard AI insight | 10/10 passed |
| Distillation API（含真实本地 HTTP profile endpoint） | 8/8 passed |
| Reports API、adapter、Markdown store | 20/20 passed |
| TypeScript：`npx tsc --noEmit` | 通过 |
| ESLint：`npm run lint` | 0 errors，4 个既有 Fast Refresh warnings |
| Electron：`npm run build:electron` | 通过，preload bundle 生成成功 |
| `npm run test:scripts` | 30/30 passed |
| Browser/server boundary | 通过 |
| SQLite-only persistence | 通过 |
| Database schema | 通过 |
| Bundle no SQLite | 通过 |
| Windows/macOS platform matrix | 通过 |

### 5.2 E2E 结果

`tests/e2e/desktop.spec.ts` 共 18 项：11 项通过、7 项失败。Settings 页面加载和设置持久化通过；失败项集中在外部市场 API 超时、实时市场数据、未准备的本地安全 companion/数据源以及旧页面期望，不是本轮 LLM 配置链路失败。由于这些依赖真实外部服务或本机数据，未将其改成伪造成功。

### 5.3 未通过或待处理的既有门禁

`npm run check:i18n` 的 44 个语言/格式测试全部通过，但最后的 `check-app-config-sync` 发现 71 项既有品牌字面量/环境变量一致性问题。该报告已修复其中的 Windows `find` 兼容性，使门禁可以在 Windows 上真实执行；剩余问题属于已有的全局 rebrand 一致性债务，不属于本轮 LLM 调用代码变更。

架构检查使用 report mode，发现 41 项既有 module deep-import/public server leak；该检查本轮没有新增 blocking 规则，也没有把这些历史架构债务归因到模型配置。

## 6. Windows/macOS 适配结论

- Windows：在当前 Windows 环境完成真实模型调用、全量 unit、Electron TypeScript 构建和 preload 打包。
- macOS：平台路径、运行时映射、Windows 10/11 parity group 和 macOS supported matrix 测试通过；本机无法替代 macOS 主机执行原生 Electron 运行和签名打包。
- 本轮修改未引入 shell-specific `find` 依赖，文件遍历使用 Node `fs` API，路径比较统一使用规范化 `/` 分隔符。
- Windows 上的 POSIX 文件 mode 和 symlink 能力差异已在测试中显式处理，不影响实际密钥读写安全策略。

## 7. 发布建议

LLM 配置相关代码和测试可以提交。正式发布前仍建议在 macOS CI/实体机执行一次 `npm run build:desktop` 和 Electron 启动 smoke test，并单独安排全局品牌一致性门禁与外部 API E2E 的清理批次。

## 8. Agent 数据来源与原型对齐（v1.1）

本轮以 `D:\Dev\token-monitor` 的本地数据来源清单和 `docs\V3.0_TrustTools\project-sparkle-hub-92-c957c2e6-main-4` 原型为对照，完成了注册表、路径投影、来源页分页和全系统浏览器回归。

### 8.1 Agent 覆盖

注册表从原有 30 个可见工具扩展到 36 个，新增：Qwen、Command Code、Proma、Qoder CN、Reasonix、Cherry Studio。原有 agent 的路径探测也同步扩展，包括 Antigravity、Cline、Cursor、GitHub Copilot、Grok、Hermes、Kiro、Kilo Code、OpenCode、Pi、ZCode、Zed 等。

| 能力 | 结果 |
|------|------|
| 可见 agent 注册表 | 36/36 |
| 原生 usage reader | 8 |
| 通用 JSONL/适配器 reader | 12 |
| 模型观测注册 | 36/36 |
| 参考项目本地 agent 清单映射 | 已覆盖 |
| Qoder CN | 已识别目录；SQLite 专用 schema reader 待后续提供真实 schema 后接入 |

### 8.2 Windows/macOS 实际目录投影

来源页现在按照当前运行平台从注册表解析真实目录，页面只展示 HOME 下的安全相对路径（例如 `~/AppData/Roaming/...`），不会把用户名、密钥或外部环境覆盖路径泄露到浏览器。

| 平台 | 已验证目录类型 |
|------|----------------|
| Windows | `%APPDATA%` / `~/AppData/Roaming`、`%LOCALAPPDATA%` / `~/AppData/Local`、`~/.config`、`~/.agent` |
| macOS | `~/Library/Application Support`、`~/Library/Logs`、`~/.config`、`~/.agent` |
| Linux | XDG 目录已保留在注册表；按项目平台策略显示为 planned，不宣称本机实测支持 |

### 8.3 Sources 页面

来源页按原型补齐搜索、状态筛选、平台目录展示、卡片稳定 test id 与每页 6 条的分页导航。未安装 agent 仍显示其已知目录，便于用户按本机实际路径确认安装状态；已安装状态仍由真实扫描结果决定。

## 9. 本轮自动化测试结果

| 测试/门禁 | 结果 |
|-----------|------|
| `npm run test:unit` | 1454 passed / 0 skipped / 0 failed |
| agent 注册表、平台路径、来源投影定向测试 | 53/53 passed |
| `npm run test:scripts` | 30/30 passed |
| `npx tsc --noEmit` | 通过 |
| `npm run verify:tool-registry` | 通过，36 个 JSON 定义与生成文件一致 |
| `npm run build` | 通过 |
| `npx playwright test -c playwright.config.empty-home.ts tests/e2e/full-system-smoke.spec.ts` | 14/14 passed |

全系统 E2E 覆盖首页、Agents、Skills、安全检测、设置、记忆、会话、日报、蒸馏、市场、Tracker、数据来源和 Widget 共 13 个路由，并额外验证来源页搜索、状态筛选、Windows 平台目录和分页交互。

## 10. 本轮发现并修复的问题

1. 市场接口离线时 `/market` SSR 直接返回 500。已增加安全的空市场降级，离线时页面仍可访问。
2. 来源页 E2E 在 hydration 前操作分页，导致测试不稳定。已等待 locale/hydration 完成，并使用实际控件文案与稳定 test id。
3. Windows 下显式传入临时 Home 的扫描仍会额外读取宿主 `USERPROFILE/HOME`。已修复为显式隔离 Home 时只扫描该目录与显式 additional roots，默认生产路径行为不变。
4. 注册表生成器和校验器原先写死 30 个工具。已改为以 manifest 数量和注册表内容校验，后续新增 agent 不再需要修改硬编码计数。

## 11. 结论与剩余边界

本轮功能代码、注册表、来源页和自动化测试均已通过验证，可提交。真实模型调用证据见本报告 v1.0 的第 2 节；本轮新增 E2E 使用隔离空 Home 和离线降级，避免把宿主机数据或外部市场服务当成测试成功条件。

剩余边界是：当前环境为 Windows，macOS 已完成路径解析与平台矩阵测试，但未在真实 macOS 主机执行原生打包；Qoder CN 已支持目录识别，SQLite 数据解析需基于真实 schema 单独实现。Windows ACL 已由专用测试覆盖，POSIX `chmod 600/700` 仍在 macOS/Linux 分支使用原有 mode 位断言。

本轮已将 3 个可移植的符号链接测试改为 Windows junction 等价实现，并新增 ACL 检查：要求 SYSTEM 与 Administrators 保有完全控制，同时拒绝 Everyone、Users、Authenticated Users 的写权限。权限测试没有删除安全断言，也没有把平台差异伪装成通过。
