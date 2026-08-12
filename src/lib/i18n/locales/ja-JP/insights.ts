// AI 翻訳稿、審校待ち (2026-08)
export const insights = {
  title: "Jarvis 今日のインサイト",
  rotate: "切替",
  dots: "インサイト一覧",
  sources: {
    empty:
      "まだソースデータがありません。スキャン後に実際のインサイトが表示されます。",
    coverage: "{connected} / {total} のツールを接続済み、接続率 {rate}。",
    events:
      "{events} 件のイベントを収集しました。分析・レポートに利用できます。",
    notInstalled:
      "{count} 件のツールが未インストールです。公式サイトから接続できます。",
    noLogs: "{count} 件のツールにログがなく、使用量を収集できません。",
    malformed: "{count} 行の異常データがあります。ログ形式を確認してください。",
    allGood: "全 {total} 件のツールが正常で、異常ログはありません。",
  },
  tracker: {
    empty:
      "まだ使用量データがありません。スキャン後に実際のインサイトが表示されます。",
    burn: "累計 {tokens} tokens を消費、{events} 件のイベントを収集しました。",
    wasteLeader: "浪費指数が最も高い: {name} · {waste}、注目に値します。",
    cacheLow:
      "キャッシュヒット率が最も低い: {name} · {rate}、コンテキスト再利用をご検討ください。",
    suggestCount:
      "{count} 件の消費改善提案があります。詳細はバーンランキングをご覧ください。",
    topBurn: "消費が最も多い: {name} · {tokens} tokens。",
  },
} as const;
