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
      "dashboard-guide-collection":
        "데이터 소스가 계속 수집 중인지 먼저 확인해 수집 공백으로 대시보드 판단이 왜곡되지 않게 하세요.",
      "dashboard-guide-sessions":
        "세션 활동을 보면 오늘 작업 중 복기하거나 이어서 진행할 일이 있는지 판단할 수 있습니다.",
      "dashboard-guide-concentration":
        "소스 사용이 한쪽에 치우쳤다면 주력 도구가 적절한 작업을 맡고 있는지 점검하세요.",
      "dashboard-guide-cache":
        "캐시 효율은 컨텍스트 재사용 상태를 보여 주며, 번 리더보드에서 원인을 더 살펴볼 수 있습니다.",
      "dashboard-guide-distill":
        "오늘의 재사용 가능한 세션을 증류해 일회성 결과를 오래 쓰는 자산으로 전환하세요.",
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
      "agents-prompt-guide":
        "프롬프트를 더 구체적으로 쓰면 중복 읽기와 재작업이 줄어 token을 아낄 수 있습니다.",
      "agents-guide-coverage":
        "도구 연결 범위가 Agent 개요의 완성도를 좌우하므로 누락된 로컬 도구부터 연결하세요.",
      "agents-guide-activity":
        "활동량과 세션 수를 함께 보면 자주 쓰는 Agent와 설치만 된 Agent를 구분할 수 있습니다.",
      "agents-guide-prompt":
        "프롬프트에서 지속적인 규칙과 일시적인 작업을 분리해 중복 컨텍스트를 줄이세요.",
      "agents-guide-cache":
        "캐시 구조를 보면 Agent가 같은 컨텍스트를 반복해서 읽는지 파악할 수 있습니다.",
      "agents-guide-security":
        "기능이 늘면 노출 범위도 커지므로 Agent 권한과 Skill 위험을 함께 검토하세요.",
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
        "완성도가 높고 재사용하기 좋은 세션을 증류 소재로 우선 선택하세요.",
      "distill-guide-outputs":
        "재사용 방식에 맞춰 절차는 워크플로로, 안정적인 기능은 Skill로 만들면 좋습니다.",
      "distill-guide-quota":
        "생성 전에 모델과 할당량을 확인해 증류 작업이 중간에 멈추지 않게 하세요.",
      "distill-guide-reuse":
        "승인된 결과물은 지식 또는 메모리에 등록해 이후에도 재사용할 수 있게 하세요.",
      "distill-guide-start":
        "후보가 없다면 명확한 결론이 있는 세션 하나를 대화 페이지에서 골라 시작하세요.",
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
        "리포트 보관함에서 완료된 기간과 아직 복기가 필요한 기간을 확인할 수 있습니다.",
      "reports-guide-highlights":
        "성과와 핵심 변화를 먼저 정리한 뒤 세부 내용을 더하면 리포트가 읽기 쉬워집니다.",
      "reports-guide-security":
        "일반 사용량 결론에 가려지지 않도록 보안 이벤트는 리포트에서 별도로 다루세요.",
      "reports-guide-workflow":
        "초안, 편집, 저장, 내보내기가 리포트 작성의 전체 흐름이며 저장 전에 결론을 확인해야 합니다.",
      "reports-guide-next":
        "해당 기간의 리포트가 없다면 최근 세션 활동이 있었던 기간부터 작성하세요.",
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
        "중요한 합의가 세션에 묻히지 않도록 메모리 자산을 검색하고 추적할 수 있게 관리하세요.",
      "memory-guide-approval":
        "확인되지 않은 내용이 장기 컨텍스트에 들어가지 않도록 승인 후 메모리를 게시하세요.",
      "memory-guide-hygiene":
        "오래되거나 위험한 메모리를 주기적으로 정리해 잘못된 컨텍스트의 반복 사용을 줄이세요.",
      "memory-guide-types":
        "지속적인 선호는 프로필에, 개별 제약은 작업 메모리에 나누어 관리하세요.",
      "memory-guide-distill":
        "메모리가 비어 있다면 증류 워크벤치에서 확인된 교훈 하나를 등록하세요.",
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
        "건수에 휩쓸리지 말고 고위험 발견부터 처리한 뒤 일반 알림을 검토하세요.",
      "security-guide-failures":
        "스캔 실패는 점검 사각지대를 뜻하며 위험이 없다는 근거가 아닙니다.",
      "security-guide-coverage":
        "실제로 활성화된 Skill과 설정까지 검사 범위에 포함하고 누락된 항목은 추가로 스캔하세요.",
      "security-guide-recency":
        "오래된 스캔은 과거 상태만 보여 주므로 설치하거나 업데이트한 뒤 다시 스캔하세요.",
      "security-guide-scan":
        "결과가 아직 없다면 로컬 정적 스캔을 실행해 보안 기준선을 만드세요.",
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
        "변화의 원인을 판단하기 전에 전체 소비량과 이벤트 활동을 함께 비교하세요.",
      "tracker-guide-waste":
        "낭비를 진단할 때는 반복 읽기, 재작업, 과도한 출력을 우선 확인하세요.",
      "tracker-guide-cache":
        "캐시 재사용률이 낮다면 안정적인 컨텍스트를 반복해서 읽고 있을 가능성이 큽니다.",
      "tracker-guide-concentration":
        "특정 모델이나 프로젝트에 소비가 집중되면 작업 구성과 프롬프트를 따로 점검하세요.",
      "tracker-guide-optimize":
        "최적화 후에도 같은 기간을 다시 확인해 변경 효과가 실제로 나타났는지 검증하세요.",
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
        "로컬 Skill의 수와 출처를 먼저 파악해 같은 기능이 중복되지 않도록 관리하세요.",
      "skills-guide-enablement":
        "현재 필요한 Skill만 활성화해 Agent에 불필요한 기능이 노출되는 범위를 줄이세요.",
      "skills-guide-coverage":
        "Agent마다 Skill 구성이 다르면 같은 작업에서도 결과가 달라질 수 있습니다.",
      "skills-guide-updates":
        "업데이트가 필요한 Skill은 변경 내용을 검토한 뒤 각 Agent에 동기화할지 결정하세요.",
      "skills-guide-safety":
        "새로 추가되거나 변경된 Skill은 다시 스캔해야 하며 이전 버전의 안전 결과를 그대로 적용하면 안 됩니다.",
    },
    market: {
      "market-installed": "{count}개의 마켓 컴포넌트가 설치되었습니다.",
      "market-updates":
        "{count}개의 컴포넌트에 업데이트가 있습니다. 빠른 업그레이드를 권장합니다.",
      "market-scan-first": "새 컴포넌트 설치 전에 보안 스캔을 먼저 완료하세요.",
      "market-review":
        "설치 전에 SKILL.md와 버전 기록을 확인해 못 쓰는 패키지를 피하세요.",
      "market-guide-installs":
        "로컬 설치 상태로 보유 중인 기능과 검토 대상을 구분해 중복 설치를 피하세요.",
      "market-guide-updates":
        "사용 중인 컴포넌트를 교체하기 전에 버전별 변경 내용을 먼저 확인하세요.",
      "market-guide-cache":
        "캐시된 카탈로그는 오프라인에서도 볼 수 있지만 최신 정보가 아닐 수 있습니다.",
      "market-guide-review":
        "마켓의 항목은 후보일 뿐이므로 설치 전에 내용과 보안을 반드시 검토하세요.",
      "market-guide-install":
        "설치된 컴포넌트가 없다면 용도가 분명하고 검토를 마친 항목부터 시작하세요.",
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
      "chats-guide-inventory":
        "세부 내용을 열기 전에 세션 목록의 안전한 메타데이터로 필요한 작업을 먼저 찾으세요.",
      "chats-guide-sources":
        "소스별로 필터링하면 활동 중인 Agent나 수집 누락을 빠르게 확인할 수 있습니다.",
      "chats-guide-recovery":
        "세션을 계속하거나 보관 또는 증류하기 전에 복구 가능한 상태인지 확인하세요.",
      "chats-guide-activity":
        "턴 수와 token 활동을 함께 보면 추가 검토가 필요한 세션을 가려내는 데 도움이 됩니다.",
      "chats-guide-distill":
        "세션이 없다면 데이터 소스를 먼저 확인하고, 명확한 결론이 있는 경우에만 증류하세요.",
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
        "턴 수는 진행 깊이를 보여 주지만 결론의 품질을 보장하지는 않습니다.",
      "chat-detail-guide-tokens":
        "token 활동으로 컨텍스트 규모를 파악하고 예상치 못한 증가를 살펴보세요.",
      "chat-detail-guide-state":
        "작업하기 전에 세션 상태와 메타데이터의 최신성을 함께 판단하세요.",
      "chat-detail-guide-recovery":
        "복구 조건을 충족한 세션만 이어서 실행하고 나머지는 읽기 전용으로 유지하세요.",
      "chat-detail-guide-distill":
        "결론을 재사용할 수 있다면 대화 본문을 노출하지 않고 메타데이터에서 증류를 시작하세요.",
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
        "강화 분석을 사용하려면 사용 가능한 모델 프로필과 유효한 인증 정보가 모두 필요합니다.",
      "settings-guide-enhancement":
        "강화 스위치는 모델을 통한 재작성만 제어하며 로컬 규칙 인사이트는 항상 제공됩니다.",
      "settings-guide-schedules":
        "중복 수집이나 스캔을 피하려면 필요한 예약 작업만 활성화하세요.",
      "settings-guide-retention":
        "보존 기간을 바꾸기 전에 추적이 필요한 로컬 기록이 무엇인지 확인하세요.",
      "settings-guide-privacy":
        "설정과 업무 데이터는 로컬에 저장되므로 데이터를 지우기 전에 영향 범위를 확인하세요.",
    },
    sources: {
      "sources-connected": "{count}개의 데이터 소스를 연결했습니다.",
      "sources-malformed":
        "{count}줄의 비정상 데이터가 있습니다. 로그 형식을 확인하세요.",
      "sources-not-installed":
        "{count}개의 도구가 미설치 상태입니다. 다운로드하여 연결하세요.",
      "sources-all-good":
        "전체 {count}개의 소스가 정상이며 이상 로그가 없습니다.",
      "sources-rescan":
        "도구 디렉터리가 변경되면 다시 스캔하세요. 그렇지 않으면 세션과 스킬 수집에 공백이 생깁니다.",
      "sources-local":
        "모든 수집은 로컬에서 이루어지며 대화 내용은 어디에도 업로드되지 않습니다.",
      "sources-guide-inventory":
        "도구가 감지되었다고 해서 분석 가능한 로그까지 생성되었다는 뜻은 아닙니다.",
      "sources-guide-availability":
        "설치됨, 로그 있음, 사용 가능한 이벤트 있음은 서로 다른 소스 상태입니다.",
      "sources-guide-logs":
        "로그가 없는 소스에서는 사용량 인사이트를 만들 수 없으므로 실제 도구 활동을 먼저 확인하세요.",
      "sources-guide-rescan":
        "디렉터리나 설치 상태가 바뀌면 다시 스캔해 수집 범위를 최신 상태로 갱신하세요.",
      "sources-guide-privacy":
        "소스 페이지에는 집계 상태와 오류만 표시되며 대화 본문이나 로컬 경로는 노출되지 않습니다.",
    },
  },
} as const;
