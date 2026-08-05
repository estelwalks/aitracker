# TrustTools PC Client 四语言国际化敏捷任务清单

| 属性 | 值 |
|------|-----|
| 文档类型 | 敏捷任务清单 (AGILE-TASK) |
| 项目名称 | TrustTools |
| 版本 | v1.2 |
| 创建日期 | 2026-08-04 17:51:49 |
| 更新日期 | 2026-08-04 18:12:33 |
| 生成工具 | agile-feature-dev |
| 文档状态 | 草稿 |

## 修订记录

| 版本 | 修改时间 | 修改内容 |
|------|----------|----------|
| v1.2 | 2026-08-04 18:12:33 | 明确语言与展示货币均支持“跟随系统”和设置页独立手动切换 |
| v1.1 | 2026-08-04 18:07:14 | 新增多币种展示、汇率来源、缓存与离线回退实施计划 |
| v1.0 | 2026-08-04 17:51:49 | 初始版本：定义 PC Client 中英日韩四语言国际化实施计划 |

---

## 1. 目标与范围

### 1.1 交付目标

TrustTools 作为离线优先的 PC Client，首发提供下列完整界面语言：

| 语言 | Locale | 默认适用系统语言 |
|------|--------|------------------|
| 简体中文 | `zh-CN` | `zh`、`zh-CN` |
| English (US) | `en-US` | `en`、`en-*` |
| 日本語 | `ja-JP` | `ja`、`ja-*` |
| 한국어 | `ko-KR` | `ko`、`ko-*` |

语言包随安装包交付，切换不依赖网络、不上传任何数据，也不影响本地 Token、Skill、安全扫描或会话数据。

### 1.2 系统跟随与用户覆盖

界面语言和展示货币均提供独立的“跟随系统”模式，且可分别切换为手动值：

| 设置项 | 跟随系统模式 | 手动模式 |
|--------|--------------|----------|
| 界面语言 | 按 Electron `app.getLocale()` 映射到四种支持语言 | 用户选择中/英/日/韩任一种 |
| 展示货币 | 按已解析的系统 locale 的地区映射货币 | 用户选择 CNY/USD/JPY/KRW 任一种 |

优先级：用户选择手动值 > 对应项的“跟随系统”结果 > `zh-CN` / `CNY` 安全回退。两个设置相互独立：例如用户可以选择英文界面且货币跟随系统，或日文界面且手动显示 USD。

Electron 跨平台没有可靠、统一的“用户操作系统首选货币”API，因此“货币跟随系统”以系统 locale 的地区代码为权威映射（如 `ja-JP → JPY`、`ko-KR → KRW`、`en-US → USD`、`zh-CN → CNY`）；未覆盖地区安全回退 USD。用户可在设置中随时覆盖该推导结果。

偏好必须由 Electron IPC 持久化到 `trusttools-prefs.json`；浏览器开发模式使用 localStorage 镜像。语言切换立即刷新 React 页面、窗口标题、原生菜单、托盘菜单和原生对话框；货币切换立即重渲染金额，不重扫日志。

### 1.3 范围边界

**纳入范围**：React 路由/组件、页面元信息、Toast、错误与空状态、图表说明、导出文件名、Electron 菜单/托盘/对话框/通知、日期/数字/费用格式。

**不翻译**：AI 工具名、模型名、Skill 名称和原始 README、命令、文件路径、项目目录、日志正文、扫描规则标识、用户输入内容。可为这些值提供已翻译的“标签”，但原值必须保持不变。

**币种原则**：展示语言与展示货币是两个独立设置。费用以 USD 作为内部规范化计价基准；用户可选择 `CNY`、`USD`、`JPY`、`KRW` 任一展示货币。语言只改变符号位置、分组、小数位和日期格式，不自动改变币种。例如英文界面可展示 `CN¥12.34`，日文界面也可展示 `$12.34`。

### 1.4 展示货币策略

| 展示货币 | Currency | 默认用户群 | 小数位建议 |
|----------|----------|------------|------------|
| 人民币 | `CNY` | `zh-CN` | 2 |
| 美元 | `USD` | `en-US` | 2 |
| 日元 | `JPY` | `ja-JP` | 0 |
| 韩元 | `KRW` | `ko-KR` | 0 |

首次启动时，语言与展示货币均为“跟随系统”；展示货币根据系统 locale 的地区映射得出。一旦用户为其中任一项选择手动值，只覆盖该项；可通过设置中的“跟随系统”恢复自动模式。切换展示货币只更新视图，绝不重新计算 Token、改写历史价格或覆盖用户选择。

---

## 2. 当前基线与关键缺口

| 项目 | 当前状态 | 缺口 |
|------|----------|------|
| React i18n | 已有 `I18nProvider` 与 `zh/en` 小型字典 | 仅少数导航/设置文案接入；`en` 不是标准 `en-US` |
| 持久化 | localStorage `tt-locale` | 桌面端未与 Electron prefs 统一；未读取系统语言 |
| 页面文案 | 大量中文硬编码于 routes/components | 切换语言不能覆盖真实功能页、错误、Toast、图表与空状态 |
| 格式化 | 多处固定 `zh-CN` | 日期、数字、相对时间、导出文件名不可随语言变化 |
| 原生体验 | Electron 已有 IPC、菜单、托盘和对话框 | 主进程没有共享语言包与菜单重建机制 |
| 字体与布局 | Inter + JetBrains Mono | 日文/韩文缺少可靠的系统字体回退与四语言视觉回归 |
| 定价与汇率 | 内部已以 `knownUsd` 计价，并有 USD→CNY 动态汇率缓存 | `Currency` 仅支持 USD/CNY；页面大量硬编码 `CNY`；缺 JPY/KRW 汇率、展示货币偏好和汇率透明度 |

---

## 3. 目标架构

```text
Electron Main Process
  ├─ locale/currency resolver (manual preference > app.getLocale region map > fallback)
  ├─ native message catalog (menu/tray/dialog/notification)
  └─ locale IPC: get / set / changed

Renderer
  ├─ I18nProvider
  ├─ module message catalogs (four locales, dynamically imported)
  ├─ typed t(key, values) / formatDate / formatNumber / formatMoney
  └─ document lang + title updater

Persistence
  ├─ trusttools-prefs.json: trusttools.localeMode = system | manual
  ├─ trusttools-prefs.json: trusttools.locale = Locale (manual mode only)
  ├─ trusttools-prefs.json: trusttools.currencyMode = system | manual
  ├─ trusttools-prefs.json: trusttools.displayCurrency = Currency (manual mode only)
  └─ localStorage mirror: tt-locale (browser development fallback)
```

### 3.1 目录与接口约定

```text
src/lib/i18n/
├── locale.ts                 # Locale、默认/回退、系统语言映射
├── context.tsx               # Provider、IPC 初始化、热切换
├── format.ts                 # Intl 格式化统一入口
├── messages.ts               # message key 类型及开发期缺失校验
└── locales/
    ├── zh-CN/{common,dashboard,skills,market,security,sessions,sources,settings,electron}.ts
    ├── en-US/...
    ├── ja-JP/...
    └── ko-KR/...
electron/
├── i18n.ts                   # 无 React 依赖的主进程文案与语言解析
├── contracts.ts              # locale IPC 契约
└── preload.cts               # 安全桥接
```

- 前端统一调用 `t("settings.language")` 或 `t("sessions.resumeUnavailable", { source })`；禁止页面拼接可翻译句子。
- 对变量、数量和日期使用 ICU 风格占位或等价的参数化 API；禁止 `"已安装 " + count + " 个"`。
- 格式化统一调用 `formatDate`、`formatDateTime`、`formatNumber`、`formatPercent`、`formatMoney`；业务层继续保存机器可读数值与 ISO 时间。
- `Locale` 固定为 `zh-CN | en-US | ja-JP | ko-KR`；未知语言永远回退 `zh-CN`。
- `DisplayCurrency` 固定为 `CNY | USD | JPY | KRW`；内部费用字段继续存为 USD，展示层以带时间戳的汇率转换。
- 解析器返回 `{ locale, localeSource, displayCurrency, currencySource }`；`source` 取 `system`、`manual` 或 `fallback`，供设置页透明展示。

### 3.2 PC Client 特有要求

| 范围 | 方案 |
|------|------|
| 系统默认语言/货币 | Main Process 解析 `app.getLocale()` 的语言与地区；Renderer 通过受限 IPC 读取初始解析结果，避免首次闪现中文或错误币种 |
| 原生菜单/托盘 | 切换语言后销毁并重建 `Menu` / `Tray` context menu；保留当前启用状态与快捷键 |
| 原生对话框 | 所有标题、按钮和说明从 `electron/i18n.ts` 获取；浏览器端只传稳定的动作码 |
| 字体 | CSS 字体栈加入 macOS/Windows/Linux 的中文、日文、韩文字体回退；代码和数字继续优先 JetBrains Mono |
| 自动更新与安装器 | 更新提示、关闭提示、兼容性提示纳入主进程字典；不要求变更应用名称或包标识 |
| 离线性 | 四套文案打包在客户端；不通过远程翻译 API 更新 UI 文案 |
| 汇率与离线 | 按“USD→目标币种”单独缓存；网络失败用未过期缓存，再回退内置基准汇率，并显示“汇率日期/来源” |

---

## 4. 敏捷任务清单

## Epic I18N-01：国际化基础设施

### Story I18N-001：四语言与桌面端语言决策

**工作量**：3 人日  
**验收标准**：语言和展示货币均支持独立的“跟随系统/手动”模式；重启桌面端后保持；四种 locale 均可加载且离线可用。

#### Tasks

- [ ] I18N-001-1：定义 `Locale`、`DisplayCurrency`、`system/manual` 模式、系统语言/地区映射、默认/回退策略与单元测试。
- [ ] I18N-001-2：通过 Electron IPC 提供 `getLocalePreferences`、`setLocaleMode`、`setCurrencyMode` 及变更事件；仅允许可信 Renderer 调用。
- [ ] I18N-001-3：扩展 React `I18nProvider`，先读平台解析结果再回退 localStorage，并更新 `<html lang>`；提供展示货币 Context。
- [ ] I18N-001-4：将现有 `en` 迁移为 `en-US`，新增 `ja-JP`、`ko-KR` 的完整基础字典。

### Story I18N-002：类型安全文案与格式化层

**工作量**：3 人日  
**验收标准**：四语言 key 完整一致；开发/测试可发现缺失 key；日期、数值、费用、百分比均使用选定 locale。

#### Tasks

- [ ] I18N-002-1：按模块拆分消息字典并建立 key 类型校验脚本。
- [ ] I18N-002-2：新增 `Intl` 格式化封装，替换固定 `zh-CN` 格式化入口。
- [ ] I18N-002-3：建立参数化消息规范，覆盖计数、时间、错误原因和复数语义。
- [ ] I18N-002-4：为日期、费用、未知价格、0 值和长数字补充四语言单元测试。

### Story I18N-002B：多币种展示与汇率可靠性

**工作量**：3 人日  
**验收标准**：CNY、USD、JPY、KRW 可独立于语言切换；所有费用卡片、图表、会话、海报和导出使用同一展示货币与同一汇率快照；未知价格绝不显示为零。

#### Tasks

- [ ] I18N-002B-1：将 `Currency` 扩展为 `CNY | USD | JPY | KRW`，保持 `knownUsd` 为唯一内部计价基准。
- [ ] I18N-002B-2：实现受控汇率服务与缓存：按货币保存汇率、有效日期、来源（live/cache/stale-cache/fallback），设定超时和最大陈旧期限。
- [ ] I18N-002B-3：新增 `displayCurrency`、`currencyMode` 偏好、Electron IPC 持久化和“跟随系统 locale 地区”策略；用户可随时恢复自动模式。
- [ ] I18N-002B-4：统一 `formatMoney` / `formatCost` 的 locale 与 currency 参数，替换各页面硬编码 `CNY`；JPY/KRW 遵循 0 小数位，不做截断性金额误差。
- [ ] I18N-002B-5：在设置/费用相关 UI 显示“展示货币、汇率日期、来源与价格未知说明”；提供“刷新汇率”且不阻塞本地功能。
- [ ] I18N-002B-6：扩展 CSV/JSON 导出：保留原始 USD 成本，并新增展示货币金额、币种、汇率和汇率日期；确保字段为机器可读稳定值。

## Epic I18N-02：React 页面全量迁移

### Story I18N-003：应用框架、导航与通用反馈

**工作量**：2 人日  
**验收标准**：侧栏、页脚、窗口/路由标题、404、错误边界、按钮、Toast、确认弹窗切换语言后无残留硬编码文案。

#### Tasks

- [ ] I18N-003-1：迁移 `AppShell`、`__root.tsx`、通用 UI 组件与主题/状态标签。
- [ ] I18N-003-2：迁移页面标题、meta description、错误/空状态、导出文件名。
- [ ] I18N-003-3：加入 ESLint/CI 检查，禁止生产路由新增裸露中文或英文 UI 字面量（白名单含工具名与日志字段）。

### Story I18N-004：首页与数据模块

**工作量**：3 人日  
**验收标准**：首页、趋势、上下文、热力图、模型分布、明细、海报与数据来源页在四种语言下文案、单位和 tooltip 完整且不截断。

#### Tasks

- [ ] I18N-004-1：首页 KPI、时间区间、趋势/上下文/模型/热力图组件迁移。
- [ ] I18N-004-2：明细表、海报、CSV/JSON 导出标题/列名/文件名迁移；导出数据键保持兼容并在格式层说明。
- [ ] I18N-004-2B：首页 KPI、趋势 tooltip、模型分布、上下文、热力图、明细、海报与导出接入统一展示货币和汇率元数据。
- [ ] I18N-004-3：数据来源和会话恢复的状态、费用、异常中断、恢复命令说明迁移。

### Story I18N-005：Skill 与设置模块

**工作量**：3 人日  
**验收标准**：Skill 管理、市场、安全检测、设置中所有操作、风险提示、冲突处理和二次确认均有四语言版本；安全规则代码与 Skill 原文不翻译。

#### Tasks

- [ ] I18N-005-1：Skill 管理/市场搜索、安装、冲突、离线和失败提示迁移。
- [ ] I18N-005-2：安全检测流程、11 维规则展示、历史、纯本地隐私声明迁移。
- [ ] I18N-005-3：设置、数据治理、更新检查、开机自启与语言选择页迁移。
- [ ] I18N-005-3B：设置页分别提供“界面语言”和“展示货币”的“跟随系统”开关/选项与手动选择器，显示当前解析结果、来源、汇率状态、手动刷新与离线/过期缓存说明。

## Epic I18N-03：Electron 原生体验

### Story I18N-006：主进程菜单、托盘与对话框

**工作量**：2 人日  
**验收标准**：四语言切换后，菜单、托盘、关闭提示、更新/兼容对话框和系统通知立即更新；IPC 不接受任意 locale 或任意文案。

#### Tasks

- [ ] I18N-006-1：提取主进程文案与菜单/托盘工厂函数。
- [ ] I18N-006-2：实现语言切换后的菜单、托盘与已打开窗口安全刷新。
- [ ] I18N-006-3：迁移 `dialog`、通知、升级兼容和关闭常驻提示。

## Epic I18N-04：质量与发布

### Story I18N-007：四语言回归与翻译治理

**工作量**：3 人日  
**验收标准**：四语言静态 key 校验、单元测试、桌面端 IPC 测试、主要页面 Playwright 冒烟全部通过；翻译经人工审校后才发布。

#### Tasks

- [ ] I18N-007-1：字典 key 完整性、locale 回退和格式化单元测试。
- [ ] I18N-007-1B：四币种换算、汇率缓存/陈旧回退、JPY/KRW 小数位、未知价格和导出字段单元测试。
- [ ] I18N-007-2：Electron 语言优先级、prefs 持久化、菜单重建与 IPC 安全测试。
- [ ] I18N-007-3：四语言 Playwright 视觉/交互冒烟：首页、Skill、市场、安全、会话、来源、设置。
- [ ] I18N-007-4：日文/韩文长文本、窄窗口、100%/125%/150% 缩放检查；建立翻译审校清单。

---

## 5. 依赖关系与建议顺序

| Task | 前置依赖 | 后续影响 |
|------|----------|----------|
| I18N-001 | 无 | I18N-002 ~ I18N-007 |
| I18N-002 | I18N-001 | I18N-002B、I18N-003 ~ I18N-005、I18N-007 |
| I18N-002B | I18N-001、现有定价快照 | I18N-004、I18N-005、I18N-007 |
| I18N-003 | I18N-002 | I18N-004、I18N-005 |
| I18N-004 / 005 | I18N-002、I18N-003 | I18N-007 |
| I18N-006 | I18N-001 | I18N-007 |
| I18N-007 | I18N-004、I18N-005、I18N-006 | 发布 |

建议按 I18N-001 →（I18N-002 与 I18N-002B）→（I18N-003 与 I18N-006 并行）→（I18N-004 与 I18N-005 并行）→ I18N-007 交付。预计实现、汇率验证与翻译审校共 19 人日；发布缓冲另预留 20%。

---

## 6. 验收矩阵

| 场景 | 预期结果 |
|------|----------|
| 英文系统首次启动 | 默认 `en-US` 与 `USD`；无用户偏好时菜单、页面和金额格式正确 |
| 日文/韩文系统首次启动 | 分别默认 `ja-JP`/`JPY` 与 `ko-KR`/`KRW`；CJK 字体正常、无方块字 |
| 跟随系统 | 在无手动偏好时，系统 locale 的语言和地区正确映射语言/货币；未知地区安全回退 |
| 用户切换任意语言/货币 | 页面、标题、菜单、托盘、对话框或金额即时更新，无需重启；另一项设置不被覆盖 |
| 离线状态 | 四种语言均可切换；不请求翻译服务 |
| 费用/时间 | 数值和日期按 locale 格式化，币种与真实计价保持不变 |
| 显示货币 | CNY/USD/JPY/KRW 可独立切换；内部 USD 基准、Token 和原始价格不变 |
| 汇率离线回退 | 优先实时汇率，其次有效缓存，再次内置基准；UI 明示日期与来源，陈旧超过上限时要求确认或显示不可用 |
| 导出 | 每行同时含原始 USD、展示金额、展示币种、汇率和汇率日期；未知价格不填 0 |
| 安全检测 | 规则代码、Skill 内容、命令和路径不被翻译；安全解释文案被翻译 |
| 缺失 key | 测试/CI 失败；生产环境记录错误并回退 `zh-CN`，不展示 key |
| 缩放与长文本 | 100%/125%/150% 下导航、表格、弹窗不遮挡关键操作 |

---

## 7. 风险与控制

| 风险 | 控制措施 |
|------|----------|
| 硬编码文案遗漏 | 模块化迁移清单 + ESLint 检查 + 四语言 Playwright |
| 翻译失真，尤其是安全/删除提示 | 中文源文案冻结后由母语审校；禁止运行时机器翻译 |
| Renderer 与主进程语言不一致 | locale 由受限 IPC 提供单一真相；切换事件驱动菜单重建 |
| 首次渲染闪烁 | 先读取 IPC 初始 locale；无法读取时使用确定的 `zh-CN` 回退 |
| 日文/韩文字体与长度溢出 | 平台字体回退栈 + 150% 缩放视觉回归 + 禁止固定文本宽度 |
| 翻译影响业务数据 | 业务数据保存稳定 ID/ISO/数值；只在展示层格式化 |
| 汇率过期或数据源异常 | 对每币种独立缓存和过期控制；展示来源/日期；不将 fallback 金额描述为实时价格 |
| 语言切换误改货币 | `locale` 与 `displayCurrency` 分别持久化；仅首次默认值可由语言派生 |
| 系统货币不可直接读取 | 使用跨平台可靠的 locale 地区映射，显示“跟随系统地区”；始终提供手动覆盖和安全回退 |

## 8. 完成定义（Definition of Done）

- 四种 locale 在 Web 开发模式和 macOS PC Client 中均可离线使用。
- 所有用户可见 React 与 Electron 原生文案完成迁移，无关键硬编码遗留。
- 语言偏好跨重启持久化，且系统语言回退正确。
- 格式化、语言决策、IPC、字典完整性、核心页面冒烟和桌面端菜单回归均通过。
- 中英日韩文案经人工审校；安全、删除、安装、费用和隐私提示无语义歧义。
- CNY、USD、JPY、KRW 可独立显示，汇率状态可追溯，所有费用展示与导出使用同一快照。
