<div align="center">

[中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md)

</div>

# skill-scanner

Private development package for an ESM TypeScript Skill security scanner. It never executes
supplied files and never persists API keys. Scanning is privacy-preserving by default: pass
in-memory `files` (path + content — no disk I/O), or pass file/directory `paths` and the
scanner reads them from disk. `quick` runs static rules; `full` adds optional model review
via the **OpenAI Responses**, **OpenAI Chat Completions**, or **Anthropic Messages** API.

```ts
import { scanSkill } from "skill-scanner";
const report = await scanSkill({ mode: "quick", files: [{ path: "SKILL.md", content: "# Demo" }] });
// or scan a file/directory directly from disk:
const reportFromPath = await scanSkill({ mode: "quick", paths: ["/path/to/skill_dir"] });
```

## Detection

- **76 static rules** across **11 risk kinds** (`remote_execution` / `command_injection` /
  `data_exfiltration` / `secret_access` / `persistence` / `destructive` / `obfuscation` /
  `privilege_escalation` / `sensitive_file_access` / `network_abuse` /
  `prompt_injection`), including per-language command-injection rules, Windows/macOS-specific
  patterns and an IOC blocklist (C2 IPs, exfil/OAST domains, malicious GitHub accounts,
  malware hashes).
- **File-level checks** (`RISK_FILE` and related rules): risky file extensions, oversized content (>1MB),
  extremely long files (>2000 lines), consecutive-newline hiding and suspicious public IPs
  (with a DNS/CDN whitelist).
- **Rule verification**: `full` mode asks the lite model to verify each non-bypassed static
  hit and drop false positives; IOC and file-level hits marked bypass are skipped.
- **Model passes**: an input containing only `SKILL.md` runs `singleFileAnalysis` (pro); multi-file inputs run `multiFileAnalysis` (pro), which
  runs a **ReAct agent loop** over in-memory files (tools `list_files` / `read_file` / `grep`,
  ≤ `maxAgentTurns`, default 12) to trace cross-file behavior — falls back to a single-shot
  dump on failure. Per-file content sent to the model is capped (head + tail, 30K chars each,
  raised via `contextWindowTokens`); model-reported categories are normalized back to the
  canonical slug kinds from localized/English aliases.
- **Dedup**: model findings colliding with a rule hit on the same file+line are dropped
  (rule wins); afterwards a lite-model **semantic dedup** removes rule findings that describe
  the same risk as a model finding (model wins).

## Scoring

Deduction-based, aligned with a 0–100 score where higher is safer:
`riskScore = max(0, 100 − Σ rule weights [each ruleId once] − Σ model finding weights)`.
`threatLevel` maps to 5 bands (critical/high/medium/low/none); `verdict` is
`block` (critical/high) / `warn` (medium) / `allow` (low/none), or `unknown` for a
partial scan with no findings (never judged safe).

## Report

The report (Zod-validated) includes `findings` (with language-independent `kind`/`severity`
slugs plus localized `kindDisplay`/`severityDisplay`), `rules` (static findings aggregated by
ruleId, with `count` and per-match `matches`), `branches` (static/ruleReview/singleFileAnalysis/
multiFileAnalysis with complete/skipped/failed), `skippedFiles`, `categories` (per-kind count /
highest severity / total weight), `threatLevel`, `threatLevelDisplay`, `locale`, `contentHash`
and `riskScore`. It also includes `tokenUsage`: model request and reported-usage counts, input/output/total
tokens, plus per-model and per-branch breakdowns. Its status is `not_applicable`, `complete`, `partial`, or
`unavailable`, so a proxy that omits usage is never misreported as a measured zero-token call. OpenAI cached
tokens remain included in input, while Anthropic cache read/creation tokens are added to input; cache hits are
also exposed separately as `cachedInputTokens`. Excerpts are secret-redacted; in `files` mode, path/content are never read from disk.
When scanning `paths`, report `path` values are absolute disk paths.
Each finding carries a `fileHash` (SHA-256 of path+content) and its `id` is `ruleId:fileHash:line`,
so ids are content-addressed and never leak the path.
Model findings carry a `reasoning` rationale; their `message`/`remediation` are supplied by the model in the
request locale (zh-CN uses the Chinese variant). Model analysis uses English versions of the
knownsec-skill-scanner reference prompts (`src/model/prompts/*.md`); the Chinese originals are kept as `*.zh.md`.

## Internationalization (locale)

Requests may carry `locale: "zh-CN" | "en-US" | "ja-JP" | "ko-KR"` (default `zh-CN`). Rule names,
descriptions, remediation and the summary in scan results are generated in that locale;
`kind`/`severity`/`verdict`/`contentHash`/rule IDs stay language-independent.
The report persists `locale` and `contentHash` (SHA-256 over sorted path+content), so hosts can use
`contentHash + scannerVersion + rulesVersion + mode + locale` as a language-isolated cache key.
When `report.locale !== current language`, mark the report as "needs re-scan" and do not reuse it directly.

## Module structure

```
src/
  i18n/        Localized resources (zh-CN / en-US / ja-JP / ko-KR)
  rules/       76 reference rules + metadata (language-independent)
  detection/   Static scan / file-level checks / dedup / scoring / report aggregation
  model/       Transport (OpenAI Responses / Chat Completions / Anthropic) / Agent loop / normalization / prompts
  scanner.ts   Orchestrator
  types.ts     Zod schemas
```

## LLM configuration & testing (full mode)

`model` supports three protocols, selected via `provider`: `"openai-responses"`,
`"openai-completions"`, or `"anthropic"`. The legacy value `"openai"` remains supported and maps to
`"openai-completions"`. When omitted, the endpoint is inspected: containing `anthropic`/`claude` or
ending in `/messages` → anthropic, ending in `/responses` → openai-responses, otherwise → openai-completions.

| provider | endpoint convention | actual request | auth header |
|---|---|---|---|
| `openai-responses` | base URL, e.g. `https://api.openai.com/v1` | appends `/responses` | `Authorization: Bearer <key>` |
| `openai-completions` | base URL, e.g. `https://api.openai.com/v1` | appends `/chat/completions` | `Authorization: Bearer <key>` |
| `anthropic` | `https://api.anthropic.com/v1` (or omit `/v1`) | appends `/messages` | `x-api-key` + `anthropic-version: 2023-06-01` |
| `openai` (legacy) | same as `openai-completions` | appends `/chat/completions` | `Authorization: Bearer <key>` |

Example run (`examples/run-full-scan.mjs` reads environment variables, builds `model`, and runs a
full scan over a directory):

```bash
# OpenAI Responses
LLM_PROVIDER=openai-responses LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# OpenAI Chat Completions compatible (OpenAI / DeepSeek / vLLM / Ollama ...)
LLM_PROVIDER=openai-completions LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# If LLM_PROVIDER is omitted, openai-completions is used by default
LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# Anthropic
LLM_PROVIDER=anthropic LLM_ENDPOINT=https://api.anthropic.com/v1 LLM_API_KEY=sk-ant-... \
LLM_LITE_MODEL=claude-sonnet-5 LLM_PRO_MODEL=claude-opus-5 \
node examples/run-full-scan.mjs /path/to/skill_dir
```

Supported environment variables:

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | no | `openai-responses` / `openai-completions` / `anthropic`; legacy `openai` maps to `openai-completions`; auto-detected when omitted |
| `LLM_ENDPOINT` | yes | base URL, see endpoint conventions above |
| `LLM_API_KEY` | yes | API key (used only in the request, never persisted) |
| `LLM_LITE_MODEL` | yes | model for rule verification + semantic dedup |
| `LLM_PRO_MODEL` | yes | model for single/cross-file behavioral analysis |
| `LLM_TIMEOUT_MS` | no | per-call model timeout, default 120000 |
| `LLM_CONTEXT_WINDOW_TOKENS` | no | model context window (tokens), e.g. `1000000` for 1M; raises the content cap sent to the model when declared |
| `LLM_MAX_AGENT_TURNS` | no | max tool-call turns for the multiFileAnalysis behavioral agent, default 12 |
| `LLM_LOCALE` | no | `zh-CN`/`en-US`/`ja-JP`/`ko-KR`, default `zh-CN` |

You can also write these variables to a `.env` file in the project root (already gitignored) and run
`set -a; source .env; set +a` first.

Passing `model` directly in code also works: `{ provider, endpoint, apiKey, liteModel, proModel, timeoutMs? }`.
Responses uses `/responses`, Chat Completions uses `/chat/completions`, and Anthropic uses `/messages`;
the path is not appended twice when the endpoint already includes it.
Model output must be strict JSON; responses tolerate markdown code fences and surrounding comment text.
If any branch fails, a `partial` report is returned with static results preserved and the branch marked
failed/skipped in `branches`. See the exported Zod schemas for details.

## CLI

The package ships a `skill-scanner` bin command (build first with `npm run build`, then use
`npm link` or `node dist/cli.js`):

```bash
skill-scanner <file-or-directory> [options]
```

Examples:

```bash
# static-only scan of a directory (or a single file)
skill-scanner /path/to/skill_dir
skill-scanner /path/to/SKILL.md

# full scan via a JSON config file
skill-scanner /path/to/skill_dir --config .skill-scanner.json

# full scan via environment variables (LLM_*)
LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
skill-scanner /path/to/skill_dir

# full JSON report to stdout, or to a file
skill-scanner /path/to/skill_dir --json
skill-scanner /path/to/skill_dir --json --output report.json
```

`.skill-scanner.json` (the `model` object mirrors the library `model` config):

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

A ready-to-copy template ships at `.skill-scanner.example.json` — copy it to `.skill-scanner.json`
and fill in your values (the real config file is gitignored, so API keys are never committed).

Options:

| Flag | Description |
|---|---|
| `<file-or-directory>` | target to scan |
| `--config <file>` | JSON config file (default: `./.skill-scanner.json`) |
| `--mode <quick\|full>` | scan mode (default: full if a model is configured, else quick) |
| `--quick` | static-only scan |
| `--locale <locale>` | `zh-CN` / `en-US` / `ja-JP` / `ko-KR` (default `zh-CN`) |
| `--provider <openai-responses\|openai-completions\|anthropic>` | LLM protocol (legacy `openai` maps to `openai-completions`) |
| `--endpoint <url>` | LLM base URL |
| `--api-key <key>` | LLM API key |
| `--lite-model <name>` | model for rule verification + semantic dedup |
| `--pro-model <name>` | model for single/cross-file behavioral analysis |
| `--timeout-ms <ms>` | per-call model timeout (default 120000) |
| `--context-window-tokens <n>` | model context window in tokens |
| `--max-agent-turns <n>` | behavioral agent tool-call turns (default 12) |
| `--json` | output the full JSON report |
| `--output <file>` | write the report to a file |
| `--verbose` | verbose scan logging to stderr (keeps stdout clean for the report) |
| `-h, --help` | show help |
| `-v, --version` | show version |

Config precedence: CLI flags > config file > `LLM_*` environment variables.
The CLI auto-loads `./.env` from the current directory (without overriding already-set variables), so no manual `source` is needed.
