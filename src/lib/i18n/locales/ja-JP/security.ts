// AI 翻訳稿、審校待ち (2026-08)
export const security = {
  pageHeader: "セキュリティ検査",
  pageHeaderDesc:
    "SKILL.md と Skill フォルダーのみ対応 · 11 のセキュリティ次元をローカルで静的スキャン",
  pageDescription:
    "SKILL.md の 11 次元の静的セキュリティ検査をローカルのみで解析します。",
  stats: {
    scanned: "累計スキャン",
    averageDuration: "平均所要時間",
    rulesVersion: "ルールライブラリのバージョン",
  },
  verdict: {
    all: "すべて",
    safe: "安全",
    suspicious: "要確認",
    dangerous: "危険",
  },
  severity: {
    high: "高",
    medium: "中",
    low: "低",
  },
  source: {
    builtin: "組み込みルール",
    custom: "ユーザールール",
  },
  phase: {
    idle: "待機中",
    scanning: "スキャン中",
    done: "完了",
  },
  scanSteps: {
    read: "ローカルの SKILL.md を読み取り",
  },
  rulesNotice:
    "組み込みルールライブラリ v{version} は TrustTools アプリとともに更新されます。現在リモートのルール更新チャネルはないため、ネットワークリクエストは発生せず、偽の更新成功ステータスも表示されません。",
  dropzone: {
    title: "SKILL.md または Skill フォルダーをドロップしてスキャンを開始",
    hint: "SKILL.md / SKILL.md を含むディレクトリのみ対応 · 1ファイル最大 100MB · ローカル解析のためソースコードはアップロードされません",
    tccHint:
      "書類/ダウンロード/デスクトップのファイルを選択する場合、初回のみシステムの承認が必要です。アプリは他のディレクトリ権限を要求しません",
    selectFile: "SKILL.md を選択",
    selectFolder: "フォルダーを選択",
    remaining: "今日の残り {remaining} / {limit} 回",
  },
  scanning: {
    title: "ローカルでスキャン中 · {progress}%",
  },
  history: {
    title: "検査履歴（直近 30 日）",
    clear: "履歴をクリア",
    loading: "検査履歴を読み込み中...",
    empty: "まだスキャンは実行されていません。",
    searchPlaceholder: "検査名で検索...",
    showing: "表示中 {shown} / {total} 件",
  },
  report: {
    title: "セキュリティレポート · {name}",
    viewSource: "ソースを表示",
    verdictLabel: "総合判定：{verdict}",
    riskScore: "/ 100 リスクスコア",
    riskHits: "{count} 件のヒット · {duration}",
    pass: "合格",
    hits: "{count} 件のヒット",
    noRisks: "11 次元すべてで静的リスクルールにヒットしませんでした。",
    riskDetails: "不合格項目の詳細",
    reviewTitle: "総合審査意見",
    sourceTitle: "ローカルソース：{name}",
    sourceTruncated:
      "… 残りのローカルコンテンツは省略されました（アップロードされていません）",
  },
  privacy: {
    statement:
      "判定はローカルの静的ルールのみに基づきます。SKILL.md、コード断片、ヒット詳細はアップロードされません。",
  },
  review: {
    safe: "現在の静的ルールではリスクは検出されませんでした。静的スキャンは Skill の動作と出所の人手による審査の代わりにはなりません。",
    suspicious:
      "人手による確認が必要な静的リスクシグナルが検出されました。インストール前に上記のヒット行とそのコンテキストを確認することをお勧めします。",
    dangerous:
      "高リスクの静的シグナルが検出されました。この Skill をインストールまたは実行せず、独立した人手による審査が完了してから判断することをお勧めします。",
  },
  confirm: {
    deleteReport:
      "現在のレポートを削除してスキャナーをリセットしますか？履歴は保持されます。",
    clearHistory:
      "直近 30 日の検査履歴をすべてクリアしますか？この操作は取り消せません。",
  },
  toast: {
    scanDone: "ローカルスキャンが完了しました：{verdict}",
    historyCleared: "検査履歴をクリアしました",
    noSource:
      "この過去のレポートにはソースコードが保存されていません。ローカルファイルを選択して再度表示してください。",
  },
} as const;
