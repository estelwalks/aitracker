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
    market: "보안 마켓",
    skills: "스킬",
    memory: "메모리",
  },
  page: {
    dashboard: {
      "dashboard-watch":
        "현재 스냅샷에는 Skill 자산 {skills}개와 지식 자산 {knowledge}개가 있습니다.",
      "dashboard-assets":
        "사용량이 가장 높은 Agent「{name}」이(가) 전체 tokens의 {rate}를 차지합니다.",
      "dashboard-usage": "현재 범위에서 사용 이벤트 {events}개를 수집했습니다.",
      "dashboard-security-safe":
        "오늘 보안 위험이 발견되지 않았습니다. 스캔된 항목은 모두 통과했습니다.",
      "dashboard-security-risk":
        "오늘 {count}건의 보안 위험이 처리 대기 중입니다. 보안 페이지에서 확인하세요.",
      "dashboard-efficiency":
        "「{name}」의 캐시 히트율이 {rate}에 불과합니다. 비용 절감을 위해 컨텍스트 재사용을 권장합니다.",
      "dashboard-empty":
        "아직 세션 데이터가 없습니다. 데이터 소스에서 로컬 Agent를 연결하세요.",
      "dashboard-guide-collection":
        "현재 범위에서 {tokens} tokens를 소비했습니다.",
      "dashboard-guide-sessions": "현재 범위에 AI 세션 {count}개가 있습니다.",
      "dashboard-guide-concentration":
        "사용량 이벤트당 평균 {average} tokens를 소비했습니다.",
      "dashboard-guide-cache":
        "현재 범위에 사용량 이벤트 {events}개가 있습니다.",
      "dashboard-guide-distill":
        "{count}개의 Agent가 측정 가능한 사용량 이벤트를 생성했습니다.",
    },
    agents: {
      "agents-overview":
        "기존 Agent {count}개를 감지했으며 {active}개는 사용량 이벤트가 있고 {inactive}개는 없습니다.",
      "agents-focus-prompt":
        "「{name}」의 프롬프트 중복도가 높습니다. 공통 지시를 추출해 token 소비를 줄이세요.",
      "agents-focus-cache":
        "「{name}」의 캐시 히트율이 {rate}에 불과합니다. 컨텍스트 재사용을 활성화하세요.",
      "agents-focus-security":
        "기존 Agent {available}개의 로컬 데이터를 현재 읽을 수 있습니다.",
      "agents-prompt-guide":
        "사용량이 가장 높은 기존 Agent「{name}」이(가) 전체 tokens의 {rate}를 차지합니다.",
      "agents-guide-coverage":
        "설치됨, 읽기 가능 또는 사용 이벤트가 있는 Agent {count}개를 감지했습니다.",
      "agents-guide-activity":
        "기존 Agent에 세션 {count}개가 기록되어 있습니다.",
      "agents-guide-prompt":
        "기존 Agent가 이벤트 {events}개와 {tokens} tokens를 생성했습니다.",
      "agents-guide-cache":
        "Agent {available}개의 로컬 데이터를 현재 읽을 수 있습니다.",
      "agents-guide-security":
        "기존 Agent {count}개가 사용량 이벤트를 생성했습니다.",
    },
    distill: {
      "distill-ready":
        "오늘 {count}개의 세션을 증류할 수 있습니다. 경험으로 보관하세요.",
      "distill-pending":
        "{count}건의 증류가 승인 대기 중입니다. 승인하거나 반려하세요.",
      "distill-quota":
        "증류 할당량이 {rate} 사용되었습니다. 일일 호출량을 관리하세요.",
      "distill-empty": "오늘 증류할 세션이 없습니다.",
      "distill-focus":
        "소재가 집중될수록 증류 품질이 높아집니다. 한 번에 3~8개의 강한 관련 대화를 고르는 편이 전체 가져오기보다 낫습니다.",
      "distill-repeat":
        "반복되는 질문·답변은 하나의 Skill로 고정해 token을 아낄 수 있습니다.",
      "distill-guide-intake":
        "오늘 증류 호출은 {used} / {limit}회 사용되었습니다.",
      "distill-guide-outputs":
        "증류 워크벤치에 현재 지식 자산 {count}개가 있습니다.",
      "distill-guide-quota": "오늘 증류 호출 {count}회가 남았습니다.",
      "distill-guide-reuse": "증류 결과 {count}개가 승인 대기 중입니다.",
      "distill-guide-start": "증류 후보 큐에 현재 {count}개가 있습니다.",
    },
    reports: {
      "reports-highlights":
        "이번 기간 주력 Agent는「{name}」이며 사용량의 {rate}를 기여했습니다.",
      "reports-security":
        "이번 기간 {count}건의 보안 이벤트가 재검토 대기입니다. 리포트에 포함하세요.",
      "reports-latest":
        "최근 리포트는 {time}에 생성되었으며, 데이터는 현재 스캔 기준입니다.",
      "reports-empty": "이번 기간 데이터가 없습니다.",
      "reports-collab":
        "AI가 초안을 쓰고, 당신이 다듬고, 저장만 하면 됩니다. 리포트는 처음부터 쓰지 않고 결론만 확인하면 됩니다.",
      "reports-next":
        "리포트에 「다음 단계」를 한 줄 추가하면 요약 시 자동으로 인용됩니다.",
      "reports-guide-inventory":
        "리포트 라이브러리에 현재 {total}개가 있습니다.",
      "reports-guide-highlights":
        "일간 리포트 {daily}개, 주간 리포트 {weekly}개입니다.",
      "reports-guide-security": "현재 초안 리포트가 {count}개 있습니다.",
      "reports-guide-workflow": "현재 승인된 리포트가 {count}개 있습니다.",
      "reports-guide-next": "현재 보관된 리포트가 {count}개 있습니다.",
    },
    memory: {
      "memory-total":
        "총 {count}개의 메모리를 저장했습니다. 프로필 {profiles}개, 작업 {tasks}개입니다.",
      "memory-auto":
        "증류 자동 축적을 활성화하면 경험이 자동으로 메모리에 기록됩니다.",
      "memory-empty":
        "메모리가 비어 있습니다. 세션을 증류하면 경험이 자동으로 축적됩니다.",
      "memory-kinds":
        "프로필은 당신이 누구이고 어떻게 일하기 좋아하는지, 작업 기억은 우리가 정한 규칙을 기억합니다.",
      "memory-guide-inventory":
        "메모리 라이브러리에 현재 자산 {count}개가 있습니다.",
      "memory-guide-approval":
        "메모리 {approved}개가 승인 또는 게시되었습니다.",
      "memory-guide-hygiene":
        "메모리 {unsafe}개가 의심 또는 위험으로 표시되었습니다.",
      "memory-guide-types":
        "메모리 {pending}개가 아직 승인 또는 게시되지 않았습니다.",
      "memory-guide-distill": "메모리 {safe}개에는 보안 위험 표시가 없습니다.",
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
      "security-scan-first":
        "새 스킬은 활성화 전에 먼저 스캔하세요. 몇 초면 대부분의 악성 스크립트를 차단할 수 있습니다.",
      "security-history":
        "스캔 기록은 보관됩니다. 문제가 생기면 이전/이후 버전을 비교해 어떤 업데이트에서 위험이 생겼는지 빠르게 찾을 수 있습니다.",
      "security-guide-posture":
        "최근 보안 요약에 의심 또는 위험 자산 {risky}개가 기록되었습니다.",
      "security-guide-failures":
        "최근 스캔에서 자산 {failed}개 평가에 실패했습니다.",
      "security-guide-coverage":
        "최근 스캔은 자산 {discovered}개를 발견하고 {assessed}개를 평가했습니다.",
      "security-guide-recency": "최근 보안 요약은 {time}에 생성되었습니다.",
      "security-guide-scan": "최근 스캔에서 자산 {clean}개가 통과했습니다.",
    },
    tracker: {
      "tracker-burn-leader": "소비 최대: 「{name}」, 누적 {tokens} tokens.",
      "tracker-waste-leader":
        "낭비 지수 최고: 「{name}」· {rate}, 주목할 만합니다.",
      "tracker-cache-low":
        "캐시 히트 최저: 「{name}」· {rate}, 컨텍스트 재사용을 권장합니다.",
      "tracker-suggest":
        "소비 최적화 제안 {count}건 — 버닝 리더보드를 확인하세요.",
      "tracker-top-model":
        "「{name}」이(가) 가장 많은 tokens를 소비했습니다. 가벼운 작업은 더 작은 모델로 처리할 수 있습니다.",
      "tracker-top-project":
        "프로젝트별로 보면 「{name}」의 소비 비중이 가장 높습니다. 프롬프트 템플릿을 먼저 최적화하세요.",
      "tracker-empty": "지금은 뚜렷한 낭비 항목이 없습니다.",
      "tracker-guide-consumption":
        "현재 범위에서 이벤트 {events}개가 {tokens} tokens를 소비했습니다.",
      "tracker-guide-waste":
        "낭비 지수가 가장 높은 소스는「{name}」이며 지수는 {rate}입니다.",
      "tracker-guide-cache":
        "소스 {count}개가 검증 가능한 캐시 필드를 제공합니다.",
      "tracker-guide-concentration":
        "최대 소비 소스「{name}」이(가) 전체 tokens의 {rate}를 차지합니다.",
      "tracker-guide-optimize":
        "사용량 이벤트당 평균 {average} tokens를 소비했습니다.",
    },
    skills: {
      "skills-local": "로컬에 {count}개의 스킬이 있습니다.",
      "skills-enabled":
        "그중 {count}개가 활성화됨 — 나머지는 필요 시 활성화하세요.",
      "skills-unscanned":
        "{count}개의 스킬이 스캔되지 않았습니다. 활성화 전에 안전 스캔을 먼저 완료하세요.",
      "skills-sync":
        "Skill이 일부 Agent에만 설치되면 결과가 일관되지 않습니다. 원클릭 동기화로 보완하세요.",
      "skills-specific":
        "Skill이 구체적일수록 모델이 덜 흔들리고 token도 아낍니다.",
      "skills-guide-inventory":
        "로컬 Skill 스냅샷에 {count}개의 Skill이 있습니다.",
      "skills-guide-enablement":
        "Skill {enabled}개가 하나 이상의 Agent에 설치되어 있습니다.",
      "skills-guide-coverage": "설치된 Agent {agents}개를 감지했습니다.",
      "skills-guide-updates":
        "Skill 설치 {outdated}개에 사용 가능한 업데이트가 있습니다.",
      "skills-guide-safety":
        "Skill {unassigned}개는 어떤 Agent에도 설치되지 않았습니다.",
    },
    market: {
      "market-installed": "{count}개의 보안 마켓 컴포넌트가 설치되었습니다.",
      "market-updates":
        "{count}개의 컴포넌트에 업데이트가 있습니다. 빠른 업그레이드를 권장합니다.",
      "market-scan-first": "새 컴포넌트 설치 전에 보안 스캔을 먼저 완료하세요.",
      "market-review":
        "설치 전에 SKILL.md와 버전 기록을 확인해 못 쓰는 패키지를 피하세요.",
      "market-guide-installs":
        "보안 마켓 Skill {installed}개가 현재 설치되어 있습니다.",
      "market-guide-updates":
        "보안 마켓 Skill {updates}개에 사용 가능한 업데이트가 있습니다.",
      "market-guide-cache":
        "로컬 보안 마켓 캐시에 탐색 가능한 항목 {total}개가 있습니다.",
      "market-guide-review":
        "설치된 보안 마켓 Skill 중 {current}개는 대기 중인 업데이트가 없습니다.",
      "market-guide-install":
        "보안 마켓 캐시는 약 {hours}시간 전에 가져왔습니다.",
    },
    chats: {
      "chats-total": "총 {count}개의 세션을 수집했습니다.",
      "chats-top-source":
        "세션이 가장 많은 소스는「{name}」입니다. 사용량을 주목하세요.",
      "chats-recoverable":
        "{count}개의 세션을 복구할 수 있습니다. 보관하거나 증류하세요.",
      "chats-empty": "아직 세션이 없습니다. 데이터 소스를 연결하면 표시됩니다.",
      "chats-resume":
        "복구 명령에는 프로젝트 경로가 포함되어 터미널에 붙여 넣으면 원래 작업 디렉터리로 돌아갑니다.",
      "chats-distill":
        "재사용할 세션은 증류 워크벤치로 보내세요. 기록을 뒤지는 것보다 Skill로 만드는 편이 빠릅니다.",
      "chats-guide-inventory": "세션 스냅샷에 현재 세션 {count}개가 있습니다.",
      "chats-guide-sources": "이 세션들은 Agent 소스 {count}개에서 왔습니다.",
      "chats-guide-recovery": "현재 복구 가능한 세션이 {count}개 있습니다.",
      "chats-guide-activity":
        "전체 세션은 총 {turns}턴, {tokens} tokens입니다.",
      "chats-guide-distill": "전체 세션의 활성 시간은 약 {minutes}분입니다.",
    },
    "chat-detail": {
      "chat-detail-turns":
        "이 세션은 {count}턴이며 메타데이터가 완전히 수집되었습니다.",
      "chat-detail-tokens": "이 세션은 {tokens} tokens를 소비했습니다.",
      "chat-detail-recoverable":
        "이 세션은 복구하거나 증류할 수 있습니다. 상세 페이지에서 시작하세요.",
      "chat-detail-resume":
        "이 세션은 복구해 컨텍스트를 이어갈 수 있습니다. 복구 명령에는 프로젝트 경로가 포함됩니다.",
      "chat-detail-guide-turns":
        "이 세션에 재시도 턴 {count}개가 기록되어 있습니다.",
      "chat-detail-guide-tokens":
        "이 세션에 하위 Agent 호출 {count}회가 기록되어 있습니다.",
      "chat-detail-guide-state":
        "이 세션의 소스는「{source}」이고 로컬 상태는「{status}」입니다.",
      "chat-detail-guide-recovery":
        "이 세션에는 편집 작업이 포함된 턴이 {count}개 있습니다.",
      "chat-detail-guide-distill":
        "이 세션의 활성 시간은 약 {minutes}분입니다.",
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
      "settings-local":
        "수집은 전부 로컬에서 이루어지며 대화 내용은 업로드되지 않습니다. 데이터 소스에서 수집 범위를 조정하세요.",
      "settings-guide-model":
        "모델 프로필 {profiles}개가 저장되어 있고 {ready}개에 인증 정보가 있습니다.",
      "settings-guide-enhancement":
        "백그라운드 작업 {total}개가 등록되어 있습니다.",
      "settings-guide-schedules":
        "백그라운드 작업 중 {enabled}개가 활성화되어 있습니다.",
      "settings-guide-retention":
        "백그라운드 작업 중 {disabled}개가 비활성화되어 있습니다.",
      "settings-guide-privacy":
        "모델 프로필 {ready}개에 사용 가능한 인증 정보가 있습니다.",
    },
    sources: {
      "sources-connected": "{count}개의 데이터 소스를 연결했습니다.",
      "sources-malformed":
        "{count}줄의 비정상 데이터가 있습니다. 로그 형식을 확인하세요.",
      "sources-not-installed":
        "감지된 소스 {count}개에 분석 가능한 이벤트가 없습니다.",
      "sources-all-good":
        "전체 {count}개의 소스가 정상이며 이상 로그가 없습니다.",
      "sources-rescan":
        "도구 디렉터리가 변경되면 다시 스캔하세요. 그렇지 않으면 세션과 스킬 수집에 공백이 생깁니다.",
      "sources-local":
        "모든 수집은 로컬에서 이루어지며 대화 내용은 어디에도 업로드되지 않습니다.",
      "sources-guide-inventory":
        "소스 스냅샷에 레지스트리 소스 {total}개가 있습니다.",
      "sources-guide-availability":
        "소스 {available}개의 로컬 데이터를 현재 읽을 수 있습니다.",
      "sources-guide-logs":
        "소스 {connected}개가 분석 가능한 이벤트를 생성했습니다.",
      "sources-guide-rescan":
        "소스 스냅샷에 형식 오류 {malformed}줄이 기록되어 있습니다.",
      "sources-guide-privacy":
        "설치 스냅샷에서 설치된 도구 {installed}개를 감지했습니다.",
    },
  },
} as const;
