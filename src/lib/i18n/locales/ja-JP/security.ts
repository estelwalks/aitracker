// AI 翻訳稿、審校待ち (2026-08)
export const security = {
  pageHeader: "セキュリティと防御",
  pageHeaderDesc:
    "実際のローカル Skill 検査、リスクレポート、明確なセキュリティ境界",
  pageDescription:
    "実際のローカルセキュリティエンジンで Skill を検査し、リスク、失敗した分岐、スキップしたファイルを確認します。",
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
    "組み込みルールライブラリ v{version} は {appName} アプリとともに更新されます。現在リモートのルール更新チャネルはないため、ネットワークリクエストは発生せず、偽の更新成功ステータスも表示されません。",
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
  center: {
    summary: "{skills} 個の Skill · {dimensions} 検査次元 · 健全度 {health}%",
    unavailable: {
      title: "ローカルコンパニオンサービスを利用できません",
      desc: "このブラウザページは {appName} のローカルコンパニオンに接続されていないため、ローカル Skill を読み取りません。デスクトップアプリからブラウザ入口を開いて再試行してください。",
      connecting: "ローカルコンパニオンサービスに接続しています…",
      connected: "ローカルコンパニオンサービス経由で安全に接続しました",
      retry: "再接続",
    },
    briefing: {
      title: "セキュリティ速報",
      allPassed: "すべて合格",
      needsAttention: "{count} 件を要確認",
      findingsDetected: "{count} 件を検出",
      detectionOnly: "検出のみ",
      monitorUnavailable: "監視を利用できません",
      activeDefenseDisabled: "能動的防御は無効",
      refresh: "次の情報",
      cleanLine:
        "最新結果では {total} 個の Skill を {dimensions} のセキュリティ次元で検査し、リスクは見つかりませんでした。",
      findingLine:
        "最新の {total} 個の Skill はすべて許可判定ですが、ルールで {findings} 件が検出されています。レポートを展開して確認してください。",
      riskyLine:
        "最新検査は {total} 個の Skill を対象とし、{risky} 個を要確認です。ブロック {danger}、警告 {warn}。",
      noReportLine:
        "実際の検査結果はまだありません。クイックスキャンでこの端末の Skill を検査してください。",
      boundaryLine:
        "現在は検出と通知のみです。外部 Agent の動作を阻止せず、実行時防御があるようには表示しません。",
      partialLine:
        "最新検査は一部完了です。静的結果は保持されています。モデル分岐、失敗、スキップを確認してください。",
      passed: "合格 {count}",
      warned: "警告 {count}",
      blocked: "ブロック {count}",
      lastScan: "{dimensions} 次元 · 最新 {time}",
      health: "健全度",
      quickScan: "クイックスキャン開始",
      fullScan: "詳細スキャン",
      selectDirectory: "Skill フォルダーを選択",
      directoryPickerUnavailable:
        "コンパニオンブラウザモードではネイティブのフォルダー選択を利用できません。検出済みのすべてのローカル Skill を検査できます。",
    },
    autoScan: {
      title: "自動スキャン",
      unavailable: "未有効 / 利用不可",
      unavailableDesc:
        "現在の実行環境には自動セキュリティスキャンの根拠がありません。上の操作から quick または full を手動実行してください。",
      quickOnly: "クイックモードのみ",
      desc: "バックグラウンド検査はローカル静的ルールのみを実行し、モデル呼び出しや料金は発生しません。",
      stepEnable: "① 巡回を有効化",
      stepEnableDesc: "ローカルのセキュリティ監視タスクが実行",
      stepMode: "② quick に固定",
      stepModeDesc: "モデルの Endpoint に内容を送信しません",
      stepReview: "③ 結果を確認",
      stepReviewDesc: "失敗とスキップは履歴に保持",
      settings: "スキャナー設定",
    },
    mode: {
      label: "スキャンモード",
      quick: "クイックスキャン",
      quickDesc: "静的ルールとファイル検査。モデル設定は不要です。",
      full: "詳細スキャン",
      fullDesc:
        "静的結果にモデルレビューと動作分析を追加し、料金が発生する場合があります。",
      modelRequired:
        "詳細スキャンにはモデル設定が必要で、クイックモードへ暗黙に切り替えません。",
    },
    phase: {
      idle: "待機中",
      running: "スキャン中",
      cancelling: "キャンセル要求中",
      complete: "スキャン完了",
      partial: "一部完了",
      failed: "スキャン失敗",
      cancelled: "キャンセル済み",
      modelRequired: "モデル設定が必要",
    },
    status: {
      latest: "最新スキャン · {time}",
      never: "未スキャン",
      discovered: "検出 Skill",
      scanned: "完了",
      safe: "安全",
      unsafe: "要確認",
      failed: "失敗",
      skipped: "スキップ",
      progress: "実際の進捗 {completed}/{total}",
    },
    vortex: {
      title: "全体セキュリティ検査 · {dimensions} 次元",
      cancel: "キャンセルを要求",
      current: "検査中 · {name}",
      waiting: "実際のスキャンイベントを待機中",
      progress: "進捗：{completed}/{total}",
      risks: "{count} 件のリスクを検出",
      failures: "失敗 {failed} · スキップ {skipped}",
    },
    metrics: {
      scannedSkills: "検査済み Skill",
      safe: "安全",
      unsafe: "要確認",
      dimensions: "検査次元",
      files: "検査ファイル",
      failed: "失敗 Skill",
      skipped: "スキップ Skill",
    },
    result: {
      title: "検査結果 · リスク項目",
      description: "{skills} 個の Skill · {findings} 件の検出",
      noReportTitle: "検査結果がありません",
      noReportDesc:
        "クイックまたは詳細スキャンを選択してください。すべての統計は実際のレポートから表示されます。",
      allPassed:
        "{skills} 個すべての Skill が {dimensions} 次元の検査に合格しました。",
      partialNotice:
        "この検査は一部のみ完了しました。静的結果は保持されていますが、詳細検査の完了とは見なしません。",
      failedNotice:
        "このタスクは失敗しました。他の成功した Skill の結果は保持されています。",
      localeMismatch:
        "このレポートは別の言語で生成されています。現在の言語で再検査してください。履歴は元の言語で読み取り専用表示されます。",
      rerunLocale: "現在の言語で再検査",
      skill: "Skill",
      verdict: "判定",
      score: "セキュリティスコア",
      findings: "検出項目",
      files: "ファイル",
      detail: "詳細",
      noFindings: "リスクは見つかりませんでした",
      branches: "スキャン分岐",
      skippedFiles: "スキップしたファイル",
      path: "相対パス",
      reason: "理由",
      findingSourceStatic: "静的ルール",
      findingSourceModel: "モデル分析",
      line: "{line} 行目",
      remediation: "修正案",
      summary: "レポート概要",
      statusComplete: "完了",
      statusPartial: "一部",
      statusFailed: "失敗",
      statusSkipped: "スキップ",
      statusCancelled: "キャンセル済み",
      errorUnavailable: "秘匿化された失敗詳細はありません",
    },
    history: {
      title: "検査履歴",
      count: "{count} 件 · 新しい順",
      all: "すべて",
      safe: "安全",
      unsafe: "要確認",
      day: "24 時間",
      week: "7 日",
      month: "30 日",
      empty: "条件に一致する実際の検査履歴はありません。",
      scopeAll: "全体検査 · Skill",
      scopeSingle: "単一 Skill",
      covered: "{skills} 個の Skill · 安全 {safe} / 要確認 {unsafe}",
      generatedLocale: "レポート言語：{locale}",
    },
    model: {
      title: "詳細スキャンのモデル設定",
      desc: "API Key は Electron safeStorage によりメインプロセスで暗号化され、この画面や通常の設定には保存されません。",
      provider: "API プロトコル",
      openai: "OpenAI 互換",
      anthropic: "Anthropic Messages",
      endpoint: "Endpoint",
      apiKey: "API Key",
      apiKeyConfigured: "安全に保存済み。空欄なら変更しません",
      apiKeyMissing: "未設定",
      liteModel: "軽量モデル",
      proModel: "高性能モデル",
      timeoutMs: "タイムアウト（ミリ秒）",
      contextWindowTokens: "コンテキストウィンドウ Token",
      maxAgentTurns: "最大 Agent ターン数",
      save: "設定を保存",
      saving: "保存中",
      cancel: "キャンセル",
      configure: "モデルを設定",
      update: "モデル設定を更新",
      configuredState:
        "モデル認証情報は安全に保存され、手動の詳細スキャンを実行できます。",
      missingState:
        "モデル設定は未完了ですが、クイックスキャンは引き続き利用できます。",
      requiredTitle: "モデル設定が必要",
      requiredDesc:
        "有効な Endpoint、API Key、軽量モデル、高性能モデルを保存してから詳細スキャンを開始してください。",
      encryptionUnavailable:
        "このシステムでは安全な鍵暗号化を利用できないため、API Key を保存できません。",
      encryptionAvailable:
        "安全な鍵暗号化を利用できます。API Key はメインプロセスでのみ暗号化保存されます。",
    },
    verdict: {
      allow: "許可",
      warn: "警告",
      block: "ブロック",
      unknown: "不明",
    },
    severity: { critical: "重大", high: "高", medium: "中", low: "低" },
    branch: {
      static: "静的ルール",
      ruleReview: "ルールレビュー",
      singleFileAnalysis: "単一ファイル分析",
      multiFileAnalysis: "複数ファイル動作分析",
      complete: "完了",
      skipped: "スキップ",
      failed: "失敗",
    },
    skipReason: {
      fileUnavailable: "収集中にファイルを利用できなくなりました",
      symbolicLink: "パス逸脱を防ぐためシンボリックリンクを検査しませんでした",
      depthLimit: "許可された最大ディレクトリ深度を超えました",
      fileLimit: "許可された最大ファイル数を超えました",
      skillSizeLimit: "許可された Skill の合計サイズを超えました",
      fileSizeLimit: "許可された単一ファイルのサイズを超えました",
      binaryFile: "バイナリファイルはテキスト分析されません",
      scannerSkip:
        "スキャナーの安全ポリシーによりこのファイルをスキップしました",
      unknown: "安全に表示できるスキップ理由はありません",
    },
    risk: {
      remote_execution: "リモート実行",
      command_injection: "コマンド注入",
      data_exfiltration: "データ流出",
      secret_access: "シークレットアクセス",
      persistence: "永続化",
      destructive: "破壊的動作",
      obfuscation: "難読化",
      privilege_escalation: "権限昇格",
      sensitive_file_access: "機密ファイルアクセス",
      network_abuse: "ネットワーク悪用",
      prompt_injection: "プロンプト注入",
    },
    toast: {
      started: "実際のスキャンタスクを開始しました",
      cancelled:
        "キャンセルを要求しました。実行中の処理が先に完了する場合があります",
      completed: "スキャンが完了しました",
      partial: "一部完了です。失敗した分岐を確認してください",
      failed: "スキャンに失敗しました",
      modelSaved: "モデル設定を安全に保存しました",
      directorySelected: "Skill フォルダーを選択しました",
    },
  },
} as const;
