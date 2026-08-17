// AI 翻訳稿、審校待ち (2026-08)
export const market = {
  pageHeader: "Skill マーケット",
  pageHeaderDesc: "セキュリティスキャンを通過した Skill のみ収録",
  meta: {
    description:
      "{appName} Skill マーケットの実インデックスを閲覧できます。セキュリティスキャンを通過した Skill のみ収録しています。",
  },
  notProvided: "未提供",
  network: {
    loadFailed:
      "ネットワークを利用できません：Skill マーケットの読み込みに失敗しました",
    unavailableTitle:
      "ネットワークを利用できないため、Skill マーケットにアクセスできません",
    unavailableDesc:
      "ローカルにキャッシュされたリストは引き続き閲覧できます。ネットワーク復旧後に最新データへ自動同期されます。",
  },
  empty: {
    noMatch: "一致する Skill がありません",
    noMatchDesc: "別のキーワードを試してみてください。",
  },
  stats: {
    totalSkills: "掲載 Skill",
    officialCount: "公式",
    passRate: "セキュリティ通過",
    passRatePage: "このページの通過率",
    installedCount: "インストール済み",
    totalDownloads: "総ダウンロード",
    hintCurrentPage: "現在のページの集計",
    hintLocalInstalled: "この端末にインストール済み",
  },
  search: {
    placeholder: "Skill 名、ソースパス、または機能を検索",
    keyword: " · キーワード「{keyword}」",
    updatedAt: "データ更新 {time}",
    perPage: "1 ページ {count} 件 · {page} ページ目",
  },
  sort: {
    hot: "人気",
    latest: "最新",
    nameAsc: "A-Z",
    nameDesc: "Z-A",
    downloads: "ダウンロード数",
  },
  list: {
    title: "Skill 一覧（{count}）",
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
  official: "公式",
  domainAll: "すべて",
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
    lastScanned: "最終スキャン",
  },
  metric: {
    downloads: "ダウンロード数",
    tokenUsage: "Token 使用量",
    size: "サイズ",
    stars: "Star",
  },
  security: {
    score: "セキュリティスコア {score}",
    scoreMissing: "セキュリティスコア未提供",
    safe: "安全",
    attention: "要確認",
  },
  install: {
    button: "インストール",
    toSelected: "選択したツールにインストール",
    target: "インストール先",
    notDetected: "未検出",
    succeeded: "インストール成功",
    failed: "インストール失敗",
    success: "{agent} にインストールしました",
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
    viewRepo: "ソースリポジトリを表示",
    viewSource: "ソースコードを表示",
    securityNotice:
      "セキュリティスキャン通過 · 悪意のある URL、危険なコマンド、機密情報は検出されていません",
    commandExample: "インストールコマンド例",
    contextTokens: "コンテキスト Token",
    lastUpdated: "最終更新",
    permissionClaim: "権限宣言",
    networkClaim: "ネットワーク宣言",
    selectAgent: "インストール先を選択（単一選択、{count} ツール対応）",
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
