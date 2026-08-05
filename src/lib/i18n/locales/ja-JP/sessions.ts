// AI 翻訳稿、審校待ち (2026-08)
export const sessions = {
  metaDescription:
    "ローカルの過去セッションを閲覧し、ワンクリックで復元コマンドをコピーできます。",
  pageHeader: "セッション復元",
  pageHeaderDesc:
    "ローカルの過去セッションを閲覧し、ワンクリックで復元コマンドをコピー",
  range: {
    d7: "過去 7 日間",
    d30: "過去 30 日間",
    d90: "過去 90 日間",
  },
  status: {
    all: "すべての状態",
    available: "復元可能",
    interrupted: "異常終了",
    lost: "紛失としてマーク済み",
    unavailable: "コマンド利用不可",
  },
  source: {
    all: "すべてのツール",
  },
  project: {
    all: "すべてのプロジェクト",
  },
  panelTitle: "ローカルセッション",
  hint: "現在は Claude Code、Codex、Grok のみ復元可能です。費用はローカルのモデル価格表で見積り、未知の価格は明示されます。",
  searchPlaceholder: "タイトル / プロジェクト / モデル / sessionId を検索",
  summary: {
    count: "セッション数",
    tokens: "Token 合計",
    cost: "費用合計",
    turns: "ターン数合計",
  },
  empty: {
    title: "一致するセッションがありません",
    desc: "フィルター条件や検索キーワードを調整して再試行してください。",
  },
  refreshing: "更新中",
  row: {
    untitled: "(名前のないセッション)",
    copy: "復元コマンドをコピー",
    copied: "コピー済み",
    copyUnsafe:
      "このセッション ID は安全でないため、復元コマンドを生成できません",
    project: "プロジェクト",
    model: "モデル",
    time: "時間",
    duration: "所要時間",
    cost: "費用",
    turns: "ターン数",
    edits: "編集回数",
    resumeDirHint: "このディレクトリで復元コマンドを実行してください：",
    statusReason: "状態：",
  },
  toast: {
    refreshed: "セッション一覧を更新しました",
    copied: "復元コマンドをコピーしました",
  },
} as const;
