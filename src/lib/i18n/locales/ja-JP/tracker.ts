// AI 翻訳稿、審校待ち (2026-08)
export const tracker = {
  title: "バーンランキング",
  desc: "行動診断型の浪費ランキング：実際のトークンデータから非効率な消費を特定し、改善案を提示します。",
  insightTitle: "今日のインサイト",
  metric: {
    tokens: "総消費",
    projects: "ランクイン プロジェクト",
    skills: "ランクイン Skill",
    sessions: "ランクイン セッション",
    sortedBy: "浪費度順に並べ替え",
  },
  board: {
    skill: "Skill 消費ランキング",
    project: "プロジェクト消費ランキング",
    session: "セッション消費ランキング",
    skillSub: "どの Skill がこっそりトークンを燃やしているか",
    projectSub: "どのプロジェクトが最も消費しているか",
    sessionSub: "どのセッションが最も割に合わないか",
  },
  row: {
    tokens: "{count} tokens",
    events: "{count} イベント",
    calls: "{count} 回の呼び出し",
    waste: "浪費指数",
    cacheRate: "キャッシュヒット {rate}",
    outputRatio: "出力比率 {ratio}",
    suggest: "改善提案",
    trendUp: "前期比で上昇",
    trendDown: "前期比で下降",
    trendFlat: "前期比で横ばい",
    trendNa: "比較データなし",
  },
  suggest: {
    cache:
      "キャッシュヒット率が低いです。コンテキストを再利用してキャッシュ効果を高めましょう。",
    output:
      "出力トークン比率が高いです。出力を簡素化するか圧縮を有効にしましょう。",
    volume: "消費量が大きいです。タスク規模と重複スキャンを確認しましょう。",
    none: "明らかな改善点はありません。",
  },
  detail: {
    wasteDetail: "浪費指数 {waste}% の計算方法",
    wasteExplain:
      "指数 = 100 × (1 − キャッシュヒット率) × 出力比率：キャッシュ再利用が低く、出力比率が高いと浪費になります。",
    wastedTotal: "合計無駄消費 {tokens} tokens",
    close: "閉じる",
  },
  empty: "浪費記録はまだありません",
  emptyDesc:
    "実際の使用量がスキャンされると、浪費指数順のランキングが表示されます。",
} as const;
