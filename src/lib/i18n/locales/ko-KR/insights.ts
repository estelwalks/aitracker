// AI 번역 초안, 검토 대기 (2026-08)
export const insights = {
  title: "오늘의 인사이트",
  rotate: "전환",
  dots: "인사이트 목록",
  sources: {
    empty: "아직 소스 데이터가 없습니다. 스캔 후 실제 인사이트가 표시됩니다.",
    coverage: "{connected} / {total}개 도구 연결됨, 연결률 {rate}.",
    events:
      "{events}개 이벤트를 수집했습니다. 분석 및 리포트에 활용할 수 있습니다.",
    notInstalled:
      "{count}개 도구가 미설치 상태입니다. 공식 사이트에서 연결하세요.",
    noLogs: "{count}개 도구에 로그가 없어 사용량을 수집할 수 없습니다.",
    malformed: "{count}줄의 비정상 데이터가 있습니다. 로그 형식을 확인하세요.",
    allGood: "전체 {total}개 도구가 정상이며 이상 로그가 없습니다.",
  },
  tracker: {
    empty: "아직 사용량 데이터가 없습니다. 스캔 후 실제 인사이트가 표시됩니다.",
    burn: "누적 {tokens} tokens 소비, {events}개 이벤트 수집.",
    wasteLeader: "낭비 지수 최고: {name} · {waste}, 주목할 만합니다.",
    cacheLow: "캐시 히트 최저: {name} · {rate}, 컨텍스트 재사용을 권장합니다.",
    suggestCount: "소비 최적화 제안 {count}건 — 버닝 리더보드를 확인하세요.",
    topBurn: "소비 최대: {name} · {tokens} tokens.",
  },
} as const;
