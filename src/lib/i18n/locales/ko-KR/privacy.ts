export const privacy = {
  local: {
    title: "완전 로컬 실행",
    desc: "세션과 Skill은 이 기기에만 남으며 업로드되지 않습니다",
  },
  ownership: {
    title: "성과는 빼앗기지 않습니다",
    desc: "증류 산출물은 당신 소유이며 클라우드 모델로 환류되지 않습니다",
  },
  account: {
    title: "로그인 불필요 · 로컬 자체 등록",
    desc: "계정 불필요, 기기에서 로컬로 식별자를 생성합니다",
  },
} as const;
