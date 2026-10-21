# 归档 JSON 契约与渲染设计（v1 草案）

> 依据：DEC-2（2026-10-19）——LLM 输出必须是结构化 JSON，Markdown 只是展示层。
> 关联：[会话归档与报告需求分析](aitracker-会话归档与报告需求分析.md) §5、需求文档 §5/§7、现有 `src/modules/reports/templates.ts`。
> 状态：草案，待研发评审。

---

## 1. 设计原则

1. **模型只填内容，结构由系统定义。** 字段名、枚举、数量上限、必填项全部固定；自定义提示词只能调整关注点、语言、篇幅，不能改结构。
2. **可校验优先于可读。** 先过 schema 与引用校验，再渲染；校验不过的内容不进库。
3. **引用必须可验证。** 所有事实性字段带 `citations`，ID 来自系统提供的消息清单，模型不得自造。
4. **失败不污染数据。** 新版本失败时保留旧版本；不把半成品写成"当前版本"。
5. **渲染与内容分离。** 换模板、换语言、改排版都不需要重新调模型。
6. **schema 版本化。** 历史归档在若干版本后仍能被渲染出来。
7. **上下文用到 80% 为止。** 不为了省 token 牺牲完整性，也不把最后 20% 的余量用掉；分段只在超出该预算时发生。

---

## 2. 分层

```
系统组装输入 ──► 模型（只输出 JSON） ──► 校验/修复 ──► 入库(JSON + 版本)
                                                      │
                                                      ▼
                                              渲染器(模板/i18n) ──► Markdown / 页面
```

| 层 | 负责 | 不负责 |
|---|---|---|
| 输入组装 | 消息、时间、ID、既有任务、覆盖度、上下文预算 | 不做摘要 |
| 模型 | 任务归并、内容概括、给出引用 | 不生成结构、不造 ID、不判断完成率 |
| 校验 | schema、引用存在性、ID 合法性、日期范围、去重 | 不修文风 |
| 存储 | JSON 原文 + 版本 + prompt/model/schema 版本 | 不存完整转录 |
| 渲染 | 标题、分组、引用角标、多语言 | 不调模型 |

---

## 3. 输入契约（系统组装）

模型收到的输入是四段，边界清晰：

```json
{
  "task": "archive_session",
  "session": {
    "tool": "claude-code",
    "sessionId": "abc-123",
    "title": "重构报告模块",
    "timeRange": { "start": "2026-09-24T09:12:00+08:00", "end": "2026-09-24T11:40:00+08:00" },
    "timePrecision": "exact"
  },
  "messages": [
    { "id": "m_001", "role": "user", "ts": "2026-09-24T09:12:03+08:00", "text": "..." },
    { "id": "m_002", "role": "assistant", "ts": "2026-09-24T09:12:40+08:00", "text": "..." }
  ],
  "existingTasks": [
    { "taskId": "t_7f3a", "date": "2026-09-23", "title": "报告模板重构", "outcomeSummary": "..." }
  ],
  "coverage": { "status": "partial", "readMessages": 120, "totalMessages": 180, "note": "第 121 条之后超出上下文未读" },
  "limits": { "maxTasks": 50, "maxOutcomesPerTask": 20, "maxCitationsPerTask": 20 },
  "budget": { "contextWindow": 1000000, "usableContext": 800000, "maxOutput": 32000 }
}
```

要点：

- **消息 ID 由系统生成**，同一会话重复处理时必须稳定（见分析文档 §2.3）。
- **覆盖度由读取器报告**，模型不得猜测"已读完整"。
- **`existingTasks` 是增量合并的关键**：模型必须优先复用其中的 `taskId`，只有确实是新目标时才输出 `"new"`。
- **默认送全量会话**（DEC-5）：只要在 80% 可用上下文内，不裁剪、不采样、不提前摘要。只有超出时才分段，且每段标明范围。
- `budget.usableContext` 是程序按"实测上下文 × 80%"算出的输入预算，而不是标称值。
- `budget.contextWindow` 是标称值，只用于展示与诊断；真正决定是否分段的是 `usableContext`（见 §4.4）。

---

## 4. 输出契约

### 4.1 Schema（等价 JSON Schema，字段即约束）

```json
{
  "schemaVersion": 1,
  "tasks": [
    {
      "taskId": "existing:t_7f3a | new",
      "title": "string, 1..120",
      "date": "YYYY-MM-DD | null",
      "datePrecision": "exact | estimated | unknown",
      "goal": "string, 1..500",
      "actions": ["string, 1..300"],
      "outcomes": [
        {
          "artifactId": "existing:a_12 | new",
          "kind": "document | code | file | test | analysis | other",
          "summary": "string, 1..800",
          "evidence": "produced | verified | self_claimed | failed",
          "citations": ["m_001"]
        }
      ],
      "progress": "string, 0..500 | null",
      "feedback": [
        { "summary": "string, 1..300", "citations": ["m_004"] }
      ],
      "followUps": ["string, 1..300"],
      "citations": ["m_001"]
    }
  ],
  "limitations": ["string, 0..300"],
  "coverageNote": "string | null"
}
```

约束：

| 项 | 上限 / 规则 |
|---|---|
| `tasks` | ≤ 50 |
| `actions` | ≤ 15 / 任务 |
| `outcomes` | ≤ 20 / 任务 |
| `feedback` | ≤ 10 / 任务 |
| `followUps` | ≤ 10 / 任务 |
| `citations` | ≤ 20 / 任务；每条必须存在于输入消息 |
| `taskId` / `artifactId` | 只能取 `existing:<已知ID>` 或 `new` |
| `date` | 必须落在 `session.timeRange` 的日期范围内，否则 `datePrecision` 降为 `unknown` |
| 文本字段 | `title` ≤120、`goal` ≤1000、`summary` ≤2000、其他 ≤500；不得包含绝对路径、密钥、邮箱；由程序二次扫描兜底 |

上限的作用是**防止模型失控**，不是压缩效果。长会话里有 30 个任务、每个任务 15 条产出，都应该完整记下来——这正是 DEC-5 要的"不要太小"。

### 4.2 示例

```json
{
  "schemaVersion": 1,
  "tasks": [
    {
      "taskId": "new",
      "title": "重构报告模板并补齐测试",
      "date": "2026-09-24",
      "datePrecision": "exact",
      "goal": "把报告正文从固定文本改为按模板渲染，并补测试",
      "actions": ["梳理现有模板与调用点", "拆分正文构建与渲染", "补充模板一致性测试"],
      "outcomes": [
        {
          "artifactId": "new",
          "kind": "code",
          "summary": "新增模板渲染模块，报告正文改由模板输出",
          "evidence": "verified",
          "citations": ["m_003", "m_008"]
        }
      ],
      "progress": "渲染模块已完成，历史报告尚未迁移",
      "feedback": [
        { "summary": "用户要求保留原有章节顺序", "citations": ["m_012"] }
      ],
      "followUps": ["迁移历史报告"],
      "citations": ["m_001", "m_003", "m_008", "m_012"]
    }
  ],
  "limitations": ["第 121 条之后的消息未读取，可能缺少后续任务"],
  "coverageNote": "部分覆盖"
}
```

### 4.3 系统注入字段（不信任模型）

以下字段**不由模型输出**，即使模型给了也一律覆盖：

`sessionKey`、`tool`、`sessionId`、`generatedAt`、`promptProfileId`、`promptVersion`、`modelId`、`schemaVersion`、`coverage`、`messageIdMap`。

理由：这些是审计与追溯的依据，模型无权决定。

### 4.4 上下文与输出策略（DEC-5）

原则：**效果优先，输入尽量用足，但只到可用上下文的 80%**；剩下 20% 留给输出与误差，分段是兜底而不是常态。

定义：

```
可用上下文 = min(模型标称上下文, 实测可用值) × 80%
例：标称 1M → 实际按 800k 计算输入预算
```

剩下 20% 用于：输出 token、系统提示词、schema 说明、重试时的错误回传，以及应对 tokenizer 估算误差。

| 情况 | 处理 |
|---|---|
| 会话 token ≤ 可用上下文 | 一次送全量，不分段、不采样、不摘要 |
| 会话超出可用上下文 | 按消息时间和目标切段；每段带 `existingTasks`，段间靠 `taskId` 合并；覆盖度如实标注 |
| 单个任务产出多、输出接近上限 | 按任务分批输出，沿用同一 `taskId`；不要为了塞进一次输出而删减内容 |
| 上下文标称 1M 但实际可用更小 | 以探测到的实际值为准，再乘 80%，记录到 provider 能力矩阵 |

实现细节：

- `budget.usableContext` 由程序计算后传给模型侧；不要写死 800k，因为不同 provider 的实测值不同。
- `budget.contextWindow` 与 `budget.maxOutput` 必须来自实测/配置，不能写死。
- 分段时不能静默丢消息：未读范围写入 `coverage` 与 `limitations`。
- 长上下文模型仍可能"中间遗忘"：提示词要求按时间顺序遍历全部消息、覆盖首尾任务，不要只总结开头和结尾。

---

## 5. 校验流水线

```
原始响应
  → 1. 提取 JSON（容忍 ```json 围栏、前后解释文字、取第一个配平对象）
  → 2. parse
  → 3. schema 校验（类型/枚举/长度/数量上限）
  → 4. 引用校验（每个 citation ∈ 输入消息 ID）
  → 5. ID 校验（existing:<id> 必须存在；new 合法）
  → 6. 日期校验（落在输入范围内）
  → 7. 去重校验（taskId 唯一；同 task 的 artifactId 唯一）
  → 8. （失败时）一次修复：把错误列表 + 原输出回传，要求只返回修正后的 JSON
  → 9. 分级接受 → 入库
```

分级接受规则：

| 情况 | 处理 |
|---|---|
| 完全无法解析 / schema 校验失败（修复后仍失败） | 本次任务失败，**保留旧版本**，记录错误码 |
| 引用不存在 | 丢弃该 citation，对应内容标记 `unverified`，**不删除整条任务** |
| `taskId` 非法 | 该任务降级为 `new` 并记录诊断，不丢弃内容 |
| 日期越界 | `date` 置 null、`datePrecision: unknown`，写入 `limitations` |
| 重复 `taskId` | 合并；无法合并则保留第一条并记录诊断 |
| 超上限 | 截断并记录诊断 |

**原则：信息可以降级，但不能静默消失。** 所有降级都写入 `diagnostics`，在归档详情页可见。

---

## 6. 渲染

### 6.1 输入

- 归档 JSON
- 渲染器版本与 locale
- 引用可解析性（源消息是否仍存在）

### 6.2 输出结构

```markdown
# 会话工作记录

- 会话主题：{session.title 或首个 goal}
- 来源与日期：{tool} · {date}（{precision 文案}）
- 读取覆盖：{coverage}

## {date 或 "任务时间未提供"}

### {task.title}

- 用户目的：{goal}
- AI 行为：{actions.join("；")}
- 产出与进展：{outcomes...}；{progress}
- 用户反馈：{feedback...}          ← 无则省略
- 后续事项：{followUps...}         ← 无则省略

（引用：{citation 角标，指向来源列表}）
```

### 6.3 规则

- **标题与章节名来自 i18n**，不来自模型；这样 4 个语言包共用同一份 JSON。
- **引用渲染成角标**（`[1]`），文末列出"来源：m_003 ✔ / m_031 ✘ 源已不可用"。
- **日期按 `date` 分组**；`unknown` 单独成节并标注，不推测日期。
- **证据等级用词**：`verified` → "已执行/已验证"；`self_claimed` → "AI 自述，未验证"；`failed` → "尝试未成功"；`produced` → "已生成"。
- **重新渲染不调模型**：改模板、改语言、改排版都从存储的 JSON 重渲染，成本为零。
- `safeReportText` 作为渲染后的最后一道防线保留。

---

## 7. 报告侧 JSON

报告同样拆分"系统统计"与"模型叙述"：

```json
{
  "schemaVersion": 1,
  "sections": [
    {
      "id": "overview",
      "items": [{ "text": "本周主要在报告模块和归档链路上工作。", "citations": ["archive:t_7f3a", "archive:t_81b2"] }]
    },
    {
      "id": "work_and_output",
      "items": [{ "text": "...", "citations": ["archive:t_7f3a"] }]
    }
  ],
  "feedback": [{ "text": "...", "citations": ["archive:t_9c01"] }],
  "followUps": [{ "text": "...", "citations": ["archive:t_9c01"] }]
}
```

- `sections.id` 固定为 `overview` / `work_and_output` / `feedback` / `followUps`，文案由 i18n 提供。
- 数字（会话数、token、费用、任务数、产出覆盖率）**由系统计算并渲染**，模型不参与。
- **报告输入默认送当期全量归档**（JSON 或渲染后的正文），不因 token 数主动裁剪——800k 输入预算下，一个月的归档通常放得下。
- 只有在超出可用上下文时才降级：先换成"归档索引行 + 产出摘要"，再不够就按周/半月分批汇总后合并。降级必须在报告上标注为"部分素材"。

---

## 8. Provider 能力与调用参数

| 能力 | 处理 |
|---|---|
| 原生 JSON mode / structured outputs | 优先启用，能显著降低解析失败率 |
| 只有普通对话接口 | 严格提示 + 提取器 + 一次修复 |
| 上下文窗口（标称 vs 实测） | 探测实际值并记录；按实际值决定是否分段 |
| 最大输出 token | 按任务分批，不删减内容；记录分批边界 |
| 支持 tool use / function calling | 可用作 schema 约束的替代实现 |
| 温度 | 归档 0–0.2；报告 0.2–0.5 |

调用参数（模型、温度、输入输出 token、费用）写入 `archive_version` / `report` 表，供追溯与成本统计。现有 `sqlite-ai-execution-repository` 可以直接记录这些执行。

---

## 9. 失败与状态

```
pending → generating → validating → (repairing) → stored
                                   └→ failed（保留旧版本）
```

- 生成失败不改变"当前版本"指针。
- 队列中的任务固定使用启动时的提示词版本（需求 §5 已要求）。
- 同一会话的自动与手动任务串行/合并；旧任务结果不得覆盖新版本（用版本号 CAS）。

---

## 10. 版本与迁移

| 版本 | 位置 | 作用 |
|---|---|---|
| `schemaVersion` | JSON 内 | 决定校验规则 |
| `renderVersion` | 存储行 | 决定渲染模板 |
| `promptVersion` | 存储行 | 复现当时的提示词 |
| `modelId` | 存储行 | 复现当时的模型 |

- 读取时按 `schemaVersion` 选择迁移函数，迁移结果**不写回**原记录。
- 渲染器必须能读旧 schema；不能读时降级为"原始 JSON 查看"。
- 删除策略：保留最近 N 个版本 + 人工编辑版永久保留。

---

## 11. 测试要求

1. **契约测试**：合法输出通过；缺字段、类型错、超上限、重复 ID 被正确拒绝或降级。
2. **对抗输出**：```json 围栏、前后解释、多个 JSON、尾部截断、编造 citation、编造 taskId。
3. **属性测试**：输出中每个 citation 都能在输入里找到；每个 `existing:` ID 都来自输入。
4. **渲染快照**：4 个 locale、日期分组、`unknown` 日期、源不可用引用。
5. **隐私**：渲染结果与错误信息不含绝对路径、密钥、邮箱。
6. **幂等**：同一输入重跑，任务/产物 ID 不漂移。

---

## 12. 与现有代码的衔接

| 现状 | 调整 |
|---|---|
| `templates.ts` 自由文本模板 + 版本号 | 保留版本机制，改为"JSON schema + 渲染模板"两套版本 |
| `session-content-digest.ts` 采样摘要 | 归档上线后退役，报告改读归档索引 |
| `ai-generation-adapter.ts` 直接拼正文 | 改为"调用 → JSON → 校验 → 入库"，正文由渲染器产生 |
| `safeReportText` | 保留，位置后移到渲染之后 |
| 自定义提示词（需求 §5） | 拆成三段：固定 schema 段（不可改）+ 用户可编辑段 + 系统数据段 |
| `sqlite-ai-execution-repository` | 记录归档/报告调用的 token 与费用 |

---

## 13. 待确认

1. `schemaVersion` 是否允许字段级扩展（例如未来加"知识沉淀"字段）？建议只增不改，旧渲染器忽略未知字段。
2. 自定义提示词能否影响 `kind` / `evidence` 枚举？建议不能。
3. 报告 JSON 的 `sections` 是否允许用户自定义章节？建议固定四段，避免再次依赖标题解析。
