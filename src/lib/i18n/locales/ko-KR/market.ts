// AI 번역 초안, 검토 대기 (2026-08)
export const market = {
  pageHeader: "Skill 마켓",
  pageHeaderDesc: "보안 스캔을 통과한 Skill만 수록",
  meta: {
    description:
      "AITracker Skill 마켓의 실제 인덱스를 탐색합니다. 보안 스캔을 통과한 Skill만 수록됩니다.",
  },
  notProvided: "제공되지 않음",
  network: {
    loadFailed:
      "네트워크를 사용할 수 없습니다: Skill 마켓을 불러오지 못했습니다",
    unavailableTitle:
      "네트워크를 사용할 수 없어 Skill 마켓에 접근할 수 없습니다",
    unavailableDesc:
      "로컬에 캐시된 목록은 계속 볼 수 있으며, 네트워크가 복구되면 최신 데이터로 자동 동기화됩니다.",
  },
  empty: {
    noMatch: "일치하는 Skill이 없습니다",
    noMatchDesc: "다른 키워드로 다시 검색하세요.",
  },
  stats: {
    totalSkills: "등록된 Skill 총수",
    officialCount: "공식 릴리스 수",
    passRate: "보안 통과율",
    installedCount: "설치된 수",
    totalDownloads: "총 다운로드 수",
    hintCurrentPage: "현재 페이지 통계",
    hintLocalInstalled: "이 기기에 설치됨",
  },
  search: {
    placeholder: "이름 또는 설명으로 실제 Skill 검색…",
    keyword: " · 키워드 “{keyword}”",
    updatedAt: "데이터 업데이트 {time}",
    perPage: "페이지당 {count}개 · {page}페이지",
  },
  sort: {
    downloads: "다운로드 수",
    latest: "최신",
    stars: "Star",
    tokens: "Token 사용량",
  },
  list: {
    title: "Skill 목록 ({count})",
  },
  table: {
    rank: "순위",
    publisher: "게시자",
    downloads: "다운로드 수",
    tokenUsage: "Token 사용량",
    size: "크기",
    stars: "Star",
    security: "보안 상태",
    actions: "작업",
  },
  installed: "설치됨",
  official: "공식",
  noDescription: "이 Skill에 대한 설명이 아직 제공되지 않습니다.",
  metric: {
    downloads: "다운로드 수",
    tokenUsage: "Token 사용량",
    size: "크기",
    stars: "Star",
  },
  security: {
    score: "보안 점수 {score}",
    scoreMissing: "보안 점수 미제공",
  },
  install: {
    button: "설치",
    toSelected: "선택한 도구에 설치",
    success: "{agent}에 설치됨",
    downloading: "다운로드 및 스캔 중…",
    failure: {
      scanBlocked:
        "정적 스캔에서 고위험 규칙이 발견되어 설치가 차단되었습니다.",
      noAgent: "설치 대상을 선택하세요",
      diskFull: "디스크 공간이 부족합니다. 정리 후 다시 시도하세요",
      download: "다운로드에 실패했습니다. 네트워크를 확인하고 다시 시도하세요",
      generic: "다운로드 또는 정적 스캔에 실패했습니다",
    },
  },
  drawer: {
    viewRepo: "원본 저장소 보기",
    viewSource: "소스 코드 보기",
    securityNotice:
      "보안 스캔 통과 · 악성 URL, 위험한 명령, 민감한 정보가 검출되지 않았습니다",
    commandExample: "설치 명령 예시",
    contextTokens: "컨텍스트 Token",
    lastUpdated: "최근 업데이트",
    permissionClaim: "권한 선언",
    networkClaim: "네트워크 선언",
    selectAgent: "설치 대상을 선택하세요 (단일 선택, {count}개 도구 지원)",
    agentNotInstalled: "미설치",
  },
  pagination: {
    prev: "이전",
    next: "다음",
  },
  outcome: {
    compressed: "압축 패키지 {size}",
    unpacked: "압축 해제 후 {size}",
    entries: "검사 항목 {count}",
    files: "스캔한 파일 {count}",
    success: "성공",
    failed: "실패",
  },
} as const;
