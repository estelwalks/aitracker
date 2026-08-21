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
      "dashboard-guide-collection":
        "データソースが継続して収集されていることを先に確認し、収集漏れによるダッシュボードの誤判断を防ぎましょう。",
      "dashboard-guide-sessions":
        "セッションの稼働状況から、今日の作業に振り返りや継続が必要かを判断できます。",
      "dashboard-guide-concentration":
        "利用するソースが一部に偏っている場合は、主力ツールが適切な作業を担っているか見直しましょう。",
      "dashboard-guide-cache":
        "キャッシュ効率からコンテキストの再利用状況が分かります。詳しくはバーンランキングで確認できます。",
      "dashboard-guide-distill":
        "今日の再利用可能なセッションを蒸留し、一度きりの成果を長く使える資産に変えましょう。",
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
      "agents-prompt-guide":
        "プロンプトを具体的に書くと、重複読み込みや手戻りが減り、token を節約できます。",
      "agents-guide-coverage":
        "ツールの網羅状況が Agent 一覧の完全性を左右します。未接続のローカルツールを先に追加しましょう。",
      "agents-guide-activity":
        "稼働状況とセッション数を組み合わせると、常用中の Agent とインストールのみの Agent を区別できます。",
      "agents-guide-prompt":
        "プロンプトでは恒常的なルールと一時的なタスクを分け、重複するコンテキストを減らしましょう。",
      "agents-guide-cache":
        "キャッシュの構成を確認すると、Agent が同じコンテキストを繰り返し読み込んでいないか分かります。",
      "agents-guide-security":
        "機能の拡張とともに露出範囲も広がるため、Agent の権限と Skill のリスクを併せて見直しましょう。",
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
        "完了度が高く、再利用しやすいセッションを蒸留素材として優先しましょう。",
      "distill-guide-outputs":
        "再利用方法に合わせて、手順はワークフロー、安定した機能は Skill として出力しましょう。",
      "distill-guide-quota":
        "生成前にモデルとクォータを確認し、蒸留ジョブが途中で止まらないようにしましょう。",
      "distill-guide-reuse":
        "承認済みの成果物は知識またはメモリに登録し、後から再利用できる状態にしましょう。",
      "distill-guide-start":
        "候補がない場合は、明確な結論があるセッションを会話ページから一つ選んで始めましょう。",
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
        "レポートのアーカイブから、完了済みの期間と振り返りが残っている期間を確認できます。",
      "reports-guide-highlights":
        "成果と主な変化を先にまとめ、その後に詳細を加えると読みやすいレポートになります。",
      "reports-guide-security":
        "一般的な利用状況に埋もれないよう、セキュリティ事象はレポート内で分けて記載しましょう。",
      "reports-guide-workflow":
        "下書き、編集、保存、エクスポートがレポート作成の一連の流れです。保存前に結論を確認しましょう。",
      "reports-guide-next":
        "対象期間のレポートがない場合は、直近でセッション活動があった期間から作成しましょう。",
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
        "重要な取り決めがセッションに埋もれないよう、メモリ資産を検索可能かつ追跡可能に保ちましょう。",
      "memory-guide-approval":
        "未確認の内容が長期コンテキストに入らないよう、承認してからメモリを公開しましょう。",
      "memory-guide-hygiene":
        "古いメモリやリスクのあるメモリを定期的に整理し、誤ったコンテキストの再利用を減らしましょう。",
      "memory-guide-types":
        "長期的な好みはプロフィール、個別の制約はタスク記憶として分けて管理しましょう。",
      "memory-guide-distill":
        "メモリが空の場合は、蒸留ワークベンチから確認済みの学びを一つ登録しましょう。",
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
        "件数の多さに惑わされず、高リスクの所見から先に対処し、その後に一般的な注意事項を確認しましょう。",
      "security-guide-failures":
        "スキャン失敗は確認範囲の死角を示すものであり、リスクがない証拠ではありません。",
      "security-guide-coverage":
        "有効な Skill と設定までスキャン対象に含め、漏れている項目は追加で確認しましょう。",
      "security-guide-recency":
        "古いスキャンは過去の状態しか示しません。インストールや更新の後は再スキャンしましょう。",
      "security-guide-scan":
        "結果がまだない場合は、ローカル静的スキャンを実行して安全性の基準を作りましょう。",
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
        "変化の原因を判断する前に、総消費量とイベントの稼働状況を比較しましょう。",
      "tracker-guide-waste":
        "浪費を診断するときは、重複読み込み、手戻り、過剰な出力を優先して確認しましょう。",
      "tracker-guide-cache":
        "キャッシュ再利用率の低さは、固定的なコンテキストを繰り返し読み込んでいる可能性を示します。",
      "tracker-guide-concentration":
        "モデルやプロジェクトへの消費が偏っている場合は、タスクとプロンプトを個別に見直しましょう。",
      "tracker-guide-optimize":
        "最適化後も同じ期間を観測し、変更が実際に効果を上げたか確認しましょう。",
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
        "ローカル Skill の数と入手元を整理し、同じ機能が重複したままにならないようにしましょう。",
      "skills-guide-enablement":
        "必要な Skill だけを有効にし、Agent に不要な機能が露出する範囲を減らしましょう。",
      "skills-guide-coverage":
        "Agent ごとに Skill の適用状況が異なると、同じタスクでも結果が変わることがあります。",
      "skills-guide-updates":
        "更新待ちの Skill は変更内容を確認してから、各 Agent へ同期するか判断しましょう。",
      "skills-guide-safety":
        "追加または変更した Skill は再スキャンし、旧バージョンの安全性評価を流用しないでください。",
    },
    market: {
      "market-installed":
        "{count} 個のマーケットコンポーネントをインストール済みです。",
      "market-updates":
        "{count} 個のコンポーネントに更新があります。早めのアップグレードをおすすめします。",
      "market-scan-first":
        "新しいコンポーネントをインストールする前に、必ずセキュリティスキャンを完了してください。",
      "market-review":
        "インストール前に SKILL.md とバージョン履歴を確認し、使えないパッケージを避けてください。",
      "market-guide-installs":
        "ローカルのインストール状況で所有済みの機能と候補を区別し、重複インストールを避けましょう。",
      "market-guide-updates":
        "利用中のコンポーネントを置き換える前に、マーケットのバージョン変更内容を確認しましょう。",
      "market-guide-cache":
        "キャッシュ済みのカタログはオフラインでも閲覧できますが、最新とは限りません。",
      "market-guide-review":
        "マーケットの掲載情報は候補にすぎません。インストール前に内容と安全性を確認しましょう。",
      "market-guide-install":
        "インストール済みの項目がない場合は、用途が明確で確認済みの項目から始めましょう。",
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
        "セッション一覧には安全なメタデータだけが表示されるため、詳細を開く前の絞り込みに使えます。",
      "chats-guide-sources":
        "ソースで絞り込むと、稼働中の Agent や収集漏れをすばやく見つけられます。",
      "chats-guide-recovery":
        "セッションを継続、アーカイブ、蒸留する前に、復元可能な状態か確認しましょう。",
      "chats-guide-activity":
        "ターン数と token の稼働状況から、さらに振り返る価値があるセッションを見つけられます。",
      "chats-guide-distill":
        "セッションがない場合はデータソースを確認し、明確な結論ができてから蒸留しましょう。",
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
        "ターン数は作業の進行度を示しますが、結論の質を示すものではありません。",
      "chat-detail-guide-tokens":
        "token の稼働状況からコンテキストの規模を把握し、想定外の増加を見つけられます。",
      "chat-detail-guide-state":
        "操作する前に、セッションの状態とメタデータの新しさを併せて判断しましょう。",
      "chat-detail-guide-recovery":
        "復元条件を満たすセッションだけを再開し、それ以外は読み取り専用のままにしましょう。",
      "chat-detail-guide-distill":
        "結論を再利用できる場合は、本文を公開せずにメタデータから蒸留を開始できます。",
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
        "拡張分析には、利用可能なモデルプロファイルと有効な認証情報の両方が必要です。",
      "settings-guide-enhancement":
        "拡張スイッチはモデルによる書き換えだけを制御し、ローカルのルールインサイトは常に利用できます。",
      "settings-guide-schedules":
        "収集やスキャンの重複を避けるため、定期ジョブは必要なものだけを有効にしましょう。",
      "settings-guide-retention":
        "保持期間はローカル履歴の範囲を決めます。変更前に追跡が必要なデータを確認しましょう。",
      "settings-guide-privacy":
        "設定と業務データはローカルに保存されます。データを消去する前に影響範囲を確認しましょう。",
    },
    sources: {
      "sources-connected": "{count} 個のデータソースを接続済みです。",
      "sources-malformed":
        "{count} 行の異常データがあります。ログ形式を確認してください。",
      "sources-not-installed":
        "{count} 件のツールが未インストールです。ダウンロードして接続してください。",
      "sources-all-good":
        "全 {count} 件のソースが正常で、異常ログはありません。",
      "sources-rescan":
        "ツールのディレクトリ変更後は再スキャンしてください。さもないとセッションやスキルの収集に欠落が生じます。",
      "sources-local":
        "すべての収集はローカルで行われ、会話内容がアップロードされることはありません。",
      "sources-guide-inventory":
        "検出済みであることはツールの存在を示すだけで、分析可能なログがあるとは限りません。",
      "sources-guide-availability":
        "インストール済み、ログあり、利用可能なイベントありは、それぞれ異なるソース状態です。",
      "sources-guide-logs":
        "ログのないソースからは使用状況を分析できません。まずツールが実際に利用されているか確認しましょう。",
      "sources-guide-rescan":
        "ディレクトリやインストール状態を変更した後は再スキャンし、収集範囲を更新しましょう。",
      "sources-guide-privacy":
        "ソースページには集計状態とエラー件数だけを表示し、会話本文やローカルパスは公開しません。",
    },
  },
} as const;
