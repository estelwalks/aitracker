// AI 번역 초안, 검토 대기 (2026-08)
export const security = {
  pageHeader: "보안 검사",
  pageHeaderDesc:
    "SKILL.md 및 Skill 폴더만 지원 · 11개 보안 차원 로컬 정적 스캔",
  pageDescription:
    "SKILL.md의 11개 차원 정적 보안 검사를 로컬에서만 분석합니다.",
  stats: {
    scanned: "누적 스캔",
    averageDuration: "평균 소요 시간",
    rulesVersion: "규칙 라이브러리 버전",
  },
  verdict: {
    all: "전체",
    safe: "안전",
    suspicious: "의심",
    dangerous: "위험",
  },
  severity: {
    high: "높음",
    medium: "중간",
    low: "낮음",
  },
  source: {
    builtin: "내장 규칙",
    custom: "사용자 규칙",
  },
  phase: {
    idle: "대기 중",
    scanning: "스캔 중",
    done: "완료",
  },
  scanSteps: {
    read: "로컬 SKILL.md 읽기",
  },
  rulesNotice:
    "내장 규칙 라이브러리 v{version}은 AITracker 앱과 함께 업데이트됩니다. 현재 원격 규칙 업데이트 채널이 없으므로 네트워크 요청을 보내지 않으며 가짜 업데이트 성공 상태도 표시하지 않습니다.",
  dropzone: {
    title: "SKILL.md 또는 Skill 폴더를 끌어다 놓아 스캔을 시작하세요",
    hint: "SKILL.md / SKILL.md가 포함된 디렉터리만 지원 · 파일당 최대 100MB · 로컬에서 분석하며 소스 코드를 업로드하지 않음",
    tccHint:
      "문서/다운로드/데스크톱의 파일을 선택하면 처음 한 번 시스템 승인이 필요합니다. 앱은 다른 디렉터리 권한을 요청하지 않습니다",
    selectFile: "SKILL.md 선택",
    selectFolder: "폴더 선택",
    remaining: "오늘 남은 횟수 {remaining} / {limit}회",
  },
  scanning: {
    title: "로컬 스캔 중 · {progress}%",
  },
  history: {
    title: "검사 기록 (최근 30일)",
    clear: "기록 지우기",
    loading: "검사 기록 불러오는 중...",
    empty: "아직 스캔을 실행하지 않았습니다.",
    searchPlaceholder: "검사 이름 검색...",
    showing: "표시 중 {shown} / {total}건",
  },
  report: {
    title: "보안 보고서 · {name}",
    viewSource: "소스 코드 보기",
    verdictLabel: "종합 판정: {verdict}",
    riskScore: "/ 100 리스크 점수",
    riskHits: "{count}건 적중 · {duration}",
    pass: "통과",
    hits: "{count}건 적중",
    noRisks: "11개 차원 모두 정적 리스크 규칙에 적중하지 않았습니다.",
    riskDetails: "통과하지 못한 항목 상세",
    reviewTitle: "종합 검토 의견",
    sourceTitle: "로컬 소스: {name}",
    sourceTruncated: "… 나머지 로컬 콘텐츠는 생략되었습니다 (업로드되지 않음)",
  },
  privacy: {
    statement:
      "판정은 로컬 정적 규칙에서만 나옵니다. SKILL.md, 코드 조각 또는 적중 세부 정보는 업로드되지 않습니다.",
  },
  review: {
    safe: "현재 정적 규칙에서 리스크를 발견하지 못했습니다. 정적 스캔은 Skill의 동작과 출처에 대한 수동 검토를 대체할 수 없습니다.",
    suspicious:
      "수동 확인이 필요한 정적 리스크 신호가 발견되었습니다. 설치 전에 위의 적중 줄과 그 맥락을 검토하는 것이 좋습니다.",
    dangerous:
      "고위험 정적 신호가 발견되었습니다. 이 Skill을 설치하거나 실행하지 말고 독립적인 수동 검토를 마친 후 결정하는 것이 좋습니다.",
  },
  confirm: {
    deleteReport:
      "현재 보고서를 삭제하고 스캐너를 초기화하시겠습니까? 기록은 유지됩니다.",
    clearHistory:
      "최근 30일의 모든 검사 기록을 지우시겠습니까? 이 작업은 되돌릴 수 없습니다.",
  },
  toast: {
    scanDone: "로컬 스캔 완료: {verdict}",
    historyCleared: "검사 기록을 지웠습니다",
    noSource:
      "이 이전 보고서에는 소스 코드가 저장되어 있지 않습니다. 로컬 파일을 다시 선택하여 확인하세요.",
  },
} as const;
