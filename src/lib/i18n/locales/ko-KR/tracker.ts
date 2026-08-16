// AI 번역 초안, 검토 대기 (2026-08)
export const tracker = {
  title: "버닝 리더보드",
  desc: "행동 진단형 낭비 랭킹: 실제 토큰 데이터에서 비효율적 소비를 식별하고 최적화 제안을 제공합니다.",
  metric: {
    tokens: "총 소비",
    events: "이벤트 수",
    entries: "랭크 항목",
  },
  board: {
    skill: "Skill 소비 랭킹",
    project: "프로젝트 소비 랭킹",
    session: "세션 소비 랭킹",
  },
  row: {
    tokens: "{count} tokens",
    events: "{count} 이벤트",
    calls: "{count}회 호출",
    waste: "낭비 지수",
    cacheRate: "캐시 히트 {rate}",
    outputRatio: "출력 비율 {ratio}",
    suggest: "최적화 제안",
    trendUp: "전기 대비 상승",
    trendDown: "전기 대비 하락",
    trendFlat: "전기 대비 동일",
    trendNa: "비교 데이터 없음",
  },
  suggest: {
    cache:
      "캐시 히트율이 낮습니다. 컨텍스트를 재사용하여 캐시 효율을 높이세요.",
    output:
      "출력 토큰 비율이 높습니다. 출력을 간소화하거나 압축을 활성화하세요.",
    volume: "소비량이 큽니다. 작업 규모와 중복 스캔을 확인하세요.",
    none: "명확한 최적화 포인트가 없습니다.",
  },
  detail: {
    wasteDetail: "낭비 분석",
    close: "닫기",
  },
  empty: "데이터 없음",
  emptyDesc: "실제 사용량이 스캔되면 낭비 지수 순으로 랭킹이 표시됩니다.",
} as const;
