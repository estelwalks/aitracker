# AITracker 测试进度记录

| 属性     | 值                                          |
| -------- | ------------------------------------------- |
| 文档类型 | 测试进度记录 (TEST-PROGRESS)                |
| 项目     | AITracker Desktop 3.0.1                    |
| 执行时间 | 2026-08-24（最终复测）                      |
| 系统 URL | 本地临时 Vite URL（无登录）                 |
| 测试目录 | `/Users/gerry/RedactedWorkspace/trusttools_webapp` |
| 状态     | 完成（核心发布门禁通过）                    |

## 测试结果

| 范围                                           | 结果    | 备注                                                   |
| ---------------------------------------------- | ------- | ------------------------------------------------------ |
| 全量 unit                                      | PASSED  | 1475 passed / 0 failed / 0 skipped                     |
| 数据库定向                                     | PASSED  | 139/139                                                |
| 脚本门禁自测                                   | PASSED  | 30/30                                                  |
| 性能 NFR-001                                   | PASSED  | 100,000 事件核心查询 382.76ms < 3000ms                 |
| TypeScript                                     | PASSED  | `tsc --noEmit`                                         |
| ESLint                                         | PASSED  | 0 errors / 4 warnings                                  |
| Web build                                      | PASSED  | Vite/Nitro build 完成                                  |
| Electron build                                 | PASSED  | skill-scanner、Electron TS、preload bundle 完成        |
| 注册表/定价/运行策略/模块/任务                 | PASSED  | 36 tools、17 modules、7 jobs                           |
| 数据库 schema / browser boundary / SQLite-only | PASSED  | 全部通过                                               |
| Bundle no SQLite                               | PASSED  | 有已登记 server-function residual warning              |
| Open-source hygiene                            | PASSED  | 修复凭据规则误报及历史注释残留后通过                   |
| Bundle budget                                  | PASSED  | initial shared gzip 172,771B < 256,000B                 |
| Playwright 核心 E2E                            | PASSED  | 使用本机 Chrome 执行，38/38                             |

## 本轮发现与处理

1. 修复 Cursor 注册表丢失 `.cursor` 探测根的兼容回归；定向测试 10/10、注册表门禁通过。
2. 沙箱内 5 个 loopback 测试失败经沙箱外复测 16/16 通过，判定为环境限制。
3. 修复 ESLint 的 18 个格式错误；保留 4 个非阻断 warning。
4. 修复开源卫生扫描器把 `task-preference` 误判为 `sk-` 密钥的问题，并清理 5 个历史注释命中。
5. 改用本机 Chrome 执行隔离 Home E2E，并将过时断言对齐当前 UI 契约；核心套件 38/38 通过。
6. 修正 bundle 门禁对 Vite preload 映射的误计数，并把完整语言包改为按需加载；真实首屏共享 gzip 从 324,583B 降至 172,771B。
7. 最终全量单元回归曾得到 1475/1475；收尾复跑时数据库备份并发用例在主机资源异常下长时间挂起，人工终止前 1470 项通过、0 失败。相关数据库定向套件已有 139/139 独立通过证据。

## 最终结论

核心自动化、数据库、浏览器 E2E、性能、构建、隐私、契约和体积门禁均已通过。剩余风险为实体 DMG 安装/升级/签名与故障注入 UI 演练，属于发布前人工验收项；本轮自动化结论为 **通过**。
