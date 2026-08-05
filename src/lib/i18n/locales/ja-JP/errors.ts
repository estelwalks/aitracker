// AI 翻訳稿、審校待ち (2026-08)
export const errors = {
  generic: "操作に失敗しました。もう一度お試しください",
  skills: {
    emptyInput: "引数は空にできません",
    batchPathsCount: "一括アンインストールのパス数が不正です",
    batchPathsInvalid: "一括アンインストールのパスが不正です",
    installInvalid: "インストール引数が不正です",
    syncInvalid: "同期引数が不正です",
    blacklistInvalid: "ブラックリスト引数が不正です",
  },
  sessions: {
    filterInvalid: "セッションフィルターが不正です",
  },
  pricing: {
    modelListInvalid: "モデルリストが不正です",
  },
  market: {
    fieldInvalid: "マーケットのフィールド {field} が無効です",
    pagingFieldInvalid: "マーケットのページングフィールド {field} が無効です",
    invalidSkill: "マーケットが無効な Skill データを返しました",
    missingPaging: "マーケットのレスポンスにページング情報がありません",
    pagingRangeInvalid: "マーケットのページング範囲が無効です",
    invalidFormat: "マーケットが無効な形式を返しました",
    queryInvalid: "マーケットのクエリが無効です",
    pageNotPositive: "ページ番号は正の整数にしてください",
    limitRange: "1 ページあたりの件数は 1 〜 50 の範囲にしてください",
    searchTooLong: "検索キーワードは 100 文字以内にしてください",
    sortInvalid: "並び順パラメータが無効です",
    installInvalid: "インストールパラメータが無効です",
  },
} as const;
