# TrustTools V3.0 架构设计文档

| 属性     | 值                          |
| -------- | --------------------------- |
| 文档类型 | 架构设计文档 (ARCH)         |
| 项目名称 | TrustTools V3.0（代号待定） |
| 版本     | v1.0                        |
| 创建日期 | 2026-07-24 14:08:36         |
| 更新日期 | 2026-07-24 14:08:36         |
| 生成工具 | architecture-design         |
| 文档状态 | 草稿                        |

## 修订记录

| 版本 | 修改时间            | 修改内容 |
| ---- | ------------------- | -------- |
| v1.0 | 2026-07-24 14:08:36 | 初始版本 |

---

## 1. 背景与目标

基于 TrustTools V2.4 已有能力（SkillPackage 后台），构建 V3.0 桌面客户端，把 Token 追踪、Skill 管理、安全检测、记忆聚合、团队协作整合为统一的个人 AI 主权工具。

**核心原则：本地优先，云端辅助。**

---

## 2. 架构总览

### 2.1 系统上下文图

```mermaid
C4Context
    title TrustTools V3.0 系统上下文

    Person(user, "用户", "AI 开发者 / 重度用户")

    System_Boundary(local, "用户本机") {
        System(v3client, "V3.0 桌面客户端", "Electron + Dashboard")
        System(chrome_ext, "浏览器插件", "Chrome/Edge Extension")
        System_Ext(ai_tools, "AI 工具", "Claude Code / Cursor / Codex ...")
    }

    System_Boundary(cloud, "TrustTools 云端") {
        System(auth, "账户鉴权", "手机号+验证码")
        System(team, "团队服务", "团队数据 & Skill 共享")
    }

    System_Ext(v24, "V2.4 SkillPackage", "Python 后台<br/>(现有)")

    System_Ext(litellm, "LiteLLM", "模型定价数据")
    System_Ext(web_ai, "Web AI 平台", "ChatGPT / Claude.ai")

    Rel(user, v3client, "打开 Dashboard", "HTTPS localhost")
    Rel(user, chrome_ext, "安装插件")
    Rel(user, ai_tools, "使用 AI 工具")

    Rel(v3client, ai_tools, "读取日志/skill/memory", "本地文件系统")
    Rel(chrome_ext, web_ai, "检测页面 token 数据", "DOM 解析")
    Rel(chrome_ext, v3client, "写入消耗数据", "localhost API")

    Rel(v3client, auth, "登录/鉴权", "HTTPS")
    Rel(v3client, team, "团队数据同步", "HTTPS")
    Rel(v3client, litellm, "拉取模型定价", "HTTPS (24h 缓存)")

    Rel(v24, v3client, "SkillPackage 目录", "HTTPS (V1.x)")
```

### 2.2 本地 vs 云端边界

```
┌─────────────────────────────────────────────────────┐
│                    用户本机                          │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Electron │  │ 浏览器插件 │  │  27 个 AI 工具    │  │
│  │  壳+Dash │  │          │  │  (Claude Code,...) │  │
│  │  board   │  │          │  │                    │  │
│  └────┬─────┘  └────┬─────┘  └────────┬───────────┘  │
│       │             │                 │               │
│       │    ┌────────┴────────┐       │               │
│       └────┤  本地 API 服务   │◄──────┘               │
│            │  (localhost:7680)│                       │
│            └───────┬─────────┘                       │
│                    │                                 │
│         ┌──────────┼──────────┐                      │
│    ┌────┴────┐ ┌───┴────┐ ┌──┴──────┐               │
│    │ JSONL   │ │ SQLite │ │ 配置    │               │
│    │ token   │ │ skill/ │ │ 文件    │               │
│    │ events  │ │ memory │ │         │               │
│    └─────────┘ └────────┘ └─────────┘               │
│                                                     │
│   个人功能 100% 本地，不依赖云端                        │
└──────────────────────┬──────────────────────────────┘
                       │
            ┌──────────┴──────────┐
            │    TrustTools 云端   │
            │  （可选，需登录）      │
            │                     │
            │  ┌───────────────┐  │
            │  │  账户鉴权     │  │
            │  └───────────────┘  │
            │  ┌───────────────┐  │
            │  │  团队数据同步  │  │
            │  └───────────────┘  │
            │  ┌───────────────┐  │
            │  │  LiteLLM 定价  │  │
            │  │  缓存         │  │
            │  └───────────────┘  │
            └─────────────────────┘
```

---

## 3. V3.0 内部模块架构

```mermaid
graph TB
    subgraph Electron壳["Electron 壳"]
        MainProc["主进程<br/>启动本地API + 托盘 + 自启"]
        BrowserWin["BrowserWindow<br/>嵌入 Dashboard SPA"]
    end

    subgraph Dashboard["Dashboard (React SPA)"]
        TokenPage["Token 消耗页<br/>主面板/明细表/团队看板"]
        SkillPage["Skill 管理页<br/>我的/团队双栏"]
        SecurityPage["安全检测页<br/>拖入检测/报告"]
        MemoryPage["记忆页<br/>配置目录/浏览"]
        SettingPage["设置页<br/>币种/预警/账户"]
    end

    subgraph LocalAPI["本地 API 服务 (Node.js)"]
        Router["路由层<br/>30+ REST 接口"]

        subgraph Engines["核心引擎"]
            TokenEngine["Token 引擎<br/>日志解析(L27工具)+聚合+费用计算"]
            SkillEngine["Skill 引擎<br/>目录扫描+健康度+同步安装"]
            SecurityEngine["安全引擎<br/>静态规则+AI审查"]
            MemoryEngine["记忆引擎<br/>目录监控+聚合"]
        end

        subgraph DataLayer["数据层"]
            JSONLStore[("queue.jsonl<br/>token 事件队列")]
            SQLiteStore[("SQLite<br/>skill/配置/元数据")]
            FileWatch["目录监听<br/>fs.watch"]
        end
    end

    subgraph SyncModule["云端同步模块"]
        AuthSync["鉴权同步"]
        TeamSync["团队数据同步"]
        PricingSync["定价缓存同步<br/>24h刷新"]
    end

    BrowserWin -->|"fetch/SSE"| Router
    Router --> TokenEngine
    Router --> SkillEngine
    Router --> SecurityEngine
    Router --> MemoryEngine

    TokenEngine --> JSONLStore
    TokenEngine --> PricingSync
    SkillEngine --> SQLiteStore
    SkillEngine --> FileWatch
    MemoryEngine --> FileWatch
    MemoryEngine --> SQLiteStore
    SecurityEngine --> Router

    SyncModule -->|"HTTPS (需登录)"| Cloud

    MainProc -->|"spawn 子进程"| Router
```

---

## 4. 数据流

### 4.1 Token 采集链路

```mermaid
sequenceDiagram
    participant AI as AI工具<br/>(Claude/Cursor...)
    participant FS as 日志文件
    participant TE as Token 引擎
    participant J as queue.jsonl
    participant API as 本地 API
    participant UI as Dashboard

    AI->>FS: 对话结束，追加日志行
    FS-->>TE: fs.watch 检测文件变化
    TE->>TE: 解析 source/model/tokens/hour
    TE->>J: 追加 JSONL 行<br/>(source,model,hour)去重
    UI->>API: GET /usage-summary?from=...&to=...
    API->>J: 读取+聚合
    J-->>API: 聚合结果
    API->>API: 匹配定价 → 计算费用
    API-->>UI: JSON {totals, rolling, sources[]}
    UI->>UI: 渲染图表
```

### 4.2 浏览器插件链路

```mermaid
sequenceDiagram
    participant B as 浏览器
    participant CS as Content Script
    participant BG as Background SW
    participant API as 本地 API

    B->>CS: 检测到 Claude.ai/ChatGPT 页面
    CS->>CS: 解析 DOM 提取 token 元数据
    CS->>BG: 发送 {model, tokens, timestamp}
    BG->>API: POST localhost:7680/data/ingest
    API->>API: 写入 queue.jsonl
    API-->>BG: 200 OK
    BG->>BG: 更新插件图标角标
```

## 4.3 Skill 安全检测链路

```mermaid
sequenceDiagram
    participant U as 用户
    participant UI as Dashboard 安全页
    participant SE as 安全引擎
    participant AI as AI 审查

    U->>UI: 拖入/上传 skill 文件
    UI->>SE: POST /security/scan (multipart)
    SE->>SE: 解包文件
    par 并行检测
        SE->>SE: 静态规则扫描<br/>(恶意URL/危险命令/密钥泄露)
        SE->>AI: 提交代码片段
        AI-->>SE: 风险评分
    end
    SE->>SE: 汇总结果 → 生成报告
    SE-->>UI: {status, risks[{type,level,detail}]}
    UI->>U: 展示安全报告
```

---

## 5. 数据模型

### 5.1 Token 事件

| 字段                        | 类型     | 说明                              |
| --------------------------- | -------- | --------------------------------- |
| source                      | string   | 来源工具 (claude/cursor/codex...) |
| model                       | string   | 模型名                            |
| hour_start                  | ISO 8601 | UTC 半小时桶                      |
| input_tokens                | number   | 输入 token                        |
| output_tokens               | number   | 输出 token                        |
| cached_input_tokens         | number   | 缓存读取                          |
| cache_creation_input_tokens | number   | 缓存写入                          |
| reasoning_output_tokens     | number   | 推理 token                        |
| billable_total_tokens       | number   | 计费 token                        |
| conversation_count          | number   | 对话轮次                          |
| project_key                 | string   | 项目标识 (可选)                   |

### 5.2 Skill 注册表

| 字段                  | 类型     | 说明                  |
| --------------------- | -------- | --------------------- |
| id                    | uuid     | 唯一标识              |
| name                  | string   | Skill 名称            |
| source_dir            | string   | 来源目录              |
| install_date          | datetime | 安装时间              |
| last_active           | datetime | 最近调用时间          |
| call_count_7d/30d/90d | number   | 各周期调用次数        |
| health_status         | enum     | 活跃/低频/休眠/废弃   |
| owner                 | enum     | 个人/团队             |
| team_id               | uuid     | 归属团队 (团队 skill) |

---

## 6. 部署拓扑

```
用户机器 A (macOS)                  用户机器 B (Windows)
┌────────────────────┐             ┌────────────────────┐
│  V3.0 Desktop.app  │             │  V3.0 Desktop.exe  │
│  Chrome Extension  │             │  Edge Extension    │
│  本地数据 (JSONL+SQLite)           │  本地数据            │
└────────┬───────────┘             └────────┬───────────┘
         │                                  │
         │    HTTPS (登录后)                    │
         └──────────────┬───────────────────┘
                        │
              ┌─────────┴─────────┐
              │  TrustTools 云端   │
              │  (最小化服务)      │
              │                   │
              │  Nginx            │
              │  ├─ Auth API      │
              │  │  (phone+code)  │
              │  ├─ Team API      │
              │  │  (MySQL/PSQL)  │
              │  └─ Pricing CDN   │
              │     (静态JSON)    │
              └───────────────────┘
```

---

## 7. 风险清单

| 风险                        | 影响               | 缓解                        |
| --------------------------- | ------------------ | --------------------------- |
| 技术栈未定                  | 阻塞排期           | 尽快和老板对齐              |
| 27 个 AI 工具日志格式差异大 | Token 引擎工作量大 | 好弄的先上，逐个覆盖        |
| 本地 API 和浏览器插件通信   | 跨进程通信复杂度   | 统一 localhost 协议         |
| 云端团队服务另增复杂度      | 运维成本           | 最小化云端——仅鉴权+团队数据 |

---

## 8. 自检摘要

- [x] 本地 vs 云端边界清晰划分
- [x] 数据流完整覆盖采集→存储→展示
- [x] 现有 V2.4 和 V3.0 关系明确
- [x] 技术栈标注为假设（Node.js）
- [ ] 待技术栈决策后更新部署和运行时章节
