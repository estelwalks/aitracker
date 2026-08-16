// AI 번역 초안, 검토 대기 (2026-08)
export const tracker = {
  title: "버닝 리더보드",
  desc: "행동 진단형 낭비 랭킹: 실제 토큰 데이터에서 비효율적 소비를 식별하고 최적화 제안을 제공합니다.",
  insightTitle: "오늘의 인사이트",
  metric: {
    tokens: "총 소비",
    projects: "랭크 프로젝트",
    skills: "랭크 Skill",
    sessions: "랭크 세션",
    sortedBy: "낭비 정도순 정렬",
  },
  board: {
    skill: "Skill 소비 랭킹",
    project: "프로젝트 소비 랭킹",
    session: "세션 소비 랭킹",
    skillSub: "어떤 Skill이 몰래 토큰을 태우고 있나",
    projectSub: "어떤 프로젝트가 가장 많이 소비하나",
    sessionSub: "어떤 세션이 가장 손해인가",
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
    wasteDetail: "낭비 지수 {waste}% 계산 방법",
    wasteExplain:
      "지수 = 100 × (1 − 캐시 히트율) × 출력 비율: 캐시 재사용이 낮고 출력 비율이 높으면 낭비입니다.",
    wastedTotal: "합계 무효 소비 {tokens} tokens",
    close: "닫기",
  },
  empty: "낭비 기록이 없습니다",
  emptyDesc: "실제 사용량이 스캔되면 낭비 지수 순으로 랭킹이 표시됩니다.",
} as const;
