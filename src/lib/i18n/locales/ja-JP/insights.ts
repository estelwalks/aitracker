// AI 翻訳稿、審校待ち (2026-08)
export const insights = {
  title: "今日のインサイト",
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
  actions: {
    security: "セキュリティを確認",
    distill: "蒸留する",
    reports: "レポートを見る",
    sessions: "セッションを見る",
    sources: "データソース",
    settings: "モデル設定",
    tracker: "バーンランキングを見る",
    market: "マーケット",
    skills: "スキル",
    memory: "メモリ",
  },
  page: {
    dashboard: {
      "dashboard-watch":
        "今日は {agents} 個の Agent が稼働し、{blocked} 回のリスクを遮断、約 {hours} 時間を節約、{distillable} 件のセッションを蒸留できます。",
      "dashboard-assets":
        "主力 Agent「{name}」が {rate} の使用量を占めています。他は低使用のため、配分の見直しをご検討ください。",
      "dashboard-usage":
        "今日は {events} 件の使用イベントと {sessions} 件のセッションを収集しました。セッションで確認や蒸留ができます。",
      "dashboard-security-safe":
        "本日はセキュリティリスクは見つかりませんでした。スキャン済み項目はすべて合格です。",
      "dashboard-security-risk":
        "本日 {count} 件のセキュリティリスクが未処理です。セキュリティページで再確認してください。",
      "dashboard-efficiency":
        "「{name}」のキャッシュヒット率は {rate} のみです。コスト削減のためコンテキスト再利用をご検討ください。",
      "dashboard-empty":
        "まだセッションデータがありません。データソースからローカル Agent を接続してください。",
    },
    agents: {
      "agents-overview":
        "{count} 個の Agent が稼働中。本日 {blocked} 回のリスクを遮断し、約 {hours} 時間を節約しました。",
      "agents-focus-prompt":
        "「{name}」はプロンプトの重複度が高いため、共通指示を抽出して token 消費を削減してください。",
      "agents-focus-cache":
        "「{name}」のキャッシュヒット率は {rate} のみです。コンテキスト再利用を有効化してください。",
      "agents-focus-security":
        "「{name}」は直近 {count} 件のリスク操作があります。権限と設定を再確認してください。",
    },
    distill: {
      "distill-ready":
        "本日 {count} 件のセッションを蒸留できます。経験としてアーカイブしてください。",
      "distill-pending":
        "{count} 件の蒸留が承認待ちです。承認または却下してください。",
      "distill-quota":
        "蒸留クォータは {rate} 使用済みです。1 日の呼び出し量にご注意ください。",
      "distill-empty": "本日蒸留できるセッションはありません。",
    },
    reports: {
      "reports-highlights":
        "今期の主力 Agent は「{name}」で、使用量の {rate} を占めています。",
      "reports-security":
        "今期 {count} 件のセキュリティ事象が再確認待ちです。レポートの重点に含めてください。",
      "reports-latest":
        "最新レポートは {time} に生成されました。データは現在のスキャン時点です。",
      "reports-empty": "今期のデータはありません。",
    },
    memory: {
      "memory-total":
        "{count} 件の記憶を蓄積しました。内訳はプロフィール {profiles} 件、タスク {tasks} 件です。",
      "memory-auto":
        "蒸留の自動蓄積を有効にすると、経験が自動でメモリに保存されます。",
      "memory-empty":
        "メモリは空です。セッションを蒸留すると経験が自動で蓄積されます。",
    },
    security: {
      "security-risk-top":
        "{count} 件の高リスク所見を検出しました。すぐにセキュリティページで対処してください。",
      "security-scan-gap":
        "{count} 件のソースが今回のスキャンで未対象です。現状を安全とみなすことはできません。",
      "security-scan-coverage":
        "今回のスキャンは {rate} のソースを対象としました。残りは早めに補完してください。",
      "security-last-scan":
        "前回の完全スキャンは {time} に完了しました。結果は参考値です。",
    },
    tracker: {
      "tracker-burn-leader":
        "消費が最も多い: 「{name}」、累計 {tokens} tokens。",
      "tracker-waste-leader":
        "浪費指数が最も高い: 「{name}」· {rate}、注目に値します。",
      "tracker-cache-low":
        "キャッシュヒット率が最も低い: 「{name}」· {rate}、コンテキスト再利用をご検討ください。",
      "tracker-suggest":
        "{count} 件の消費改善提案があります。詳細はバーンランキングをご覧ください。",
      "tracker-empty": "今のところ目立った浪費はありません。",
    },
    skills: {
      "skills-local": "ローカルに {count} 個のスキルがあります。",
      "skills-enabled":
        "うち {count} 個が有効です。残りは必要に応じて有効化できます。",
      "skills-unscanned":
        "{count} 個のスキルが未スキャンです。安全確認のため先にスキャンしてから有効化してください。",
    },
    market: {
      "market-installed":
        "{count} 個のマーケットコンポーネントをインストール済みです。",
      "market-updates":
        "{count} 個のコンポーネントに更新があります。早めのアップグレードをおすすめします。",
      "market-scan-first":
        "新しいコンポーネントをインストールする前に、必ずセキュリティスキャンを完了してください。",
    },
    chats: {
      "chats-total": "{count} 件のセッションを収集しました。",
      "chats-top-source":
        "セッションが最も多いソースは「{name}」です。使用量に注目してください。",
      "chats-recoverable":
        "{count} 件のセッションを復元できます。アーカイブまたは蒸留してください。",
      "chats-empty":
        "まだセッションがありません。データソースを接続すると表示されます。",
    },
    "chat-detail": {
      "chat-detail-turns":
        "このセッションは {count} ターンです。メタデータは完全に収集済みです。",
      "chat-detail-tokens": "このセッションは {tokens} tokens を消費しました。",
      "chat-detail-recoverable":
        "このセッションは復元または蒸留できます。詳細ページから開始してください。",
    },
    widget: {
      "widget-broadcast-security":
        "本日のセキュリティ: {count} 件のリスクが未処理です。",
      "widget-broadcast-efficiency":
        "本日の効率: 「{name}」のキャッシュヒット率が最小で {rate} です。",
      "widget-broadcast-distill":
        "本日の蒸留: {count} 件のセッションが待機中です。",
    },
    settings: {
      "settings-model-unconfigured":
        "モデルが未設定です。モデル設定で接続を完了すると拡張インサイトを利用できます。",
      "settings-scan-plan":
        "スキャン計画は {count} 個のデータソースを対象とします。ここで調整できます。",
      "settings-collection":
        "データ収集の完全度は {rate} です。不足分はここでソースを確認できます。",
    },
    sources: {
      "sources-connected": "{count} 個のデータソースを接続済みです。",
      "sources-malformed":
        "{count} 行の異常データがあります。ログ形式を確認してください。",
      "sources-not-installed":
        "{count} 件のツールが未インストールです。ダウンロードして接続してください。",
      "sources-all-good":
        "全 {count} 件のソースが正常で、異常ログはありません。",
    },
  },
} as const;
