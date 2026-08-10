// AI 翻訳稿、審校待ち (2026-08)
export const sources = {
  metaDescription:
    "このマシンの各 AI ツールのインストール検出状況とログ収集状況を確認します。",
  pageHeader: "データソース",
  pageHeaderDesc: "{count} 個の AI ツールの検出状況 · {time} 更新",
  status: {
    hasData: "データあり",
    noLogs: "ログなし",
    notInstalled: "未インストール",
  },
  parsing: {
    native: "ネイティブ対応",
    adapter: "アダプター対応",
    unsupported: "対応予定",
  },
  summary: {
    connected: "接続済み / 検出合計",
    events: "収集イベント合計",
    notInstalled: "未収集ツール",
    noLogs: "ログなしツール",
    malformed: "異常行数",
  },
  panelTitle: "ツール検出状況",
  searchPlaceholder: "ツール名を検索",
  scanning: "スキャン中",
  rescan: "再スキャン",
  empty: {
    title: "一致するツールがありません",
    desc: "フィルター条件や検索キーワードを調整して再試行してください。",
  },
  row: {
    events: "収集イベント {count}",
    parsing: "ログ解析：{label}",
    malformed: "異常 {count}",
    download: "ダウンロードしてインストール ↗",
    paths: "検出パス：{paths}",
  },
  toast: {
    rescanDone: "再スキャンが完了しました",
  },
} as const;
