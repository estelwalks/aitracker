// AI 번역 초안, 검토 대기 (2026-08)
export const sessions = {
  metaDescription:
    "로컬 과거 세션을 탐색하고 한 번의 클릭으로 복원 명령을 복사합니다.",
  pageHeader: "세션 복원",
  pageHeaderDesc: "로컬 과거 세션을 탐색하고 한 번의 클릭으로 복원 명령 복사",
  range: {
    d7: "최근 7일",
    d30: "최근 30일",
    d90: "최근 90일",
  },
  status: {
    all: "모든 상태",
    available: "복원 가능",
    interrupted: "비정상 중단",
    lost: "분실로 표시됨",
    unavailable: "명령 사용 불가",
  },
  source: {
    all: "모든 도구",
  },
  project: {
    all: "모든 프로젝트",
  },
  panelTitle: "로컬 세션",
  hint: "현재 Claude Code, Codex, Grok만 복원할 수 있습니다. 비용은 로컬 모델 가격표로 추정되며, 알 수 없는 가격은 명확히 표시됩니다.",
  searchPlaceholder: "제목 / 프로젝트 / 모델 / sessionId 검색",
  summary: {
    count: "세션 수",
    tokens: "Token 합계",
    cost: "비용 합계",
    turns: "턴 합계",
  },
  empty: {
    title: "일치하는 세션이 없습니다",
    desc: "필터 조건이나 검색 키워드를 조정한 후 다시 시도하세요.",
  },
  refreshing: "새로고침 중",
  row: {
    untitled: "(이름 없는 세션)",
    copy: "복원 명령 복사",
    copied: "복사됨",
    copyUnsafe: "이 세션 ID는 안전하지 않아 복원 명령을 생성할 수 없습니다",
    project: "프로젝트",
    model: "모델",
    time: "시간",
    duration: "소요 시간",
    cost: "비용",
    turns: "턴",
    edits: "편집 횟수",
    resumeDirHint: "이 디렉터리에서 복원 명령을 실행하세요:",
    statusReason: "상태:",
  },
  toast: {
    refreshed: "세션 목록이 새로고침되었습니다",
    copied: "복원 명령이 복사되었습니다",
  },
} as const;
