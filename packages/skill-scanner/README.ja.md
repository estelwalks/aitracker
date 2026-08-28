<div align="center">

[中文](README.md) · [English](README.en.md) · **日本語** · [한국어](README.ko.md)

</div>

# skill-scanner

Agent Skill 向けのプライバシー保護型セキュリティスキャナ（ESM / TypeScript）。提供されたファイルを実行することも、
API キーを永続化することもありません。スキャンはデフォルトでプライバシー保護型です：メモリ内の `files`
（path + content、ディスク I/O なし）を渡すか、ファイル/ディレクトリの `paths` を渡すとスキャナがディスクから読み取ります。
`quick` モードは静的ルールを実行します。`full` モードでは **OpenAI Responses**、**OpenAI Chat Completions**、または **Anthropic Messages** API による
モデルレビューを追加します。API キーはリクエストでのみ使用され、保存も返却もされません。

```ts
import { scanSkill } from "skill-scanner";
const report = await scanSkill({ mode: "quick", files: [{ path: "SKILL.md", content: "# Demo" }] });
// またはファイル/ディレクトリを直接スキャン（ディスクから読み取り）：
const reportFromPath = await scanSkill({ mode: "quick", paths: ["/path/to/skill_dir"] });
```

## 検出機能

- **76 件の静的ルール**が **11 種類のリスク**をカバー（`remote_execution` / `command_injection` /
  `data_exfiltration` / `secret_access` / `persistence` / `destructive` / `obfuscation` /
  `privilege_escalation` / `sensitive_file_access` / `network_abuse` /
  `prompt_injection`）。言語別のコマンドインジェクションルール、Windows/macOS 固有パターン、
  IOC ブロックリスト（C2 IP、外部送信/OAST ドメイン、悪意のある GitHub アカウント、マルウェアハッシュ）を含む。
- **ファイルレベルチェック**（`RISK_FILE` など）：リスク拡張子、超大コンテンツ（>1MB）、
  極端に長いファイル（>2000 行）、連続改行による隠蔽、不審な公開 IP（DNS/CDN ホワイトリスト付き）。
- **ルール検証**：`full` モードでは lite モデルが非 bypass の静的ヒットを 1 件ずつ検証し、誤検知を除去します。
  IOC とファイルレベルのヒットは高信頼のため、検証はスキップされます。
- **モデル解析**：`SKILL.md` だけの入力では `singleFileAnalysis`（pro）、複数ファイルでは `multiFileAnalysis`（pro）を実行します。後者は
  インメモリファイル上で **ReAct エージェントループ**（ツール `list_files` / `read_file` / `grep`、
  ≤ `maxAgentTurns`、デフォルト 12）を実行し、ファイル間の振る舞いを追跡します——失敗時は
  シングルショットにフォールバックします。モデルに送るファイルごとのコンテンツには上限があり
  （先頭＋末尾 各 30K 文字、`contextWindowTokens` で引き上げ可能）、モデルが返すカテゴリは
  ローカライズ/英語エイリアスから正規の slug に正規化されます。
- **重複排除**：同じ file+line でルールヒットと衝突するモデル発見は削除されます（ルール優先）。
  その後、lite モデルによる**意味的重複排除**が、モデル発見と同じリスクを説明するルールヒットを除去します（モデル優先）。

## スコアリング

減点方式で、0–100 点のスコアが高いほど安全です：
`riskScore = max(0, 100 − Σ ルール重み [各 ruleId につき 1 回] − Σ モデル発見の重み)`。
`threatLevel` は 5 段階（critical/high/medium/low/none）にマッピングされます。`verdict` は
`block`（critical/high）/ `warn`（medium）/ `allow`（low/none）、
発見ゼロの部分スキャンでは `unknown`（安全とは判定しない）。

## レポート

レポート（Zod 検証済み）には `findings`（言語非依存の `kind`/`severity` slug に加え、ローカライズされた
`kindDisplay`/`severityDisplay`）、`rules`（ruleId ごとに集計された静的発見。`count` と個別 `matches`）、
`branches`（static/ruleReview/singleFileAnalysis/multiFileAnalysis。complete/skipped/failed）、
`skippedFiles`、`categories`（種類ごとの件数 / 最高深刻度 / 総重み）、`threatLevel`、`threatLevelDisplay`、
`locale`、`contentHash`、`riskScore` が含まれます。抜粋はシークレットがマスクされます。`files` モードでは、パスとコンテンツはディスクから読み取られません。`paths` モードでは、レポートの `path` はディスク上の絶対パスになります。各 finding は `fileHash`（path+content の SHA-256）を持ち、`id` は `ruleId:fileHash:line` で、コンテンツアドレス型でありパスを漏らしません。モデル発見は `reasoning` の判定理由を持ち、`message`/`remediation` はモデルがリクエストの locale に応じて提供します（zh-CN は中国語版）。モデル分析は knownsec-skill-scanner 参考プロンプトの英語版（`src/model/prompts/*.md`）を使用し、中国語のオリジナルは `*.zh.md` として保持しています。

## 国際化（locale）

リクエストで `locale: "zh-CN" | "en-US" | "ja-JP" | "ko-KR"` を指定できます（デフォルト `zh-CN`）。
スキャン結果のルール名・説明・修正提案・サマリーはその locale で生成されます。
`kind`/`severity`/`verdict`/`contentHash`/ルール ID は言語非依存のままです。
レポートは `locale` と `contentHash`（ソート済み path+content の SHA-256）を保持するため、
ホストは `contentHash + scannerVersion + rulesVersion + mode + locale` を言語分離されたキャッシュキーとして使えます。
`report.locale !== 現在の言語` の場合は「再スキャンが必要」として、そのレポートを直接再利用しないでください。

## モジュール構成

```
src/
  i18n/        ローカライズ済みリソース（zh-CN / en-US / ja-JP / ko-KR）
  rules/       76 件の参照ルール + メタデータ（言語非依存）
  detection/   静的スキャン / ファイルレベルチェック / 重複排除 / スコアリング / レポート集計
  model/       トランスポート（OpenAI Responses / Chat Completions / Anthropic）/ エージェントループ / 正規化 / プロンプト
  scanner.ts   オーケストレータ
  types.ts     Zod スキーマ
```

## LLM 設定とテスト（full モード）

`model` は 3 つのプロトコルに対応し、`provider`（`"openai-responses"`、`"openai-completions"`、`"anthropic"`）で指定します。
旧値 `"openai"` も引き続き使用でき、`"openai-completions"` にマッピングされます。
省略時は endpoint から自動検出：`anthropic`/`claude` を含むか `/messages` で終わる → anthropic、
`/responses` で終わる → openai-responses、それ以外 → openai-completions。

| provider | endpoint 規約 | 実際のリクエスト | 認証ヘッダー |
|---|---|---|---|
| `openai-responses` | ベース URL（例 `https://api.openai.com/v1`） | `/responses` を追記 | `Authorization: Bearer <key>` |
| `openai-completions` | ベース URL（例 `https://api.openai.com/v1`） | `/chat/completions` を追記 | `Authorization: Bearer <key>` |
| `anthropic` | `https://api.anthropic.com/v1`（`/v1` は省略可） | `/messages` を追記 | `x-api-key` + `anthropic-version: 2023-06-01` |
| `openai`（旧値） | `openai-completions` と同じ | `/chat/completions` を追記 | `Authorization: Bearer <key>` |

実行例（`examples/run-full-scan.mjs` が環境変数を読み、`model` を組み立て、ディレクトリに対して full スキャンを実行）：

```bash
# OpenAI Responses
LLM_PROVIDER=openai-responses LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# OpenAI Chat Completions 互換（OpenAI / DeepSeek / vLLM / Ollama ...）
LLM_PROVIDER=openai-completions LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# LLM_PROVIDER を省略すると openai-completions を使用
LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# Anthropic
LLM_PROVIDER=anthropic LLM_ENDPOINT=https://api.anthropic.com/v1 LLM_API_KEY=sk-ant-... \
LLM_LITE_MODEL=claude-sonnet-5 LLM_PRO_MODEL=claude-opus-5 \
node examples/run-full-scan.mjs /path/to/skill_dir
```

対応環境変数：

| 変数 | 必須 | 説明 |
|---|---|---|
| `LLM_PROVIDER` | いいえ | `openai-responses` / `openai-completions` / `anthropic`；旧値 `openai` は `openai-completions` にマッピング。省略時は endpoint から自動検出 |
| `LLM_ENDPOINT` | はい | ベース URL（上記 endpoint 規約を参照） |
| `LLM_API_KEY` | はい | API キー（リクエストでのみ使用、保存されない） |
| `LLM_LITE_MODEL` | はい | ルール検証 + 意味的重複排除用モデル |
| `LLM_PRO_MODEL` | はい | 単一/複数ファイル挙動解析用モデル |
| `LLM_TIMEOUT_MS` | いいえ | 呼び出しごとのタイムアウト、デフォルト 120000 |
| `LLM_CONTEXT_WINDOW_TOKENS` | いいえ | モデルのコンテキストウィンドウ（トークン）。例 `1000000` は 1M。宣言するとモデルに送るコンテンツ上限を引き上げ |
| `LLM_MAX_AGENT_TURNS` | いいえ | multiFileAnalysis 挙動エージェントの最大ツール呼び出し回数、デフォルト 12 |
| `LLM_LOCALE` | いいえ | `zh-CN`/`en-US`/`ja-JP`/`ko-KR`、デフォルト `zh-CN` |

これらの変数をプロジェクトルートの `.env`（gitignore 済み）に書いて、
`set -a; source .env; set +a` の後に実行することもできます。

コード内で `model` を直接渡すことも可能：`{ provider, endpoint, apiKey, liteModel, proModel, timeoutMs? }`。
Responses は `/responses`、Chat Completions は `/chat/completions`、Anthropic は `/messages` を使用し、endpoint に既にパスがあれば二重に追加しません。
モデルの出力は厳密な JSON である必要があります。レスポンスはマークダウンのコードフェンスと前後のコメントを許容します。
いずれかのブランチが失敗すると、静的結果を保持した `partial` レポートが返され、`branches` に failed/skipped が記録されます。
詳細はエクスポートされた Zod スキーマを参照してください。

## コマンドライン（CLI）

パッケージには `skill-scanner` bin コマンドが付属します（先に `npm run build`、その後 `npm link` または `node dist/cli.js`）：

```bash
skill-scanner <ファイルまたはディレクトリ> [オプション]
```

例：

```bash
# ディレクトリ（または単一ファイル）の静的スキャン
skill-scanner /path/to/skill_dir
skill-scanner /path/to/SKILL.md

# JSON 設定ファイルによる full スキャン
skill-scanner /path/to/skill_dir --config .skill-scanner.json

# 環境変数による full スキャン（LLM_*）
LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
skill-scanner /path/to/skill_dir

# 完全な JSON レポートを stdout またはファイルへ出力
skill-scanner /path/to/skill_dir --json
skill-scanner /path/to/skill_dir --json --output report.json
```

`.skill-scanner.json`（`model` オブジェクトはライブラリの `model` 設定と同一）：

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

コピーして使えるテンプレートが `.skill-scanner.example.json` として同梱されています。`.skill-scanner.json` にコピーして値を入力してください
（実際の設定ファイルは gitignore 済みで、API キーが誤ってコミットされません）。

オプション：

| フラグ | 説明 |
|---|---|
| `<ファイルまたはディレクトリ>` | スキャン対象 |
| `--config <file>` | JSON 設定ファイル（デフォルト `./.skill-scanner.json`） |
| `--mode <quick\|full>` | スキャンモード（デフォルト：モデル設定があれば full、なければ quick） |
| `--quick` | 静的スキャンのみ |
| `--locale <locale>` | `zh-CN` / `en-US` / `ja-JP` / `ko-KR`（デフォルト `zh-CN`） |
| `--provider <openai-responses\|openai-completions\|anthropic>` | LLM プロトコル（旧値 `openai` は `openai-completions` にマッピング） |
| `--endpoint <url>` | LLM ベース URL |
| `--api-key <key>` | LLM API キー |
| `--lite-model <name>` | ルール検証 + 意味的重複排除用モデル |
| `--pro-model <name>` | 単一/複数ファイル挙動解析用モデル |
| `--timeout-ms <ms>` | 呼び出しごとのタイムアウト（デフォルト 120000） |
| `--context-window-tokens <n>` | モデルのコンテキストウィンドウ（トークン） |
| `--max-agent-turns <n>` | 挙動エージェントの最大ツール呼び出し回数（デフォルト 12） |
| `--json` | 完全な JSON レポートを出力 |
| `--output <file>` | レポートをファイルに書き出す |
| `--verbose` | 詳細なスキャンログを stderr に出力（stdout のレポートは汚さない） |
| `-h, --help` | ヘルプを表示 |
| `-v, --version` | バージョンを表示 |

設定の優先順位：CLI フラグ > 設定ファイル > `LLM_*` 環境変数。
CLI はカレントディレクトリの `.env` を自動で読み込みます（既存の環境変数は上書きしません）。手動で source する必要はありません。
