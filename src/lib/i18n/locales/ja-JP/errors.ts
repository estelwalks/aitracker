// AI 翻訳稿、審校待ち (2026-08)
export const errors = {
  generic: "操作に失敗しました。もう一度お試しください",
  sources: {
    migrateInvalid: "移行引数が不正です",
  },
  security: {
    dailyLimitReached: "本日のローカルスキャン枠（{limit} 回）を使い切りました",
    fileRequired:
      "SKILL.md またはそれを含む Skill フォルダーを選択してください",
    fileTypeInvalid:
      "SKILL.md 単体のファイル、または SKILL.md を含む Skill フォルダーのみ対応しています",
    fileTooLarge:
      "ファイルが大きすぎます。100MB 以内のファイルを選択してください",
    notTextFile: "SKILL.md は解析可能なテキストファイルではありません",
  },
  skills: {
    emptyInput: "引数は空にできません",
    batchPathsCount: "一括アンインストールのパス数が不正です",
    batchPathsInvalid: "一括アンインストールのパスが不正です",
    installInvalid: "インストール引数が不正です",
    syncInvalid: "同期引数が不正です",
    blacklistInvalid: "ブラックリスト引数が不正です",
    invalidName: "Skill 名が不正です",
    pathOutsideManaged: "パスが管理対象の Skill ルート内にありません",
    symlinkEscape: "権限外のパスまたはシンボリックリンクを検出しました",
    notManagedDir: "対象は管理対象の Skill ディレクトリではありません",
    recycleWriteFailed: "リサイクルディレクトリへの書き込みに失敗しました",
    marketSymlinkForbidden:
      "マーケットの Skill ソースにシンボリックリンクは許可されません",
    marketSourceNotDir:
      "マーケットの Skill ソースはディレクトリである必要があります",
    marketSourceSymlink:
      "マーケットの Skill ソースにシンボリックリンクを含めることはできません",
    invalidSourcePath: "マーケットの Skill ソースパスが不正です",
    sourceOutsideTemp:
      "マーケットの Skill ソースが管理対象の一時ディレクトリ外にあります",
    marketRootNeedsSkillMd:
      "マーケットの Skill ルートには通常ファイル SKILL.md が必要です",
    unsupportedAgent: "対象 Agent はサポートされていません",
    blacklisted: "この Skill はブラックリストに登録されています",
    copySymlinkForbidden: "シンボリックリンクのコピーは許可されていません",
    invalidTargetPath: "対象パスが不正です",
    overlappingPaths:
      "ソースと対象パスが重複しているため、操作をブロックしました",
    duplicateName: "対象に同名の Skill がすでに存在します",
    noSkillSelected: "少なくとも 1 つの Skill を選択してください",
    notFound: "Skill が見つからないか、読み取れません",
  },
  sessions: {
    filterInvalid: "セッションフィルターが不正です",
    queryFailed: "ローカルセッションの照会に失敗しました。再試行してください",
    sessionNotFound: "選択したセッションが存在しないか利用できません",
    resumeUnavailable: "このセッションは現在復元できません",
    resumeInvalid: "セッション復元リクエストが無効です",
    resumeCancelled: "セッション復元はキャンセルされました",
    resumeFailed: "ローカルセッション復元を開始できませんでした",
    transcriptUnavailable: "セッションの会話を読み取れませんでした",
  },
  memory: {
    invalidInput: "メモリ内容が不正です",
    notFound: "メモリ項目が見つかりません",
    conflict: "メモリ項目が他の操作によって変更されました",
    invalidTransition: "メモリ項目の状態ではこの操作は実行できません",
    writeFailed: "メモリの保存に失敗しました。再試行してください",
  },
  distillation: {
    invalidSelection: "1〜8 個の重複しないセッションを選択してください",
    sessionNotFound: "選択したセッションが存在しないか利用できません",
    cancelled: "蒸留はキャンセルされました",
    notFound: "候補が存在しません",
    notWaiting: "候補は承認待ちではありません",
    knowledgeUnavailable: "ナレッジストアが利用できません",
    knowledgeFailed: "ナレッジエントリの書き込みに失敗しました",
    notApproved: "Skill として保存する前に候補を承認してください",
    invalidName: "Skill 名が無効です",
    invalidAgent: "対象ツールが利用できません",
    skillExists: "同名の Skill が既に存在します。別の名前を選択してください",
    quotaExceeded:
      "今日の公式モデル蒸留枠は使い切りました（1 日 {limit} 回）。明日以降に再試行するか、モデル管理をご確認ください",
  },
  modelProfile: {
    nameRequired: "設定名を入力してください",
    nameTooLong: "設定名は 64 文字以内にしてください",
    invalidMode: "設定モードが不正です",
    invalidProtocol: "プロトコルが不正です",
    invalidUrl: "エンドポイントは有効な http/https URL にしてください",
    invalidModel: "モデル名が不正です（英数字/._:/- のみ、最大 120 文字）",
    apiKeyRequired: "API Key を入力してください",
    apiKeyTooShort: "API Key は 8 文字以上にしてください",
    apiKeyTooLong: "API Key は 512 文字以内にしてください",
    notFound: "このモデル設定は存在しないか、削除されました",
    testFailed:
      "接続テストに失敗しました。エンドポイント・API Key・ネットワークを確認してください",
    testTimeout: "接続テストがタイムアウトしました（5 秒）",
    listFailed:
      "モデル一覧の取得に失敗しました。エンドポイント、API Key、ネットワークを確認してください",
  },
  pricing: {
    modelListInvalid: "モデルリストが不正です",
    rateResponseIncomplete: "為替レートの応答が不完全です",
    rateMissingCurrency: "為替レートの応答に通貨がありません",
    rateRefreshFailed:
      "為替レートの更新に失敗しました。後でもう一度お試しください",
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
    schema: {
      invalidSkillParam: "Skill パラメータが無効です",
      invalidInstallField: "Skill インストールフィールド {field} が無効です",
      agentRequired: "少なくとも 1 つの Agent を選択してください",
      unsupportedAgent: "サポートされていない Agent が含まれています",
    },
    api: {
      http: "マーケット API リクエストに失敗しました（HTTP {status}）",
      networkTimeout:
        "ネットワークが利用できません：Skill マーケットのリクエストがタイムアウトし、ローカルキャッシュもありません",
    },
    archive: {
      tarNumericField:
        "ダウンロードに無効な tar 数値フィールドが含まれています",
      tarChecksum: "ダウンロードの tar チェックサムが無効です",
      invalidPath: "ダウンロードに無効なパスが含まれています",
      absolutePath: "ダウンロードに絶対パスが含まれています：{path}",
      pathTraversal: "ダウンロードにパストラバーサルが含まれています：{path}",
      tooManyEntries: "ダウンロードが 1000 エントリの上限を超えています",
      fileTooLarge: "ダウンロードに大きすぎるファイルが含まれています：{path}",
      tarTruncated: "ダウンロードの tar コンテンツが不完全です",
      paxBadLink:
        "ダウンロードの PAX メタデータに許可されないリンク先があります",
      badLinkEntry:
        "ダウンロードに許可されないリンクまたは特殊エントリが含まれています：{path}",
      unpackedTooLarge: "ダウンロードが解凍後 40 MB の上限を超えています",
      emptyTar: "ダウンロードが空、または有効な tar アーカイブではありません",
      tarTooLarge: "ダウンロードが 20 MB の上限を超えています",
      emptyDownload: "ダウンロードエンドポイントがコンテンツを返しませんでした",
      downloadHttp: "Skill のダウンロードに失敗しました（HTTP {status}）",
      notGzip: "ダウンロードコンテンツが有効な gzip アーカイブではありません",
      inflateFailed: "ダウンロードを展開できないか、サイズ上限を超えています",
      downloadTimeout:
        "Skill のダウンロードがタイムアウトしました。ネットワークを確認して再試行してください",
    },
    install: {
      diskFull: "ディスク容量が不足しています。容量を空けて再試行してください",
      invalidName: "Skill 名が不正です",
      pathTraversal: "ダウンロードにパストラバーサルが含まれています：{path}",
      parentDirEscape:
        "ダウンロードファイルの親ディレクトリが展開先を越えています：{path}",
      duplicateEntry: "ダウンロードに重複エントリが含まれています：{path}",
      noSkillMd: "ダウンロード内に SKILL.md が見つかりません",
      multipleSkillRoots:
        "ダウンロードに複数の Skill ルートが含まれており、安全にインストール先を特定できません",
      rootOutsideTemp: "Skill ルートが一時ディレクトリの境界を越えています",
    },
    outcome: {
      installedAll: "{count} 個の Agent に正常にインストールしました。",
      partialCount:
        "{succeeded} 個の Agent が成功し、{failed} 個が失敗しました。",
      failedAll: "すべての対象でインストールに失敗しました。",
      scanBlocked:
        "静的スキャンで高リスクルールを検出したため、インストールをブロックしました。",
      targetBlocked:
        "静的スキャンが不合格のため、インストールをスキップしました",
    },
  },
  usage: {
    configNotJson: "設定が有効な JSON ではありません",
    adapterConfigInvalid: "アダプター設定が無効です",
    retentionNonNegative: "保持日数は 0 以上の整数にしてください",
    retentionRange: "保持日数が許可された範囲外です",
  },
} as const;
