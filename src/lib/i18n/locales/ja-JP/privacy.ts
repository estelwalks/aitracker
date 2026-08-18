export const privacy = {
  local: {
    title: "完全ローカル実行",
    desc: "セッションと Skill はこのマシンだけに残り、アップロードされません",
  },
  ownership: {
    title: "成果は乗っ取られない",
    desc: "蒸留成果はあなたのもので、クラウドモデルには還元されません",
  },
  account: {
    title: "ログイン不要 · ローカル自己登録",
    desc: "アカウント不要、デバイス上でローカルに識別子を生成します",
  },
} as const;
