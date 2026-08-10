// AI 번역 초안, 검토 대기 (2026-08)
export const sources = {
  metaDescription:
    "이 머신의 각 AI 도구 설치 감지 상태와 로그 수집 상황을 확인합니다.",
  pageHeader: "데이터 소스",
  pageHeaderDesc: "AI 도구 {count}개의 감지 상태 · {time} 업데이트",
  status: {
    hasData: "데이터 있음",
    noLogs: "로그 없음",
    notInstalled: "미설치",
  },
  parsing: {
    native: "네이티브 지원",
    adapter: "어댑터 지원",
    unsupported: "지원 예정",
  },
  summary: {
    connected: "연결됨 / 전체 감지",
    events: "수집 이벤트 총계",
    notInstalled: "미수집 도구",
    noLogs: "로그 없음 도구",
    malformed: "비정상 행 수",
  },
  panelTitle: "도구 감지 상태",
  searchPlaceholder: "도구 이름 검색",
  scanning: "검사 중",
  rescan: "다시 검사",
  empty: {
    title: "일치하는 도구가 없습니다",
    desc: "필터 조건이나 검색 키워드를 조정한 후 다시 시도하세요.",
  },
  row: {
    events: "수집 이벤트 {count}",
    parsing: "로그 파싱: {label}",
    malformed: "비정상 {count}",
    download: "다운로드 설치 ↗",
    paths: "감지 경로: {paths}",
  },
  toast: {
    rescanDone: "다시 검사가 완료되었습니다",
  },
} as const;
