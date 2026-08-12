/** Distillation workbench copy (aligned with the V3.0 prototype). */
export const distill = {
  jarvisTitle: "Jarvis Insights",
  insightRotate: "Next insight",
  insightDots: "Insight carousel",
  insightSelected: "{count} sessions selected · {turns} turns",
  insightWaiting: "{count} candidates awaiting approval",
  insightRuns: "{count} distillation runs",
  insightApproved: "{count} knowledge assets committed",
  insightEmpty:
    "Pick sessions and run distillation — Jarvis will build insights from real data.",
  help: "Help",
  compare: "Side-by-side",
  compareUnavailable:
    "Side-by-side compare is coming soon — not available in this version.",
  configTitle: "Distillation settings",
  quickTimeRange: "Time range",
  rangeAll: "All",
  range7: "Last 7 days",
  range30: "Last 30 days",
  quickGranularity: "Granularity",
  grainSession: "By session",
  grainProject: "By project",
  quickNote:
    "Distillation reads only session metadata (title / project / model / turns / time) — never the conversation content.",
  proMaterial: "Material library",
  proSelected: "{count} sessions selected",
  proModel: "Model",
  proOffline: "Offline fallback (deterministic)",
  proPresets: "Prompt presets",
  presetSummary: "Summarize",
  presetSkill: "Extract Skill",
  presetBrief: "Write brief",
  presetPromptSummary:
    "Summarize the key conclusions and reusable takeaways from these sessions.",
  presetPromptSkill:
    "Distill this into a reusable Skill spec covering purpose, steps and boundaries.",
  presetPromptBrief:
    "Write a brief covering the background, findings and recommendations.",
  proPromptPlaceholder: "Custom distillation prompt… (⌘↵ to run)",
  proRun: "Run",
  resultsTitle: "Results",
  expBrowse: "View SKILL.md",
  expEdit: "Edit",
  expRegenerate: "Regenerate",
  expSaveInstall: "Save & install",
  editHint:
    "Edits only affect “Save & install”, never the approved knowledge entry.",
  noCandidates: "No candidates yet",
  noCandidatesDesc:
    "Run distillation to produce candidates — they are persisted locally and survive a refresh.",
  saveTitle: "Save as Skill",
  saveDesc:
    "Write the approved knowledge note into the selected tool's skills directory; it then appears on the Skills page for syncing.",
  saveName: "Name",
  saveTarget: "Target tool",
  saveConfirm: "Save",
  savedToast: "Skill saved to {agent}",
  guideTitle: "What is distillation?",
  guideStep1: "Pick material",
  guideStep1Desc:
    "Choose 1–8 sessions from the material library as the source.",
  guideStep2: "Run distillation",
  guideStep2Desc:
    "AI produces a knowledge-note candidate from session metadata — never the conversation content.",
  guideStep3: "Approve & commit",
  guideStep3Desc:
    "Review the candidate; once approved it is written to the local knowledge store.",
  guideStep4: "Sync to tools",
  guideStep4Desc:
    "Save as a Skill and sync it to installed tools from the Skills page.",
  guideStart: "Get started",
} as const;
