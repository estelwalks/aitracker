<div align="center">

**中文** · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

</div>

# skill-scanner

面向 Agent Skill 的隐私保护型安全扫描器（ESM / TypeScript）。它从不执行宿主提供的文件、也从不持久化 API key。
扫描默认保持隐私：可传入内存 `files`（path + content，不读盘），也可传入文件/目录 `paths` 由扫描器从磁盘读取。
`quick` 模式运行静态规则；`full` 模式额外通过 **OpenAI Responses**、**OpenAI Chat Completions** 或 **Anthropic Messages** API 进行模型复核。
API key 仅在单次请求中使用，从不落盘、也从不被返回。

```ts
import { scanSkill } from "skill-scanner";
const report = await scanSkill({ mode: "quick", files: [{ path: "SKILL.md", content: "# Demo" }] });
// 或直接扫描文件/目录（从磁盘读取）：
const reportFromPath = await scanSkill({ mode: "quick", paths: ["/path/to/skill_dir"] });
```

## 检测能力

- **76 条静态规则**覆盖 **11 类风险**（`remote_execution` / `command_injection` /
  `data_exfiltration` / `secret_access` / `persistence` / `destructive` / `obfuscation` /
  `privilege_escalation` / `sensitive_file_access` / `network_abuse` /
  `prompt_injection`），包括按语言区分的命令注入规则、Windows/macOS 专属特征以及 IOC 黑名单
  （C2 IP、外发/OAST 域名、恶意 GitHub 账号、恶意软件哈希）。
- **文件级检查**（`RISK_FILE` 等规则）：风险扩展名、超大内容（>1MB）、超长文件（>2000 行）、
  连续换行隐藏与可疑公网 IP（含 DNS/CDN 白名单）。
- **规则复核**：`full` 模式由 lite 模型逐条验证非 bypass 的静态命中并剔除误报；
  带 bypass 标记的 IOC 与文件级命中直接保留。
- **模型分析**：仅包含一个 `SKILL.md` 时运行 `singleFileAnalysis`（pro）；多文件时运行 `multiFileAnalysis`（pro），后者在
  内存文件上运行 **ReAct agent 循环**（工具 `list_files` / `read_file` / `grep`，
  ≤ `maxAgentTurns`，默认 12）追踪跨文件行为——失败时回退为单次灌内容，能力不回退。
  发送给模型的单文件内容设有上限（头尾各 30K 字符，可通过 `contextWindowTokens` 放宽）；
  模型返回的类别会从本地化/英文别名归一化回规范 slug。
- **去重**：与规则命中同 file+line 的模型发现被剔除（规则优先）；
  随后由 lite 模型做**语义去重**，剔除与模型发现描述同一风险的规则命中（模型优先）。

## 评分

扣分制，对齐 0–100 分、分数越高越安全：
`riskScore = max(0, 100 − Σ 规则权重 [每条 ruleId 只扣一次] − Σ 模型发现权重)`。
`threatLevel` 映射到 5 档（critical/high/medium/low/none）；`verdict` 为
`block`（critical/high）/ `warn`（medium）/ `allow`（low/none），
部分扫描且零发现时为 `unknown`（绝不判为安全）。

## 报告

报告（Zod 校验）包含 `findings`（语言无关的 `kind`/`severity` slug，加上本地化的
`kindDisplay`/`severityDisplay`）、`rules`（按 ruleId 聚合的静态发现，含 `count` 与逐条 `matches`）、
`branches`（static/ruleReview/singleFileAnalysis/multiFileAnalysis，状态 complete/skipped/failed）、
`skippedFiles`、`categories`（按类别统计数量 / 最高严重度 / 总权重）、`threatLevel`、
`threatLevelDisplay`、`locale`、`contentHash`、`riskScore` 与 `tokenUsage`。`tokenUsage` 提供模型请求数、
返回 usage 的请求数、input/output/total token 总计，并按模型和分支细分；`status` 为 `not_applicable`、
`complete`、`partial` 或 `unavailable`，因此代理未返回 usage 时不会被误报为已消耗 0 token。OpenAI 的
缓存 token 已包含在 input 中，Anthropic 的 cache read/create token 会计入 input，`cachedInputTokens` 单独展示缓存命中量。
摘录内容会做密钥脱敏；`files` 模式下路径与内容从不读盘。`paths` 模式下报告的 `path` 为磁盘绝对路径。
每条 finding 携带 `fileHash`（path+content 的 SHA-256），`id` 为 `ruleId:fileHash:line`，内容寻址、不泄露路径。
模型发现携带 `reasoning` 判定理由，`message`/`remediation` 由模型按请求 locale 提供（zh-CN 取中文变体）；模型分析使用 knownsec-skill-scanner 参考提示词的**英文版**（`src/model/prompts/*.md`），中文原版保留为 `*.zh.md`。

## 国际化（locale）

请求可携带 `locale: "zh-CN" | "en-US" | "ja-JP" | "ko-KR"`（默认 `zh-CN`）。扫描结果中的规则名、
描述、修复建议与摘要按该 locale 生成；`kind`/`severity`/`verdict`/`contentHash`/规则 ID 保持语言无关。
报告持久化 `locale` 与 `contentHash`（对排序后的 path+content 做 SHA-256），宿主可用
`contentHash + scannerVersion + rulesVersion + mode + locale` 作为按语言隔离的缓存键；
当 `report.locale !== 当前语言` 时标记“需要重新检测”，不应直接复用该报告。

## 模块结构

```
src/
  i18n/        多语言资源（zh-CN / en-US / ja-JP / ko-KR）
  rules/       76 条参考规则 + 元数据（语言无关）
  detection/   静态扫描 / 文件级检查 / 去重 / 评分 / 报告聚合
  model/       传输层（OpenAI Responses / Chat Completions / Anthropic）/ Agent 循环 / 归一化 / 提示词
  scanner.ts   编排器
  types.ts     Zod schemas
```

## LLM 配置与测试（full 模式）

`model` 支持三种协议，通过 `provider` 指定：`"openai-responses"`、`"openai-completions"` 或
`"anthropic"`。旧值 `"openai"` 仍兼容，并映射为 `"openai-completions"`。
缺省时按 endpoint 自动探测：含 `anthropic`/`claude` 或路径以 `/messages` 结尾 → anthropic，
以 `/responses` 结尾 → openai-responses，否则 → openai-completions。

| provider | endpoint 约定 | 实际请求 | 鉴权头 |
|---|---|---|---|
| `openai-responses` | 基础地址，如 `https://api.openai.com/v1` | 追加 `/responses` | `Authorization: Bearer <key>` |
| `openai-completions` | 基础地址，如 `https://api.openai.com/v1` | 追加 `/chat/completions` | `Authorization: Bearer <key>` |
| `anthropic` | `https://api.anthropic.com/v1`（或省略 `/v1`） | 追加 `/messages` | `x-api-key` + `anthropic-version: 2023-06-01` |
| `openai`（旧值） | 同 `openai-completions` | 追加 `/chat/completions` | `Authorization: Bearer <key>` |

运行示例（`examples/run-full-scan.mjs` 读取环境变量、构造 `model`、对目录跑 full 扫描）：

```bash
# OpenAI Responses
LLM_PROVIDER=openai-responses LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# OpenAI Chat Completions 兼容（OpenAI / DeepSeek / vLLM / Ollama ...）
LLM_PROVIDER=openai-completions LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# 未指定 LLM_PROVIDER 时，默认使用 openai-completions
LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# Anthropic
LLM_PROVIDER=anthropic LLM_ENDPOINT=https://api.anthropic.com/v1 LLM_API_KEY=sk-ant-... \
LLM_LITE_MODEL=claude-sonnet-5 LLM_PRO_MODEL=claude-opus-5 \
node examples/run-full-scan.mjs /path/to/skill_dir
```

支持的环境变量：

| 变量 | 必填 | 说明 |
|---|---|---|
| `LLM_PROVIDER` | 否 | `openai-responses` / `openai-completions` / `anthropic`；旧值 `openai` 映射为 `openai-completions`；缺省按 endpoint 自动探测 |
| `LLM_ENDPOINT` | 是 | 基础地址，见上表 endpoint 约定 |
| `LLM_API_KEY` | 是 | API key（仅在请求中使用，不落盘） |
| `LLM_LITE_MODEL` | 是 | 规则复核 + 语义去重模型 |
| `LLM_PRO_MODEL` | 是 | 单文件/跨文件行为分析模型 |
| `LLM_TIMEOUT_MS` | 否 | 单次模型调用超时，默认 120000 |
| `LLM_CONTEXT_WINDOW_TOKENS` | 否 | 模型上下文窗口（token），如 `1000000` 表示 1M；声明后放宽发给模型的内容上限 |
| `LLM_MAX_AGENT_TURNS` | 否 | multiFileAnalysis 行为 agent 的最大工具调用轮数，默认 12 |
| `LLM_LOCALE` | 否 | `zh-CN`/`en-US`/`ja-JP`/`ko-KR`，默认 `zh-CN` |

可把这些变量写入项目根目录 `.env`（已加入 `.gitignore`），`set -a; source .env; set +a` 后运行。

程序内直接传 `model` 亦可：`{ provider, endpoint, apiKey, liteModel, proModel, timeoutMs? }`。
Responses 协议使用 `/responses`，Chat Completions 使用 `/chat/completions`，Anthropic 使用 `/messages`；
endpoint 已包含对应路径时不会重复追加。
模型文本须返回严格 JSON；响应会容忍 markdown 代码围栏与前后注释。任一分支失败返回 `partial`
报告并保留静态结果，`branches` 中标记 failed/skipped。详见导出的 Zod schema。

## 命令行（CLI）

包内附带 `skill-scanner` bin 命令（先 `npm run build`，再 `npm link` 或 `node dist/cli.js`）：

```bash
skill-scanner <文件或目录> [选项]
```

示例：

```bash
# 目录（或单个文件）静态扫描
skill-scanner /path/to/skill_dir
skill-scanner /path/to/SKILL.md

# 通过 JSON 配置文件做 full 扫描
skill-scanner /path/to/skill_dir --config .skill-scanner.json

# 通过环境变量做 full 扫描（LLM_*）
LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
skill-scanner /path/to/skill_dir

# 输出完整 JSON 报告到 stdout 或文件
skill-scanner /path/to/skill_dir --json
skill-scanner /path/to/skill_dir --json --output report.json
```

`.skill-scanner.json`（`model` 对象与库内 `model` 配置一致）：

```json
{
  "mode": "full",
  "locale": "zh-CN",
  "model": {
    "provider": "anthropic",
    "endpoint": "https://api.anthropic.com/v1",
    "apiKey": "sk-ant-...",
    "liteModel": "claude-sonnet-5",
    "proModel": "claude-opus-5"
  }
}
```

可直接复制仓库内的 `.skill-scanner.example.json` 为 `.skill-scanner.json` 后修改使用（真实配置文件已加入 `.gitignore`，避免误提交 API key）。

参数：

| 参数 | 说明 |
|---|---|
| `<文件或目录>` | 扫描目标 |
| `--config <file>` | JSON 配置文件（默认 `./.skill-scanner.json`） |
| `--mode <quick\|full>` | 扫描模式（默认：配置了模型则 full，否则 quick） |
| `--quick` | 仅静态扫描 |
| `--locale <locale>` | `zh-CN` / `en-US` / `ja-JP` / `ko-KR`（默认 `zh-CN`） |
| `--provider <openai-responses\|openai-completions\|anthropic>` | LLM 协议（旧值 `openai` 映射为 `openai-completions`） |
| `--endpoint <url>` | LLM 基础地址 |
| `--api-key <key>` | LLM API key |
| `--lite-model <name>` | 规则复核 + 语义去重模型 |
| `--pro-model <name>` | 单文件/跨文件行为分析模型 |
| `--timeout-ms <ms>` | 单次模型调用超时（默认 120000） |
| `--context-window-tokens <n>` | 模型上下文窗口（token） |
| `--max-agent-turns <n>` | 行为 agent 最大工具调用轮数（默认 12） |
| `--json` | 输出完整 JSON 报告 |
| `--output <file>` | 将报告写入文件 |
| `--verbose` | 将详细扫描日志输出到 stderr（不污染 stdout 的报告输出） |
| `-h, --help` | 显示帮助 |
| `-v, --version` | 显示版本 |

配置优先级：CLI 参数 > 配置文件 > `LLM_*` 环境变量。
CLI 会自动读取当前目录下的 `.env`（不覆盖已存在的环境变量），无需手动 `source`。
