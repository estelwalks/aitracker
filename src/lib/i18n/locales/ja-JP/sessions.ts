// AI 翻訳稿、審校待ち (2026-08)
export const sessions = {
  metaDescription:
    "ローカルの過去セッションを閲覧し、利用可能なセッションを安全に復元します。",
  pageHeader: "セッション管理",
  pageHeaderDesc:
    "時刻・ツール・プロジェクトでローカルセッションを閲覧し、利用可能なセッションを安全に復元します。",
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
  detail: {
    back: "セッション一覧に戻る",
    title: "セッション詳細",
    safeSummary:
      "匿名化済みのセッション概要のみを表示します。パス、コマンド、会話内容は表示しません。",
    activity: "セッション活動",
    startedAt: "開始時刻",
    endedAt: "終了時刻",
    duration: "アクティブ時間",
    subagents: "サブエージェント呼び出し",
  },
  action: {
    open: "詳細を見る",
    resume: "セッションを復元",
    resuming: "復元中",
    resumeAccepted: "ローカル復元リクエストを開始しました",
    resumeUnavailable: "復元不可",
  },
  pagination: {
    previous: "前へ",
    next: "次へ",
    summary: "{page} / {totalPages} ページ · {total} 件",
  },
  row: {
    untitled: "(名前のないセッション)",
    copy: "セッションを復元",
    copied: "開始済み",
    copyUnsafe: "このセッション ID は安全でないため、復元できません",
    project: "プロジェクト",
    model: "モデル",
    time: "時間",
    duration: "所要時間",
    cost: "費用",
    turns: "ターン数",
    edits: "編集回数",
    resumeDirHint:
      "復元は管理されたローカルサービスで実行され、コマンドやディレクトリはブラウザに公開されません。",
    statusReason: "状態：",
  },
  toast: {
    refreshed: "セッション一覧を更新しました",
    copied: "ローカル復元リクエストを開始しました",
  },
} as const;
