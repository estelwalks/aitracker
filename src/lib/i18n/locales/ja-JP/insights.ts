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
    market: "セキュリティマーケット",
    skills: "スキル",
    memory: "メモリ",
  },
  page: {
    dashboard: {
      "dashboard-watch":
        "現在のスナップショットには Skill 資産 {skills} 件、知識資産 {knowledge} 件があります。",
      "dashboard-assets":
        "最大利用 Agent「{name}」は総 tokens の {rate} を占めます。",
      "dashboard-usage":
        "現在の範囲で {events} 件の使用イベントを収集しました。",
      "dashboard-security-safe":
        "本日はセキュリティリスクは見つかりませんでした。スキャン済み項目はすべて合格です。",
      "dashboard-security-risk":
        "本日 {count} 件のセキュリティリスクが未処理です。セキュリティページで再確認してください。",
      "dashboard-efficiency":
        "「{name}」のキャッシュヒット率は {rate} のみです。コスト削減のためコンテキスト再利用をご検討ください。",
      "dashboard-empty":
        "まだセッションデータがありません。データソースからローカル Agent を接続してください。",
      "dashboard-guide-collection":
        "現在の範囲で {tokens} tokens を消費しました。",
      "dashboard-guide-sessions":
        "現在の範囲には {count} 件の AI セッションがあります。",
      "dashboard-guide-concentration":
        "1 利用イベントあたり平均 {average} tokens を消費しました。",
      "dashboard-guide-cache":
        "現在の範囲には {events} 件の利用イベントがあります。",
      "dashboard-guide-distill":
        "{count} 個の Agent が計測可能な利用イベントを生成しました。",
    },
    agents: {
      "agents-overview":
        "既存 Agent を {count} 個検出し、{active} 個に利用イベント、{inactive} 個にイベントがありません。",
      "agents-focus-prompt":
        "「{name}」はプロンプトの重複度が高いため、共通指示を抽出して token 消費を削減してください。",
      "agents-focus-cache":
        "「{name}」のキャッシュヒット率は {rate} のみです。コンテキスト再利用を有効化してください。",
      "agents-focus-security":
        "{available} 個の既存 Agent でローカルデータを読み取れます。",
      "agents-prompt-guide":
        "最大利用の既存 Agent「{name}」は総 tokens の {rate} を占めます。",
      "agents-guide-coverage":
        "インストール済み、読み取り可能、または利用イベントがある Agent を {count} 個検出しました。",
      "agents-guide-activity":
        "既存 Agent には {count} 件のセッションが記録されています。",
      "agents-guide-prompt":
        "既存 Agent は {events} 件の利用イベントと {tokens} tokens を生成しました。",
      "agents-guide-cache":
        "{available} 個の Agent でローカルデータを読み取れます。",
      "agents-guide-security":
        "{count} 個の既存 Agent が利用イベントを生成しました。",
    },
    distill: {
      "distill-ready":
        "本日 {count} 件のセッションを蒸留できます。経験としてアーカイブしてください。",
      "distill-pending":
        "{count} 件の蒸留が承認待ちです。承認または却下してください。",
      "distill-quota":
        "蒸留クォータは {rate} 使用済みです。1 日の呼び出し量にご注意ください。",
      "distill-empty": "本日蒸留できるセッションはありません。",
      "distill-focus":
        "素材が絞られているほど蒸留品質は向上します。3〜8 件の関連性の高い会話を選ぶ方が、全体をインポートするより良い成果が得られます。",
      "distill-repeat":
        "繰り返しの多い Q&A は 1 つの Skill に固定でき、token を節約できます。",
      "distill-guide-intake":
        "本日の蒸留呼び出しは {used} / {limit} 回使用済みです。",
      "distill-guide-outputs":
        "蒸留ワークベンチには現在 {count} 件の知識資産があります。",
      "distill-guide-quota": "本日はあと {count} 回蒸留を呼び出せます。",
      "distill-guide-reuse": "{count} 件の蒸留結果が承認待ちです。",
      "distill-guide-start": "蒸留候補キューには現在 {count} 件あります。",
    },
    reports: {
      "reports-highlights":
        "今期の主力 Agent は「{name}」で、使用量の {rate} を占めています。",
      "reports-security":
        "今期 {count} 件のセキュリティ事象が再確認待ちです。レポートの重点に含めてください。",
      "reports-latest":
        "最新レポートは {time} に生成されました。データは現在のスキャン時点です。",
      "reports-empty": "今期のデータはありません。",
      "reports-collab":
        "AI が下書きし、あなたが修正して保存するだけ。レポートはゼロから書く必要がなく、結論の確認だけで済みます。",
      "reports-next":
        "レポートに「次のステップ」を追記すると、集計時に自動で引用されます。",
      "reports-guide-inventory":
        "レポートライブラリには現在 {total} 件のレポートがあります。",
      "reports-guide-highlights": "日報 {daily} 件、週報 {weekly} 件です。",
      "reports-guide-security": "現在 {count} 件のレポートが下書きです。",
      "reports-guide-workflow": "現在 {count} 件のレポートが承認済みです。",
      "reports-guide-next": "現在 {count} 件のレポートがアーカイブ済みです。",
    },
    memory: {
      "memory-total":
        "{count} 件の記憶を蓄積しました。内訳はプロフィール {profiles} 件、タスク {tasks} 件です。",
      "memory-auto":
        "蒸留の自動蓄積を有効にすると、経験が自動でメモリに保存されます。",
      "memory-empty":
        "メモリは空です。セッションを蒸留すると経験が自動で蓄積されます。",
      "memory-kinds":
        "プロフィールはあなたが誰でどう働きたいかを、タスク記憶は私たちが決めたルールを覚えています。",
      "memory-guide-inventory":
        "メモリライブラリには現在 {count} 件の資産があります。",
      "memory-guide-approval":
        "{approved} 件のメモリが承認または公開済みです。",
      "memory-guide-hygiene":
        "{unsafe} 件のメモリが疑わしいまたは危険と判定されています。",
      "memory-guide-types": "{pending} 件のメモリが未承認または未公開です。",
      "memory-guide-distill":
        "{safe} 件のメモリにはセキュリティリスク判定がありません。",
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
      "security-scan-first":
        "新しいスキルは有効化する前にスキャンしてください。数秒で大半の悪意あるスクリプトを防げます。",
      "security-history":
        "スキャン履歴は保存されます。問題発生時に前後バージョンを比較し、どの更新でリスクが入ったかを特定できます。",
      "security-guide-posture":
        "最新の安全性サマリーには疑わしいまたは危険な資産が {risky} 件あります。",
      "security-guide-failures":
        "最新スキャンでは {failed} 件の資産評価に失敗しました。",
      "security-guide-coverage":
        "最新スキャンは {discovered} 件を検出し、{assessed} 件を評価しました。",
      "security-guide-recency":
        "最新の安全性サマリーは {time} に生成されました。",
      "security-guide-scan":
        "最新スキャンでは {clean} 件の資産が合格しました。",
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
      "tracker-top-model":
        "「{name}」が最も多くの tokens を消費しています。軽量タスクはより小さいモデルで処理できます。",
      "tracker-top-project":
        "プロジェクト別では「{name}」の消費が最も多く、プロンプトテンプレートの最適化をご検討ください。",
      "tracker-empty": "今のところ目立った浪費はありません。",
      "tracker-guide-consumption":
        "現在の範囲で {events} 件のイベントが {tokens} tokens を消費しました。",
      "tracker-guide-waste":
        "浪費指数が最も高いのは「{name}」で、指数は {rate} です。",
      "tracker-guide-cache":
        "{count} 件のソースが検証可能なキャッシュ項目を提供しています。",
      "tracker-guide-concentration":
        "最大消費ソース「{name}」は総 tokens の {rate} を占めます。",
      "tracker-guide-optimize":
        "1 利用イベントあたり平均 {average} tokens を消費しました。",
    },
    skills: {
      "skills-local": "ローカルに {count} 個のスキルがあります。",
      "skills-enabled":
        "うち {count} 個が有効です。残りは必要に応じて有効化できます。",
      "skills-unscanned":
        "{count} 個のスキルが未スキャンです。安全確認のため先にスキャンしてから有効化してください。",
      "skills-sync":
        "Skill が一部の Agent にしか入っていないと結果が不整合になります。ワンクリック同期で補完してください。",
      "skills-specific":
        "Skill が具体的であるほどモデルはぶれにくく、token も節約できます。",
      "skills-guide-inventory":
        "ローカル Skill スナップショットには {count} 個の Skill があります。",
      "skills-guide-enablement":
        "{enabled} 個の Skill が少なくとも 1 つの Agent にインストールされています。",
      "skills-guide-coverage":
        "インストール済み Agent を {agents} 個検出しました。",
      "skills-guide-updates":
        "{outdated} 件の Skill インストールに更新があります。",
      "skills-guide-safety":
        "{unassigned} 個の Skill はどの Agent にもインストールされていません。",
    },
    market: {
      "market-installed":
        "{count} 個のセキュリティマーケットコンポーネントをインストール済みです。",
      "market-updates":
        "{count} 個のコンポーネントに更新があります。早めのアップグレードをおすすめします。",
      "market-scan-first":
        "新しいコンポーネントをインストールする前に、必ずセキュリティスキャンを完了してください。",
      "market-review":
        "インストール前に SKILL.md とバージョン履歴を確認し、使えないパッケージを避けてください。",
      "market-guide-installs":
        "セキュリティマーケット由来の Skill を {installed} 個インストール済みです。",
      "market-guide-updates":
        "{updates} 個のセキュリティマーケット Skill に更新があります。",
      "market-guide-cache":
        "ローカルセキュリティマーケットキャッシュには {total} 件の項目があります。",
      "market-guide-review":
        "インストール済みセキュリティマーケット Skill のうち {current} 個には保留中の更新がありません。",
      "market-guide-install":
        "セキュリティマーケットキャッシュは約 {hours} 時間前に取得されました。",
    },
    chats: {
      "chats-total": "{count} 件のセッションを収集しました。",
      "chats-top-source":
        "セッションが最も多いソースは「{name}」です。使用量に注目してください。",
      "chats-recoverable":
        "{count} 件のセッションを復元できます。アーカイブまたは蒸留してください。",
      "chats-empty":
        "まだセッションがありません。データソースを接続すると表示されます。",
      "chats-resume":
        "復元コマンドにはプロジェクトパスが含まれ、ターミナルに貼り付けるだけで元の作業ディレクトリに戻れます。",
      "chats-distill":
        "再利用できるセッションは蒸留ワークベンチへ。履歴を探すより Skill 化する方が早いです。",
      "chats-guide-inventory":
        "セッションスナップショットには現在 {count} 件あります。",
      "chats-guide-sources":
        "これらのセッションは {count} 個の Agent ソースから来ています。",
      "chats-guide-recovery": "現在 {count} 件のセッションが復元可能です。",
      "chats-guide-activity":
        "全セッションの合計は {turns} ターン、{tokens} tokens です。",
      "chats-guide-distill":
        "全セッションのアクティブ時間は約 {minutes} 分です。",
    },
    "chat-detail": {
      "chat-detail-turns":
        "このセッションは {count} ターンです。メタデータは完全に収集済みです。",
      "chat-detail-tokens": "このセッションは {tokens} tokens を消費しました。",
      "chat-detail-recoverable":
        "このセッションは復元または蒸留できます。詳細ページから開始してください。",
      "chat-detail-resume":
        "このセッションは復元してコンテキストを継続できます。復元コマンドにはプロジェクトパスが含まれます。",
      "chat-detail-guide-turns":
        "このセッションには {count} 件の再試行ターンがあります。",
      "chat-detail-guide-tokens":
        "このセッションには {count} 回のサブ Agent 呼び出しがあります。",
      "chat-detail-guide-state":
        "このセッションのソースは「{source}」、ローカル状態は「{status}」です。",
      "chat-detail-guide-recovery":
        "このセッションには編集操作を含むターンが {count} 件あります。",
      "chat-detail-guide-distill":
        "このセッションのアクティブ時間は約 {minutes} 分です。",
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
      "settings-local":
        "収集はすべてローカルで行われ、会話内容はアップロードされません。データソースで収集範囲を調整できます。",
      "settings-guide-model":
        "モデルプロファイルは {profiles} 件あり、{ready} 件に認証情報があります。",
      "settings-guide-enhancement":
        "バックグラウンドジョブは {total} 件登録されています。",
      "settings-guide-schedules":
        "バックグラウンドジョブのうち {enabled} 件が有効です。",
      "settings-guide-retention":
        "バックグラウンドジョブのうち {disabled} 件が無効です。",
      "settings-guide-privacy":
        "{ready} 件のモデルプロファイルに利用可能な認証情報があります。",
    },
    sources: {
      "sources-connected": "{count} 個のデータソースを接続済みです。",
      "sources-malformed":
        "{count} 行の異常データがあります。ログ形式を確認してください。",
      "sources-not-installed":
        "{count} 件の検出ソースには分析可能なイベントがありません。",
      "sources-all-good":
        "全 {count} 件のソースが正常で、異常ログはありません。",
      "sources-rescan":
        "ツールのディレクトリ変更後は再スキャンしてください。さもないとセッションやスキルの収集に欠落が生じます。",
      "sources-local":
        "すべての収集はローカルで行われ、会話内容がアップロードされることはありません。",
      "sources-guide-inventory":
        "ソーススナップショットにはレジストリソースが {total} 件あります。",
      "sources-guide-availability":
        "{available} 件のソースでローカルデータを読み取れます。",
      "sources-guide-logs":
        "{connected} 件のソースが分析可能なイベントを生成しました。",
      "sources-guide-rescan":
        "ソーススナップショットには形式異常が {malformed} 行あります。",
      "sources-guide-privacy":
        "インストールスナップショットは {installed} 個のインストール済みツールを検出しました。",
    },
  },
} as const;
