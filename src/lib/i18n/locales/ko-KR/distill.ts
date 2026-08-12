// AI 번역 초안, 검토 대기 (2026-08)
/** 증류 워크벤치 문구(V3.0 프로토타입 정렬). */
export const distill = {
  jarvisTitle: "Jarvis 인사이트",
  insightRotate: "다음 인사이트",
  insightDots: "인사이트 캐러셀",
  insightSelected: "선택 {count}개 세션 · 총 {turns}턴",
  insightWaiting: "승인 대기 중인 후보 {count}개",
  insightRuns: "증류 {count}회 실행됨",
  insightApproved: "지식 자산 {count}개 반영됨",
  insightEmpty:
    "세션을 선택하고 증류를 실행하면 Jarvis가 실제 데이터를 기반으로 인사이트를 생성합니다.",
  help: "도움말",
  compare: "나란히 비교",
  compareUnavailable:
    "나란히 비교는 곧 제공될 예정입니다. 이 버전에서는 사용할 수 없습니다.",
  configTitle: "증류 설정",
  quickTimeRange: "시간 범위",
  rangeAll: "전체",
  range7: "최근 7일",
  range30: "최근 30일",
  quickGranularity: "세분화",
  grainSession: "세션별",
  grainProject: "프로젝트별",
  quickNote:
    "증류는 세션 메타데이터(제목/프로젝트/모델/턴 수/시간)만 읽으며 대화 본문은 절대 읽지 않습니다.",
  proMaterial: "자료 라이브러리",
  proSelected: "{count}개 세션 선택됨",
  proModel: "모델",
  proOffline: "오프라인 폴백(결정적)",
  proPresets: "프롬프트 프리셋",
  presetSummary: "요약",
  presetSkill: "Skill 추출",
  presetBrief: "브리프 작성",
  presetPromptSummary:
    "이 세션들의 핵심 결론과 재사용 가능한 교훈을 요약해 주세요.",
  presetPromptSkill:
    "용도, 절차, 경계를 포함한 재사용 가능한 Skill 사양으로 정리해 주세요.",
  presetPromptBrief: "배경, 발견, 권장사항을 포함한 브리프를 작성해 주세요.",
  proPromptPlaceholder: "증류 프롬프트 커스터마이즈…(⌘↵ 실행)",
  proRun: "실행",
  resultsTitle: "결과",
  expBrowse: "SKILL.md 보기",
  expEdit: "편집",
  expRegenerate: "다시 생성",
  expSaveInstall: "저장 및 설치",
  editHint:
    '편집은 "저장 및 설치"에만 반영되며 승인된 지식 항목에는 영향이 없습니다.',
  noCandidates: "아직 후보가 없습니다",
  noCandidatesDesc:
    "증류를 실행하면 후보가 로컬에 저장되어 이 목록에 표시됩니다. 새로 고침 후에도 유지됩니다.",
  saveTitle: "Skill로 저장",
  saveDesc:
    "승인된 지식 노트를 선택한 도구의 skills 디렉터리에 기록합니다. 저장 후 '스킬' 페이지에서 확인하고 동기화할 수 있습니다.",
  saveName: "이름",
  saveTarget: "대상 도구",
  saveConfirm: "저장",
  savedToast: "{agent}에 Skill 저장됨",
  guideTitle: "증류란 무엇인가요?",
  guideStep1: "자료 선택",
  guideStep1Desc: "자료 라이브러리에서 1~8개의 세션을 소스로 선택합니다.",
  guideStep2: "증류 실행",
  guideStep2Desc:
    "AI가 세션 메타데이터를 기반으로 지식 노트 후보를 생성하며 대화 본문은 읽지 않습니다.",
  guideStep3: "승인 및 반영",
  guideStep3Desc: "후보를 검토하고 승인하면 로컬 지식 저장소에 기록합니다.",
  guideStep4: "도구 동기화",
  guideStep4Desc:
    "Skill로 저장하고 '스킬' 페이지에서 설치된 도구에 동기화합니다.",
  guideStart: "시작하기",
} as const;
