# AITracker 开发、测试、验证与发布实操手册

> 本文面向**刚拿到仓库、要持续开发**的开发者，按“准备环境 → 日常开发 → 测试 → 验证 → 发布”的顺序，把每个阶段要执行什么命令、为什么、什么时候跑讲清楚。
> 英文简版见 [DEVELOPMENT.md](DEVELOPMENT.md)，发布人工清单见 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)。

## 0. 环境准备（先做这一步）

### 0.1 版本要求

| 依赖 | 要求 | 当前说明 |
|---|---|---|
| Node.js | `>= 24`（`package.json` engines，CI 固定 24，`.nvmrc` = 24） | **⚠️ 常见首个坑**：如果你机器上是 Node 20，所有 `npm run dev` / `typecheck` / 测试都会失败或行为异常 |
| npm | `10.9.2`（`package.json` packageManager 字段） | `npm ci` 会校验版本 |
| 平台 | macOS / Windows 获得完整桌面体验 | Linux 标记为 `planned`，工具与模块清单中未启用 |

检查当前版本：

```bash
node --version   # 必须显示 v24.x
npm --version
```

### 0.2 升级到 Node 24（仅当当前不是 24）

**方式 A：Homebrew（最简单，macOS）**

```bash
brew install node@24
# node@24 是 keg-only，需要手动加入 PATH：
echo 'export PATH="/opt/homebrew/opt/node@24/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
node --version   # 应显示 v24.x
```

> 如果你的 Homebrew 已经很久没更新，先 `brew update` 再安装。装完后**重新打开终端**，确认 `which node` 指向 `/opt/homebrew/opt/node@24/bin/node`。

**方式 B：nvm（版本切换更灵活，推荐长期开发）**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# 重新打开终端后：
nvm install 24
nvm use 24
nvm alias default 24
node --version
```

安装完依赖后，本项目根目录的 `.nvmrc` 会让 `nvm use` 自动选中 24。

### 0.3 安装依赖与测试浏览器

```bash
npm ci                          # 用 lockfile 精确安装，不要用 npm install
npx playwright install chromium # E2E 需要（CI 里用的是 --with-deps chromium）
```

- `npm ci` 会安装 `@estelwalks/agent-threat-scanner`（已发布的 npm 包）和 Electron，无需 API key。
- 本地功能与自动化测试都不需要任何密钥。

### 0.4 快速自检

```bash
npm run typecheck     # 类型检查通过，说明工具链基本就绪
npm run test:unit     # 跑一批单元测试，能出绿色结果即可
```

---

## 1. 代码地图：改代码时去哪里找

| 我想改什么 | 去哪里 |
|---|---|
| 页面 / UI / 前端逻辑 | `src/routes/**`（文件式路由）+ `src/modules/<模块>/presentation/**` |
| 业务能力（采集、技能、知识、安全、报告…） | `src/modules/<模块>/{domain,application,infrastructure}/**` |
| 服务端数据接口（server functions） | `src/modules/<模块>/**/*.server.ts`、`*api.server.ts`，通过 `createServerFn` 暴露 |
| 前端状态 | React Query（`useQuery`/`useMutation`）+ React Context；**没有 Vue/Pinia/Redux** |
| Electron 主进程 / 托盘 / 窗口 / IPC | `electron/main.ts` 及 `electron/*.ts`，preload 桥在 `electron/preload*` |
| 定时任务 / 快照刷新策略 | `src/app/runtime-policy.source.json` + `src/modules/tasks/definitions/job-catalog.generated.ts`（生成物） |
| SQLite 迁移 / 表结构 | `src/platform/database/migrations/*.sql` |
| 工具注册表（新增 AI 工具） | `src/lib/tool-registry/**`（生成 `public-manifest.generated.ts`） |
| 所有服务的装配点 | `src/app/composition.server.ts`（组合根，新模块必须接进来） |
| 数据库/仓库层 | `src/platform/database/**`、`src/platform/**` |
| 应用配置（品牌名、数据目录、环境变量名） | `src/lib/app-config.ts`（⚠️ 标 `[compat]` 的常量不能随便改） |

模块内部一般按 `domain / application / infrastructure / presentation / contracts` 分层，每个模块还常带 `*.server.ts`、`*query.ts`、`*.test.ts`。

---

## 2. 日常开发循环

### 2.1 纯前端快速迭代（推荐）

```bash
npm run dev
# 打开 http://localhost:5173
```

- 只是 TanStack Start 的 Vite dev server，HMR 快。
- 适合只改 UI、路由、Query 层的场景。

### 2.2 完整桌面体验

```bash
npm run dev:desktop
```

- 先跑 `predev:desktop`（生成 native icons），然后 `electron/dev-runner.mjs` 会：
  1. 启动 Vite dev server（默认 `127.0.0.1:5173`）；
  2. 等 Vite 就绪并预热关键依赖（避免 Electron 窗口出现后模块图失效）；
  3. 编译 Electron main/preload 并启动 Electron 外壳。
- 首次冷启动可能较慢（Windows 上 optimizeDeps 可能超过 1 分钟，冷启动上限 300 秒），属正常现象。
- 改动 Electron 主进程代码时，runner 会检测到 Electron 编译输入（`*.ts`/`*.cts`）变更并自动重编译、重启 Electron；改前端代码走 Vite HMR。

### 2.3 首次启动实验（隔离环境）

```bash
npm run dev:desktop:first-run      # 一次搞定：准备隔离 home + 种子数据 + 启动
npm run lab:first-run:prepare      # 只生成隔离 home
npm run lab:first-run:seed         # 只往隔离 home 写种子数据
```

用这套实验不会污染你真实的 `~/.aitracker` 数据。

### 2.4 常用环境变量（开发时）

所有变量名由 `src/lib/app-config.ts` 的 `ENV` 定义，前缀是 `AITRACKER_`：

| 变量 | 作用 |
|---|---|
| `AITRACKER_USAGE_HOME` | 数据根目录（默认 `~/.aitracker`）。测试/E2E 用它隔离数据 |
| `AITRACKER_ENABLE_BACKGROUND_TASKS` | `"false"` 可关闭后台定时任务（E2E 默认关闭保证确定性） |
| `AITRACKER_DEV_HOST` / `AITRACKER_DEV_PORT` | dev server 地址端口（默认 127.0.0.1:5173） |
| `AITRACKER_DISTILL_DAILY_QUOTA` | 覆盖蒸馏真实模型的每日配额上限 |
| `AITRACKER_RUNTIME` | 运行形态（web / desktop 等） |

### 2.5 生成文件（重要约定）

以下文件是**生成物，已提交到仓库，CI 会校验它们与源定义一致**：修改源定义后必须用对应 `generate:*` 命令重新生成，**绝不手改**：

```bash
npm run generate:tool-imports      # 工具导入
npm run generate:manifest          # 公共工具清单 public-manifest.generated.ts
npm run generate:pricing-imports   # 定价导入
npm run generate:security-rules    # 安全规则
npm run generate:runtime-policy    # 运行时策略 runtime-policy.generated.ts
npm run generate:module-catalog    # 模块目录 module-catalog.generated.ts
npm run generate:native-icons      # 原生图标
```

路由树 `src/app/routeTree.gen.ts` 由 TanStack Router 生成（dev/build 时自动）。`prebuild` 会串联跑上面全部 `generate:*`。

**不要提交** `.output/`、`build/electron/`、`dist/`、`out/`、`release/`（均在 `.gitignore`）。

---

## 3. 测试矩阵

### 3.1 测试都放在哪

| 位置 | 内容 |
|---|---|
| `src/**/*.test.ts(x)`、`electron/**/*.test.ts(mjs)` | 与被测代码同目录的单元测试（约 299 个测试文件） |
| `tests/unit/` | 不能放在源码旁的单元测试（如路由结构检查） |
| `tests/e2e/` | Playwright 端到端用户旅程（9 个 spec） |
| `tests/fixtures/performance/` | 确定性的性能 fixture（版本化、可复现） |
| `tests/performance/` | 性能预算与场景定义 |
| `scripts/*.test.mjs` | 仓库工具/门禁脚本自身的测试（15 个） |

### 3.2 命令与用途

| 命令 | 覆盖范围 | 什么时候跑 |
|---|---|---|
| `npm run test:unit` | 应用、Electron、tests/unit 的全部单元测试 | 每次改完代码后（最快反馈） |
| `npm run test:database` | SQLite 迁移、仓库、备份、恢复、表约束、隐私负例 | 改数据库/迁移/仓库层时 |
| `npm run test:scripts` | 仓库校验工具（模块边界、SQLite-only、开源卫生等） | 改了 `scripts/` 时 |
| `npm run test:scanner` | `agent-threat-scanner` 导入与 CLI 冒烟 | 改了扫描器相关时 |
| `npm run test:cli` | `packages/cli` 的测试 | 改了 CLI 时 |
| `npm run test:release` | 发布脚本/元数据/制品名/README 链接测试 | 发布前 |
| `npm run test:all` | 以上非 E2E 全部套件（unit + scripts + database + scanner） | 提交 PR 前必跑 |
| `npm run test:e2e` | Playwright 默认配置（临时隔离 home，关闭后台任务） | 涉及用户旅程、路由、交互时 |
| `npm run test:e2e:empty-home` | 空数据目录的韧性场景 | 首启/空状态改动 |
| `npm run test:e2e:stale-home` | 预置旧数据的韧性场景 | 迁移/快照/旧数据兼容改动 |
| `npm run test:e2e:offline` | 离线汇率韧性场景 | 网络/汇率改动 |
| `npm run test:e2e:local-workspace` | 本地工作区桌面场景 | 桌面/本地扫描改动 |
| `npm run test:route-performance` | 路由打开性能预算 | 路由/首屏性能改动 |
| `npm run test:perf` | local-usage 性能测试 + 类型检查 + lint | 采集性能改动 |
| `npm run check:i18n` | 翻译文件、硬编码文案、app-config 同步 | 改文案/i18n 时 |

### 3.3 E2E 是怎么跑的

- 默认配置（`playwright.config.ts`）：端口 41737，`workers: 1`，每个 spec 超时 30s，**自动创建一个临时 home 目录**（`AITRACKER_USAGE_HOME`）并把后台任务关掉（`AITRACKER_ENABLE_BACKGROUND_TASKS=false`）保证确定性；`webServer` 用 `npm run dev -- --host 127.0.0.1 --port 41737 --strictPort` 拉起被测服务。
- 跑之前先装浏览器：`npx playwright install chromium`。
- 失败时保留截图（`only-on-failure`），重试时保留 trace。

---

## 4. 验证门禁（提交 PR / 合入 main 前）

### 4.1 本地“全绿”清单

```bash
npm run typecheck                      # 应用 + Electron + scanner 类型
npm run lint                           # ESLint
npm run test:all                       # 全部非 E2E 测试
npm run build:desktop                  # Vite 构建 + prune + Electron main/preload 编译
npm run verify:architecture:blocking   # 模块边界（presentation 不许碰 SQLite/fs 等）
npm run verify:runtime-policy          # 运行时策略与生成物一致
npm run verify:job-catalog             # 任务目录与生成物一致
npm run verify:module-catalog          # 模块目录与生成物一致
npm run verify:database-schema         # 数据库 schema 一致性
npm run verify:browser-server-boundary # 浏览器/服务端源码边界
npm run verify:sqlite-only             # 持久化只允许走服务端 SQLite（发布阻断）
npm run verify:bundle-no-sqlite        # 公开 bundle 不含 SQLite（发布阻断）
npm run verify:bundle-budget           # 包体积预算（需要先 build）
npm run verify:read-model-budgets      # 读模型性能预算（会重生成 10x fixture）
npm run check:opensource-hygiene       # 路径/凭据/旧名扫描
```

> `verify:sqlite-only`、`verify:bundle-no-sqlite` 依赖 `npm run build` 的产物（`.output`），所以顺序是**先 build 再 verify**。CI 里也是这么排的。
> `verify:architecture`（非 blocking）可在本地快速跑，`verify:architecture:blocking` 与 CI 一致。

### 4.2 CI 会跑什么（`.github/workflows/ci.yml`）

| Job | 环境 | 内容 |
|---|---|---|
| `CI / verify` | ubuntu-latest, Node 24, 30min | release-contract → 制品名 → README 链接 → typecheck → lint → 开源卫生 → 架构边界(blocking) → build → bundle-budget → read-model-budgets → build:electron → test:database → database-schema → browser-server-boundary → sqlite-only → bundle-no-sqlite → runtime-policy → job-catalog → test:unit → test:scripts → test:scanner |
| `CI / e2e` | ubuntu-latest, Node 24, 30min | `npx playwright install --with-deps chromium` → `npm run test:e2e` |

分支策略（注意）：
- **PR 触发**：所有 PR 都会跑 CI；
- **push 只对 `main` 触发**：因为 GitHub 对同名 check 会区分 `(push)` / `(pull_request)`，如果 feature 分支 push 也跑，会导致 required check 永远无法满足（protect-main 规则要求名字精确为 `CI / verify` 和 `CI / e2e`）。所以**不要**为了“提前看结果”往远程 feature 分支 push 期待 CI —— 正确姿势是开 PR。

---

## 5. 调试技巧

### 5.1 数据与日志

- 数据根目录默认 `~/.aitracker`（`AITRACKER_USAGE_HOME` 可覆盖）。里面有 SQLite 数据库、迁移备份、快照等。
- 运行日志：observability JSONL 日志在数据根目录下（`observability.jsonl`，约 1MB 轮转、保留 3 个归档）。
- 用脚本直接查库：

```bash
npm run inspect:database   # 检查 SQLite 内容/结构
npm run diagnose:model     # 诊断当前活跃模型相关状态
```

### 5.2 隔离环境

- 想模拟“全新用户”：`npm run dev:desktop:first-run`（隔离 home + 种子数据）。
- 想验证“老数据升级”：用 `test:e2e:stale-home` 对应的 fixture 思路，或自己 `AITRACKER_USAGE_HOME=$(mktemp -d)` 后预置数据再启动。

### 5.3 E2E 排查

- 失败会输出截图（`test-results/` 等 Playwright 默认目录），trace 在重试时保留。
- 单跑一个 spec：`npx playwright test tests/e2e/xxx.spec.ts`（注意这会走默认 config，可用 `-c playwright.config.ts`）。

### 5.4 性能预算

- 需要真实大 fixture 时：`npm run perf:fixtures` 生成确定性 fixture（10x 大 fixture 按需生成、不进 Git）。
- `npm run perf:benchmark` 跑基准；`npm run verify:read-model-budgets` 校验预算。

### 5.5 常见“看起来是 bug”其实是环境的坑

| 现象 | 原因 |
|---|---|
| 启动即报 Node 版本/engine 错误 | Node 不是 24 |
| `npm ci` 报 lockfile 不匹配 | 用了 `npm install` 改过 lockfile；回到 `git checkout package-lock.json` 再 `npm ci` |
| 改注册表/模块后 CI 失败 | 忘了重新生成生成物（见 2.5） |
| E2E 一直超时 | 没装 Playwright 浏览器，或端口被占用 |
| 页面出现但数据空白 | 后台任务被 `AITRACKER_ENABLE_BACKGROUND_TASKS=false` 关闭，或 home 目录为空，属预期 |

---

## 6. 发布流程

发布完全由 **Git tag 驱动**：打 `v<version>` 标签并推送后，GitHub Actions 自动构建 macOS/Windows/Linux 安装包并生成 **draft release**；**任何发布都需要维护者人工验收后再点发布**。

### 6.1 版本与 Changelog 约定（先做）

1. **三个版本必须一致**：`package.json`、`package-lock.json`、`packages/cli/package.json` 的 `version` 相同（版本唯一来源是 `package.json`，`src/lib/app-config.ts` 从这里读）。
2. **Changelog**（`CHANGELOG.md`）：
   - 平时改动一律写进 `## [Unreleased]`；
   - 发布时把 `[Unreleased]` 整个内容移到新编号节 `## [X.Y.Z] - YYYY-MM-DD`，并重建空的 `[Unreleased]`；
   - 新节顶部放 `### Highlights`（英文的简短用户摘要），紧跟 `### 更新摘要`（同一份摘要的中文版，可省略；两者一一对应）；下面 `### Details` 放明细；
   - GitHub Release 页面由工作流从该节生成，**英文在前、中文在后**：`### Highlights` → `## What's changed`，`### 更新摘要` → `## 本次更新`；缺少中文摘要时该版本只发英文，中文摘要缺少英文列表则直接失败；
   - 版本号节和 bump **属于 release 分支**，不属于 feature 分支/PR；feature 分支只往 `[Unreleased]` 加条目。
   - 预览 release notes：`npm run release:notes -- --version <version> --output -`。
3. **跑发布门禁**：

```bash
npm ci                                 # 从干净 checkout
npm run typecheck && npm run lint && npm run test:all
npm run build:desktop
npm run verify:sqlite-only && npm run verify:bundle-no-sqlite && npm run verify:bundle-budget
npm run test:release
npx prettier --check README.md CHANGELOG.md docs/RELEASE_CHECKLIST.md
npm run verify:release-contract -- --tag v<version> --channel <stable|beta>
```

### 6.2 打标签触发发布

```bash
git checkout release-branch   # 版本号与 changelog 已就绪
git tag v<version>            # 例如 v1.0.4；含 - 的标签（如 v1.1.0-beta.1）自动走 beta 频道
git push origin v<version>
```

推送后两个 workflow 并行触发：

| Workflow | 做什么 |
|---|---|
| `.github/workflows/release.yml` | ① release-contract 门禁（校验 tag 与版本一致、制品名、README 链接）→ ② 矩阵构建安装包（macOS arm64/x64、Windows x64/arm64，Windows arm64 在 x64 runner 上交叉构建；Linux x64 在 ubuntu-22.04 上产出 AppImage/deb/rpm）→ ③ 汇编 **draft** release：下载制品 → 再校验 → 生成 `release-metadata.json`、`release-metadata-linux.json` 与 `checksums.txt` → 生成中英双语 release notes → `gh release create --draft`（beta 加 `--prerelease`） |
| `.github/workflows/publish-npm.yml` | 用 OIDC 可信发布 `@estelwalks/aitracker` CLI 到 npm（无需 NPM_TOKEN），并移动 `latest`/`beta` dist-tag；已存在的版本自动跳过 |

> 稳定 vs beta：tag 名含 `-`（如 `v1.1.0-beta.1`）→ beta 频道（draft prerelease）；否则 → stable。

### 6.3 macOS 签名（稳定发布必须，beta 可选但推荐）

未签名时 `electron/after-pack.cjs` 用 ad-hoc 签名，用户每次升级都要重新授权文件夹访问（TCC 按 cdhash 记录）。用项目自签名证书可让授权跨版本保留：

```bash
npm run signing:create-cert   # 生成 10 年期代码签名证书并安装到登录钥匙串
```

然后把 `.p12`（base64）配到 GitHub secrets：

```sh
gh secret set MAC_CSC_LINK < certificate.p12.base64
gh secret set MAC_CSC_KEY_PASSWORD --body "<p12 密码>"
gh variable set MAC_CSC_NAME --body "AITracker Self-Signed"
```

- 配置了 `MAC_CSC_LINK` 后，release 会设置 `AITRACKER_REQUIRE_SIGNING=1`：证书不可用时**直接失败**而不是悄悄发布 ad-hoc 包。
- 本机验证：`npm run dist:mac:arm64` 后 `codesign -d -r- release/mac-arm64/AITracker.app`，要求显示 `certificate leaf = H"…"` 而不是 `cdhash`。
- 公证（notarization）目前**未配置**，稳定发布前必须补上；详见 [MACOS_SIGNING.md](MACOS_SIGNING.md)。
- 绝不提交证书/私钥；密钥材料默认写到仓库外（`~/aitracker-signing`）。

### 6.4 人工验收并发布 draft（唯一入口）

1. 打开 Actions 的 Release workflow，确认 `release-contract`、各平台 build、`draft-release` 全绿。
2. 到 Releases 页面打开那个 **draft**，核对：
   - tag 与版本号；
   - 安装包齐全：`AITracker-macOS-arm64.dmg`、`AITracker-macOS-x64.dmg`、`AITracker-Windows-x64.exe`、`AITracker-Windows-arm64.exe`，以及 Linux 的 `AITracker-Linux-x64.AppImage` / `.deb` / `.rpm`（**文件名不含版本号**，这是刻意设计：`releases/latest/download/<name>` 跨版本保持稳定）；
   - `release-metadata.json`、`release-metadata-linux.json` 与 `checksums.txt` 齐全；
   - release notes 与 changelog 的 `Highlights` / `更新摘要` 一致（英文在前、中文在后）。
3. 建议做冒烟：在干净用户环境装一个包，走通首启、更新、导出、数据库恢复、已配置 provider 流程。
4. 确认无误后点 **Publish release**。

### 6.5 发布后验证

```bash
# README 下载链接应解析到新 tag 的资产（而不是旧 release）
curl -sIL -o /dev/null -w '%{http_code} %{url_effective}\n' \
  https://github.com/estelwalks/aitracker/releases/latest/download/AITracker-macOS-arm64.dmg
# CLI 应能解析到最新频道
npx --no-install @estelwalks/aitracker@latest --dry-run
```

### 6.6 发布边界（哪些事 release 工作流不做）

- 不签名/不公证（需要 secrets 与人工流程）；
- 不创建/更新 Homebrew Tap、不提交 WinGet manifest（相关生成器在 `scripts/`，属本地工具）；
- 不发布正式 stable 渠道——draft 由维护者手动发布，失败的工作流不会自动产生正式发布；
- 稳定安装命令只有在签名稳定构建 + 官方 Cask 就绪后才能对外宣传。

---

## 7. 新成员 15 分钟上手清单

```bash
# 1. Node 24
node --version
# 2. 依赖
npm ci
npx playwright install chromium
# 3. 快速验证
npm run typecheck
npm run test:unit
# 4. 跑起来
npm run dev          # 浏览器模式
npm run dev:desktop  # 桌面模式
# 5. 读文档
#   docs/architecture/README.zh-CN.md → system-architecture / business-structure
#   docs/plan/aitracker-后续开发计划.md
```

## 8. 相关文档

- [架构与业务文档索引](architecture/README.zh-CN.md)
- [Development Guide（英文简版）](DEVELOPMENT.md)
- [Release Checklist（发布人工清单）](RELEASE_CHECKLIST.md)
- [macOS 签名说明](MACOS_SIGNING.md)
- [后续开发计划](plan/aitracker-后续开发计划.md)
- [多渠道安装与发布架构设计](design/aitracker-架构设计文档.md)
- [敏捷任务清单](plan/aitracker-敏捷任务清单.md)
