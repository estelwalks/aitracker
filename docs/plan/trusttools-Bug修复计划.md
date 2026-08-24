# Windows 启动失败诊断与修复计划

| 属性     | 值                         |
| -------- | -------------------------- |
| 文档类型 | Bug 修复计划 (BUGFIX-PLAN) |
| 项目名称 | trusttools                 |
| 版本     | v1.4                       |
| 创建日期 | 2026-08-24 19:58:11        |
| 更新日期 | 2026-08-24 20:25:22        |
| 生成工具 | cydx-jira-bugfix           |
| 文档状态 | 草稿                       |

## 修订记录

| 版本 | 修改时间            | 修改内容                                                |
| ---- | ------------------- | ------------------------------------------------------- |
| v1.4 | 2026-08-24 20:25:22 | 修复 Node 24/Windows 无法直接启动 `npm.cmd` 的测试阻塞  |
| v1.3 | 2026-08-24 20:18:18 | 保留首次初始化屏障，定位 Windows 60 秒采集失败          |
| v1.2 | 2026-08-24 20:07:06 | 重置前检查活跃 writer，避免覆盖开发服务器正在使用的数据 |
| v1.1 | 2026-08-24 20:04:30 | 增加安全启动诊断链路、Windows 旧数据重置及回归验证      |
| v1.0 | 2026-08-24 19:58:11 | 初始版本                                                |

## 1. 修改方案

- 问题根因：桌面暖机请求按产品设计同步等待首次采集。现象中的 60 秒与 `installation.refresh` 超时一致，Windows PATH 中不可达的 UNC 路径或映射盘可能使逐文件探测耗尽超时；同时 `TaskSchedulerStartupError` 丢失失败任务身份，最终只能显示 `startup.unavailable`。需用 Windows 日志确认具体任务后实施最小修复。
- 测试阻塞：Node 24 在 Windows 上不能把 `.cmd` 文件作为原生可执行文件直接交给 `spawn()`；首次运行实验脚本和桌面开发运行器都直接启动 `npm.cmd`，因此在进入应用前抛出 `spawn EINVAL`。
- 修改文件：
  - `electron/i18n.ts`：提供不含本机路径或原始异常的启动失败诊断提示。
  - `electron/main.ts`：把已分类的数据库错误码映射为用户可执行的恢复建议，并保留其余错误的通用安全提示。
  - `electron/release-data-reset.ts`：兼容性重置前读取 writer lock；若锁对应进程仍存活则拒绝重置，避免删除运行中服务的数据。
  - `electron/*.test.ts`：覆盖安全错误码映射、Windows 启动提示及活跃 writer 的重置保护。
  - `src/lib/tools/detection.server.ts`：若日志确认安装扫描超时，为 Windows 可执行文件探测增加有界、可取消的实现，避免不可达网络 PATH 无限拖延。
  - `src/modules/tasks/application/scheduler.ts`：保留首次初始化屏障，同时让启动错误携带安全的失败任务及超时分类。
  - `src/app/startup-diagnostics.server.ts`、`electron/startup-failure.ts`：把稳定、无路径的首次采集错误码传递到弹窗。
  - `scripts/npm-spawn.mjs`：Windows 使用 `ComSpec /d /s /c npm.cmd`，POSIX 继续直接执行 `npm`。
  - `scripts/first-run-lab.mjs`、`electron/dev-runner.mjs`：统一使用跨平台 npm 启动解析器。
  - `scripts/npm-spawn.test.mjs`、`electron/dev-runner.test.mjs`：覆盖 Windows、POSIX 及 `ComSpec` 缺失的分支。
- 代码自检清单：首次数据未完成时仍停留在准备页；不泄露 PATH 或用户名；Windows 探测有明确时间上限；失败任务身份可测试、可诊断。

## 2. 同类问题排查计划

- 排查范围：Electron 启动、SQLite Host、跨进程 writer lock、后台调度器启动屏障。
- 搜索关键词：`startupFailure`、`ensureBackgroundRuntimeStarted`、`scheduler.start`、`startupPolicy`、`timeoutMs`、`writer.lock`。
- 重点检查位置：桌面暖机请求、SSR 入口、首次采集任务、主进程捕获块、SQLite 打开路径。

## 3. 构建与部署

- 前端与桌面构建命令：`npm run build:desktop`
- Windows 安装包命令：`npm run dist:win:x64`
- 不执行外部环境部署；需在 Windows 11 真机安装包上验证。

## 4. 验证计划

- 测试页面：桌面启动屏。
- 验证步骤：
  1. 对一个已占用数据库的实例启动第二个服务进程。
  2. 验证弹窗指出「本地数据已被占用」且不暴露路径。
  3. 关闭占用者后重启，验证应用正常进入主窗口。
  4. 对旧迁移线数据启动 Windows 打包版本，验证仅首次清理并完成新基线初始化。
  5. 在开发服务器持有 writer lock 时启动打包版本，验证重置被拒绝、原数据库文件仍存在，并提示关闭占用者。
  6. 模拟 Windows PATH 含不可达网络目录，验证探测在子超时内终止并返回可用的本地结果。
  7. 模拟必需首次采集超时，验证仍停留在准备页，并显示不含本机路径的具体任务诊断码。
  8. 在 Node 24/Windows 上执行 `npm run dev:desktop:first-run`，验证实验脚本和内部开发运行器均能启动。
- 预期结果：首次采集成功后才进入首页；不可达 Windows PATH 不再造成 60 秒失败；其他采集故障能显示具体诊断码。

## 5. 提交信息

- 分支名：`codex/fix-windows-startup-diagnostics`
- Commit message：`fix: bound Windows startup collection and preserve diagnostics`
