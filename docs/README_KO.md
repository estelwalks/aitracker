# AITracker

<p align="center">
  <img src="../public/favicon-dark.svg" alt="AITracker 로고" width="180" />
</p>

<p align="center">
  <a href="https://github.com/estelwalks/aitracker/stargazers"><img src="https://img.shields.io/github/stars/estelwalks/aitracker?style=flat-square&cacheSeconds=3600" alt="GitHub Stars" /></a>
  <a href="https://github.com/estelwalks/aitracker/blob/main/LICENSE"><img src="https://img.shields.io/github/license/estelwalks/aitracker?style=flat-square&cacheSeconds=3600" alt="라이선스" /></a>
  <a href="https://github.com/estelwalks/aitracker/releases/latest"><img src="https://img.shields.io/github/v/release/estelwalks/aitracker?style=flat-square&cacheSeconds=3600" alt="최신 릴리스" /></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README_CN.md">简体中文</a> | <a href="README_JA.md">日本語</a> | <a href="README_KO.md">한국어</a>
</p>

> **사용한 토큰은 얼마인지, 비용은 얼마나 들었는지, 어떤 Agent 도구가 가장 유용한지 한눈에 확인하세요.**

AITracker는 **오픈 소스 기반의 로컬 실행형 AI 워크스페이스**입니다.

Claude Code, Codex, Cursor 등 AI 도구의 토큰, 비용, 사용 추이를 자동으로 추적하고 Skills와 자주 사용하는 설정을 한곳에서 관리합니다. 실제 작업 및 사용 기록에서 Skills를 추출하고 개인 지식 베이스와 장기 기억을 구축하여, 매번의 AI 사용이 다음에 재사용할 수 있는 능력이 되도록 합니다.

**오픈 소스 · 로컬 · 계정 필요 없음**

> 참고: 아래 삽입 이미지는 원본 그래픽을 보존했습니다. 이미지 내부에 포함된 중국어 텍스트는 원본 상태이며, 본 문서의 Markdown 문안은 모두 한국어로 번역했습니다.

---

## ✨ AITracker가 필요한 이유

AI 도구는 계속 늘어나고 있습니다.

Claude Code, Codex, Cursor, Cline, Gemini CLI, OpenCode……

도구가 많아질수록 새로운 문제도 생깁니다.

- 나는 AI를 실제로 얼마나 사용했을까?
- 토큰과 비용은 어디에 쓰이고 있을까?
- 어떤 도구와 모델이 나에게 가장 적합할까?
- Skills와 설정은 왜 여기저기 흩어져 있을까?
- 다른 AI 도구로 바꾸면 매번 다시 설정해야 할까?
- 오늘 성공한 방법을 다음에도 바로 재사용할 수 있을까?
- AI가 내 프로젝트와 장기적인 업무 경험을 기억할 수 있을까?

**AITracker는 이 모든 일을 한곳에 모아줍니다.**

AI 사용 현황을 파악하고, AI 역량을 관리하며, Skills를 추출하고, 지식과 장기 기억을 축적합니다. AI를 일회성 도구가 아니라 계속 성장하는 작업 자산으로 만들어줍니다.

---

## 🚀 빠른 시작

AITracker는 Electron, TanStack Start, React와 TypeScript로 만든 데스크톱 애플리케이션입니다. 보안 검사는 npm에 공개된 `@estelwalks/agent-threat-scanner` 패키지를 사용하므로 클론 후 루트 의존성만 설치하면 개발할 수 있습니다.

### 요구 사항

- Node.js 24 이상
- npm 10 이상
- macOS 또는 Windows (완전한 데스크톱 환경)

```bash
git clone https://github.com/estelwalks/aitracker.git
cd aitracker
npm ci
npm run dev:desktop
```

브라우저 개발 서버만 실행하려면 `npm run dev`를 사용하세요.

### 설치 (Beta)

첫 Beta 버전은 macOS(x64 / arm64)와 Windows x64 데스크톱 설치 파일을 대상으로
합니다. Beta 설치 파일은 서명되지 않았습니다. 현재 Beta CLI 패키지, 해당 GitHub
Release와 beta Tap은 아직 공개되지 않았으므로 아래 명령은 공개 후에만 사용할 수
있습니다.

Beta CLI 패키지와 일치하는 GitHub Release가 공개된 후, Node.js와 npm이 설치되어
있다면 다음 명령으로 Beta를 실행할 수 있습니다.

```bash
npx --yes aitracker@beta
```

이 명령은 데스크톱 설치 파일을 다운로드하여 엽니다. Node.js 없이 동작하는 무음
설치 명령은 아닙니다. macOS에서는 Gatekeeper가 “개발자를 확인할 수 없음” 경고를
표시할 수 있습니다. 배포 출처와 산출물을 확인한 뒤 시스템 설정 또는 앱의 오른쪽
클릭 “열기” 동작으로 실행을 직접 승인하세요. Windows에서는 SmartScreen 경고가
표시될 수 있으므로 계속하기 전에 게시자와 산출물을 확인하세요. 전역 보안 보호를
비활성화하거나 안전하지 않은 우회 명령을 실행하지 마세요.

설치 파일을 열지 않고 다운로드 및 검증만 하려면 저장할 디렉터리를 지정하세요. 디렉터리가
없으면 생성되며, 릴리스 메타데이터가 제공하는 안전한 파일 이름으로 저장됩니다.

```bash
npx --yes aitracker@beta --download-only ./downloads
```

디렉터리 없이 사용하는 `--download-only`도 하위 호환을 위해 계속 지원됩니다. 이 경우
임시 디렉터리에 다운로드하고 명령이 끝나면 임시 파일을 삭제합니다. 이미 존재하는 대상
파일, 심볼릭 링크 디렉터리, 빈 디렉터리 인수, 중복 지정 및 파일 시스템 루트는 거부됩니다.

macOS 사용자는 beta Tap이 공개된 후 프로젝트의 자체 Tap도 사용할 수 있습니다.

```bash
brew tap estelwalks/aitracker
brew install --cask estelwalks/aitracker/aitracker-beta
```

안정 버전 명령은 현재 사용 가능한 것으로 공개하지 않습니다. 서명된 안정 버전과
공식 Homebrew Cask가 준비된 후에만 안정 버전 설치 방법을 안내합니다.

### 빌드 및 테스트

```bash
npm run build:desktop       # Web 앱 및 Electron main / preload 번들
npm run typecheck           # 앱 및 내장 scanner 타입 검사
npm run lint                # 앱 및 내장 scanner 린트
npm run test:all            # 단위, 도구, 데이터베이스 및 scanner 테스트
npm run check:opensource-hygiene
```

플랫폼 설치 파일은 `npm run dist:mac` 또는 `npm run dist:win:x64`로 만들 수 있습니다. 전체 명령어, 생성 파일 정책과 저장소 구조는 [개발 가이드](DEVELOPMENT.md)를 참고하세요.

---

## 🌟 핵심 기능

| 기능             | 설명                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **AI 사용 분석** | 여러 AI 도구의 토큰, 비용, 모델, 프로젝트와 사용 추이를 자동으로 집계하여 AI를 얼마나 사용했고 비용이 어디에 쓰였는지 확인합니다. |
| **AI 도구 분석** | 실제 사용 데이터를 바탕으로 도구와 모델별 사용 빈도, 소비량과 추이를 비교하여 나에게 더 적합한 AI를 찾습니다.                     |
| **Skills 관리**  | 여러 AI 도구에 흩어진 Skills를 자동으로 발견하고 한곳에서 관리하여 반복적인 검색과 유지 관리를 줄입니다.                          |
| **설정 관리**    | Rules 등 자주 사용하는 AI 설정을 통합 관리하고, 도구 간 재사용을 단계적으로 지원합니다.                                           |
| **Skills 추출**  | 실제 업무, 과거 대화와 이미 검증된 방법에서 재사용 가능한 경험을 추출하여 Skills로 축적합니다.                                    |
| **지식 베이스**  | 프로젝트 자료, 방법, 경험과 가치 있는 정보를 지속적으로 정리하여 개인 지식 베이스로 만듭니다.                                     |
| **장기 기억**    | 프로젝트 맥락, 사용 습관과 중요한 경험을 계속 축적하여 다음 AI 사용을 처음부터 다시 시작하지 않도록 합니다.                       |
| **로컬 우선**    | 핵심 데이터와 설정을 우선 자신의 컴퓨터에 저장하며, 계정 없이도 핵심 기능을 사용할 수 있습니다.                                   |

---

## AI 사용 현황을 한눈에 보기

AITracker는 로컬 AI 코딩 도구의 사용 데이터를 자동으로 수집하고, 흩어진 데이터를 하나의 Dashboard로 모아줍니다.

다음 항목을 확인할 수 있습니다.

- Token 사용량
- 입력 / 출력 / Cache Token
- 일간·주간·월간 비용
- AI 도구별 사용 현황
- 모델별 사용 현황
- 프로젝트별 소비량
- 사용 추이

더 이상 감으로 AI 사용량을 판단할 필요가 없습니다.

> **얼마나 사용했고, 얼마나 지출했으며, 무엇이 가장 유용한지 한눈에 확인하세요.**

---

## AI 역량 관리

점점 관리하기 어려워지는 것은 AI 도구 자체만이 아닙니다. 여러 도구에 흩어진 설정과 역량도 함께 관리해야 합니다.

![AI 도구 네트워크](./assets/ko/01-ai-tools-network.png)

AITracker는 이러한 설정을 자동으로 발견하고 통합 관리 기능을 제공합니다.

어떤 Skill이 어느 디렉터리에 있는지 기억할 필요가 없고, 도구를 바꿀 때마다 설정을 처음부터 다시 구성할 필요도 없습니다.

---

## Skills 추출

정말 가치 있는 Skill이 반드시 처음부터 직접 작성되어야 하는 것은 아닙니다.

AITracker는 실제 업무, 과거 대화와 이미 성공적으로 실행한 방법에서 재사용할 만한 경험을 찾아 단계적으로 Skills로 추출합니다.
![](./assets/ko/02-skills-distillation.png)

“이번에 드디어 실행됐다”를 “다음부터 바로 재사용할 수 있다”로 바꿉니다.

---

## 도구 간 재사용

유용한 Skill이 Claude Code에만 종속되어서는 안 됩니다.

검증된 설정 역시 Codex, Cursor 또는 다른 도구로 전환했다고 해서 처음부터 다시 시작할 필요가 없어야 합니다.

AITracker는 서로 다른 AI 도구 위에 놓이는 역량 계층을 만들고자 합니다.

![](./assets/ko/03-cross-tool-reuse.png)

한곳에서 관리하고, 여러 AI 도구에서 계속 사용하세요.

---

## 지식 베이스와 장기 기억

AI는 매일 수많은 대화를 만들어내지만, 그중 실제로 남길 가치가 있는 것은 일부입니다.

예를 들면 다음과 같습니다.

- 프로젝트의 중요한 배경
- 이미 검증된 방법
- 문제를 해결하고 원인을 추적한 과정
- 유용한 Prompt
- 하나의 Skill
- 하나의 Workflow
- 중요한 기술적 의사 결정

AITracker는 이러한 가치 있는 정보를 **지식 베이스와 장기 기억**으로 단계적으로 축적합니다.

![](./assets/ko/04-knowledge-base-memory.png)

AI가 매번 처음부터 다시 시작하지 않도록 합니다.

---

## 더 많은 AI 코딩 도구 지원

AITracker는 여러 AI 도구를 대상으로 설계되었으며, 다음과 같은 주요 AI Coding Tools를 단계적으로 지원합니다.

`Claude Code` · `Codex` · `Cursor` · `Cline` · `Gemini CLI` · `OpenCode` · ...

현재 **36개 이상의 AI 도구에 대한 데이터 수집 및 식별 시나리오**를 지원하며, 계속 확장하고 있습니다.

---

## 로컬 우선

AITracker는 기본적으로 로컬에서 실행됩니다.

AI 사용 기록, 통계 데이터, Skills, Rules, 지식과 기억은 우선 자신의 컴퓨터에 저장됩니다.

![](./assets/ko/05-local-first.png)

**계정을 등록하지 않아도 핵심 기능을 사용할 수 있습니다.**

데이터는 여러분의 것입니다.

---

## AITracker가 해결하려는 문제

과거에는 다음과 같았습니다.

![](./assets/ko/06-past-scattered-tools.png)

이제는 점점 다음과 비슷해지고 있습니다.

![](./assets/ko/07-now-unified-platform.png)

AI 도구는 점점 더 강력해지고, 동시에 점점 더 많아지고 있습니다.

하지만 이러한 AI 역량을 **파악하고, 관리하고, 축적할** 진정한 나만의 공간은 부족합니다.

AITracker가 만들고자 하는 것이 바로 그것입니다.

> **AI 파악 → 역량 관리 → 경험 추출 → 지속적인 축적**

## 기여하기

AITracker는 오픈 소스 프로젝트입니다.

Issue 제출과 새로운 AI 도구 지원 제안을 환영합니다.

사용 중인 AI Coding Tool이 아직 AITracker에서 지원되지 않는다면, 언제든 알려주세요.

---

## 라이선스

AITracker는 추가 제한이 적용된 GPL-3.0 기반 프로젝트 라이선스로
배포됩니다. 자세한 내용은 [LICENSE](../LICENSE)를 참고하세요.

---

## 프로젝트 응원하기

AITracker가 도움이 되었다면 프로젝트에 Star를 보내주세요. 감사합니다.
