# Windows 启动失败诊断与修复计划

| 属性     | 值                         |
| -------- | -------------------------- |
| 文档类型 | Bug 修复计划 (BUGFIX-PLAN) |
| 项目名称 | trusttools                 |
| 版本     | v1.6                       |
| 创建日期 | 2026-08-24 19:58:11        |
| 更新日期 | 2026-08-24 20:42:40        |
| 生成工具 | cydx-jira-bugfix           |
| 文档状态 | 草稿                       |

## 修订记录

| 版本 | 修改时间            | 修改内容                                                |
| ---- | ------------------- | ------------------------------------------------------- |
| v1.6 | 2026-08-24 20:42:40 | 任务获得重型许可后才开始执行超时，修复打包版首次初始化  |
| v1.5 | 2026-08-24 20:28:21 | 放宽 Windows 首次 Vite 依赖优化的开发启动等待时间       |
| v1.4 | 2026-08-24 20:25:22 | 修复 Node 24/Windows 无法直接启动 `npm.cmd` 的测试阻塞  |
| v1.3 | 2026-08-24 20:18:18 | 保留首次初始化屏障，定位 Windows 60 秒采集失败          |
| v1.2 | 2026-08-24 20:07:06 | 重置前检查活跃 writer，避免覆盖开发服务器正在使用的数据 |
| v1.1 | 2026-08-24 20:04:30 | 增加安全启动诊断链路、Windows 旧数据重置及回归验证      |
| v1.0 | 2026-08-24 19:58:11 | 初始版本                                                |

## 1. 修改方案

- 问题根因：桌面暖机请求按产品设计同步等待首次采集，全部重型采集共用单并发许可，但调度器在任务等待许可前就启动各自的执行超时。Windows 数据库记录确认 usage、sessions、skills 最终成功，而排在其后的 `installation.refresh` 在等待期间耗尽 60 秒并被取消，`exchange.refresh` 也提前取消，最终显示 `startup.unavailable`。
- 测试阻塞：Node 24 在 Windows 上不能把 `.cmd` 文件作为原生可执行文件直接交给 `spawn()`；首次运行实验脚本和桌面开发运行器都直接启动 `npm.cmd`，因此在进入应用前抛出 `spawn EINVAL`。
- 冷启动阻塞：Windows 首次 Vite 依赖优化超过原有 60 秒开发等待上限，运行器在优化仍进行时提前退出；这属于开发启动器限制，不是正式应用的工作区超时。
- 修改文件：
  - `electron/i18n.ts`：提供不含本机路径或原始异常的启动失败诊断提示。
  - `electron/main.ts`：把已分类的数据库错误码映射为用户可执行的恢复建议，并保留其余错误的通用安全提示。
  - `electron/release-data-reset.ts`：兼容性重置前读取 writer lock；若锁对应进程仍存活则拒绝重置，避免删除运行中服务的数据。
  - `electron/*.test.ts`：覆盖安全错误码映射、Windows 启动提示及活跃 writer 的重置保护。
  - `src/modules/tasks/application/scheduler.ts`：保留首次初始化屏障；重型任务先等待许可，获得许可后才启动自身执行超时，显式取消仍可中断许可等待。
  - `src/modules/tasks/application/scheduler.test.ts`：验证后续重型任务等待前序任务时不会提前启动或耗尽自己的执行超时。
  - `scripts/npm-spawn.mjs`：Windows 使用 `ComSpec /d /s /c npm.cmd`，POSIX 继续直接执行 `npm`。
  - `scripts/first-run-lab.mjs`、`electron/dev-runner.mjs`：统一使用跨平台 npm 启动解析器。
  - `scripts/npm-spawn.test.mjs`、`electron/dev-runner.test.mjs`：覆盖 Windows、POSIX 及 `ComSpec` 缺失的分支。
  - `electron/dev-runner.mjs`：开发冷启动、静态模块预热和优化元数据统一允许最多 5 分钟，探测请求降频并放宽到 5 秒。
- 代码自检清单：首次数据未完成时仍停留在准备页；实际采集仍受原任务超时限制；停止或取消能中断许可等待；许可和计时器均在所有终态释放。

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
  6. 让多个重型首次采集串行等待，验证后续任务在获得许可后才开始执行超时。
  7. 模拟必需首次采集在实际执行期间超时，验证仍停留在准备页并安全失败。
  8. 在 Node 24/Windows 上执行 `npm run dev:desktop:first-run`，验证实验脚本和内部开发运行器均能启动。
  9. 删除 Vite 优化缓存后重复首次运行，验证超过 60 秒的依赖优化不会被误判为失败。
- 预期结果：首次采集全部成功后进入首页；排队时间不消耗单个采集任务的执行时限，实际执行超时仍能正常取消。

## 5. 提交信息

- 分支名：`codex/fix-windows-startup-diagnostics`
- Commit message：`fix: start collector timeout after resource acquisition`
