# AITracker

<p align="center">
  <img src="../public/favicon-dark.svg" alt="AITracker Logo" width="180" />
</p>

<p align="center">
  <a href="https://github.com/estelwalks/aitracker/stargazers"><img src="https://img.shields.io/github/stars/estelwalks/aitracker?style=flat-square&cacheSeconds=3600" alt="GitHub Stars" /></a>
  <a href="https://github.com/estelwalks/aitracker/blob/main/LICENSE"><img src="https://img.shields.io/github/license/estelwalks/aitracker?style=flat-square&cacheSeconds=3600" alt="许可证" /></a>
  <a href="https://github.com/estelwalks/aitracker/releases/latest"><img src="https://img.shields.io/github/v/release/estelwalks/aitracker?style=flat-square&cacheSeconds=3600" alt="最新 Release" /></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README_CN.md">简体中文</a> | <a href="README_JA.md">日本語</a> | <a href="README_KO.md">한국어</a>
</p>

> **你用了多少 Token，花了多少钱，哪些Agent工具最好用，一眼看清。**

AITracker 是一个**开源、本地运行的 AI 工作台**。

自动追踪 Claude Code、Codex、Cursor 等 AI 工具的 Token、成本和使用趋势，统一管理 Skills 与常用配置，从真实工作与使用记录中蒸馏 Skills，构建个人知识库与长期记忆，让每一次 AI 使用都成为下一次可以复用的能力。

**开源 · 本地 · 无需注册**

---

## ✨ 为什么需要 AITracker？

AI 工具越来越多。

Claude Code、Codex、Cursor、Cline、Gemini CLI、OpenCode……

但随着工具越来越多，新的问题也开始出现：

- 我到底用了多少 AI？
- Token 和钱都花在哪里？
- 哪个工具、哪个模型最适合我？
- Skills 等配置都散落在哪里？
- 换一个 AI 工具，又要重新配置一遍？
- 今天跑通的方法，下次还能不能直接用？
- AI 能不能记住我的项目和长期工作经验？

**AITracker 把这些事情集中到一个地方。**

从看清 AI 使用，到管理 AI 能力，再到蒸馏 Skills、沉淀知识与长期记忆，让 AI 不再只是一次性使用的工具。

---

## 🚀 快速开始

AITracker 是基于 Electron、TanStack Start、React 和 TypeScript 构建的桌面应用。安全扫描使用已发布到 npm 的 `@estelwalks/agent-threat-scanner` 包，克隆后安装根项目依赖即可开发。

### 环境要求

- Node.js 24 或更高版本
- npm 10 或更高版本
- macOS 或 Windows（完整桌面体验）

```bash
git clone https://github.com/estelwalks/aitracker.git
cd aitracker
npm ci
npm run dev:desktop
```

仅启动浏览器开发服务器时，运行 `npm run dev`。

### 安装（Beta）

首个 Beta 版本面向 macOS（x64 / arm64）和 Windows x64 桌面安装包。Beta
安装包未签名。截至目前，Beta CLI 包、对应的 GitHub Release 和 beta Tap
尚未发布，下面的命令仅在发布后可用。

发布 Beta CLI 包和匹配的 GitHub Release 后，如果已安装 Node.js 和 npm，可运行：

```bash
npx --yes aitracker@beta
```

此命令会下载并打开桌面安装程序；它不是无需 Node.js 的静默安装。macOS
Gatekeeper 可能提示“无法验证开发者”；请在确认发布来源和成果物后，通过“系统设置”
或在应用上右键选择“打开”来手动确认启动。Windows 可能显示 SmartScreen 警告；继续
前请检查发布者和成果物。不要关闭全局安全保护，也不要运行不安全的绕过命令。

如果只想下载并校验安装程序而不打开，可以指定输出目录。目录不存在时会自动创建，
并使用发布元数据提供的安全安装包文件名：

```bash
npx --yes aitracker@beta --download-only ./downloads
```

不指定目录的 `--download-only` 仍保持兼容：使用临时目录下载和校验，命令退出时清理
临时文件。已存在的目标文件、符号链接目录、空目录参数、重复参数和文件系统根目录
都会被拒绝。

macOS 用户也可以在 beta Tap 发布后使用项目自己的 Tap：

```bash
brew tap estelwalks/aitracker
brew install --cask estelwalks/aitracker/aitracker-beta
```

稳定版命令目前尚未作为可用选项发布；只有在稳定版完成签名且官方 Homebrew Cask
准备就绪后，才会公布稳定版安装方式。

### 构建与测试

```bash
npm run build:desktop       # Web 应用与 Electron 主进程 / preload 构建
npm run typecheck           # 应用与内置 scanner 类型检查
npm run lint                # 应用与内置 scanner 代码检查
npm run test:all            # 单元、工具、数据库与 scanner 测试
npm run check:opensource-hygiene
```

可以使用 `npm run dist:mac` 或 `npm run dist:win:x64` 构建平台安装包。完整命令、生成文件约定和仓库结构请参阅[开发指南](DEVELOPMENT.md)。

---

## 🌟 核心能力

| 能力            | 说明                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------ |
| **AI 使用分析** | 自动汇总不同 AI 工具的 Token、成本、模型、项目和使用趋势，知道 AI 到底用了多少、钱花在哪里 |
| **AI 工具分析** | 基于自己的真实使用数据，对比不同工具和模型的使用频率、消耗与趋势，找到更适合自己的 AI      |
| **Skills 管理** | 自动发现并集中管理散落在不同 AI 工具中的 Skills，减少重复查找和维护                        |
| **配置管理**    | 统一管理 Rules 等常用 AI 配置，并逐步实现跨工具复用                                        |
| **Skills 蒸馏** | 从真实工作、历史会话和已跑通的方法中提炼可复用经验，逐步沉淀为 Skills                      |
| **知识库**      | 把项目资料、方法、经验和有价值的信息持续整理为个人知识库                                   |
| **长期记忆**    | 持续沉淀项目上下文、使用习惯和重要经验，让下一次使用 AI 不必重新开始                       |
| **本地优先**    | 核心数据与配置优先保存在本机，无需账号即可使用核心能力                                     |

---

## 看清你的 AI 使用

AITracker 自动采集本机 AI 编码工具的使用数据，把分散的数据汇总到一个 Dashboard。

你可以查看：

- Token 使用量
- 输入 / 输出 / Cache Token
- 每日、每周、每月成本
- 不同 AI 工具使用情况
- 不同模型使用情况
- 项目消耗
- 使用趋势

不再凭感觉判断自己用了多少 AI。

> **用了多少、花了多少、哪个最好用，一眼看清。**

---

## 管理你的 AI 能力

真正越来越难管理的，不只是 AI 工具本身，还有散落在不同工具里的配置和能力。

![](./assets/cn/01-ai-tools-network.png)

AITracker 自动发现这些配置，并提供统一的管理入口。

你不需要再记住某个 Skill 放在哪个目录，也不需要每换一个工具就重新配置一遍。

---

## Skills 蒸馏

真正有价值的 Skill，不一定需要从零开始编写。

AITracker 从你的真实工作、历史会话和已经跑通的方法中，识别值得复用的经验，并逐步蒸馏为 Skills。

![](./assets/cn/02-skills-distillation.png)

把“这次终于跑通了”，变成“以后可以直接复用”。

---

## 跨工具复用

一个好用的 Skill，不应该只能属于 Claude Code。

一套跑通的配置，也不应该因为切换到 Codex、Cursor 或其他工具就重新开始。

AITracker 希望建立一个位于不同 AI 工具之上的能力层：

![](./assets/cn/03-cross-tool-reuse.png)

在一个地方管理，在不同 AI 工具中继续使用。

---

## 知识库与长期记忆

AI 每天会产生大量对话，但真正值得留下来的往往只有一部分。

例如：

- 一个项目的重要背景
- 一套已经验证的方法
- 一个排查问题的过程
- 一个好用的 Prompt
- 一个 Skill
- 一个 Workflow
- 一次重要的技术决策

AITracker 将这些有价值的信息逐步沉淀为**知识库与长期记忆**。

![](./assets/cn/04-knowledge-base-memory.png)

让 AI 不再每次从零开始。

---

## 支持更多 AI 编程工具

AITracker 面向多 AI 工具设计，逐步适配主流 AI Coding Tools，包括：

`Claude Code` · `Codex` · `Cursor` · `Cline` · `Gemini CLI` · `OpenCode` · ...

目前已覆盖 **36+ AI 工具的数据采集与识别场景**，并持续扩展。

---

## 本地优先

AITracker 默认运行在本地。

你的 AI 使用记录、统计数据、Skills、Rules、知识与记忆优先保存在自己的电脑中。

![](./assets/cn/05-local-first.png)

**无需注册账号即可使用核心功能。**

你的数据，属于你自己。

## AITracker 想解决什么？

过去，我们通常是：

![](./assets/cn/06-past-scattered-tools.png)

现在越来越像：

![](./assets/cn/07-now-unified-platform.png)

AI 工具越来越强，也越来越多。

但我们缺少一个真正属于自己的地方，去**看清、管理和积累这些 AI 能力**。

这就是 AITracker 想做的事情。

> **看清 AI → 管理能力 → 蒸馏经验 → 持续积累。**

---

## 如何贡献

AITracker is open source.

欢迎提交 Issue，以及新的 AI 工具适配建议。

如果你正在使用某个 AI Coding Tool，而 AITracker 还没有支持，也欢迎告诉我们。

---

## 许可证

AITracker 采用基于 GPL-3.0 且附带额外限制的项目许可证。详见
[LICENSE](../LICENSE)。

---

## 致谢

感谢以下贡献者：

- [gobuer](https://github.com/gobuer)
- [estelwalks](https://github.com/estelwalks)
- [JJBondOne](https://github.com/JJBondOne)

开发过程中使用了以下工具：

- [Claude Code](https://code.claude.com/docs/en/)
- [DeepSeek Harness](https://www.deepseek.com/harness/en/)
- [Codex](https://developers.openai.com/codex/)
- [Lovable](https://lovable.dev/)

---

## 支持项目

如果 AITracker 对你有帮助，欢迎给项目一个 Star，感谢。
