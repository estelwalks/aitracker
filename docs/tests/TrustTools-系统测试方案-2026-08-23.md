# TrustTools 系统测试方案

| 属性     | 值                                                     |
| -------- | ------------------------------------------------------ |
| 文档类型 | 系统测试方案 (SYSTEM-TEST-PLAN)                        |
| 项目     | TrustTools Desktop 3.0.1                               |
| 日期     | 2026-08-23                                             |
| 状态     | 已执行                                                 |
| 依据     | PRD、架构文档、97 条产品测试用例、217 个自动化测试文件 |

## 1. 目标与发布门禁

验证本地优先桌面应用的核心路由、用量采集、Skill 管理与安全扫描、会话恢复、模型配置、报告/蒸馏、SQLite 持久化、隐私边界和构建可发布性。发布门禁为：全量单元测试无失败、类型检查通过、Lint 无 error、生产/Web/Electron 构建通过、关键注册表/数据库/浏览器边界门禁通过、核心 E2E 通过、性能预算通过、bundle budget 通过。

## 2. 风险—测试映射

| 风险                               | 主要证据                                                                 | 发布标准                      |
| ---------------------------------- | ------------------------------------------------------------------------ | ----------------------------- |
| 本地日志解析、计费或聚合错误       | usage/pricing 单测、10 万事件性能测试、注册表门禁                        | 断言全通过；核心查询 < 3000ms |
| 恶意 Skill、路径穿越或敏感数据泄漏 | security、privacy-negative、open-source hygiene、browser/server boundary | 全通过，安全路径 fail-closed  |
| SQLite 损坏、迁移、备份恢复失败    | database 全套、schema/sqlite-only/bundle-no-sqlite                       | 全通过                        |
| 模型配置、报告、蒸馏降级失败       | profile endpoint 集成测试、离线 fallback 单测                            | 成功路径与 fallback 均通过    |
| 注册表兼容性漂移                   | frozen baseline、tool-registry verify                                    | 基线与生成文件一致            |
| 页面白屏、路由或国际化回归         | Playwright 路由 smoke、locale、settings E2E                              | 浏览器启动后全部通过          |
| 首屏体积与运行性能退化             | bundle budget、NFR-001                                                   | 两项预算均通过                |
| 桌面壳构建/IPC 回归                | Electron 单测、build:electron                                            | 全通过                        |

## 3. 执行矩阵

| 层级      | 命令                                                           | 范围                                                        |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| 单元/集成 | `npm run test:unit`                                            | `src` + `electron`，含真实 loopback、SQLite、恢复与安全边界 |
| 脚本自测  | `npm run test:scripts`                                         | 架构、持久化、开源卫生门禁本身                              |
| 数据库    | `npm run test:database`                                        | 迁移、WAL、锁、备份恢复、约束、隐私                         |
| 性能      | `npm run test:perf`                                            | 10 万事件核心查询及静态检查                                 |
| E2E       | `npm run test:e2e` 与隔离 Home 配置                            | 13+ 路由、设置、语言/货币、核心流程                         |
| 构建      | `npm run build`、`npm run build:electron`                      | Web/Nitro 与 Electron/preload                               |
| 质量门禁  | `lint`、`tsc --noEmit`、`verify:*`、`check:opensource-hygiene` | 类型、格式、注册表、数据库、bundle 与隐私                   |

## 4. 环境与数据策略

- 系统 URL：本地 Vite 临时 loopback URL；无远程登录与凭据。
- 运行时：macOS arm64，Node 26.7.0，npm 11.19.0。
- 测试脚本目录：项目根目录下 `src/`、`electron/`、`scripts/`、`tests/`。
- 隔离：单元测试使用临时目录；E2E 使用 `playwright.config.empty-home.ts` / `stale-home.ts`，不得读取真实用户数据。
- 外部网络：业务断言不以真实市场 API 成功为通过条件；验证离线降级。
- 失败最多修复/复测 3 次；环境失败与产品失败分别记录。

## 5. 本轮审计回灌的补强项

1. 将原测试文档的 6 模块扩展为当前 17 模块/13+ 路由视角。
2. 把原文档排除的单元、性能、恢复和架构门禁纳入发布证据。
3. 增加 AI profile、离线 fallback、输出安全与无模型路径。
4. 增加 SQLite 备份恢复、迁移一致性、bundle 泄漏与首屏体积门禁。
5. 明确 E2E 浏览器依赖缺失属于基础设施阻塞，不得伪报为产品失败。
