# AITracker Linux 适配设计方案

> **本文是上游设计文档（单一来源）。** 面向实施的拆分版见
> [`dev-docs/linux/`](../../dev-docs/linux/README.md)——按模块自包含，含逐文件改动清单与验收标准。
> 两份文档同步维护：改动其一请同步另一份。

| 项目     | 内容                                                                                                                                                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档状态 | 待评审                                                                                                                                                                      |
| 适用版本 | 1.0.4 → 1.1.0（Linux 首发）                                                                                                                                                 |
| 目标读者 | 桌面端 / 构建发布 / 前端 / 测试                                                                                                                                             |
| 代码基线 | `electron-builder 26.15.3`、`Electron 43.4.1`、Node ≥ 24                                                                                                                    |
| 关联文档 | [开发文档集](../../dev-docs/linux/README.md)、[DEVELOPMENT.md](../DEVELOPMENT.md)、[RELEASE_CHECKLIST.md](../RELEASE_CHECKLIST.md)、[MACOS_SIGNING.md](../MACOS_SIGNING.md) |

---

## 实施进展（本轮）

**M0（元数据契约）与 M1（打包地基）代码已完成并通过全部门禁。**

| 里程碑        | 状态                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| M0 元数据契约 | ✅ 代码完成（updater 容忍型校验、schema、CLI 校验器）                                                               |
| M1 打包地基   | ✅ 代码完成（`linux:` 配置、图标集、`dist:linux:*`、`release-metadata-linux.json`、契约脚本、CI、`setDesktopName`） |
| M2 可用性     | 🟡 部分（`frame: false`、双击最大化已做；托盘与三分支 UI 待做）                                                     |
| M3 更新闭环   | ⬜ 未开始                                                                                                           |
| M4 功能对等   | ⬜ 未开始                                                                                                           |

### 实施中修正的两处设计假设

1. **arm64 不是"加一行"**。`linux.artifactName` 必须用字面量 `-x64`（`${arch}` 在 Linux 上是 `x86_64`/`amd64` 两种后缀），因此当前**没有能产出 arm64 文件名的模板**；`verify-release-artifact-names` 的"渲染全部模板并比对名字全集"断言会因此失败。arm64 需要独立的 `artifactName` 覆盖 + 四处名字表同步 + 独立 runner。`RELEASE_PLATFORMS` 已预先接受 `linux-arm64`。详见 [02 §3](dev-docs/linux/02-打包与发布.md)。

2. **README 的下载链接会被产物名守卫扫描**。`verify-release-artifact-names.mjs` 的 `installerNamesIn()` 会读取 `ARTIFACT_NAME_SOURCES` 中**所有**匹配 `.dmg|.exe|AppImage|deb` 的带引号字符串，所以名字表必须与 README 保持同一顺序，否则顺序断言失败。

### 尚未在 Linux 上验证的事项

`electron-builder --linux` 能否真正产出 AppImage/deb、`.desktop` 文件名是否与 `setDesktopName` 一致、`frame:false` 在 GNOME/KDE 的行为、deb 内 `chrome-sandbox` 权限位、AppImage 在 Ubuntu 24.04 上的可启动性——这些都需要 Linux 真机。详见 `dev-docs/linux/README.md` 的「实施状态」。

---

## 实施文档索引

| 模块             | 文档                                                               | 里程碑  |
| ---------------- | ------------------------------------------------------------------ | ------- |
| 决策与现状       | [01 架构决策](../../dev-docs/linux/01-架构决策.md)                 | 全部    |
| 打包与发布       | [02 打包与发布](../../dev-docs/linux/02-打包与发布.md)             | M0 / M1 |
| 应用内更新       | [03 更新链路](../../dev-docs/linux/03-更新链路.md)                 | M3      |
| 主进程与桌面集成 | [04 主进程与桌面集成](../../dev-docs/linux/04-主进程与桌面集成.md) | M2      |
| 渲染层           | [05 渲染层适配](../../dev-docs/linux/05-渲染层适配.md)             | M2 / M4 |
| 工具注册表与扫描 | [06 工具注册表与扫描](../../dev-docs/linux/06-工具注册表与扫描.md) | M4      |
| 测试与验收       | [07 测试与验收](../../dev-docs/linux/07-测试与验收.md)             | 全部    |

---

## 1. 背景与结论摘要

AITracker 目前只发布 macOS（`dmg` ×2）与 Windows（`nsis` ×2）两个平台，共 4 个安装包。
需求是补齐 Linux 版本。本文给出**整体审查结论 + 完整设计方案**。

### 好消息（占比比预期大）

代码库的跨平台基建比“只有 mac/win 两平台”这个表象好得多，Linux 属于**“缺少显式分支 + 缺少打包链路”**，而不是“架构需要重写”：

- `src/lib/tool-registry` 已内建 XDG 支持（`XDG_CONFIG_HOME` / `XDG_DATA_HOME`，`~/.config`、`~/.local/share` 回退表），`PlatformOs` 类型已含 `"linux"`，只是 `defaultStatus.linux = "planned"` 把所有扫描路径短路了。
- `RuntimePlatform` 已含 `"linux"`，`nodePlatformToRuntimePlatform()` 已正确返回 `"linux"`，`RuntimeInfo.platform` 类型是 `NodeJS.Platform`，**渲染进程契约无需改动**。
- `update-manager.ts:522-527` 的 `extensionsFor()` **已经写好了 Linux 分支**（`.appimage/.deb/.rpm/.tar.gz`），架构别名表已含 `x86_64`/`amd64`。
- `electron/after-pack.cjs` 的 `resourcesDirectory()` 已处理 Linux 布局，签名/公证逻辑全部在 darwin 早退之后。
- `electron/WindowChrome.tsx` 的平台判定是“非 Mac 即右侧窗口按钮”，Linux 天然走对分支。
- 快捷键判定用的是 `metaKey || ctrlKey`，无 `Cmd`-only 绑定；无 `globalShortcut` 注册。
- **无原生模块**（`npmRebuild: false`，打包只带纯 JS 的 scanner + zod，`.output/` 中零 `.node`），所以**没有 native rebuild 问题**。
- 数据库权限位 `file-permissions.server.ts` 已在非 win32 平台应用 `0700/0600`，Linux 直接受益。
- 数据根目录 `~/.aitracker` 在 Linux 上语义正确，无需迁移。

### 必须解决的问题（按优先级）

| 级别   | 问题                                                                                                           | 为什么致命                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **P0** | 更新元数据 `release-metadata.json` 的 artifact key 集合是**封闭**的（恰好 4 个 key）                           | 一旦写入 `linux-x64`，**所有已发布的 1.0.x 客户端（含 mac/win）会永久拒绝整份元数据**，自动更新彻底失效。这是必须先解的时序锁 |
| **P0** | 无 `linux:` 打包配置、无 Linux 图标集、无 `dist:linux`、无 CI runner                                           | 根本产不出包。且 Electron 构建**不支持跨平台交叉打包**，必须在 Linux runner 上构建                                            |
| **P0** | Linux 更新落地流程只会在 macOS 上触发退出；`handOffInstaller` 落到 `spawn(installerPath)`，而下载文件是 `0644` | `EACCES` 且错误在 `launched: true` 返回**之后**才异步抛出 → 用户点“重启安装”**静默无反应**                                    |
| **P1** | `titleBarStyle` 在 Linux 无效，主窗口未设 `frame: false`                                                       | Linux 上会出现 **GTK 原生标题栏 + 自绘 36px 标题栏**，两套最小化/最大化/关闭按钮                                              |
| **P1** | Chromium sandbox：AppImage 无法携带 SUID `chrome-sandbox`                                                      | Ubuntu 23.10+ 默认限制非特权 user namespace，AppImage 可能**直接启动失败且无任何提示**                                        |
| **P1** | 未调用 `app.setDesktopName`                                                                                    | Wayland `app_id` / X11 `WM_CLASS` 与 `.desktop` 文件名不一致 → 任务栏图标错位、分组错误，portal 可能拒绝文件对话框            |
| **P1** | **渲染进程没有“平台”这个值**（只有 UA 嗅探 + 一处 `getRuntimeInfo()`），全部二值化为 `isMac`                   | Linux 静默复用 Windows 分支与文案（更新对话框、⌘ 提示等），无法做正确的三分支                                                 |
| **P1** | 所有工具 `linux: "planned"`，`resolvePlatformPlan` 直接返回空路径                                              | Sources 页把所有工具渲染成“未安装 / 无可显示目录”，用户无法区分“没装”和“不支持”；需逐项放开或诚实展示                         |
| **P2** | `LANG=C` / 未设 locale 时 `mapSystemLocale` 回退 **zh-CN**                                                     | Linux 上 locale 缺失是常态 → 非中文用户首启看到中文界面                                                                       |
| **P2** | `prefers-color-scheme` 在无 appearance portal 的桌面回退为 light，而 CSS 是暗色优先                            | 首启误用验证不足的亮色主题                                                                                                    |
| **P2** | 技能根解析绕过 XDG 环境变量（`getSkillPlan` 忽略 `_env`）                                                      | 自定义 `XDG_CONFIG_HOME`/`XDG_DATA_HOME` 时技能被**写入错误目录**且扫描不到                                                   |
| **P2** | 托盘图标在 Linux 回退到 16×16 PNG，面板按 22–24px 绘制                                                         | 图标模糊；且明暗跟随 GTK 主题而非面板背景                                                                                     |
| **P2** | 原生依赖绑定**平台和架构**（`@resvg/resvg-js`、`@tailwindcss/oxide`、`lightningcss`）                          | 本机只装了 `*-darwin-x64` 版；Linux 构建机/CI 必须重新 `npm ci`，**arm64 交叉构建会失败**                                     |
| **P2** | 托盘菜单是 AppIndicator 的 D-Bus 快照，勾选状态不刷新；菜单缺少“打开应用”入口                                  | 在 GNOME 下托盘点击常被菜单吞掉 → 用户可能**没有任何办法唤回窗口**                                                            |

### 核心决策（详见 §4）

| 决策点         | 结论                                                                     | 理由                                                                   |
| -------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 首发架构       | **仅 x64**                                                               | arm64 交叉构建会被原生绑定卡住；先用 `ubuntu-22.04` x64 打通链路       |
| 首发格式       | **AppImage + deb**                                                       | AppImage 覆盖全发行版、无需 root；deb 提供系统集成与 desktop 条目      |
| 构建基线       | **ubuntu-22.04（glibc 2.35）**                                           | 打包产物 glibc 下限来自下载的 Electron payload，22.04 兼容面最广       |
| 更新落地策略   | **AppImage：就地替换（`APPIMAGE` 环境变量）；deb/rpm：交给系统包管理器** | 与 macOS 的“换 bundle 再重启”体验对齐，且永不自动 sudo                 |
| 元数据契约演进 | **新增独立资产 `release-metadata-linux.json`**，主文档保持 4 key         | 老客户端不读新文件 → 1.0.4 继续能更新，同时 Linux 能同版本首发（§4.1） |
| 窗口装饰       | Linux/Windows 用 `frame: false`；macOS 保持 `hiddenInset`                | `titleBarStyle` 在 Linux 被忽略                                        |
| Wayland        | **默认保持 X11/XWayland**，Wayland 作为可选开关                          | 窗口定位、置顶、最小化在 Wayland 下均有 API 级缺陷（见 §4.6）          |

---

## 2. 现状盘点

### 2.1 平台分支清单（`process.platform`）

主进程中共 32 处平台判定，**没有任何一处显式处理 `linux`**——Linux 永远走隐式 `else`。部分 `else` 恰好正确，但关键的几处是缺失或错的：

| 位置                                         | 现状                                               | Linux 结果                       |
| -------------------------------------------- | -------------------------------------------------- | -------------------------------- |
| `electron/main.ts:248-254`                   | 退出流程仅 `darwin`                                | 安装器落地时应用不退出           |
| `electron/main.ts:384-391`                   | 开机自启 `supported = darwin \|\| win32`           | 托盘“开机启动”永久灰置           |
| `electron/main.ts:1233`                      | `titleBarStyle: darwin ? "hiddenInset" : "hidden"` | Linux 忽略该选项 → 双标题栏      |
| `electron/main.ts:1383`                      | `window-all-closed` 非 darwin 只置空引用           | 常驻后台且可能无托盘             |
| `electron/main.ts:1524-1526`                 | 打包后 `Menu.setApplicationMenu(null)`             | 失去 Ctrl+Q 等加速键             |
| `electron/tray-icon.ts:70-74`                | 非 mac/win → `favicon-{light,dark}.png`（16px）    | 托盘图标过小                     |
| `electron/main-window-size.ts:27`            | 非 win32 → 1440×940 / min 1100×720                 | 小屏设备窗口过大，且无边界持久化 |
| `electron/release-data-reset.ts:256,299,313` | 白名单 darwin/win32                                | Linux 无数据重置逃生通道         |
| `electron/update-relaunch.ts:534-537`        | 非 win/darwin → `spawn(installerPath)`             | 执行 0644 文件 → `EACCES`        |
| `electron/update-manager.ts:436-448`         | `requiredKeys` 恰好 4 个                           | **封闭契约**（P0）               |

### 2.2 已确认**无需改动**的部分

- `electron/after-pack.cjs`：非 darwin 早退，`resourcesDirectory()` 已支持 Linux。
- `electron/dev-runner.mjs` + `scripts/npm-spawn.mjs`：非 win32 走 `npm`，纯 `node:path`。
- `electron/local-web-server.ts`：绑定 `127.0.0.1` + 精确 Host/origin 校验，平台中立。
- `electron/reload-shortcut.ts`：`F5` 与 `Ctrl+R`/`Cmd+R` 均已覆盖。
- 项目内**不存在** `shell.showItemInFolder`、`app.relaunch`、`vibrancy`、`titleBarOverlay`、`globalShortcut`、`systemPreferences`、`app.setJumpList`。
- 密钥存储是文件版 AES-256-GCM（`file-secret-codec.server.ts`），平台中立；`safeStorage` 端口已声明但**从未被调用**，故 Linux keyring/`basic_text` 的坑暂不影响现有功能。

### 2.3 原生依赖（构建期，非运行期）

本机 `node_modules` 只安装了 darwin 二进制：

```
@resvg/resvg-js-darwin-x64        # 图标生成脚本
@tailwindcss/oxide-darwin-x64     # Tailwind v4 引擎
lightningcss-darwin-x64           # CSS 压缩
```

这些都是 **optionalDependencies 形式的平台预编译包**，`npm ci` 会在 Linux 上自动装 `*-linux-x64-gnu`。结论：

- **Linux 构建必须在 Linux（或容器）上执行 `npm ci`**，不能在 macOS 上交叉打包。
- **不要在同一次 CI 里同时构建 x64 与 arm64**：单次 `npm ci` 只会装宿主机架构的绑定，给 arm64 打 AppImage/deb 会拿到 x64 的 oxide/lightningcss 而失败。arm64 需要独立的 arm64 runner 或 `npm ci --cpu=arm64 --os=linux` 的独立 job。

### 2.4 发布链路（Linux 必须加入的闭环）

```
electron-builder.yml artifactName
  → release/<文件名>
  → scripts/release-metadata.mjs（sha256 + size，TARGET_FILES 恰好 4 项）
  → release/release-metadata.json
  → ① 桌面端 updater  electron/update-manager.ts
    ② 发布门禁           scripts/verify-release-{contract,artifact-names,asset-agreement}.mjs
    ③ npx CLI            packages/cli/src/cli.mjs
    ④ README 下载链接     scripts/verify-readme-release-links.mjs
    ⑤ Homebrew cask      scripts/generate-homebrew-cask.mjs（mac 专用，无需 Linux cask）
```

当前**恰好 4 个 key 被硬编码在 8 个地方**，改一处漏一处就会静默失败：

| 文件                                        | 位置                                | 当前值                                                                   |
| ------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `electron/update-manager.ts`                | `:436-448`                          | `requiredKeys` 4 个，多一个即整份拒绝                                    |
| `scripts/release-metadata.mjs`              | `:30-35`                            | `TARGET_FILES` 4 项                                                      |
| `scripts/verify-release-contract.mjs`       | `:34-39`、`:128-152`                | `RELEASE_PLATFORMS` + `expectedReleaseArtifacts()`                       |
| `scripts/verify-release-artifact-names.mjs` | `:22-27`、`:34-37`、`:55-74`、`:78` | 4 个文件名 + 2 个模板 + 正则 `\.(?:dmg\|exe)`                            |
| `scripts/verify-readme-release-links.mjs`   | `:16-21`                            | 4 个下载名                                                               |
| `schemas/release-metadata.schema.json`      | `:37-44`                            | `additionalProperties: false` + `required` 4 个                          |
| `packages/cli/src/release-metadata.mjs`     | `:16-21`、`:155`、`:263-280`        | `SUPPORTED_PLATFORMS` + `win32 ? .exe : .dmg`                            |
| `packages/cli/src/cli.mjs`                  | `:42`、`:635-659`                   | `SAFE_INSTALLER_NAME` 仅允许 `.dmg\|.exe`；`openInstaller` 对 linux 抛错 |

---

## 3. 目标与非目标

### 3.1 目标

1. Ubuntu 22.04+ / Debian 12+ / Fedora 39+ 上可安装、可启动、可用的桌面应用。
2. 提供 **AppImage（免安装、全发行版）** 与 **deb（系统集成）** 两种产物。
3. 应用内自动更新在 Linux 上可用（含 AppImage 就地升级）。
4. 原生外观：单一标题栏、托盘图标清晰、任务栏图标与分组正确。
5. 发布链路（元数据、CI、校验脚本、文档、CLI）与 mac/win 同等完整，**且不破坏已发布客户端的更新能力**。

### 3.2 非目标（首发不做）

- arm64 / snap / flatpak / rpm / pacman 产物。
- Linux 下的开机自启（XDG autostart）——首发可接受“菜单项隐藏”。
- `safeStorage` / libsecret 集成（当前代码路径未使用）。
- 全局快捷键注册。
- Wayland 原生会话（保持 X11/XWayland，提供可选开关）。

---

## 4. 关键决策与取舍

### 4.1 【最重要】更新元数据契约的演进策略

**约束**：`electron/update-manager.ts:436-448` 要求 artifact 映射**恰好**包含 4 个 key，多一个就 `return null`。链路后果：

```
metadataArtifactOf() → null
  → update-manager.ts:801  throw new Error("metadata-invalid")
  → :808-815               status: "error", errorCode: "download"
```

即：**在 `release-metadata.json` 中加入 `linux-x64` 会让所有 1.0.3/1.0.4 用户（macOS 与 Windows 用户！）的自动更新永久失效**，因为此后每个 release 都携带该 key。
这不是理论风险——`electron/update-manager.test.ts:442-520` 就用 `linux-x64` 当“未知平台”断言它必须被拒绝。

**方案对比**

| 方案                  | 做法                                                                                               | 优点                                                          | 缺点                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A. 双文档（**推荐**） | 新增独立资产 `release-metadata-linux.json`（含 `linux-x64`）；主文档保持 4 key。客户端容忍未知 key | 老客户端不读新文件 → **1.0.4 继续能更新**；Linux 可同版本首发 | 需要客户端同时发“容忍版”校验器；Linux 需要读第二份文档                      |
| B. 两版本节奏         | 版本 N 只发容忍版校验器，N+1 才加 `linux-x64`                                                      | 逻辑最简                                                      | Linux 延后一个版本；且 N 的客户端仍会因 N+1 的 key 全部失效（除非已升到 N） |
| C. 直接加 key         | —                                                                                                  | —                                                             | ❌ **禁止**，破坏所有存量客户端                                             |

**采纳方案 A**，并在同一版本内让校验器变成“宽容”模式：

1. **必需 key** = 原有 4 个（保证 mac/win 语义不变）。
2. **未知 key** 不再导致整份拒绝，改为：形状匹配 `^(darwin|win32|linux)-(arm64|x64|ia32)$` 时**忽略**（不参与必需性判断），否则仍拒绝。
3. Linux 的产物选择**优先读 `release-metadata-linux.json`**（存在即用其 sha256 强校验）；文件缺失时回退到「按固定命名 + 扩展名 + 架构别名」的通用资产选择（`selectUpdateAsset` 已支持），仅失去 sha256 元数据比对，仍保留下载后 sha256 校验。

> **注意**：Linux 产物资产本身在第 N 个版本里挂上去是**安全的**。`selectUpdateAsset`（`:529-570`）按扩展名过滤，mac/win 客户端不会选中 `.AppImage`；`verify-release-asset-agreement.mjs` 只校验 `expected ⊆ assets` 与 `metadata ⊆ assets`。

**同步要改的 8 处**见 §2.4 与 §5.4；`schemas/release-metadata.schema.json:37-44` 的 `additionalProperties: false` 需放开为 `patternProperties` 或新增可选 `linux-x64`/`linux-arm64` 属性。

### 4.2 产物格式与命名

**格式选择**

| 格式                          | 采用        | 理由                                                             |
| ----------------------------- | ----------- | ---------------------------------------------------------------- |
| AppImage                      | ✅ 主推     | 免 root、跨发行版、单文件；更新可“就地替换”                      |
| deb                           | ✅ 附带     | 系统集成（desktop 条目、图标、依赖声明）；企业/内网场景常见      |
| rpm / pacman / snap / flatpak | ❌ 首发不做 | snap 需 snapcraft（GH runner 无）；rpm/pacman 增加第二个同类包名 |
| tar.gz                        | ❌          | 无自动集成，用户体验差                                           |

**命名**：`${arch}` 宏在 Linux 上**不是** `x64`：

```
builder-util/out/arch.js → getArtifactArchName(arch, ext)
  x64  → x86_64 (AppImage/rpm/flatpak) | amd64 (deb/snap) | x64 (tar.gz/pacman)
```

所以 `${productName}-Linux-${arch}.${ext}` 会产出 `AITracker-Linux-x86_64.AppImage` 与 `AITracker-Linux-amd64.deb`——**同一平台两个后缀**，破坏“一个平台一个稳定名”的契约（README 链接、元数据、CLI 都依赖它）。

**决策**：使用**字面量架构**，保持无版本号：

```yaml
linux:
  artifactName: "${productName}-Linux-x64.${ext}"
```

产出：

- `AITracker-Linux-x64.AppImage`
- `AITracker-Linux-x64.deb`

未来加 arm64 时，**不要**恢复 `${arch}`，而是用命令行覆盖：`-c.linux.artifactName=${productName}-Linux-arm64.${ext}`，并同步扩展校验脚本。

### 4.3 更新落地策略（Linux 分支）

现状缺陷（`electron/update-relaunch.ts`）：

- `:445` win32 → 写 `.cmd` 脚本隐藏执行；`:494` darwin → 写 0755 shell 脚本挂载 DMG 换 bundle；**Linux 掉到 `:534-537`** `{ command: installerPath, args: [] }`。
- 而下载产物由 `update-manager.ts:311` 的 `createWriteStream(path, { flags: "wx" })` 创建 → 权限 `0644`。全仓库唯一的 `mode: 0o755` 在 `:513`，只给 macOS 脚本。
- `spawn()` 的 `EACCES` 是**异步**的，落在 `:543-547` 的 `.on("error")`，而 `:549-552` 已经 `return { launched: true, method: "spawn" }`。
- 于是 `main.ts:238-247` 的 `shell.openPath` 兜底分支**永远不会被执行**，UI 也认为安装已开始。

**设计**

```ts
// electron/update-relaunch.ts 新增方法（并入 :9-16 的 method 联合类型）
"linux-appimage-swap"; // AppImage 就地替换后重启
"linux-package-open"; // deb/rpm 交给系统包管理器
"linux-manual"; // 兜底：打开文件所在目录，让用户手动安装
```

**(a) AppImage —— 就地替换（对齐 macOS 体验）**

1. 目标路径取 `process.env.APPIMAGE`（**不是** `process.execPath`！AppImage 下 `execPath` 是 `/tmp/.mount_XXXX/aitracker` 这种每次运行都变的临时挂载点，既不能替换也无法用于重启）。
2. 生成 0755 的 hand-off 脚本：等待主进程退出 → `cp`/`mv` 新 AppImage 覆盖 `$APPIMAGE` → `chmod +x` → `"$APPIMAGE" --force-run &`。
3. 复用 macOS 已有的 `buildMacHandoffCommand` 结构（等待 PID、重试、回滚）。

**(b) deb / rpm —— 交给系统**

- 首选 `openPathFn(installerPath)`（`shell.openPath` → `xdg-open` → 软件中心）。
- `xdg-open` 在精简发行版上对 `.deb` 常返回非空错误串 → 兜底 `shell.showItemInFolder()` 并让 UI 明确提示“已下载到 <路径>，请手动安装”。
- **绝不**自动 `sudo`。在 UI 上给出可复制的命令：`sudo apt install ./AITracker-Linux-x64.deb`。

**(c) 前置校验（关键）**

在返回 `launched: true` **之前**必须完成：

```
chmod(installerPath, 0o755) → access(installerPath, X_OK)
```

失败则 `return { launched: false, reason }`，让 `DesktopUpdateDialogs` 能显示真实错误。这是修复“静默无反应”的核心。

**配套改动**

- `main.ts:248-254` 的“更新前退出”条件从 `darwin` 扩为 `darwin || linux`（AppImage 场景必须让位）。
- `main.ts:235` 的下载目录：Linux 改用 `$XDG_CACHE_HOME/aitracker/updates`（或 `userData/updates`，0700）。`/tmp` 在 Linux 上常是 `tmpfs`（吃内存）且可能 `noexec`，100–200MB 的包放这里既浪费又可能无法执行。
- `DesktopUpdateDialogs.tsx:132,150` 的三分支文案（`updateRestartBodyMac` / generic / 新增 Linux）。
- `update-manager.ts:525` 的 `".tar.gz"` 建议从 `extensionsFor` 移除（可选但不可安装，属于陷阱）。

### 4.4 打包与系统集成

```yaml
# electron-builder.yml —— 追加在 nsis: 之后
linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
  # deb 必填：package.json 无 author 字段，fpm 会以 authorEmailIsMissed 直接失败
  maintainer: AITracker Maintainers <maintainers@example.com>
  vendor: AITracker
  category: Development
  synopsis: AI development asset dashboard
  description: Local-first dashboard for AI token usage, cost, skills and memory.
  # 必须限定在 linux: 下。根级 executableName 会连带改掉 macOS 的 productFilename
  executableName: aitracker
  # 用目录形式的 NxN.png（.icns/.ico 在 Linux 不可用）。
  # 目录形式会被原样采纳，从而避免下载 electron-builder 的 icons@1.1.0 工具集
  icon: build/native-icons/linux
  artifactName: "${productName}-Linux-x64.${ext}"
  desktop:
    entry:
      Name: AITracker
      Comment: AI development asset dashboard
      Categories: Development;
      StartupWMClass: AITracker # 必须与 app.setDesktopName 的 app_id 一致
deb:
  priority: optional
  depends:
    - libgtk-3-0
    - libnotify4
    - libnss3
    - libxss1
    - libxtst6
    - xdg-utils
    - libatspi2.0-0
    - libuuid1
    - libsecret-1-0
    - libgbm1 # Electron 硬依赖，libgtk-3-0 不会带入
    - libasound2 | libasound2t64 # 24.04 起改名
    - libxkbcommon0
    - libxdamage1
    - libxcomposite1
    - libxrandr2
    - libcups2
    - libdrm2
    - libpango-1.0-0
    - libcairo2
appImage:
  artifactName: "${productName}-Linux-x64.${ext}"
```

**要点说明**

- **`linux.icon` 不设的后果**：`LinuxTargetHelper.js:165-180` 的 `sources = [linux.icon, mac.icon ?? config.icon]` → Linux 会**静默继承 `mac-app.icns`**（带白色底板的 Dock 美术），并且需要联网下载 `icons` 工具集做转换。必须显式设置。
- **图标目录命名规则**：`iconConverter.js:150-179` 要求 `^(\d+)(?:x\d+)?\.png$`（`512.png` 或 `512x512.png` 都可）。安装路径为 `/usr/share/icons/hicolor/${size}x${size}/apps/aitracker.png`，**1024 会产生非标准的 `hicolor/1024x1024/`**，故上限取 512。
- **`afterPack`**：无需改动，`electron/after-pack.cjs` 在非 darwin 早退，且已执行 license 文件拷贝。
- **`app.setDesktopName`**：在 `app.whenReady()` 之前调用 `app.setDesktopName("com.aitracker.desktop.desktop")`（或写入 `package.json` 的 `desktopName` + `linux.syncDesktopName: true`）。该值即 Wayland `app_id` / X11 `WM_CLASS`。Electron 43 文档明确指出未设置时会回退到“应用名的小写连字符 slug”，**不是一个有效的 portal 身份**；`xdg-desktop-portal ≥1.21` 会拒绝对没有对应 `.desktop` 的 app_id 建立会话（影响 `main.ts:1041-1066` 的三处目录选择器）。
  > ⚠️ **不要**给 `package.json` 加 `productName`——那会改变 `app.getName()` → `app.getPath("userData")`，从而**搬走 macOS/Windows 的现有用户数据**。用 `setDesktopName` 或仅 `desktopName` 字段。

### 4.5 Sandbox 策略（Linux 特有）

两个 BrowserWindow 都设了 `sandbox: true`（`main.ts:527, 1244`），全仓库**没有任何** `app.commandLine.appendSwitch`、`--no-sandbox` 或 `ELECTRON_DISABLE_SANDBOX` 处理。

Linux 上 Chromium 需要三者之一：SUID `chrome-sandbox`（root:root 4755）、非特权 user namespace、或 `--no-sandbox`。

| 场景                  | 状况                                                                   | 对策                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| deb                   | electron-builder 的 fpm 目标会正确设置 `chrome-sandbox` 4755 root:root | 加校验：`verify-linux-packages.mjs` 断言其权限位                                                                                                                   |
| AppImage              | SUID 无法穿过 FUSE/squashfs 挂载                                       | AppRun 会检测 user namespace；Ubuntu 23.10+/24.04 因 AppArmor 限制会退化。**必须文档化** `--appimage-extract-and-run` 与 `ELECTRON_DISABLE_SANDBOX=1` 两条逃生路径 |
| `npm run dev:desktop` | npm 安装的 `chrome-sandbox` 非 root 所有                               | dev-runner 在 Linux 上追加 `--no-sandbox` 或文档化                                                                                                                 |

**启动期兜底**：`app.requestSingleInstanceLock()`（`main.ts:1374`）先于窗口创建，sandbox 硬中止会留下**无窗口、无对话框、残留单实例锁**的状态。需在 `main.ts` 早期加一层 env 检测 + `dialog.showErrorBox` 友好提示。

### 4.6 Wayland 与窗口装饰

**决策：默认 X11/XWayland，Wayland 作为可选开关。**

`electron.d.ts`（Electron 43）明确标注的 Wayland 限制：

| API                              | 位置                                    | Wayland 行为                                       |
| -------------------------------- | --------------------------------------- | -------------------------------------------------- |
| `setPosition`                    | `main.ts:631`（`positionWidgetWindow`） | **不支持**；悬浮挂件完全依赖它                     |
| `getBounds` / `getContentBounds` | `main.ts:615-616`                       | 返回 `{x:0,y:0,…}`，工作区计算不可靠               |
| `moveTop()`                      | `main.ts:466`（每次 `showMainWindow`）  | **不支持**                                         |
| `center()`                       | —                                       | **不支持**                                         |
| `isMinimized` / `restore`        | `main.ts:461-463`、`893-896`            | “minimized 不是受支持状态”，自绘最小化按钮可能无效 |

**窗口装饰（P1 修复）**

```ts
// main.ts:1228-1233
mainWindow = new BrowserWindow({
  ...
  // titleBarStyle 在 Linux 被忽略，只有 frame:false 能去掉装饰
  ...(process.platform === "darwin"
    ? { titleBarStyle: "hiddenInset" as const }
    : { frame: false }),
```

不改的后果：GNOME/KDE 下出现 GTK 标题栏 + 应用自绘 36px 标题栏（`styles.css:1133` 的 `-webkit-app-region: drag`），两套窗口按钮。

**配套**：`WindowChrome.tsx:80-83` 增加 `onDoubleClick → toggleMaximizeWindow()`——无边框窗口的双击最大化在 Linux（和 Windows）不会自动生效。

---

## 5. 详细设计

### 5.1 Workstream A：构建与打包（P0）

1. **`electron-builder.yml`**：按 §4.4 追加 `linux:` / `deb:` / `appImage:`。
2. **图标生成器** `scripts/generate-native-icons.mjs`：
   - 新增 `const LINUX_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]`（**不含 1024**）。
   - 在 `outputNames`（`:42-57`）登记 `linux/${n}x${n}.png`，使 `isCurrent()`（`:171-189`）能检测缺失并重新生成。
   - 在 `generateNativeIcons()`（`:266-297`）内 `mkdir(staging/linux)`，对每个尺寸写 `renderPng(compactArtwork(artworks.light), size, 96)`——用**透明底**的 Windows 风格图形，**不要**用 `macAppArtwork`（白底板）。
   - `manifest.json` 的 `version` 由 5 升到 6（`:160`），并记录 `linuxSizes`，强制旧目录树重建。
   - 现有 staging → rename 流程与 `removeGeneratedDirectory()`（`:192-202`）已能承载子目录，无需改动。
3. **`package.json` 脚本**（对齐 `dist:win:x64` 风格）：

   ```json
   "dist:linux": "npm run build:desktop && electron-builder --linux",
   "dist:linux:x64": "npm run build:desktop && electron-builder --linux AppImage deb --x64 --publish never"
   ```

4. **构建环境约束**
   - CI 使用 `ubuntu-22.04`（glibc 2.35 基线；打包产物的 glibc 下限其实来自下载的 Electron payload，runner 只影响 fpm/AppImage 工具链）。
   - 首次构建会下载 `fpm-1.17.0-ruby-3.4.3-linux-amd64.7z` 与 AppImage 工具集。若需离线可预置 `CUSTOM_FPM_PATH` / `USE_SYSTEM_FPM`；而预置 PNG 图标目录可**完全避免** icons 工具集下载。
   - Ubuntu 24.04 用户需 `libfuse2t64` 或 `--appimage-extract-and-run`（写进 README 与发布说明）。

### 5.2 Workstream B：主进程适配

| 文件                                  | 改动                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.ts`                             | ① 启动早期 `app.setDesktopName(...)`；② 主窗口 `frame: process.platform !== "darwin"`；③ 更新前退出条件加 `linux`；④ 下载目录 Linux 改 XDG cache；⑤ sandbox 中止的友好提示                                                           |
| `tray-icon.ts`                        | 新增 `LINUX_TRAY_ICON_FILENAMES`（22/24 + 44/48），在 `:70-74` 显式选 Linux 分支，不再回退到 16px                                                                                                                                    |
| `tray-title.ts` / `main.ts:873-892`   | 该功能仅 macOS 有效（`Tray.setTitle` `@platform darwin`）。改为返回显式“不支持”，避免渲染进程拿到假成功；或在前端按 `platform` 隐藏该开关                                                                                            |
| `main-window-size.ts`                 | Linux 尺寸按 `screen.getPrimaryDisplay().workAreaSize` 钳制；建议顺带加窗口边界持久化（当前**完全没有** bounds 保存/恢复）                                                                                                           |
| `release-data-reset.ts`               | 三处白名单加入 `linux`（`main.ts:1332-1338` 的确认提示同步）。理由：Linux 用户可能已有 CLI 版本创建的 `~/.aitracker`，而严格的单向迁移检查会让其进入 `startup-failure` 且**无逃生通道**。仍必须走显式确认，不做静默重置              |
| `security-scanner-service.ts:110-175` | 为 Hermes / 豆包 Work / kimi-desktop / Marvis 等补 Linux 后缀（`~/.config/<product>/…`、`~/.local/share/<product>/…`），并把 mac/win 后缀改为按平台条件拼接；`security-skill-roots.test.ts` 的镜像断言同步                           |
| `main.ts` 托盘                        | ① 托盘菜单在自启勾选后**重建**（AppIndicator 是 D-Bus 快照，勾选不会刷新）；② 非 mac 菜单补 Dashboard / Settings 入口——否则 GNOME 下托盘点击被菜单吞掉后用户**无法唤回窗口**；③ `window-all-closed` 在托盘不可用时退出，而非静默常驻 |
| `main.ts:519`                         | 悬浮挂件 `skipTaskbar: true` 是 `@platform darwin,win32`，Linux 无效；改用 Linux 的 `type: "toolbar"`（需在 GNOME/KDE 实测）                                                                                                         |

### 5.3 Workstream C：更新链路

见 §4.3。验收要点：

- 下载产物写盘后**显式 chmod**，或改为以 `0o755` 创建。
- `handOffInstaller` 的 Linux 分支在返回成功前完成 `access(X_OK)` 前置校验。
- `update-relaunch.test.ts` 补齐三个新 method 的用例，并断言 **deb 路径不 spawn、不 sudo**。
- `extensionsFor` 移除 `.tar.gz`（或实现解包安装）。

### 5.4 Workstream D：发布链路与契约

**新增资产 `release-metadata-linux.json`**（§4.1 方案 A）：

- `scripts/release-metadata.mjs` 增加第二个输出（`TARGET_FILES` 主表保持 4 项，Linux 表独立），并同步 `formatChecksums` 的覆盖范围说明。
- 该文件含 `linux-x64`（及未来 `linux-arm64`）。

**8 处 key 集合同步改动**

| 文件:行                                                          | 改动                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `electron/update-manager.ts:436-448`                             | 宽容校验：4 个必需 key 齐备 + 未知 key 形状匹配则忽略；Linux 读第二份文档                                                      |
| `schemas/release-metadata.schema.json:37-44`                     | 放开 `additionalProperties`，新增可选 `linux-x64` / `linux-arm64`                                                              |
| `packages/cli/src/release-metadata.mjs:16-21,52-61,155,263-280`  | Linux key 列入**可选**（放进 `:276` 的豁免集合，否则 Homebrew cask 生成器会在 4-key 元数据上崩）；扩展名规则改按平台映射       |
| `packages/cli/src/cli.mjs:42`                                    | `SAFE_INSTALLER_NAME` 扩展为 `AppImage\|deb\|rpm\|tar\.gz`                                                                     |
| `packages/cli/src/cli.mjs:635-659`                               | 新增 Linux 分支：AppImage → `chmod 0755` + detached spawn；deb/rpm → **打印** `sudo apt install ./…` 并退出 0（绝不自动 sudo） |
| `packages/cli/src/cli.mjs:245-246`                               | 帮助文本 `(darwin or win32)` → 含 linux                                                                                        |
| `scripts/verify-release-contract.mjs:34-39,128-152`              | `RELEASE_PLATFORMS` 加 `linux-x64`；`expectedReleaseArtifacts()` 加条目                                                        |
| `scripts/verify-release-artifact-names.mjs:22-27,34-37,55-74,78` | 加 Linux 名与模板；**必须扩展 `:78` 的正则**（`\.(?:dmg\|exe)` → 含 `AppImage\|deb`），否则顺序校验看不到 Linux 名             |
| `scripts/verify-readme-release-links.mjs:16-21`                  | 加 Linux 下载名（4 个 README 都需链接）                                                                                        |

**CI（`.github/workflows/release.yml`）**

```yaml
- name: Linux x64
  os: ubuntu-22.04
  platform: linux-x64
  command: npm run dist:linux:x64
  artifact_glob: |
    release/*.AppImage
    release/*.deb
  artifact_name: release-linux-x64
```

- 现有 `:138-141`（macOS tag 校验）、`:143-146`（Windows）、`:151-156`/`:158-163`（产物名校验）都是**按 runner.os 分支**的，需补 Linux 分支（或把 macOS 的 `if` 放宽为 `runner.os != 'Windows'`）。
- `draft-release` 的上传 globs（`:272-276`）加 `release/AITracker-Linux-*`；发布说明的下载段落（`:250-255`）加 Linux。
- `ci.yml` **没有**跑 `npm run test:release`——建议补上，否则产物名/顺序的 pin 测试只在本地跑，容易与 `electron-builder.yml` 漂移。

**新增门禁 `scripts/verify-linux-packages.mjs`**（现有脚本只 `stat` 文件名，不检查内容）：

- `dpkg-deb -I` 断言 `Maintainer:` 非空、`Depends:` 含预期项。
- `dpkg-deb -c` 断言包含 `/opt/AITracker/aitracker`、`/usr/share/applications/*.desktop`、`/usr/share/icons/hicolor/*/apps/aitracker.png`。
- 若环境有 `desktop-file-validate`，校验解包出的 `.desktop`（electron-builder 自己不会跑）。
- 断言 `chrome-sandbox` 为 4755 root:root。

### 5.5 Workstream E：渲染进程与产品功能

**先决条件：渲染进程目前根本没有“平台”这个值。** 全仓库只有两处平台探测：

| 机制           | 位置                                                                                   | 取值空间          | Linux 现状                                                                 |
| -------------- | -------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------- |
| 标题栏 UA 嗅探 | `WindowChrome.tsx:21-23`（`/Mac\|iPhone\|iPad/` 且非 `Windows\|Linux`），用于 `:48-54` | 二元 `isMac`      | Linux UA `X11; Linux x86_64` → `isMac=false` → **“恰好”**落入 Windows 分支 |
| 一次性异步 IPC | `DesktopUpdateDialogs.tsx:50-55`（`getRuntimeInfo()`），用于 `:132`                    | `NodeJS.Platform` | Linux **静默复用 Windows 文案**                                            |

`getRuntimeInfo()` 在整个渲染进程只被调用一次；没有任何 `.tsx` 读取 `PUBLIC_TOOL_MANIFEST` 里已有的 `platforms` 字段。

#### 5.5.1 平台值下沉（P1 基础设施）

单一数据源方案：

1. 在 SSR 载荷 `RootLoaderData`（`src/app/root-route-config.ts:26-53`）中加入 `platform`。**桌面模式下本地 Web 服务器就运行在 Electron 主进程内**，`process.platform` 同步可知且 hydration 稳定。
2. 按 `useTheme()` 的既有形态（`src/lib/theme.tsx:72-78`）提供 `usePlatform()`。
3. 删除 `WindowChrome.tsx` 的 UA 嗅探，改由 `usePlatform()` 驱动三分支 `mac | win | linux`。
4. **命名注意**：浏览器伴生模式下服务端可能不是用户本机，字段应命名为 `hostPlatform`，未知时回退 `"unknown"`。

> `vite.config.ts` 目前没有 `define`/`VITE_*`，`src/` 中也没有 `import.meta.env`，所以**构建期常量这条路当前不通**，必须走 SSR 载荷。

#### 5.5.2 三分支改造点

| 位置                                     | 改动                                                                                                                                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WindowChrome.tsx:77-124`                | `isMac` → 三值；`MAC_TRAFFIC_LIGHT_INSET = 78`（`:11,82`）仅 mac 生效；Linux 走右侧窗口按钮分支但需 `frame:false` 配合（见 §4.6）                                                                                                             |
| `WindowChrome.tsx:60-67`                 | `desktop.isWindowMaximized()` / `onWindowMaximizedChanged()` **无 `typeof` 守卫**，且 `.catch()` 只兜 Promise rejection——preload 若裁剪了窗口方法会**同步抛错并让整个标题栏空白**。需加能力检测（`native-tray-title-sync.ts:49-52` 同样问题） |
| `WindowChrome.tsx:80-83`                 | 加 `onDoubleClick` → 最大化切换                                                                                                                                                                                                               |
| `DesktopUpdateDialogs.tsx:132,147-156`   | `isMac` 二分支 → 三分支。当前 Linux 会看到 `updateRestartBody`（描述 UAC“选择是/继续”），与 Linux 实际流程不符                                                                                                                                |
| `src/components/AppShell.tsx:81,111,233` | 保留 36px 高度预留（`WindowChrome.tsx:8`）；若 Linux 改为原生装饰则需同步调整                                                                                                                                                                 |

#### 5.5.3 悬浮挂件（macOS 专属功能）在 Linux 上的处理

整条挂件通路在 Linux 上**不可达但仍在轮询**：

- `NativeTrayTitleSync.tsx:28-46` 只要 `window.desktopApi != null` 就启用两个 query，`refetchInterval` 60 秒；`native-tray-title-sync.ts:41-53` 持续推送标题。
- 但 `Tray.setTitle` 是 `@platform darwin`，`main.ts:873-877` 对非 darwin 直接早退（见 §5.2）。
- `/widget` 路由除非带 `?mode=float` 否则重定向（`src/routes/widget.tsx:8-19`）；`openWidgetWindow` **在渲染进程没有任何调用方**（全仓库只有 `electron/contracts.ts:451`、`preload.cts:93-94`、`main.ts:869` 三处定义）。
- 然而 `JarvisWidget.tsx:505` 仍渲染 `WidgetConfigPanel sections={["bar","panel"]}`，其选项描述的是“菜单栏”（`en-US/widget.ts:97`）与桌面挂件。

**决策**：首发把该面板与轮询按 `hostPlatform === "macos"` 关闭（或改用 `RuntimeInfo` 里的能力标志）。挂件若要上 Linux，需先补一个 Linux 可见的入口（托盘菜单项 / 设置页按钮），属于 M5 的独立课题。

另：挂件依赖合成器透明（`backdrop-filter`，`glass-overview-widget.css:20-21`、`styles.css:714,1264,2721`），而唯一的降级开关 `@media (prefers-reduced-transparency: reduce)`（`glass-overview-widget.css:474-479`）**在 Chromium 中未实现**，任何平台都不会触发。在无合成 WM 的 Linux 桌面上会渲染成不透明/黑色圆角块。修法：把模糊改为渐进增强，给玻璃面加不透明底色（照抄该 media block 的内容即可）。

#### 5.5.4 i18n 与快捷键提示

| 位置                                                                                      | 改动                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/i18n/locales/*/distill.ts`（en `:66,68`、zh `:62,64`、ja `:65,67`、ko `:63,65`） | 硬编码 `"⌘↵ to run"`。绑定处 `DistillConfig.tsx:765-774` 已经是 `metaKey \|\| ctrlKey`，所以 Linux 用户看到 ⌘ 但 Ctrl 生效。改为 `{mod}` 占位符并传 `isMac ? "⌘" : "Ctrl"` |
| `src/lib/i18n/locales/*/sources.ts`（en `:101`、zh `:97`、ja `:100`、ko `:100`）          | `"press ⌘⇧. inside the macOS dialog"` → Linux 的 GTK 选择器用 **Ctrl+H**；建议按平台选文案，`DataDirectoryModal.tsx:151-153` 渲染处同步                                    |
| `src/lib/i18n/locales/*/reports.ts`（en `:103`、zh `:97`、ja `:97`、ko `:99`）            | 调度器关闭提示**字面写着“use the macOS/Windows app”**，Linux 用户必然看到（见 §5.8）                                                                                       |
| `src/lib/i18n/locales/*/widget.ts:97` 等                                                  | `"Menu bar"` 在 Linux 应表述为系统托盘/状态区                                                                                                                              |

> **i18n 机制约束**：`src/lib/i18n/schema.ts:15-16` 以 **zh-CN 为唯一真源**派生 `MessageKey`/`MessageParams`，en/ja/ko 是 `satisfies Translations`。新增 `{mod}` 占位符必须**先改 zh**，再同步另外三个语言包，最后跑 `npm run check:i18n`。注意 `check-translations` / `check-locale-sync` / `check-hardcoded-text` 都**不认识平台或 ⌘**，漏改语言包不会被现有脚本拦住。

#### 5.5.5 主题、语言与滚动条

| 项                         | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **主题（需处理）**         | 默认 `DEFAULT_THEME = "system"`（`theme.tsx:43`），权威判据是 `matchMedia("(prefers-color-scheme: light)")`（`:85-111`），而 CSS 是**暗色优先**（`styles.css:344-346`）。Electron/Chromium 在 Linux 上从 XDG portal 的 `org.freedesktop.appearance color-scheme` 或 GTK 主题取值；**精简 WM / 容器中会回退为 light**，于是 Linux 首启渲染的是较少被验证的亮色主题。建议：主进程读 `nativeTheme.shouldUseDarkColors`，向 SSR 载荷传三态（`dark\|light\|unknown`），或在 Linux 首启把默认持久化为 dark                                                    |
| **系统语言（需处理）**     | `locale.ts:80-95` 的 `mapSystemLocale` 对未知前缀或 `null` **回退到 `zh-CN`**。Linux 上 `LANG=C`、`LANG=POSIX` 或未设置 locale（容器/CI/极简会话）是常态 → 非中文用户看到中文界面。应把 `c`/`posix`/空值视为“未知”，回退 en-US                                                                                                                                                                                                                                                                                                                          |
| **字体（无需改动）**       | `styles.css:143-145` 用打包进产物的 `@fontsource-variable/*`（Inter / Noto Sans SC / JetBrains Mono），**不请求 `-apple-system`/`Segoe UI`**，Linux 无需补字体名，也保持离线优先。`-webkit-font-smoothing: antialiased`（`:360`）是 macOS 专有属性，Linux 忽略（文字略粗，属可接受差异）                                                                                                                                                                                                                                                                |
| **滚动条（小回归）**       | 全仓库只有一条 `::-webkit-scrollbar` 规则且作用是**隐藏**滚动条（`styles.css:1269,1274-1276`），**没有 overlay 假设**；`scrollbar-width: thin` + `scrollbar-color`（`:956-969`）在 macOS 是 no-op、在 Linux 生效，方向正确。残留问题：少数 `overflow-*-auto` 轨道没有留 gutter（`report markdown.tsx:177`、`SkillReportModal.tsx:431`、`aitracker.tsx:271`、`SkillDetailModal.tsx:347,393`），且 `.dashboard-tool-rail` 的 `padding-bottom: 0.25rem`（`:1780-1786`）小于经典滚动条宽度会被裁切。加 `scrollbar-gutter: stable` 并把 padding 提到 ≥0.5rem |
| **Playwright（无需改动）** | 7 个 `playwright.config.*.ts` **不含**任何 macOS Chrome/Electron 路径、`Applications/`、`executablePath` 或 `channel`；统一用 `devices["Desktop Chrome"]` + Vite dev server + `tmpdir()`。仅在 Linux 上需注意硬编码端口 41737–41741                                                                                                                                                                                                                                                                                                                     |

#### 5.5.6 数据根目录的决策

- 实际落盘：`$HOME/.aitracker/data/aitracker.v1.db`（`composition.server.ts:267` → `database-runtime.server.ts:46,63`；Electron 侧由 `main.ts:1459-1463` 从 `app.getPath("home")` 播种 `AITRACKER_USAGE_HOME`）。**不是 XDG 路径**，且 `src/` 中的 `XDG` 只出现在**工具路径基**（`loader.ts:65-68`），不涉及应用数据。
- **决策：保持 `$HOME/.aitracker` 不变。** 理由：该值被显式标注为兼容敏感（`app-config.ts:13-19`“existing installs store real data under `~/.aitracker`”），且已在 UI 与文档中露出（`settings/model.ts:10`、`settings.dataPath`、`sources.ts:101`）；应用数据的 XDG 迁移**没有迁移器**，静默搬家会丢历史数据。若要 XDG 合规，应作为独立课题，在**单一根解析器**后面实现（`$XDG_DATA_HOME/aitracker` 或 `~/.local/share/aitracker`），并把两个环境变量一起接过去。
- **偏好设置无需 XDG 决策**：所有偏好（主题、locale 模式、货币、settings.v1、挂件、更新忽略、安全扫描计划与历史、工具数据目录）都存在同一数据根下的 SQLite 表里（`preferences/client.ts` → server-fns → repository）。`src/` 中**没有 `localStorage`**，Electron 侧也没有 JSON 偏好文件。
- **顺带修一个既有 bug**：`AITRACKER_HOME`（`modules/settings/data-lifecycle.server.ts:56-59`）**只影响设置页的存储占用读数**，不影响真实 DB 路径，而扫描器用的是 `AITRACKER_USAGE_HOME`。结果是 playwright 下设置页测量的是开发者的真实 `~/.aitracker`（数字错误）。两个解析器应统一——这也正是将来做 XDG 化的天然接缝。

### 5.6 Workstream F：工具注册表扫描（功能对等）

这是“Linux 版功能完整度”的核心，也是**已铺好路**的部分。

1. `src/lib/tool-registry/definitions/_shared/platform-profiles.json`：`xdgFallback` 已定义（`:16-19`，`configHome: ~/.config`、`dataHome: ~/.local/share`），`basePlatforms` 已把 `configHome`/`dataHome` 映射到 `macos`/`linux`（`:13-14`）。**关键只在一处**：`:23` 的 `defaultStatus.linux` 目前是 `"planned"`，需按工具逐个升级为 `"supported"`（各工具的 `definitions/*.tool.json` 里也有各自的 `linux` 状态，如 `claude-code.tool.json:14`）。
2. `resolvePlatformPlan()`（`registry.ts:559-562`）/ `resolvePlatformPaths()`（`:599-601`）对 `planned` 直接返回空路径列表——这就是“Linux 什么都不扫”的根因，**不需要写新代码**，只需要数据与验证。
3. **改完必须重新生成**：`npm run generate:manifest`（产出 `public-manifest.generated.ts`）并跑 `npm run verify:tool-registry`，否则生成物与定义漂移。
4. **要么真支持，要么诚实展示。** 保持 `planned` 的现状下，Sources 页会把每个工具渲染成“未安装” / “No safely displayable directory found”（`get-usage-sources.ts:133-143`、`sources/query/presentation/index.tsx:342,408-421`），用户无法区分“没装”和“不支持”。如果首发来不及逐项验证，应改为读取 `PUBLIC_TOOL_MANIFEST` 的 `platforms.linux` 并显示“Linux 支持计划中”徽标。
5. **一个连带不一致（需一并修）**：数据目录按钮的可用性 `dataDirSupported` 只看 targets **不看 status**（`tool-data-root.server.ts:154-176` → `sources/query/api.server.ts:208-215`），写入路径也接受目录（`tool-data-directory.server.ts:67-87`），但这个目录**永远不会被扫描**。`planned` 状态下应禁用该入口。
6. `src/lib/tool-registry/__baseline__/baseline.ts` 是快照文件，会随生成流程更新。

### 5.7 Workstream G：技能（Skills）路径解析

这是比工具扫描更容易被忽略的一处**功能性缺陷**（仅在自定义 XDG 变量时暴露，但 Linux 上很常见）。

- `resolveAgentRoots`（`local-skills/scanner.server.ts:79-104`）直接使用 `SKILL_AGENT_RULES[].roots`，而这些 roots 来自 `loader.ts:93-118` 的**扁平化投影**：`CONVENTIONAL_PREFIX` 把 `appData → "Library/Application Support/"`、`appDataRoaming → "AppData/Roaming/"`（`:71-76`），XDG 基则被钉死在 `xdgFallback` 默认值（`:103-106`）。
- 环境感知版解析器**已经存在但没被用在这里**：`projectBaseWithEnv`（`loader.ts:150-168`）与 `resolvePlatformPaths(..., "skills", ..., env)`（`registry.ts:587-617`）只服务 usage / detection / sessions；而 `getSkillPlan(toolId, _env)` **忽略了它的 env 参数**（`registry.ts:629-641`）。
- **Linux 后果**：当 `XDG_CONFIG_HOME` / `XDG_DATA_HOME` 为非默认值（Linux 上很常见），技能会被**发现并写入**错误的 `~/.config/…` / `~/.local/share/…`（写入根取 `roots[0]`，`skill-rules.server.ts:48-53`）。默认 XDG 时恰好正确，所以问题只在真实用户环境暴露。
- **改动**：让 `resolveAgentRoots` 走 `resolvePlatformPaths(toolId, "skills", os, env)` 并传入 OS 与 env，保留 `envHome` 的更高优先级。
- `security-scanner-service.ts:110-175` 的镜像表同步补 Linux 后缀（见 §5.2）。

### 5.8 Workstream H：运行时策略（后台任务 / 调度器）

- `src/platform/runtime/contracts.ts:11-20` 定义了 `"linux-planned"`，`:46-49` 的 `SUPPORTED_DESKTOP_PLATFORMS = { macos, windows }`，`:61-63` 因此提前返回 `backgroundTasksEnabled: false`；`src/app/bootstrap.server.ts:79-95` 于是从不启动调度器。
- **用户可见后果**：Reports 页的 `ReportSchedule` 渲染 `schedulerOff` + `schedulerOffHint`，而该提示在 4 个语言包里**字面写着“use the macOS/Windows app”**（`en-US/reports.ts:103` 等）。每个设过计划的 Linux 用户都会看到两条无意义告警，且计划任务永不执行。
- **改动**：Linux 的采集器验证通过后，把 `"linux"` 加入 `:46-49` 的支持集合并删除 `:61-63` 的 `linux-planned` 分支；在那之前，把 4 个语言的提示改为与平台无关的表述（例如“或当前不是桌面版应用”）。
- `src/app/desktop-startup-barrier.ts:16` 对非 darwin/win32 返回 `true`（即“按不支持处理”），而回调只在 darwin/win32 下安装（`composition.server.ts:1146-1156`），所以 Linux 根本走不到。Linux 真正启用时应把这个第三值显式化，否则首启不会等待首次扫描完成。

### 5.9 Workstream I：文档

以下文件都提到“仅支持 macOS/Windows”或“四个安装包”，且部分被 `verify:readme-release-links.mjs` 强制校验：

- `README.md`：`:62`（平台声明）、`:79-86`（下载链接，需加 Linux）、`:96-137`（安装章节，加 AppImage `chmod +x`、deb `sudo apt install ./…`）、`:149-155`（“Linux 不支持”表述）。
- `docs/README_CN.md:74-80`、`docs/README_JA.md:77-83`、`docs/README_KO.md:77-83`：同样的下载列表（4 个 README 都在 `README_PATHS` 中，每个发布名**至少要被其中一个链接**）。
- `packages/cli/README.md:17-19`。
- `docs/DEVELOPMENT.md:96-99,103-108,137-147`、`docs/RELEASE_CHECKLIST.md:106-107,109,120,182`、`CHANGELOG.md:9-19,184`。
- `docs/design/aitracker-架构设计文档.md:148`、`docs/plan/aitracker-敏捷任务清单.md:70`（提到 4-key 元数据结构，会漂移）。
- 交付前跑 `npx prettier --check README.md CHANGELOG.md docs/RELEASE_CHECKLIST.md`（RELEASE_CHECKLIST 的硬性要求）。

---

## 6. 实施顺序与里程碑

顺序由依赖关系决定，**M0 必须最先合并且必须已经发布到用户手上**，否则后续任何 Linux 发布都会打断存量用户的更新。

| 里程碑                    | 内容                                                                                                                                                                  | 依赖      | 验收                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| **M0（前置，独立发布）**  | 容忍版元数据校验器（updater + CLI + schema）；`release-metadata.json` 保持 4 key                                                                                      | —         | 新增测试“未知平台 key 被忽略且 4 个必需 key 仍决定结果”；旧客户端行为不变                                              |
| **M1 打包地基**           | `linux:`/`deb:`/`appImage:` 配置、Linux 图标集、`dist:linux:*`、`setDesktopName`、sandbox 策略、CI Linux job、8 处 key 同步、`release-metadata-linux.json`            | M0 已发布 | 本地/CI 产出 `AITracker-Linux-x64.AppImage` 与 `.deb`；`verify:release-contract`、`verify:release-artifact-names` 通过 |
| **M2 可用性（原生外观）** | `frame:false`、托盘图标尺寸、托盘菜单重建 + Dashboard/Settings 入口、`window-all-closed`、双击最大化、**平台值下沉 + `usePlatform()` + 三分支 UI/i18n**               | M1        | GNOME/KDE 下单一标题栏；托盘可见且能唤回窗口；无 Windows/macOS 文案错位                                                |
| **M3 更新闭环**           | Linux hand-off 三分支、`APPIMAGE` 路径、XDG cache 下载目录、UI 三分支文案、`.tar.gz` 处理                                                                             | M1        | AppImage 就地升级成功；deb 走系统安装；失败时有明确错误提示                                                            |
| **M4 功能对等**           | 工具注册表 `linux: supported` 逐项放开、Linux skill 根、技能 XDG 解析修正、运行时策略放开（后台任务/调度器）、数据重置逃生通道、locale/主题回退修正、开机自启（可选） | M2        | 扫描结果与 mac/win 同源可比；Reports 调度器与提示一致                                                                  |
| **M5 打磨**               | 窗口边界持久化、Wayland 可选开关、通知依赖、X11 工作区跳转、挂件在 Linux 的定位（或明确关闭）、滚动条 gutter、`AITRACKER_HOME`/`AITRACKER_USAGE_HOME` 统一            | M3/M4     | —                                                                                                                      |

**风险最高的两处**，建议在 M1 之后立刻用真实 Linux 机器验证：

1. **sandbox**：AppImage 在 Ubuntu 23.10+/24.04 能否直接启动。
2. **WM 行为**：无边框窗口在 GNOME/KDE 下的拖拽、边缘缩放、双击最大化。

---

## 7. 测试与验收

### 7.1 需要新增/修改的测试（当前 pin 住“双平台”假设）

| 测试文件                                                            | 当前断言                                                              | 需要改成                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `electron/update-manager.test.ts:442-520`                           | 含未知平台 key 的文档**必须被拒**（用 `linux-x64` 当反例）            | “未知 key 被忽略，4 个必需 key 仍决定结果”                                              |
| `electron/update-manager.test.ts:364-441`                           | 4-key 文档被接受                                                      | 保留，并新增宽容用例                                                                    |
| `scripts/verify-release-contract.test.mjs:92-126,174-186`           | `--platform linux-x64` 是**非法值**（`RC_PLATFORM_INVALID`）          | 变为合法；非法值改用 `linux-ia32`                                                       |
| `scripts/verify-release-contract.test.mjs:33-41,188-222`            | `artifacts.length === 4`                                              | 加 Linux 后更新计数                                                                     |
| `scripts/release-metadata.test.mjs:24-29,48-93,114-119`             | 4 文件 → 4 artifact，索引对齐 sha256                                  | 增加 Linux 文件/条目，保持索引映射                                                      |
| `scripts/verify-release-artifact-names.test.mjs:64-91`              | 只渲染 `dmg`+`nsis` 模板并深比较 4 个名字                             | 加 `appImage`/`deb` 段、扩展名映射与 Linux 名                                           |
| `scripts/verify-release-asset-agreement.test.mjs:21-34,92-133`      | `PLATFORM_KEYS`/`PREVIOUS_NAMES` 各 4 项                              | 加 Linux                                                                                |
| `scripts/verify-readme-release-links.test.mjs:16-21,112-129`        | 4 个下载名，fixture 链接全部                                          | 加 Linux 名并链接                                                                       |
| `scripts/generate-homebrew-cask.test.mjs:29-41`                     | 3-key fixture（mac 专用）                                             | **Linux key 保持可选**，此测试不变即证明契约未收紧                                      |
| `packages/cli/test/release-metadata.test.mjs:54-57,92-130`          | `linux-x64` ⇒ `/unknown platform/`；`platformKey("linux","x64")` 抛错 | 反转为接受；扩展名不匹配（`linux-x64` + `.dmg`）仍需失败                                |
| `packages/cli/test/cli.test.mjs:313-331,671-696`                    | `platform:"linux"` ⇒ `/Unsupported platform/`                         | 变为合法（非法值改 `freebsd`）；`openInstaller` Linux 分支断言**不 sudo、deb 不 spawn** |
| `electron/update-relaunch.test.ts`                                  | 只有 win32/darwin 用例                                                | 补三个 Linux method 用例与 `access(X_OK)` 前置校验用例                                  |
| `electron/tray-icon.test.ts:25-38`                                  | 断言 `electron-builder.yml` 的 mac/win 图标                           | 补 `linux:` → `build/native-icons/linux` 断言                                           |
| `electron/release-data-reset.test.ts:175-178`                       | `linux → not-applicable`                                              | 改为“需显式确认才可用”                                                                  |
| `electron/security-skill-roots.test.ts`                             | 镜像断言不含 Linux 根                                                 | 补 Linux 后缀镜像断言                                                                   |
| `scripts/generate-native-icons` 相关测试                            | 无 `linux/` 断言                                                      | 补图标集完整性与尺寸上限（≤512）断言                                                    |
| `src/lib/tool-registry/*.test.ts`、`manifest.test.ts:103-113`       | 断言 `linux: "planned"`                                               | M4 放开后同步为 `supported`                                                             |
| `src/lib/i18n/*.test.ts` + `npm run check:i18n`                     | 无平台占位符用例                                                      | 新增 `{mod}` 占位符后必须四语言同步，否则 `check-translations` 会挂                     |
| `src/lib/i18n/locale.test.ts`                                       | `LANG=C` / 未知 locale 的期望值                                       | 明确改为回退 en-US 的断言                                                               |
| `src/components/WindowChrome.tsx`（`isMacDesktopUserAgent` 纯函数） | 只有 mac/非 mac 用例                                                  | 改为三值分类器用例（UA 嗅探被移除）                                                     |

### 7.2 手工验收清单（Linux 真机）

**安装与启动**

- [ ] AppImage：`chmod +x` 后双击可启动；Ubuntu 24.04 上无需 `--appimage-extract-and-run` 即可运行（否则记录为已知问题并文档化）。
- [ ] deb：`sudo apt install ./AITracker-Linux-x64.deb` 无依赖错误；应用出现在应用菜单且图标正确。
- [ ] 任务栏图标与 `.desktop` 一致，窗口分组正确（验证 `setDesktopName` 生效）。

**界面**

- [ ] GNOME 与 KDE 下**只有一个标题栏**（无 GTK 装饰叠加）。
- [ ] 拖拽移动、边缘缩放、双击最大化、最小化/最大化/关闭按钮全部可用。
- [ ] 深色/浅色主题跟随系统切换正常；**在无 appearance portal 的精简 WM 下首启不会误用亮色主题**。
- [ ] `LANG=C` 或未设 locale 时界面为英文，**不是中文**。
- [ ] 托盘图标清晰（非放大模糊），在深色/浅色面板下均可辨认。
- [ ] 快捷键提示显示 `Ctrl`（非 `⌘`）；数据目录弹窗提示用 Ctrl+H 而非 ⌘⇧.。
- [ ] 悬浮挂件相关配置面板与轮询在 Linux 上不出现/不生效（或已有可达入口）。
- [ ] 经典滚动条下无内容被裁切（工具轨道、报告 Markdown、各弹窗）。

**功能**

- [ ] 工具扫描能发现 Linux 下已安装的 AI 工具（按 M4 放开的清单逐项核对）。
- [ ] 未放开的工具显示“计划中”而非“未安装”（若采纳诚实展示方案）。
- [ ] **`XDG_CONFIG_HOME` / `XDG_DATA_HOME` 设为非默认值时，技能发现与写入落在正确目录**。
- [ ] 数据库正常创建于 `~/.aitracker`，权限为 `0700`/`0600`。
- [ ] 目录选择器可用（验证 portal 未被拒绝）。
- [ ] 浏览器伴生模式（`127.0.0.1` 本地服务）可用。
- [ ] Reports 页无不含“use the macOS/Windows app”字样的误导提示。

**更新**

- [ ] AppImage：旧版本内点击更新 → 下载 → 重启 → 版本号已变更，且 `$APPIMAGE` 路径文件被替换。
- [ ] deb：点击更新 → 明确提示手动安装命令，**不出现静默无反应**。
- [ ] 断网 / 校验失败时错误提示准确。

**回归（不可退化）**

- [ ] macOS 与 Windows 构建产物名不变（`AITracker-macOS-*.dmg`、`AITracker-Windows-*.exe`）。
- [ ] macOS/Windows 的自动更新仍然可用（M0 的直接验收项）。
- [ ] `npm run test:all`、`npm run test:release`、`npm run verify:database`、`npm run check:i18n` 全绿。
- [ ] `npm run typecheck`、`npm run lint` 通过。

---

## 8. 风险登记册

| #   | 风险                                                          | 影响                                        | 概率           | 缓解                                                                                           |
| --- | ------------------------------------------------------------- | ------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| R1  | 误在 `release-metadata.json` 加 `linux-x64` 后发布            | **所有存量 mac/win 用户自动更新永久失效**   | 中             | M0 先行；`update-manager.test.ts` 反向用例改为宽容断言；发布前跑 `test:release`                |
| R2  | AppImage 在 Ubuntu 23.10+ 因 userns 限制无法启动              | 主要分发格式不可用                          | 中高           | 文档化两条逃生路径；M1 后立即真机验证；必要时评估 `toolsets.appimage` 静态运行时（beta）       |
| R3  | 无边框窗口在 GNOME Wayland 下无法移动/缩放                    | 应用不可用                                  | 中             | `frame:false` 先在 X11 验证；Wayland 保持默认关闭并提供开关                                    |
| R4  | 尝试在 x64 runner 上交叉构建 Linux arm64                      | 构建失败（oxide/lightningcss 架构不匹配）   | 高（若尝试）   | 首发仅 x64；arm64 用独立 arm64 runner 或 `npm ci --cpu=arm64 --os=linux` 独立 job              |
| R5  | `verify-release-artifact-names.mjs:78` 的正则未扩展           | 顺序校验静默漏掉 Linux 名，契约漂移         | 中             | 与名字改动同一次提交内完成；CI 补跑 `test:release`                                             |
| R6  | 托盘在 GNOME（无 AppIndicator 扩展）不显示                    | 用户无法唤回窗口（窗口关闭即隐藏）          | 中             | 非 mac 托盘菜单补 Dashboard/Settings；`window-all-closed` 在无托盘时退出                       |
| R7  | `~/.aitracker` 存在旧 CLI 遗留数据触发严格迁移失败            | Linux 首启即 `startup-failure`              | 中             | Linux 加入数据重置白名单（显式确认）；`startup-failure` 对话框提供重置入口                     |
| R8  | Linux 下工具扫描全部为空（`linux: planned`）                  | 功能“能装不能用”                            | 高（若不处理） | M4 逐项放开 `defaultStatus.linux`；这是数据+验证工作，无需架构改动                             |
| R9  | `/tmp` 为 `noexec`/`tmpfs` 导致更新脚本无法执行或吃内存       | 更新失败                                    | 低中           | 下载目录改 XDG cache                                                                           |
| R10 | 新增 `productName` 到 `package.json`                          | **搬走 mac/win 现有用户数据**               | 低（易踩）     | 明确使用 `setDesktopName` / `desktopName`，禁止根级 `productName`                              |
| R11 | 渲染进程始终把非 mac 当 Windows（UA 嗅探 + `isMac` 二值）     | Linux 复用 Windows 文案与分支，UI 语义错误  | 高（必然）     | 平台值经 SSR 载荷下沉 + `usePlatform()`；删除 UA 嗅探                                          |
| R12 | `LANG=C` / 未设 locale 回退 zh-CN                             | 非中文用户首启看到中文界面                  | 中高           | 把 `c`/`posix`/空视为未知，回退 en-US                                                          |
| R13 | 无 appearance portal 的桌面回退 `prefers-color-scheme: light` | 首启误用验证不足的亮色主题                  | 中             | 主进程读 `nativeTheme.shouldUseDarkColors` 传三态；或 Linux 首启默认 dark                      |
| R14 | 自定义 `XDG_CONFIG_HOME`/`XDG_DATA_HOME` 下技能写入错目录     | 技能装到错位置、扫描不到                    | 中             | `resolveAgentRoots` 改走 `resolvePlatformPaths(..., "env")`；修 `getSkillPlan` 忽略 env 的问题 |
| R15 | 挂件/托盘标题在 Linux 上轮询但不可达                          | 无谓 IPC 与定时器；用户看到不可用的配置面板 | 中             | 按 `hostPlatform === "macos"` 关闭面板与轮询                                                   |
| R16 | Reports 调度器提示写死“use the macOS/Windows app”             | Linux 用户看到自相矛盾的告警                | 高（必然）     | 4 语言改为平台无关表述；调度器放开后再改回来                                                   |

---

## 9. 附录

### 9.1 需要 Linux 真机确认的事项

1. electron-builder 生成的 `.desktop` 文件名与 `setDesktopName` 值是否一致。
2. deb 包内 `chrome-sandbox` 的实际权限位。
3. GNOME / KDE 下无边框窗口的拖拽、边缘缩放、双击最大化行为。
4. 有无 `libayatana-appindicator3` 时托盘是否可见。
5. Electron 43 在目标发行版上是否对 `dialog.showOpenDialog` 走 portal。
6. Electron 43 的 Linux 默认是否已是 Wayland（当前假定为 X11/XWayland）。

### 9.2 各 Agent 工具在 Linux 上的存储位置如何确定

这是 M4 的核心工作量，也是最容易做成“凭印象填路径”的一步。**结论：绝大部分工作已经做完了，且不需要靠 Google 猜——每个工具的落点在 `definitions/*.tool.json` 里逐条声明了，而且 46 个工具全都已经带了 Linux 目标。** 真正缺的是**验证**和**对“该工具在 Linux 是否存在”的事实判断**。

#### 9.2.1 声明机制

路径由 `(base, path)` 二元组表达，`base` 只能取以下 6 个值之一（`schema.ts:31-43`）：

| base             | Linux 解析结果                                          | 含义                                    |
| ---------------- | ------------------------------------------------------- | --------------------------------------- |
| `home`           | `$HOME/<path>`                                          | HOME 相对点目录（Linux 上最可靠的一类） |
| `configHome`     | `$XDG_CONFIG_HOME/<path>`，未设时 `~/.config/<path>`    | 配置目录                                |
| `dataHome`       | `$XDG_DATA_HOME/<path>`，未设时 `~/.local/share/<path>` | 数据目录                                |
| `userProfile`    | 仅 Windows（`AppData/`）                                | 对 Linux 无意义                         |
| `appData`        | 仅 macOS（`Library/Application Support/`）              | 对 Linux 无意义                         |
| `appDataRoaming` | 仅 Windows（`AppData/Roaming/`）                        | 对 Linux 无意义                         |
| `env:NAME`       | `$NAME/<path>`                                          | 工具自定义的环境变量根                  |

两条解析路径，**能力不同，这是 D6 缺陷的根源**：

- 环境感知版 `projectBaseWithEnv`（`loader.ts:150-168`）会读 `XDG_CONFIG_HOME`/`XDG_DATA_HOME`（`XDG_ENV_VARS`，`loader.ts:65-68`）。
- 扁平化版 `projectBase`（`loader.ts:93-118`）把 XDG **钉死在 `xdgFallback` 默认值**，而它正是**技能发现与写入**使用的那条路（§5.7）。

> **能力缺口**：`XDG_ENV_VARS` 只登记了 `configHome`/`dataHome`，**没有 `XDG_STATE_HOME`**（`$XDG_STATE_HOME`，默认 `~/.local/state`）。若某工具把状态写在那里，当前 schema 无法表达。目前 46 个工具中无人需要，但扩表时要先补 base。

`env:NAME` 这个 base **当前没有任何工具使用**（grep 零命中）。只有 Codex 和 Grok 通过 `storage.skills.envHome`（`CODEX_HOME`、`GROK_HOME`）声明了自定义根，而 `envHome` 只作用于 skills，**不作用于 usage/detection**——若要覆盖 `CLAUDE_CONFIG_DIR`、`GEMINI_DIR` 一类变量，需要改用 `env:NAME` base 或扩展 `envHome` 的作用面。

#### 9.2.2 五类分型（决定每个工具该怎么处理）

把 46 个工具按“Linux 落点是否已声明、声明得对不对”分成五类。统计基于实际提取的 133 条带 `linux` 目标的路径声明（`home` 93 条 / `configHome` 28 条 / `dataHome` 12 条）：

| 类型                 | 特征                                                                          | 数量 | 处理方式                                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| **T1 HOME 点目录**   | 只有 `home\|.xxx`                                                             | 多数 | **可信，可直接放行**——`$HOME/.claude`、`$HOME/.codex`、`$HOME/.gemini` 在 Linux 上就是唯一位置                               |
| **T2 规范 XDG**      | 已用 `configHome`/`dataHome`                                                  | 少数 | **可信，可直接放行**——`anythingllm`、`opencode`、`zed`、`mimo`、`goose`、`kilo-cli`、`kiro-cli`                              |
| **T3 VS Code 家族**  | `configHome\|<AppName>/User/globalStorage` 或 `<VendorApp>/SharedClientCache` | 9 个 | **需真机验证**：Linux 上是 `$XDG_CONFIG_HOME/<AppName>/User/globalStorage`。`AppName` 必须匹配各家自报的目录名，且大小写敏感 |
| **T4 纯桌面应用**    | 只有 `appData`/`appDataRoaming` 根                                            | 4 个 | **应标 `"unsupported"` 而非 `"planned"`**，见下                                                                              |
| **T5 零 Linux 声明** | 无任何带 `linux` 的路径                                                       | 4 个 | 同上；确无 Linux 版就标 `unsupported`                                                                                        |

**T4/T5 的 4 个工具（无任何 Linux 落点，路径在 Linux 上完全不可解析）**：

`aipy`（`appData|aipy-pro`）、`doubao-work`（`appData|DoubaoWork/Default/.doubaowork/agent_mode/workspace`）、`kimi-work`（`appData|kimi-desktop/daimon-share/...`）、`marvis`（`appData|com.tencent.mac.marvis/MarvisData/User`）。

这四个都是**国产桌面应用**，按现状判断**没有 Linux 发行版**。因此把 `platforms.linux` 从 `"planned"` 翻成 `"supported"` 是**错误的**——会得到一个永远不会命中的路径，用户侧表现为永久的“未安装”。正确动作是 `"unsupported"`，让 UI 诚实展示。

（`trae-work` 是第五个零 Linux 落点者，但它有 `home|.trae`、`home|.trae-cn` 的 mac 声明未带 `linux` 目标——只要给这两条加上 `"linux"` 就有落点了，属于**补一行 targets 的事**，不是缺信息。）

**T3 需验证的具体清单**（VS Code 家族 / vendor 客户端，Linux 上都要确认实际目录名与大小写）：

`cline`、`kilocode`、`github-copilot`、`kiro`、`qoder`、`qodercn`、`roo-code`（`configHome|Code/...` 型）；`cursor`、`codebuddy`（两者已有 `home` 落点可兜底，但 `configHome` 侧的 VS Code 落点同样要确认）。

其中 `kilocode` 最复杂——它声明了 7 个宿主（`Code` / `Code - Insiders` / `Cursor` / `CodeBuddy` / `Windsurf` / `VSCodium` / `Trae`）的 `globalStorage` 根，Linux 上每一个都要独立确认目录名。`cherrystudio`（`configHome|CherryStudio/...`）虽属桌面客户端，但落点是标准的 `~/.config/<App>`，按 T2 处理。

> 共 11 个工具的 Linux 落点用到了 `configHome`，全部需要确认真实目录名与大小写。

#### 9.2.3 如何确定真实位置（四条手段，按可靠性排序）

1. **先查声明**——`definitions/*.tool.json` 里已经写好了，先读再查，避免重复劳动：

   ```bash
   cd src/lib/tool-registry/definitions
   # 某工具的全部 Linux 落点
   node -e 'const d=require("./openclaw.tool.json");
     const walk=o=>{if(!o||typeof o!=="object")return;
       if(Array.isArray(o))return o.forEach(walk);
       if(Array.isArray(o.targets)&&o.targets.includes("linux")&&o.base)
         console.log(o.base+"|"+(o.path||""));
       Object.values(o).forEach(walk)};walk(d)'
   ```

2. **官方文档 / 源码**. 优先找工具是否声明了覆盖变量（`CLAUDE_CONFIG_DIR`、`GEMINI_DIR`、`CODEX_HOME`…）——有变量说明作者本人就把目录当可配置项，同时也提示了默认值。这是**声明 `env:NAME` base 的依据**。

3. **真机实测（最可靠）**——在 Linux 上装好工具、实际跑一次，然后看它落在哪：

   ```bash
   # a) 环境变量 + 实际目录
   env | grep -iE 'XDG|CLAUDE|CODEX|GEMINI'
   ls -d ~/.claude ~/.codex ~/.gemini ~/.config/* ~/.local/share/* 2>/dev/null

   # b) 追踪写入路径（最硬的证据）
   inotifywait -m -r -e create,modify --format '%w%f' ~/.config ~/.local/share ~ 2>/dev/null | head -50
   #    然后在该工具里执行一次真实操作

   # c) 或对进程做一次 strace
   strace -f -e trace=openat,open -o /tmp/tr.txt <tool-cmd> 2>/dev/null
   grep -oE '"/[^"]*"' /tmp/tr.txt | sort -u | grep -E '\.config|\.local/share|/home/'
   ```

4. **交叉验证解析结果**——AITracker 自己的解析器就是最终判据，别靠心算拼路径：

   ```bash
   # 打印某工具在 linux 下的全部解析路径（env-aware）
   node --import tsx -e 'const {resolvePlatformPaths}=await import("./src/lib/tool-registry/registry.ts");
     console.log(resolvePlatformPaths("cursor","usage","linux",process.env))'
   ```

#### 9.2.4 放行判定标准（可机械执行）

一个工具可以标 `"supported"`，当且仅当：

1. 至少有一条带 `linux` 目标的路径，且其 base ∈ {`home`, `configHome`, `dataHome`, `env:NAME`}；
2. 该路径在真机上**实际存在**（或工具在 Linux 上确实存在但当前未安装——此时用类型 1/2 的确定性即可放行，T3 必须实测）；
3. `storage.skills.rootSpecs` 中的 base 对 Linux 可解析——**注意 `appData` 基的 rootSpecs 在 Linux 上会静默失效**，这也正是 §5.2 里 `security-scanner-service.ts` 镜像表要一起改的原因。

推荐的机械校验（可脚本化，纳入 `verify:tool-registry`）：

> 对每个 `platforms.linux === "supported"` 的工具，断言存在 ≥1 条带 `linux` 目标、base 可解析的路径；否则报错。这样“翻了状态却没路径”这类错误会在 CI 被拦住，而不是等用户看到空列表。

#### 9.2.5 建议的放行批次

| 批次         | 范围                                                                          | 前置条件                                                                                                              |
| ------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **第 1 批**  | T1（`home` 点目录）+ T2（规范 XDG）                                           | 无需真机，改 `platforms.linux` + `defaultStatus.linux` 并 `npm run generate:manifest && npm run verify:tool-registry` |
| **第 2 批**  | T3（VS Code 家族 9 个）                                                       | 必须在 Linux 真机逐个确认 `$XDG_CONFIG_HOME/<AppName>/User/globalStorage` 的目录名与大小写                            |
| **第 3 批**  | 补 `trae-work` 的 targets；为 Codex/Grok 之外的 `envHome` 型工具补 `env:NAME` | 需要确认工具是否真的支持该环境变量                                                                                    |
| **永不放行** | T4 的 `aipy`、`doubao-work`、`kimi-work`、`marvis`                            | 改为 `"unsupported"`，UI 诚实展示                                                                                     |

**为什么必须分批而不是一次性全改 46 处**：`platforms.linux` 是**唯一开关**，没有记录“这条路径是否验证过”的元数据。一次性翻 46 个工具 = 同时打开“已确认正确”和“纯属猜测”的路径，用户看到的是不稳定的空列表，且无法从 UI 区分“没装”和“我猜错了”。第 1 批是零风险的确定性收益；第 2 批是真正需要人工的 9 个；T4 应当明确标为不支持，这也是最容易做错、做错后最误导用户的一处。

### 9.3 逐工具 Linux 落点：TokenTracker 参考实现对照表

**证据来源**：`/Users/caows/Documents/Dev/TokenTracker`（该项目已正式发布 Linux 版：AppImage + `.deb` + `.rpm`，见其 `README.md:94`）。其路径解析逻辑分布在 `src/lib/rollout.js`（24,833 行，被动读取器）、`src/commands/sync.js`、`src/lib/usage-limits.js`（凭据/配额文件）与各 `*-config.js`。下表每一行都对应**实际读取过的代码**。

TokenTracker 覆盖了 AITracker 46 个工具中的 **34 个**，因此下表是高置信度的交叉验证来源。

> **重要前提**：TokenTracker 的 XDG 支持是**不完整且不一致的**——只有 6 个模块读 `XDG_CONFIG_HOME`、5 个读 `XDG_DATA_HOME`；`XDG_STATE_HOME` 与 `XDG_CACHE_HOME` 在它的 `src/` 中**从未被读取**。多处代码硬编码 `~/.config`（Qoder、QoderCN、Copilot、arkcli）即使同族的其它模块支持 XDG。因此下表区分“**声明为 XDG 基**”与“**参考实现硬编码 `~/.config`**”两种情况。

#### 9.3.1 已核实并可直接放行（T1 HOME 点目录 / T2 规范 XDG）

| AITracker 工具     | Linux 落点（参考实现）                                                                                                                                                                                                                          | AITracker 现有声明                                                                     | 结论                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude-code`      | `~/.claude/{projects,settings.json,history.jsonl}`；`~/.claude/.credentials.json`（**仅 linux/win32**，macOS 走 Keychain）；`~/.claude.json`                                                                                                    | `home\|.claude`、`home\|.claude/projects`                                              | ✅ 一致                                                                                                                                        |
| `codex`            | `~/.codex/{sessions,archived_sessions,config.toml,auth.json}`                                                                                                                                                                                   | `home\|.codex`、`home\|.codex/sessions`、`home\|.codex/archived_sessions`              | ✅ 一致                                                                                                                                        |
| `acode`（AStudio） | `~/.acode/{sessions,archived_sessions,config.toml}`                                                                                                                                                                                             | `home\|.acode` 等                                                                      | ✅ 一致                                                                                                                                        |
| `every-code`       | `~/.code/{sessions,config.toml}` — 参考实现全仓库只用 `~/.code`（`init.js:610` `codeHome = CODE_HOME \|\| ~/.code`；`sync.js:845-851`），其 `every-code` 只是 `--source` 判别标签（`codex-config.js:19`），**没有任何地方出现 `~/.every-code`** | `home\|.every-code`（detection，含 linux）＋ `home\|.code/sessions`（usage，无 linux） | 🔴 **AITracker 自相矛盾**：同一工具内 detection 与 usage 指向不同目录，且该矛盾**首次提交即存在**。参考实现以 `~/.code` 为准。建议先实测再统一 |
| `gemini-cli`       | `~/.gemini/{tmp,settings.json,oauth_creds.json,skills}`                                                                                                                                                                                         | `home\|.gemini/tmp`                                                                    | ✅ 一致                                                                                                                                        |
| `antigravity`      | `~/.gemini/{antigravity,antigravity-ide,antigravity-cli}/brain/**/transcript*.jsonl`；conversations SQLite                                                                                                                                      | `home\|.gemini/antigravity*`                                                           | ✅ 一致                                                                                                                                        |
| `hermes`           | `~/.hermes/state.db`；profiles `~/.hermes/profiles/<name>/state.db`                                                                                                                                                                             | `home\|.hermes`、`home\|.hermes/state.db`                                              | ✅ 一致                                                                                                                                        |
| `kimi-code`        | `~/.kimi-code/{sessions,config.toml,credentials/kimi-code.json}`                                                                                                                                                                                | `home\|.kimi-code`、`home\|.kimi-code/sessions`                                        | ✅ 一致（AITracker 另有 `~/.kimi`，属 legacy 版，保留即可）                                                                                    |
| `codebuddy`        | `~/.codebuddy/{settings.json,projects/**}`                                                                                                                                                                                                      | `home\|.codebuddy/projects`                                                            | ✅ 一致                                                                                                                                        |
| `workbuddy`        | `~/.workbuddy/{settings.json,projects/**,traces/**}`                                                                                                                                                                                            | `home\|.workbuddy`、`home\|.workbuddy/projects`                                        | ✅ 一致（另有国际版 `~/.workbuddy-ai`，AITracker 未收录）                                                                                      |
| `openclaw`         | `~/.openclaw/{openclaw.json,agents/**}`                                                                                                                                                                                                         | `home\|.openclaw`、`home\|.openclaw/agents`                                            | ✅ 一致                                                                                                                                        |
| `omp`              | `~/.omp/agent/sessions/**/*.jsonl`                                                                                                                                                                                                              | `home\|.omp`、`home\|.oh-my-pi`                                                        | ✅ 一致                                                                                                                                        |
| `omo`              | `~/.omo/agent/sessions/**/*.jsonl`                                                                                                                                                                                                              | `home\|.omo`、`home\|.omo/agent/sessions`                                              | ✅ 一致（已 supported）                                                                                                                        |
| `pi`               | `~/.pi/agent/sessions/**/*.jsonl`                                                                                                                                                                                                               | `home\|.pi`、`home\|.pi/agent/sessions`                                                | ✅ 一致（已 supported）                                                                                                                        |
| `prime-agent`      | `~/.prime/agent/sessions/*.jsonl`                                                                                                                                                                                                               | `home\|.prime`、`home\|.prime/agent/sessions`                                          | ✅ 一致（已 supported）                                                                                                                        |
| `craft`            | `~/.craft-agent/{config.json,workspaces/<ws>/sessions/<id>/session.jsonl}`                                                                                                                                                                      | `home\|.craft-agent` 等                                                                | ✅ 一致                                                                                                                                        |
| `reasonix`         | `~/.reasonix/**/*.jsonl.telemetry.json`（深度 ≤ 8）                                                                                                                                                                                             | `home\|.reasonix` 等                                                                   | ✅ 一致                                                                                                                                        |
| `minimax-code`     | `~/.minimax/v2/sessions/YYYY/MM/DD/<session>/messages.jsonl`                                                                                                                                                                                    | `home\|.minimax`、`home\|.minimax/v2/sessions`                                         | ✅ 一致（已 supported）                                                                                                                        |
| `commandcode`      | `~/.commandcode/projects/<cwd-slug>/<session-id>.jsonl`                                                                                                                                                                                         | `home\|.commandcode/projects`                                                          | ✅ 一致                                                                                                                                        |
| `droid`            | `~/.factory/sessions/**/*.settings.json`                                                                                                                                                                                                        | `home\|.factory`、`home\|.factory/sessions`                                            | ✅ 一致                                                                                                                                        |
| `cline`            | `<clineDir>/data/sessions/<id>/<session>.messages.json`，默认 `~/.cline`                                                                                                                                                                        | `home\|.cline/data/sessions`                                                           | ✅ 一致                                                                                                                                        |
| `zcode`            | `~/.zcode/cli/db/db.sqlite`；state `~/.zcode/v2/{config,credentials,setting}.json`、`logs/`                                                                                                                                                     | `home\|.zcode/cli/db`                                                                  | ✅ 一致（该工具**全平台**都用 `~/.zcode`，Windows 也是）                                                                                       |
| `qwen`             | — （TokenTracker 无此工具，AITracker 独有）                                                                                                                                                                                                     | `home\|.qwen/projects`                                                                 | 自证：HOME 点目录，可信                                                                                                                        |
| `qcode`            | — （同上）                                                                                                                                                                                                                                      | `home\|.q-code`、`home\|.q-code/logs`                                                  | 自证：HOME 点目录，可信                                                                                                                        |
| `proma`            | — （同上）                                                                                                                                                                                                                                      | `home\|.proma/agent-sessions`                                                          | 自证：HOME 点目录，可信                                                                                                                        |
| `dsh`              | `~/.dsh/sessions/<project-key>/<session-id>/session[.vN].jsonl[.zstd]`                                                                                                                                                                          | `home\|.dsh`、`home\|.dsh/sessions`                                                    | ✅ 一致                                                                                                                                        |
| `grok`             | `~/.grok/sessions/<urlencoded-cwd>/<uuid>/{updates.jsonl,signals.json,summary.json}`；auth `~/.grok/auth.json`                                                                                                                                  | `home\|.grok`、`home\|.grok/sessions`、`home\|.grok/logs`                              | ✅ 基本一致（参考实现为 `summary.json`，AITracker 写 `logs`）                                                                                  |
| `kilo-cli`         | `$XDG_DATA_HOME/kilo/kilo.db`                                                                                                                                                                                                                   | `home\|.kilo`、`dataHome\|kilo`                                                        | ✅ 一致                                                                                                                                        |

#### 9.3.2 T3（VS Code 家族 / vendor 客户端）——参考实现已给出确定答案

| AITracker 工具   | Linux 落点（参考实现）                                                                                                                                        | AITracker 现有声明                                                                                    | 结论                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `cursor`         | **`$XDG_CONFIG_HOME/Cursor/User/globalStorage/state.vscdb`**                                                                                                  | `configHome\|Cursor`                                                                                  | ✅ **确认正确**                                                                     |
| `kiro`           | IDE：**`$XDG_CONFIG_HOME/Kiro/User/globalStorage/kiro.kiroagent/dev_data/`**；CLI：**`$XDG_DATA_HOME/kiro-cli/data.sqlite3`**；sessions `~/.kiro/sessions/**` | `configHome\|Kiro/User/globalStorage/kiro.kiroagent`、`dataHome\|kiro-cli`、`home\|.kiro`             | ✅ **确认正确**                                                                     |
| `qoder`          | DB：**`~/.config/Qoder/SharedClientCache/cache/db/local.db`**；projects `~/.qoder/projects/**`                                                                | `configHome\|Qoder/SharedClientCache/cache/db`、`home\|.qoder/projects`                               | ✅ 确认正确（参考实现硬编码 `.config`，未读 XDG——AITracker 用 `configHome` 更规范） |
| `qodercn`        | DB：**`~/.config/QoderCN/SharedClientCache/cache/db/local.db`**；projects **`~/.qoder-cn/projects/**`**                                                       | `configHome\|QoderCN/...`、`home\|.qoder-cn/projects`                                                 | ✅ **确认正确**，且参考实现特意注明 CN 与 intl 是**并列目录而非共享**               |
| `kilocode`       | **`$XDG_CONFIG_HOME/{Code, Code - Insiders, Cursor, CodeBuddy, Windsurf, VSCodium}/User/globalStorage/kilocode.kilo-code/tasks/`**                            | `configHome\|Code/...` 等 8 个宿主                                                                    | ✅ 一致；参考实现在 **Linux 上只用 6 个宿主**（macOS 才多出 `Trae`、`Trae CN`）     |
| `roo-code`       | 同 Kilo 的宿主根，子目录 `rooveterinaryinc.roo-cline/tasks/<id>/`                                                                                             | `configHome\|Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks`                                | ✅ 一致（AITracker 只声明了 `Code`，可考虑补全其它宿主）                            |
| `github-copilot` | OTEL `~/.copilot/otel/*.jsonl`；`~/.copilot/session-store.db`；legacy `~/.copilot/data.db`；令牌 `~/.config/github-copilot/{apps,hosts}.json`                 | `home\|.copilot`、`configHome\|github-copilot`、`configHome\|Code/User/workspaceStorage`              | ✅ 一致（`configHome\|github-copilot` 对应令牌文件）                                |
| `cherrystudio`   | — （TokenTracker 无此工具）                                                                                                                                   | `configHome\|CherryStudio/...`                                                                        | 自证：`~/.config/<Vendor>` 形态，可信                                               |
| `anythingllm`    | Desktop：**`$XDG_CONFIG_HOME/anythingllm-desktop/storage/anythingllm.db`**                                                                                    | `configHome\|anythingllm-desktop/storage`、`configHome\|anythingllm`                                  | ✅ 一致                                                                             |
| `opencode`       | **data**（storage + `opencode.db` + `auth.json`）：`$XDG_DATA_HOME/opencode`；**config**（plugin）：`$XDG_CONFIG_HOME/opencode`                               | `configHome\|opencode`、`dataHome\|opencode`、`dataHome\|opencode/storage/message`、`home\|.opencode` | ✅ **一致且更完整**——参考实现明确把 data 与 config 拆到两个 XDG 变量                |
| `goose`          | **`$XDG_DATA_HOME/goose/sessions/sessions.db`**，另有 legacy **`$XDG_DATA_HOME/Block/goose/sessions/sessions.db`**                                            | `dataHome\|goose`、`home\|.goose`                                                                     | ✅ 一致；建议补 legacy `Block/goose` 根                                             |
| `zed`            | **`$XDG_DATA_HOME/zed/threads/threads.db`**                                                                                                                   | `dataHome\|zed`、`dataHome\|zed/threads`                                                              | ✅ 一致                                                                             |
| `mimo`           | **`$XDG_DATA_HOME/mimocode/mimocode.db`**                                                                                                                     | `dataHome\|mimocode`                                                                                  | ✅ 一致                                                                             |

#### 9.3.3 应标记为 `"unsupported"`（参考实现同样无 Linux 路径）

| AITracker 工具 | 证据                                                                                                                                                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aipy`         | TokenTracker 未收录；AITracker 只有 `appData\|aipy-pro`（mac/win）                                                                                                                                                                                                                                          |
| `doubao-work`  | TokenTracker 未收录；只有 `appData\|DoubaoWork/...`                                                                                                                                                                                                                                                         |
| `kimi-work`    | TokenTracker 只支持 **Kimi Code**（CLI，`~/.kimi-code`），不支持 Kimi Work 桌面版                                                                                                                                                                                                                           |
| `marvis`       | TokenTracker 未收录；只有 `appData\|com.tencent.mac.marvis/...`（bundle id 即 mac 专属）                                                                                                                                                                                                                    |
| `trae-work`    | **最强证据**：参考实现 `rollout.js:22107-22111` 明确注释 _“TRAE SOLO ships official builds for macOS/Windows only, so there is no verified app-data layout to default to”_，其 CN 版 `trae-cn-config.js:97-98` 同样注释 _“No verified CN Work app-data layout on other platforms yet”_ 并直接 `return null` |

> `trae-work` 的处置：AITracker 现有 `home|.trae`、`home|.trae-cn`（仅 mac 目标）。参考实现用一个「best-effort 兜底」`~/.trae-solo` 并明确标注未经验证。**建议 AITracker 也标 `"unsupported"`**，若将来做 best-effort，须在 UI 上标注“未经验证”。

#### 9.3.4 修正建议汇总（可直接落到 `*.tool.json`）

| 工具                                                      | 动作                                                                                                                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `every-code`                                              | 🔴 **优先修**：统一 detection 与 usage 的目录。参考实现证明是 `~/.code`（`~/.every-code` 在其中不存在）。**先真机确认 `~/.code` 与 `~/.every-code` 哪个真实存在**，再决定改哪一侧；随后给 usage 补 `linux` target |
| `grok`                                                    | 参考实现无 `logs` 子目录（是 `<uuid>/summary.json`）。核对 `home\|.grok/logs` 是否真实存在，不存在则删                                                                                                            |
| `roo-code`                                                | 补全 VS Code 家族宿主（`Code - Insiders`、`Cursor`、`CodeBuddy`、`Windsurf`、`VSCodium`）                                                                                                                         |
| `goose`                                                   | 补 legacy 根 `dataHome\|Block/goose/sessions`                                                                                                                                                                     |
| `aipy`、`doubao-work`、`kimi-work`、`marvis`、`trae-work` | `linux: "unsupported"`                                                                                                                                                                                            |
| `security-scanner-service.ts:110-175`                     | 镜像表同步（见 §5.2）                                                                                                                                                                                             |

#### 9.3.5 AITracker 尚未收录、但参考实现证明 Linux 可用的工具（可选扩展）

这些工具在 TokenTracker 里都有明确的 Linux 落点，可作为后续收录候选：
`lmstudio`（`~/.lmstudio/server-logs/**/*.log`）、`unsloth`（`~/.unsloth/studio/studio.db`）、`devin`（`$XDG_DATA_HOME/devin/{cli/sessions.db,credentials.toml}`）、`claude-science`（`~/.claude-science/operon-cli.db`）、`workbuddy-ai`（`~/.workbuddy-ai`）、`dots`（复用 pi 读取器）。

#### 9.3.6 三条可直接采纳的实现经验

1. **`XDG_STATE_HOME` / `XDG_CACHE_HOME` 无需加入 base 集合。** 参考实现（一个已发布 Linux 版的项目）在其整个 `src/` 中**从未读取**这两个变量，且没有工具需要它们。这验证了 §9.2.1 的判断：AITracker 现有 6 个 base 足够。

2. **`env:NAME` base 的必要性被证实。** 参考实现为几乎每个工具都实现了环境变量覆盖，且**优先级固定为 `厂商 TOKENTRACKER_* > 工具自身变量 > 默认`**。AITracker 的 `envHome` 只作用于 skills、`env:NAME` base 零使用——若要达到同等可配置性，需要扩展。几个高频变量：`CODEX_HOME`（**替换** `~/.codex`）、`CLAUDE_CONFIG_DIR`（**追加**而非替换 `~/.claude`）、`GEMINI_HOME`、`KIMI_CODE_HOME`、`GROK_HOME`、`ZCODE_HOME`、`DSH_HOME`、`KILO_HOME`、`MIMO_HOME`。

3. **`os.homedir()` 与 `env.HOME` 的选择是刻意的，不可统一。** 参考实现对此有明确取舍：OpenClaw / Grok / DSH / CommandCode / TRAE / Kiro IDE / Cursor **只用 `os.homedir()`，刻意忽略 `env.HOME`**（注释说明：改用 `env.HOME` 会让 Git Bash / MSYS 找不到自己的 cursor 目录）；而 Codex / Kimi / Goose / Zed / Cline 等先用 `env.HOME`（便于测试隔离与 WSL）。AITracker 的扫描器目前统一用 `options.homeDirectory ?? homedir()`，**在 Linux 上这是更简单的模型且无 Git Bash 问题**，无需照搬这一复杂性——但若将来支持 WSL 互访，需要重新审视。

### 9.4 已知可延后事项

- XDG autostart（开机自启）：首发隐藏该菜单项优于显示灰置项。
- 窗口边界持久化：当前 mac/win 也没有，属通用改进。
- `checksums.txt` 是否覆盖 AppImage/deb：当前 `formatChecksums` 只覆盖元数据记录的产物，Linux 的附加格式会被遗漏，需明确策略。
- `main.ts:1524-1526` 打包后清空应用菜单：Ctrl+Q 等加速键缺失（与 Windows 现状一致），托盘菜单成为唯一退出路径。
- `setVisibleOnAllWorkspaces` 在 Linux 受支持（`@platform darwin,linux`），可用于补齐“从托盘唤起到当前工作区”。
