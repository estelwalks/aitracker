// AI 翻訳稿、審校待ち (2026-08)
/** 蒸留ワークベンチの文案（V3.0 プロトタイプに合わせる）。 */
export const distill = {
  jarvisTitle: "Jarvis インサイト",
  insightRotate: "次のインサイト",
  insightDots: "インサイトカルーセル",
  insightSelected: "選択 {count} セッション · 計 {turns} ターン",
  insightWaiting: "承認待ちの候補が {count} 件あります",
  insightRuns: "蒸留を {count} 回実行しました",
  insightApproved: "ナレッジ資産を {count} 件取り込みました",
  insightEmpty:
    "セッションを選んで蒸留を実行すると、Jarvis が実際のデータからインサイトを生成します。",
  help: "ヘルプ",
  compare: "並べて比較",
  compareUnavailable:
    "並べて比較は近日公開予定です。このバージョンでは利用できません。",
  configTitle: "蒸留設定",
  quickTimeRange: "期間",
  rangeAll: "すべて",
  range7: "過去 7 日",
  range30: "過去 30 日",
  quickGranularity: "粒度",
  grainSession: "セッション単位",
  grainProject: "プロジェクト単位",
  quickNote:
    "蒸留はセッションのメタデータ（タイトル / プロジェクト / モデル / ターン数 / 時間）のみを読み取り、会話本文は一切読みません。",
  proMaterial: "素材ライブラリ",
  proSelected: "{count} セッションを選択",
  proModel: "モデル",
  proOffline: "オフライン回退（決定的）",
  proPresets: "プロンプトプリセット",
  presetSummary: "要約",
  presetSkill: "Skill を抽出",
  presetBrief: "ブリーフ作成",
  presetPromptSummary:
    "これらのセッションの主な結論と再利用可能な知見を要約してください。",
  presetPromptSkill:
    "目的・手順・境界を含む再利用可能な Skill 仕様にまとめてください。",
  presetPromptBrief: "背景・発見・推奨事項を含むブリーフを作成してください。",
  proPromptPlaceholder: "蒸留プロンプトをカスタマイズ…（⌘↵ で実行）",
  proRun: "実行",
  resultsTitle: "結果",
  expBrowse: "SKILL.md を表示",
  expEdit: "編集",
  expRegenerate: "再生成",
  expSaveInstall: "保存してインストール",
  editHint:
    "編集は「保存してインストール」にのみ反映され、承認済みナレッジには影響しません。",
  noCandidates: "候補はまだありません",
  noCandidatesDesc:
    "蒸留を実行すると候補がローカルに保存され、このリストに表示されます。リロード後も保持されます。",
  saveTitle: "Skill として保存",
  saveDesc:
    "承認済みナレッジノートを選択したツールの skills ディレクトリに書き込みます。保存後は「スキル」ページで確認・同期できます。",
  saveName: "名前",
  saveTarget: "対象ツール",
  saveConfirm: "保存",
  savedToast: "{agent} に Skill を保存しました",
  guideTitle: "蒸留とは？",
  guideStep1: "素材を選ぶ",
  guideStep1Desc: "素材ライブラリから 1〜8 個のセッションを選択します。",
  guideStep2: "蒸留を実行",
  guideStep2Desc:
    "AI がセッションのメタデータからナレッジノートの候補を生成します。会話本文は読みません。",
  guideStep3: "承認して取り込み",
  guideStep3Desc: "候補を確認し、承認するとローカルナレッジに書き込みます。",
  guideStep4: "ツールへ同期",
  guideStep4Desc:
    "Skill として保存し、「スキル」ページでインストール済みツールに同期します。",
  guideStart: "はじめる",
} as const;
