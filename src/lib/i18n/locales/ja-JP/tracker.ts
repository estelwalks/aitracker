// AI 翻訳稿、審校待ち (2026-08)
export const tracker = {
  title: "バーンランキング",
  desc: "行動診断型の浪費ランキング：実際のトークンデータから非効率な消費を特定し、改善案を提示します。",
  metric: {
    tokens: "総消費",
    events: "イベント数",
    entries: "ランクイン件数",
  },
  board: {
    skill: "Skill 消費ランキング",
    project: "プロジェクト消費ランキング",
    session: "セッション消費ランキング",
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
    wasteDetail: "浪費の内訳",
    close: "閉じる",
  },
  empty: "データがまだありません",
  emptyDesc:
    "実際の使用量がスキャンされると、浪費指数順のランキングが表示されます。",
} as const;
