export const market = {
  pageHeader: "セキュリティマーケット",
  pageHeaderDesc: "セキュリティスキャンを通過した Skill のみ収録",
  strip: {
    subtitle:
      "セキュリティスキャンを通過した Skill のみ · ワンクリックでローカル Agent に配布",
  },
  meta: {
    description:
      "{appName} セキュリティマーケットの実インデックスを閲覧できます。セキュリティスキャンを通過した Skill のみ収録しています。",
  },
  notProvided: "未提供",
  jarvis: {
    available:
      "セキュリティマーケットには {total} 個の Skill、うち {official} 個が公式リリースです。",
    installed:
      "この端末にセキュリティマーケットの Skill を {count} 個インストール済みです。",
  },
  network: {
    loadFailed:
      "ネットワークを利用できません：セキュリティマーケットの読み込みに失敗しました",
    unavailableTitle:
      "ネットワークを利用できないため、セキュリティマーケットにアクセスできません",
    unavailableDesc:
      "ローカルにキャッシュされたリストは引き続き閲覧できます。ネットワーク復旧後に最新データへ自動同期されます。",
    cacheWarning:
      "ネットワークを利用できないため、キャッシュされた結果を表示しています",
  },
  empty: {
    noMatch: "一致する Skill がありません",
    noMatchDesc: "別のキーワードを試してみてください。",
  },
  stats: {
    totalSkills: "掲載 Skill",
    passRate: "セキュリティ通過",
    passRatePage: "このページの通過率",
    installedCount: "インストール済み",
    hintAllDimensionsPassed: "11 項目のスキャンをすべて通過",
    hintLocalInstalled: "この端末にインストール済み",
    hintDomains: "{count} カテゴリ",
  },
  search: {
    placeholder: "Skill 名、ソースパス、または機能を検索",
    keyword: " · キーワード「{keyword}」",
    updatedAt: "データ更新 {time}",
    perPage: "1 ページ {count} 件 · {page} ページ目",
  },
  sort: {
    latest: "最新",
    rating: "評価が高い",
    security: "セキュリティスコア上位",
    nameAsc: "A-Z",
    nameDesc: "Z-A",
  },
  list: {
    title: "セキュリティマーケットの Skill 一覧（{count}）",
    count: "合計 {count} 個の Skill",
    allSafe: "すべてセキュリティスキャン通過",
  },
  table: {
    rank: "順位",
    publisher: "公開者",
    downloads: "ダウンロード数",
    tokenUsage: "Token 使用量",
    size: "サイズ",
    stars: "Star",
    security: "セキュリティ状態",
    actions: "操作",
  },
  installed: "インストール済み",
  domainAll: "すべて",
  domain: {
    ai: "AIと自動化",
    dev: "開発",
    data: "データと分析",
    ops: "運用",
    security: "セキュリティとテスト",
    productivity: "生産性",
    docs: "ドキュメント",
    cloud: "クラウドとパフォーマンス",
    design: "デザインとフロントエンド",
  },
  card: {
    detail: "詳細",
    publisher: "発行元",
    installedAgents: "{count} 個のツールにインストール済み",
  },
  noDescription: "この Skill には説明がまだありません。",
  detail: {
    repo: "ソースリポジトリ",
    sourcePath: "ソースパス",
    tokens: "コンテキスト Token",
    securityPass: "セキュリティスキャン通過 · 安全にインストールできます",
    infoTitle: "インストール情報",
  },
  metric: {
    size: "サイズ",
    stars: "Star",
    securityScore: "セキュリティスコア",
    securityLevel: "セキュリティレベル",
  },
  security: {
    score: "セキュリティスコア {score}",
    scoreMissing: "セキュリティスコア未提供",
    safe: "安全",
    attention: "要確認",
  },
  install: {
    button: "インストール",
    to: "{agent} にインストール",
    uninstallFrom: "{agent} からアンインストール",
    installedAt: "{agent} にインストール済み",
    selectAll: "すべて選択",
    clearAll: "すべて解除",
    expandAll: "すべて表示 {count}",
    expandMore: "あと {count} 個",
    toSelected: "選択したツールにインストール",
    target: "インストール先",
    notDetected: "未検出",
    succeeded: "インストール成功",
    failed: "インストール失敗",
    success: "{agent} にインストールしました",
    uninstalled: "{agent} からアンインストールしました",
    downloading: "ダウンロード・スキャン中…",
    failure: {
      scanBlocked:
        "静的スキャンで高リスクなルールが検出されたため、インストールをブロックしました。",
      noAgent: "インストール先を選択してください",
      diskFull: "ディスク容量が不足しています。整理してから再試行してください",
      download:
        "ダウンロードに失敗しました。ネットワークを確認して再試行してください",
      generic: "ダウンロードまたは静的スキャンに失敗しました",
    },
  },
  drawer: {
    viewSource: "ソースコードを表示",
    securityNotice:
      "セキュリティスキャン通過 · 悪意のある URL、危険なコマンド、機密情報は検出されていません",
    commandExample: "インストールコマンド例",
    lastUpdated: "最終更新",
    permissionClaim: "権限宣言",
    networkClaim: "ネットワーク宣言",
    selectAgent: "インストール先を選択（複数選択・全選択対応、{count} ツール）",
    agentNotInstalled: "未インストール",
  },
  pagination: {
    range: "{start}–{end} 件目 / 全 {total} 件",
    prev: "前へ",
    next: "次へ",
  },
  outcome: {
    compressed: "圧縮パッケージ {size}",
    unpacked: "展開後 {size}",
    entries: "チェック項目 {count}",
    files: "スキャン済みファイル {count}",
    success: "成功",
    failed: "失敗",
  },
} as const;
