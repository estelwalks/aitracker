# AITracker 多渠道安装与发布敏捷任务清单

| 属性     | 值                                 |
| -------- | ---------------------------------- |
| 文档类型 | 敏捷任务清单 (AGILE-TASK)          |
| 项目名称 | AITracker                          |
| 版本     | v1.0                               |
| 创建日期 | 2026-09-03 14:36:53                |
| 更新日期 | 2026-09-03 16:20:00                |
| 生成工具 | agile-feature-dev、product-manager |
| 文档状态 | 草稿                               |

## 修订记录

| 版本 | 修改时间            | 修改内容                                                              |
| ---- | ------------------- | --------------------------------------------------------------------- |
| v1.1 | 2026-09-03 15:05:26 | 调整首阶段为未签名 npx 和自有 Homebrew Tap，签名及官方 Cask 后置      |
| v1.2 | 2026-09-03 16:20:00 | 按代码实现更新 Phase 1 范围、Homebrew beta token 和任务验收状态       |
| v1.0 | 2026-09-03 14:36:53 | 初始版本：拆分统一 Release、npx、Homebrew Cask、WinGet 与测试交付任务 |

---

## 1. Epic 概览

### Epic E-01：统一多渠道安装与发布

**业务价值：** 用户可以使用符合其平台习惯的命令安装 AITracker；维护者只构建和验证一份权威制品，正式稳定版再增加签名，并可追踪每个渠道的发布状态。

**目标用户：** Node.js 开发者、macOS Homebrew 用户、Windows WinGet 用户、AITracker 发布维护者。

**范围：** macOS arm64/x64、Windows x64；稳定版和 beta 频道；GitHub Releases、npm、Homebrew Cask、WinGet Community Repository。

**不在本期：** Linux、Mac App Store/Microsoft Store、Windows ARM64、企业私有源、完全无确认的系统级静默安装、独立 CDN。

**当前交付边界：** 本轮只实现未签名 beta 的 npx CLI 和自有 Homebrew Tap 的本地生成/安装入口。GitHub Actions 已准备未签名 beta 的版本门禁、三平台构建、metadata/checksum 生成和 draft Release；npm 真实发布、远程 Tap 同步、稳定版签名、官方 Cask、WinGet 以及真实平台安装冒烟均未完成。

## 2. 优先级和里程碑

| 里程碑        | 内容                                           | 优先级 | 退出条件                                                     |
| ------------- | ---------------------------------------------- | ------ | ------------------------------------------------------------ |
| M0 发布基础   | 版本合同、metadata、checksum、draft gate       | MUST   | 代码门禁和 workflow 已实现；三平台真实构建待 tag runner 验证 |
| M1 Beta 渠道  | 未签名 npx beta、自有 Homebrew Tap             | MUST   | 本地 CLI/Cask 入口已实现；真实 npm/Tap 发布和安装冒烟待完成  |
| M2 稳定渠道   | 签名稳定版、npm latest、官方 Cask、WinGet 提交 | MUST   | 首个签名稳定版发布并提交两个社区仓库                         |
| M3 自动化运营 | 渠道 PR、状态矩阵、重试和回滚演练              | SHOULD | 单渠道失败可重试且无需重建应用                               |

建议两周一个 Sprint。2 人团队预计 3 个 Sprint 完成 M0–M3；1 人团队预计 5–7 周。Homebrew/WinGet 外部审核时间不计入研发工期。

## 3. Definition of Ready

Story 开始前必须具备：

- 验收标准明确且能在目标平台执行。
- 所需签名账户、证书或“未签名实验频道”测试替代方案已明确。
- 依赖的上游 Story 已完成。
- 不覆盖用户当前工作树中的无关变更。
- 涉及外部仓库提交时，已准备维护者 GitHub 身份和最小权限凭据。

## 4. Story 与 Task

### Story S-001：建立版本与制品合同

**用户故事：** 作为发布维护者，我希望一个版本只生成一份权威 metadata，以便所有安装渠道引用相同制品。

**优先级：** MUST
**估算：** 3 点，2–3 人日

**验收标准：**

- `package.json` 版本、Git tag、制品文件名和 metadata 版本不一致时 CI 失败。
- metadata 覆盖 darwin-arm64、darwin-x64、win32-x64，含不可变 URL、SHA-256 和大小。
- 对缺失制品、重复平台、非法 host、非法 hash 有单元测试。

#### Tasks

- [x] T-0011：定义 `release-metadata.schema.json` 和 JavaScript 校验模型 — 发布工程 — 1 人日
- [x] T-0012：实现从 release 目录生成 metadata/checksum 的脚本及单元测试 — Node.js — 1 人日
- [x] T-0013：实现版本/tag/文件名一致性检查并接入 CI — 发布工程 — 0.5 人日

### Story S-002：建立不可变的 Canonical Release 与稳定版签名门禁

**用户故事：** 作为用户，我希望所有渠道下载的安装包都来自不可变且经过校验的 Release；稳定版还应经过平台签名，以便能够判断安装来源。

**优先级：** MUST
**估算：** 5 点，4–5 人日

**验收标准：**

- 实验 beta 可以不签名，但必须在 Release 和安装文档中明确标注；稳定版必须完成 macOS codesign/notarization 和 Windows Authenticode 验证。
- 所有制品先上传 draft Release；冒烟失败时 Release 不得发布。
- Release 发布后制品 URL 和内容不可覆盖。

#### Tasks

- [ ] T-0021：重构 macOS 构建为 CI 可执行的 x64/arm64 矩阵并接入签名、公证 — macOS 发布 — 1.5 人日
- [ ] T-0022：重构 Windows x64 NSIS 构建并接入 Authenticode 签名 — Windows 发布 — 1.5 人日
- [x] T-0023：新增未签名 beta draft Release 上传、metadata 汇总和门禁 — DevOps — 1 人日
- [ ] T-0024：按频道在干净 runner 验证签名（稳定版）或安全提示（beta）、安装、首次启动和卸载 — QA/DevOps — 1 人日

### Story S-101：创建独立 npx 安装器 CLI

**用户故事：** 作为已有 Node.js/npm 的用户，我希望运行一条 npx 命令即可下载并打开正确的 AITracker 安装器。

**优先级：** MUST
**估算：** 5 点，4–5 人日

**验收标准：**

- 根 Electron 包继续保持 private；公开 npm 包只有 CLI 运行所需文件。
- macOS arm64/x64 和 Windows x64 可正确选择同版本制品。
- checksum、host、大小或平台检查失败时返回非零状态且不启动安装器。
- 第一阶段未签名 beta 可以继续进入安装器，但 CLI 和 README 必须明确可能出现的 macOS Gatekeeper/Windows 安全提示。
- 支持 stable、beta、精确 npm 版本、`--dry-run` 和 `--download-only`。
- CLI 核心逻辑覆盖率不低于 90%，分支/异常路径不低于 80%。

#### Tasks

- [x] T-1011：创建 `packages/cli`、bin 入口、最小 package metadata 和打包白名单 — Node.js — 0.5 人日
- [x] T-1012：实现平台/架构选择器、metadata 校验和单元测试 — Node.js — 1 人日
- [x] T-1013：实现流式下载、超时、大小上限、SHA-256 和临时文件清理 — Node.js — 1.5 人日
- [x] T-1014：实现 macOS/Windows 安装器打开、退出码、dry-run/download-only — Node.js — 1 人日
- [ ] T-1015：执行 `npm pack --dry-run`、本地 tarball npx 和干净环境 E2E — QA — 1 人日（本地打包检查已通过，真实 Release/平台 E2E 待发布后执行）

### Story S-102：安全发布 npm CLI

**用户故事：** 作为维护者，我希望 npm 包从受保护的 GitHub workflow 发布并带来源证明，以便减少长期 token 和供应链风险。

**优先级：** MUST
**估算：** 3 点，2 人日

**验收标准：**

- npm package 名称在首次发布前确认；冲突时自动/文档化切换到备用 scoped 名称。
- 使用 GitHub-hosted runner 和 npm OIDC trusted publisher，不使用长期 publish token。
- beta 设置 `beta` dist-tag；稳定版设置 `latest`；精确版本不可覆盖。
- npm 页面展示正确 repository、license、README 和 provenance。

#### Tasks

- [ ] T-1021：确认 `aitracker` 包名、注册首个真实 beta 并配置 trusted publisher — 维护者 — 0.5 人日
- [ ] T-1022：新增 npm publish adapter、dist-tag 规则和重复发布保护 — DevOps — 1 人日
- [ ] T-1023：补齐 CLI README、故障码、隐私和安全说明 — 文档 — 0.5 人日

### Story S-201：提供自有 Homebrew Tap

**用户故事：** 作为 macOS 用户，我希望通过 Homebrew 安装并升级 AITracker，以便使用熟悉的包管理方式。

**优先级：** MUST
**估算：** 3 点，2–3 人日

**验收标准：**

- 稳定/测试 Cask 能为 arm64 和 x64 选择正确 DMG/hash。
- `brew style`、`brew audit --cask`、install、uninstall、zap 测试通过。
- 自有 Tap 的第一阶段不要求 Apple Developer ID，但 Cask 由 release metadata 生成，不允许手工复制 URL/hash。
- README 在官方 Cask 合并前展示带 Tap 的准确命令。

#### Tasks

- [x] T-2011：建立 `estelwalks/homebrew-aitracker` Tap 目录和稳定/beta Cask 模板 — macOS 发布 — 1 人日
- [x] T-2012：实现 metadata 到 Cask 的生成器和 snapshot 测试 — Node.js/Ruby — 1 人日
- [ ] T-2013：在 arm64/x64 环境执行安装、升级、卸载和 zap 冒烟 — QA — 1 人日

### Story S-202：提交官方 Homebrew Cask

**用户故事：** 作为 macOS 用户，我希望无需额外 Tap 即可安装 AITracker，以便降低首次安装摩擦。

**优先级：** SHOULD（稳定版后）
**估算：** 2 点，1–2 人日，不含外部审核

**验收标准：**

- 首个签名稳定版满足 Homebrew Cask 当前接受规则。
- 上游 PR 通过本地 style/audit 测试并包含版本化 URL/hash。
- 合并后 README 命令切换为 `brew install --cask aitracker`。

#### Tasks

- [ ] T-2021：核对 Acceptable Casks、命名、notability 和安全要求 — 维护者 — 0.5 人日
- [ ] T-2022：生成并提交 `Homebrew/homebrew-cask` PR，跟进审核 — 维护者 — 0.5–1.5 人日

### Story S-301：稳定 Windows 安装器身份和升级合同

**用户故事：** 作为 WinGet 用户，我希望安装、升级和卸载能被 Windows 正确关联为同一应用。

**优先级：** MUST
**估算：** 3 点，2–3 人日

**验收标准：**

- 安装后 ARP 中 DisplayName、Publisher、DisplayVersion、UninstallString 稳定且被记录为契约。
- `perMachine`、UAC、静默安装/卸载和覆盖升级在干净 Windows 环境通过。
- PackageIdentifier 和 Publisher 最终值经过维护者确认。

#### Tasks

- [ ] T-3011：检查/补齐 Electron Builder NSIS publisher、应用身份和版本字段 — Windows 发布 — 1 人日
- [ ] T-3012：验证 NSIS 静默参数、机器级安装、升级与卸载 — QA — 1 人日
- [ ] T-3013：记录 ARP 实测字段并形成 WinGet correlation fixture — QA/Node.js — 0.5 人日

### Story S-302：生成并提交 WinGet manifests

**用户故事：** 作为 Windows 用户，我希望通过 WinGet 精确安装 AITracker，以便获得标准发现和升级体验。

**优先级：** MUST
**估算：** 3 点，2–3 人日，不含外部审核

**验收标准：**

- version、installer、defaultLocale 三份 manifest 从 release metadata 生成。
- `winget validate` 和 Windows Sandbox 安装测试通过。
- `winget install --id estelwalks.AITracker -e`、upgrade、uninstall 通过。
- 稳定 Release 发布后自动创建更新 PR；beta 默认不提交。

#### Tasks

- [ ] T-3021：用 WinGetCreate 生成首版并锁定 manifest 模板 — Windows 发布 — 0.5 人日
- [ ] T-3022：实现 metadata 到 WinGet manifests 的生成器及 schema/snapshot 测试 — Node.js/YAML — 1 人日
- [ ] T-3023：执行 validate、SandboxTest、安装/升级/卸载 E2E — QA — 1 人日
- [ ] T-3024：提交 `microsoft/winget-pkgs` PR 并记录外部状态 — 维护者 — 0.5 人日

### Story S-401：统一应用内更新的频道与完整性规则

**用户故事：** 作为已安装用户，我希望应用只升级到我选择的频道且只运行校验通过的安装器。

**优先级：** MUST
**估算：** 5 点，3–4 人日

**验收标准：**

- stable 安装不选择 prerelease；beta 安装可选择 beta 或后续 stable，规则有测试。
- 下载更新后、打开安装器前验证 SHA-256。
- checksum 缺失、错误、超大下载、非可信 URL 均失败关闭。
- 原有设置和首次启动流程无回归。

#### Tasks

- [x] T-4011：扩展 GitHub Release 模型和频道选择规则及单元测试 — Electron/Node.js — 1 人日
- [x] T-4012：接入 release metadata/checksum 下载和验证 — Electron/Node.js — 1.5 人日
- [x] T-4013：增加错误状态、日志脱敏和 UI 文案映射 — 全栈 — 1 人日
- [ ] T-4014：执行旧版本到新版本的更新 E2E — QA — 0.5 人日

### Story S-501：实现发布编排、状态矩阵和可重试渠道

**用户故事：** 作为维护者，我希望知道每个渠道是否成功，并能只重试失败渠道，以便快速恢复部分发布失败。

**优先级：** SHOULD
**估算：** 3 点，2–3 人日

**验收标准：**

- workflow summary 显示制品、签名、冒烟、npm、Tap、Homebrew PR 和 WinGet PR 状态。
- 单个渠道 adapter 幂等，可在不重新构建安装包的前提下重试。
- 发布中断后能从 GitHub Release metadata 恢复上下文。
- 完成一次 checksum 故障和渠道 PR 失败的回滚演练。

#### Tasks

- [ ] T-5011：实现渠道 adapter 的统一输入/输出和幂等状态记录 — DevOps/Node.js — 1 人日
- [ ] T-5012：实现 workflow summary、外部 PR 链接和失败告警 — DevOps — 0.5 人日
- [ ] T-5013：新增 `release-reconcile` 手动重试工作流 — DevOps — 0.5 人日
- [ ] T-5014：执行并记录两类故障演练 — QA/维护者 — 0.5 人日

### Story S-502：完善用户和维护者文档

**用户故事：** 作为用户或维护者，我希望看到与当前渠道状态一致的安装和发布说明，以便不依赖口头知识。

**优先级：** MUST
**估算：** 2 点，1–2 人日

**验收标准：**

- README 四种语言包含已实际可用的安装命令、平台范围和 beta 说明。
- RELEASE_CHECKLIST 覆盖签名、metadata、三渠道发布、状态确认和回滚。
- DEVELOPMENT 说明本地 dry-run、Cask/WinGet 生成和测试命令。
- 文档中的命令在 CI 或文档 smoke test 中校验。

#### Tasks

- [ ] T-5021：更新 README/多语言安装章节和渠道可用性标识 — 文档/i18n — 0.5 人日
- [ ] T-5022：更新发布清单、开发指南和故障排查 — 文档/DevOps — 0.5 人日
- [ ] T-5023：增加文档命令/链接检查 — Node.js — 0.5 人日

## 5. 依赖关系与建议执行顺序

| Story | 依赖                 | 可并行项            | 阻塞说明                           |
| ----- | -------------------- | ------------------- | ---------------------------------- |
| S-001 | 无                   | S-301 调研          | 所有渠道共同输入                   |
| S-002 | S-001                | 部分可与 S-101 并行 | 稳定渠道的硬门禁                   |
| S-101 | S-001                | S-201、S-301        | 本地 tarball 可先于正式签名测试    |
| S-102 | S-101、S-002         | S-201               | 首次真实发布依赖 canonical Release |
| S-201 | S-001、macOS 制品    | S-101               | 自有 Tap 可先走 beta               |
| S-202 | S-002、S-201、稳定版 | S-302               | 受外部审核约束                     |
| S-301 | 无                   | S-001、S-101        | 应在 WinGet 模板前锁定 ARP 字段    |
| S-302 | S-001、S-002、S-301  | S-202               | 只提交稳定版                       |
| S-401 | S-001                | S-101、S-201、S-301 | 推广前的供应链硬门禁               |
| S-501 | S-102、S-201、S-302  | S-502               | 聚合已存在渠道                     |
| S-502 | 各渠道命令稳定       | 可持续增量更新      | 最终文档必须反映真实可用状态       |

推荐关键路径：`S-001 → S-002 → S-401 → S-102 → S-202/S-302 → S-501 → S-502`。

## 6. Sprint 建议

### Sprint 1：发布基础和 npx Alpha/Beta

- S-001、S-002 的可测试基础部分。
- S-101 完整实现。
- S-301 Windows 安装器身份调研。
- 退出目标：本地/私有 draft Release 可通过 npx tarball 安装，三类制品有 metadata/hash。

### Sprint 2：未签名 Beta 和原生包管理器（当前 Phase 1）

- 完成 S-002 的制品、metadata、checksum 和 beta 冒烟；稳定版签名作为后续 gate。
- S-101 npx CLI 和 S-201 自有 Tap 的本地实现。
- S-401 更新器频道与 checksum。
- S-102 的真实 npm 发布、S-201 的远程 Tap 同步，以及 S-302 WinGet 生成和 Sandbox 验证后置，不计入当前完成状态。
- 退出目标：未签名 `npx @estelwalks/aitracker --channel beta` 和 `brew install --cask estelwalks/aitracker/aitracker-beta` 的代码/模板就绪，用户能看到明确的系统安全提示说明；真实 Release 发布后再执行干净环境安装验证。

### Sprint 3：稳定发布和运营闭环

- 发布第一个候选稳定版。
- S-202 官方 Cask PR。
- S-302 WinGet PR。
- S-501 状态、重试、回滚演练。
- S-502 全量文档。
- 退出目标（后置）：稳定 npm/Tap 可用，Homebrew/WinGet 上游 PR 已提交并可追踪。

## 7. 测试与发布门禁

每个 Task 完成后必须执行与风险相称的格式、类型、单元测试和 Git 提交；以下是稳定发布前的后置门禁，不能作为当前 Phase 1 已完成证据：

- `npm run typecheck`
- `npm run lint`
- `npm run test:all`
- `npm run build:desktop`
- `npm run verify:sqlite-only`
- `npm run verify:bundle-no-sqlite`
- `npm run verify:bundle-budget`
- CLI 单元/E2E、Cask arm64/x64、未签名 beta 安全提示、WinGet Sandbox、稳定版平台签名和升级路径全部通过
- draft Release 冒烟通过，release metadata 与实际制品 hash 二次核对一致

## 8. 可追踪性矩阵

| 目标          | Story        | 验证证据                                                           |
| ------------- | ------------ | ------------------------------------------------------------------ |
| 单一权威制品  | S-001、S-002 | metadata、hash、draft gate 日志                                    |
| npx 安装      | S-101、S-102 | CLI 单元/打包检查已完成；npm provenance 和真实三平台 E2E 待后置    |
| Homebrew Cask | S-201、S-202 | 生成器/style 已完成；真实 install/audit、远程 Tap 和上游 PR 待后置 |
| WinGet        | S-301、S-302 | validate、SandboxTest、上游 PR                                     |
| 安全更新      | S-401        | channel/checksum 单元和更新 E2E                                    |
| 可恢复发布    | S-501        | reconcile run、故障演练记录                                        |
| 用户可发现性  | S-502        | 多语言文档和链接检查                                               |

## 9. Phase 4 交接说明

后续进入代码实现时，应按上表依赖逐 Task 执行。依据 `agile-feature-dev` 约束，每个 Task 必须交由匹配的实现 Sub-Agent，完成后立即执行格式检查、类型检查、单元测试和独立 Git commit；任何门禁失败都应在当前 Task 内修复，不得带失败进入下一个 Task。

优先启动 T-0011；在 S-001 契约稳定后，并行推进 npx、Homebrew 模板和 Windows 安装器身份验证。
