<div align="center">

[中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · **한국어**

</div>

# skill-scanner

Agent Skill용 프라이버시 보호형 보안 스캐너(ESM / TypeScript). 제공된 파일을 실행하지도 않고, API 키를 영속화하지도 않습니다.
스캔은 기본적으로 프라이버시 보호 방식입니다: 메모리 내 `files`(path + content, 디스크 I/O 없음)를 전달하거나,
파일/디렉터리 `paths`를 전달하면 스캐너가 디스크에서 읽어들입니다.
`quick` 모드는 정적 규칙을 실행합니다. `full` 모드에서는 **OpenAI Responses**, **OpenAI Chat Completions** 또는 **Anthropic Messages** API를 통한 모델 검토를 추가합니다.
API 키는 요청에서만 사용되며, 저장되거나 반환되지 않습니다.

```ts
import { scanSkill } from "skill-scanner";
const report = await scanSkill({ mode: "quick", files: [{ path: "SKILL.md", content: "# Demo" }] });
// 또는 파일/디렉터리를 직접 스캔(디스크에서 읽음):
const reportFromPath = await scanSkill({ mode: "quick", paths: ["/path/to/skill_dir"] });
```

## 탐지 기능

- **76개의 정적 규칙**이 **11가지 위험 유형**을 커버(`remote_execution` / `command_injection` /
  `data_exfiltration` / `secret_access` / `persistence` / `destructive` / `obfuscation` /
  `privilege_escalation` / `sensitive_file_access` / `network_abuse` /
  `prompt_injection`). 언어별 명령 주입 규칙, Windows/macOS 특화 패턴, IOC 블록리스트(C2 IP,
  유출/OAST 도메인, 악성 GitHub 계정, 악성코드 해시)를 포함합니다.
- **파일 레벨 검사**(`RISK_FILE` 등): 위험 확장자, 초대용량 콘텐츠(>1MB), 초장문 파일(>2000줄),
  연속 줄바꿈 은닉, 의심스러운 공인 IP(DNS/CDN 화이트리스트 포함).
- **규칙 검증**: `full` 모드는 lite 모델이 비-bypass 정적 히트를 건별로 검증해 오탐을 제거합니다.
  IOC 및 파일 레벨 히트는 고신뢰 항목이므로 검증을 건너뜁니다.
- **모델 분석**: `SKILL.md` 하나만 있는 입력은 `singleFileAnalysis`(pro), 여러 파일 입력은 `multiFileAnalysis`(pro)를 실행합니다. 후자는
  인메모리 파일 위에서 **ReAct 에이전트 루프**(도구 `list_files` / `read_file` / `grep`,
  ≤ `maxAgentTurns`, 기본 12)를 실행해 파일 간 동작을 추적합니다——실패 시 단일 전송(single-shot)으로
  폴백합니다. 모델에 보내는 파일별 콘텐츠에는 상한이 있으며(머리+꼬리 각 30K 문자,
  `contextWindowTokens`로 확장 가능), 모델이 반환한 카테고리는 로컬라이즈/영어 별칭에서 정규 slug로 정규화됩니다.
- **중복 제거**: 규칙 히트와 같은 file+line에서 충돌하는 모델 발견은 제거됩니다(규칙 우선).
  이후 lite 모델의 **의미론적 중복 제거**가 모델 발견과 동일한 위험을 설명하는 규칙 히트를 제거합니다(모델 우선).

## 점수 산정

감점 방식이며, 0–100점 스코어가 높을수록 안전합니다:
`riskScore = max(0, 100 − Σ 규칙 가중치 [각 ruleId당 1회] − Σ 모델 발견 가중치)`.
`threatLevel`은 5단계(critical/high/medium/low/none)로 매핑됩니다. `verdict`는
`block`(critical/high) / `warn`(medium) / `allow`(low/none),
발견이 없는 부분 스캔에서는 `unknown`(절대 안전으로 판정하지 않음).

## 보고서

보고서(Zod 검증)에는 `findings`(언어 무관한 `kind`/`severity` slug에 더해 로컬라이즈된
`kindDisplay`/`severityDisplay`), `rules`(ruleId별로 집계된 정적 발견, `count`와 개별 `matches`),
`branches`(static/ruleReview/singleFileAnalysis/multiFileAnalysis. complete/skipped/failed),
`skippedFiles`, `categories`(유형별 건수 / 최고 심각도 / 총 가중치), `threatLevel`, `threatLevelDisplay`,
`locale`, `contentHash`, `riskScore`가 포함됩니다. 발췌문은 비밀값이 마스킹됩니다. `files` 모드에서는 경로와 콘텐츠가 디스크에서 읽히지 않습니다. `paths` 모드에서는 보고서의 `path`가 디스크의 절대 경로입니다. 각 finding은 `fileHash`(path+content의 SHA-256)를 가지며 `id`는 `ruleId:fileHash:line`로 콘텐츠 주소화되어 경로를 노출하지 않습니다. 모델 발견은 `reasoning` 판단 근거를 가지며 `message`/`remediation`은 모델이 요청 locale에 따라 제공합니다(zh-CN은 중국어 변형). 모델 분석은 knownsec-skill-scanner 참조 프롬프트의 영어 버전(`src/model/prompts/*.md`)을 사용하며, 중국어 원본은 `*.zh.md`로 보존합니다.

## 국제화(locale)

요청에 `locale: "zh-CN" | "en-US" | "ja-JP" | "ko-KR"`을 지정할 수 있습니다(기본 `zh-CN`).
스캔 결과의 규칙명·설명·수정 제안·요약은 해당 locale로 생성됩니다.
`kind`/`severity`/`verdict`/`contentHash`/규칙 ID는 언어와 무관합니다.
보고서는 `locale`과 `contentHash`(정렬된 path+content의 SHA-256)를 유지하므로,
호스트는 `contentHash + scannerVersion + rulesVersion + mode + locale`을 언어별 격리 캐시 키로 사용할 수 있습니다.
`report.locale !== 현재 언어`인 경우 "재스캔 필요"로 표시하고 해당 보고서를 직접 재사용하지 마세요.

## 모듈 구조

```
src/
  i18n/        로컬라이즈 리소스(zh-CN / en-US / ja-JP / ko-KR)
  rules/       76개 참조 규칙 + 메타데이터(언어 무관)
  detection/   정적 스캔 / 파일 레벨 검사 / 중복 제거 / 점수 산정 / 보고서 집계
  model/       전송 계층(OpenAI Responses / Chat Completions / Anthropic) / 에이전트 루프 / 정규화 / 프롬프트
  scanner.ts   오케스트레이터
  types.ts     Zod 스키마
```

## LLM 구성 및 테스트(full 모드)

`model`은 세 가지 프로토콜을 지원하며 `provider`(`"openai-responses"`, `"openai-completions"`, `"anthropic"`)로 지정합니다.
기존 값 `"openai"`도 계속 사용할 수 있으며 `"openai-completions"`로 매핑됩니다.
생략 시 endpoint에서 자동 감지합니다. `anthropic`/`claude`를 포함하거나 `/messages`로 끝나면 → anthropic,
`/responses`로 끝나면 → openai-responses, 그 외 → openai-completions입니다.

| provider | endpoint 규약 | 실제 요청 | 인증 헤더 |
|---|---|---|---|
| `openai-responses` | 베이스 URL(예: `https://api.openai.com/v1`) | `/responses` 추가 | `Authorization: Bearer <key>` |
| `openai-completions` | 베이스 URL(예: `https://api.openai.com/v1`) | `/chat/completions` 추가 | `Authorization: Bearer <key>` |
| `anthropic` | `https://api.anthropic.com/v1`(`/v1` 생략 가능) | `/messages` 추가 | `x-api-key` + `anthropic-version: 2023-06-01` |
| `openai`(기존 값) | `openai-completions`와 동일 | `/chat/completions` 추가 | `Authorization: Bearer <key>` |

실행 예시(`examples/run-full-scan.mjs`가 환경 변수를 읽고 `model`을 구성한 뒤 디렉터리를 full 스캔):

```bash
# OpenAI Responses
LLM_PROVIDER=openai-responses LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# OpenAI Chat Completions 호환(OpenAI / DeepSeek / vLLM / Ollama ...)
LLM_PROVIDER=openai-completions LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# LLM_PROVIDER를 생략하면 openai-completions를 기본으로 사용
LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
node examples/run-full-scan.mjs /path/to/skill_dir

# Anthropic
LLM_PROVIDER=anthropic LLM_ENDPOINT=https://api.anthropic.com/v1 LLM_API_KEY=sk-ant-... \
LLM_LITE_MODEL=claude-sonnet-5 LLM_PRO_MODEL=claude-opus-5 \
node examples/run-full-scan.mjs /path/to/skill_dir
```

지원 환경 변수:

| 변수 | 필수 | 설명 |
|---|---|---|
| `LLM_PROVIDER` | 아니오 | `openai-responses` / `openai-completions` / `anthropic`; 기존 `openai`는 `openai-completions`로 매핑; 생략 시 endpoint에서 자동 감지 |
| `LLM_ENDPOINT` | 예 | 베이스 URL(위 endpoint 규약 참조) |
| `LLM_API_KEY` | 예 | API 키(요청에서만 사용, 저장되지 않음) |
| `LLM_LITE_MODEL` | 예 | 규칙 검증 + 의미론적 중복 제거용 모델 |
| `LLM_PRO_MODEL` | 예 | 단일/다중 파일 동작 분석용 모델 |
| `LLM_TIMEOUT_MS` | 아니오 | 호출별 타임아웃, 기본 120000 |
| `LLM_CONTEXT_WINDOW_TOKENS` | 아니오 | 모델 컨텍스트 윈도우(토큰). 예: `1000000`은 1M. 선언 시 모델에 보내는 콘텐츠 상한 확장 |
| `LLM_MAX_AGENT_TURNS` | 아니오 | multiFileAnalysis 동작 에이전트의 최대 도구 호출 횟수, 기본 12 |
| `LLM_LOCALE` | 아니오 | `zh-CN`/`en-US`/`ja-JP`/`ko-KR`, 기본 `zh-CN` |

이 변수들을 프로젝트 루트의 `.env`(gitignore 처리됨)에 적어둔 뒤,
`set -a; source .env; set +a` 후 실행할 수도 있습니다.

코드에서 `model`을 직접 전달할 수도 있습니다: `{ provider, endpoint, apiKey, liteModel, proModel, timeoutMs? }`.
Responses는 `/responses`, Chat Completions은 `/chat/completions`, Anthropic은 `/messages`를 사용하며 endpoint에 해당 경로가 이미 있으면 중복으로 추가하지 않습니다.
모델 출력은 엄격한 JSON이어야 합니다. 응답은 마크다운 코드 펜스와 앞뒤 주석을 허용합니다.
어느 분기가 실패하면 정적 결과를 보존한 `partial` 보고서가 반환되고 `branches`에 failed/skipped가 기록됩니다.
자세한 내용은 내보내진 Zod 스키마를 참조하세요.

## CLI(명령줄)

패키지에는 `skill-scanner` bin 명령이 포함됩니다(먼저 `npm run build`, 이후 `npm link` 또는 `node dist/cli.js`):

```bash
skill-scanner <파일 또는 디렉터리> [옵션]
```

예시:

```bash
# 디렉터리(또는 단일 파일) 정적 스캔
skill-scanner /path/to/skill_dir
skill-scanner /path/to/SKILL.md

# JSON 설정 파일로 full 스캔
skill-scanner /path/to/skill_dir --config .skill-scanner.json

# 환경 변수로 full 스캔(LLM_*)
LLM_ENDPOINT=https://api.openai.com/v1 LLM_API_KEY=sk-... \
LLM_LITE_MODEL=gpt-4o-mini LLM_PRO_MODEL=gpt-4o \
skill-scanner /path/to/skill_dir

# 전체 JSON 보고서를 stdout 또는 파일로 출력
skill-scanner /path/to/skill_dir --json
skill-scanner /path/to/skill_dir --json --output report.json
```

`.skill-scanner.json`(`model` 객체는 라이브러리 `model` 설정과 동일):

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

복사해서 사용할 수 있는 템플릿이 `.skill-scanner.example.json`으로 포함되어 있습니다. `.skill-scanner.json`으로 복사한 뒤 값을 입력하세요
(실제 설정 파일은 gitignore 처리되어 API 키가 커밋되지 않습니다).

옵션:

| 플래그 | 설명 |
|---|---|
| `<파일 또는 디렉터리>` | 스캔 대상 |
| `--config <file>` | JSON 설정 파일(기본 `./.skill-scanner.json`) |
| `--mode <quick\|full>` | 스캔 모드(기본: 모델이 구성되면 full, 아니면 quick) |
| `--quick` | 정적 스캔만 |
| `--locale <locale>` | `zh-CN` / `en-US` / `ja-JP` / `ko-KR`(기본 `zh-CN`) |
| `--provider <openai-responses\|openai-completions\|anthropic>` | LLM 프로토콜(기존 `openai`는 `openai-completions`로 매핑) |
| `--endpoint <url>` | LLM 베이스 URL |
| `--api-key <key>` | LLM API 키 |
| `--lite-model <name>` | 규칙 검증 + 의미론적 중복 제거용 모델 |
| `--pro-model <name>` | 단일/다중 파일 동작 분석용 모델 |
| `--timeout-ms <ms>` | 호출별 타임아웃(기본 120000) |
| `--context-window-tokens <n>` | 모델 컨텍스트 윈도우(토큰) |
| `--max-agent-turns <n>` | 동작 에이전트 최대 도구 호출 횟수(기본 12) |
| `--json` | 전체 JSON 보고서 출력 |
| `--output <file>` | 보고서를 파일로 저장 |
| `--verbose` | 상세 스캔 로그를 stderr로 출력(stdout의 보고서는 오염시키지 않음) |
| `-h, --help` | 도움말 표시 |
| `-v, --version` | 버전 표시 |

설정 우선순위: CLI 플래그 > 설정 파일 > `LLM_*` 환경 변수.
CLI는 현재 디렉터리의 `.env`를 자동으로 읽습니다(이미 설정된 환경 변수는 덮어쓰지 않음). 수동으로 source 할 필요가 없습니다.
