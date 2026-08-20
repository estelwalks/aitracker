# TrustTools 大模型配置与功能全量测试报告

| 属性 | 值 |
|------|-----|
| 文档类型 | 测试进度记录 (TEST-PROGRESS) |
| 项目名称 | TrustTools |
| 版本 | v1.0 |
| 创建日期 | 2026-08-21 00:47:34 |
| 更新日期 | 2026-08-21 00:47:34 |
| 生成工具 | agile-feature-dev |
| 文档状态 | 草稿 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|---------|---------|
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
