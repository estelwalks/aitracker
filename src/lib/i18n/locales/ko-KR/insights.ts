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
  actions: {
    security: "보안 확인",
    distill: "증류하기",
    reports: "리포트 보기",
    sessions: "세션 보기",
    sources: "데이터 소스",
    settings: "모델 설정",
    tracker: "번 리더보드 보기",
    market: "마켓",
    skills: "스킬",
    memory: "메모리",
  },
  page: {
    dashboard: {
      "dashboard-watch":
        "오늘 {agents}개 Agent가 근무하며 {blocked}회 위험을 차단, 약 {hours}시간을 절약했고 {distillable}개 세션을 증류할 수 있습니다.",
      "dashboard-assets":
        "주력 Agent「{name}」이(가) 사용량의 {rate}를 차지합니다. 나머지는 사용이 적어 균형 배분을 고려하세요.",
      "dashboard-usage":
        "오늘 {events}개의 사용 이벤트와 {sessions}개의 세션을 수집했습니다. 세션에서 확인하거나 증류할 수 있습니다.",
      "dashboard-security-safe":
        "오늘 보안 위험이 발견되지 않았습니다. 스캔된 항목은 모두 통과했습니다.",
      "dashboard-security-risk":
        "오늘 {count}건의 보안 위험이 처리 대기 중입니다. 보안 페이지에서 확인하세요.",
      "dashboard-efficiency":
        "「{name}」의 캐시 히트율이 {rate}에 불과합니다. 비용 절감을 위해 컨텍스트 재사용을 권장합니다.",
      "dashboard-empty":
        "아직 세션 데이터가 없습니다. 데이터 소스에서 로컬 Agent를 연결하세요.",
    },
    agents: {
      "agents-overview":
        "총 {count}개의 Agent가 근무 중이며, 오늘 {blocked}회 위험을 차단하고 약 {hours}시간을 절약했습니다.",
      "agents-focus-prompt":
        "「{name}」의 프롬프트 중복도가 높습니다. 공통 지시를 추출해 token 소비를 줄이세요.",
      "agents-focus-cache":
        "「{name}」의 캐시 히트율이 {rate}에 불과합니다. 컨텍스트 재사용을 활성화하세요.",
      "agents-focus-security":
        "「{name}」에서 최근 {count}건의 위험 작업이 있습니다. 권한과 설정을 재검토하세요.",
    },
    distill: {
      "distill-ready":
        "오늘 {count}개의 세션을 증류할 수 있습니다. 경험으로 보관하세요.",
      "distill-pending":
        "{count}건의 증류가 승인 대기 중입니다. 승인하거나 반려하세요.",
      "distill-quota":
        "증류 할당량이 {rate} 사용되었습니다. 일일 호출량을 관리하세요.",
      "distill-empty": "오늘 증류할 세션이 없습니다.",
    },
    reports: {
      "reports-highlights":
        "이번 기간 주력 Agent는「{name}」이며 사용량의 {rate}를 기여했습니다.",
      "reports-security":
        "이번 기간 {count}건의 보안 이벤트가 재검토 대기입니다. 리포트에 포함하세요.",
      "reports-latest":
        "최근 리포트는 {time}에 생성되었으며, 데이터는 현재 스캔 기준입니다.",
      "reports-empty": "이번 기간 데이터가 없습니다.",
    },
    memory: {
      "memory-total":
        "총 {count}개의 메모리를 저장했습니다. 프로필 {profiles}개, 작업 {tasks}개입니다.",
      "memory-auto":
        "증류 자동 축적을 활성화하면 경험이 자동으로 메모리에 기록됩니다.",
      "memory-empty":
        "메모리가 비어 있습니다. 세션을 증류하면 경험이 자동으로 축적됩니다.",
    },
    security: {
      "security-risk-top":
        "{count}건의 고위험 발견을 감지했습니다. 즉시 보안 페이지에서 처리하세요.",
      "security-scan-gap":
        "{count}개의 소스가 이번 스캔에서 누락되었습니다. 현재 상태를 안전하다고 볼 수 없습니다.",
      "security-scan-coverage":
        "이번 스캔은 소스의 {rate}를 커버했습니다. 나머지는 빠르게 보완하세요.",
      "security-last-scan":
        "마지막 전체 스캔은 {time}에 완료되었습니다. 결과는 참고용입니다.",
    },
    tracker: {
      "tracker-burn-leader": "소비 최대: 「{name}」, 누적 {tokens} tokens.",
      "tracker-waste-leader":
        "낭비 지수 최고: 「{name}」· {rate}, 주목할 만합니다.",
      "tracker-cache-low":
        "캐시 히트 최저: 「{name}」· {rate}, 컨텍스트 재사용을 권장합니다.",
      "tracker-suggest":
        "소비 최적화 제안 {count}건 — 버닝 리더보드를 확인하세요.",
      "tracker-empty": "지금은 뚜렷한 낭비 항목이 없습니다.",
    },
    skills: {
      "skills-local": "로컬에 {count}개의 스킬이 있습니다.",
      "skills-enabled":
        "그중 {count}개가 활성화됨 — 나머지는 필요 시 활성화하세요.",
      "skills-unscanned":
        "{count}개의 스킬이 스캔되지 않았습니다. 활성화 전에 안전 스캔을 먼저 완료하세요.",
    },
    market: {
      "market-installed": "{count}개의 마켓 컴포넌트가 설치되었습니다.",
      "market-updates":
        "{count}개의 컴포넌트에 업데이트가 있습니다. 빠른 업그레이드를 권장합니다.",
      "market-scan-first": "새 컴포넌트 설치 전에 보안 스캔을 먼저 완료하세요.",
    },
    chats: {
      "chats-total": "총 {count}개의 세션을 수집했습니다.",
      "chats-top-source":
        "세션이 가장 많은 소스는「{name}」입니다. 사용량을 주목하세요.",
      "chats-recoverable":
        "{count}개의 세션을 복구할 수 있습니다. 보관하거나 증류하세요.",
      "chats-empty": "아직 세션이 없습니다. 데이터 소스를 연결하면 표시됩니다.",
    },
    "chat-detail": {
      "chat-detail-turns":
        "이 세션은 {count}턴이며 메타데이터가 완전히 수집되었습니다.",
      "chat-detail-tokens": "이 세션은 {tokens} tokens를 소비했습니다.",
      "chat-detail-recoverable":
        "이 세션은 복구하거나 증류할 수 있습니다. 상세 페이지에서 시작하세요.",
    },
    widget: {
      "widget-broadcast-security":
        "오늘 보안: {count}건의 위험이 처리 대기 중입니다.",
      "widget-broadcast-efficiency":
        "오늘 효율: 「{name}」의 캐시 히트율이 최저 {rate}입니다.",
      "widget-broadcast-distill":
        "오늘 증류: {count}개의 세션이 대기 중입니다.",
    },
    settings: {
      "settings-model-unconfigured":
        "모델이 아직 설정되지 않았습니다. 모델 설정에서 연결을 완료하면 강화 인사이트를 사용할 수 있습니다.",
      "settings-scan-plan":
        "스캔 계획이 {count}개의 데이터 소스를 커버합니다. 여기서 조정하세요.",
      "settings-collection":
        "데이터 수집 완전도는 {rate}입니다. 부족한 부분은 여기서 소스를 확인하세요.",
    },
    sources: {
      "sources-connected": "{count}개의 데이터 소스를 연결했습니다.",
      "sources-malformed":
        "{count}줄의 비정상 데이터가 있습니다. 로그 형식을 확인하세요.",
      "sources-not-installed":
        "{count}개의 도구가 미설치 상태입니다. 다운로드하여 연결하세요.",
      "sources-all-good":
        "전체 {count}개의 소스가 정상이며 이상 로그가 없습니다.",
    },
  },
} as const;
