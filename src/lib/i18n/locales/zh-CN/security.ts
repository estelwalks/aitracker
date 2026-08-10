export const security = {
  pageHeader: "安全检测",
  pageHeaderDesc: "仅支持 SKILL.md 与 Skill 文件夹 · 11 个安全维度本地静态扫描",
  pageDescription: "仅在本地解析 SKILL.md 的 11 维静态安全检测。",
  stats: {
    scanned: "累计扫描",
    averageDuration: "平均耗时",
    rulesVersion: "规则库版本",
  },
  verdict: {
    all: "全部",
    safe: "安全",
    suspicious: "可疑",
    dangerous: "危险",
  },
  severity: {
    high: "高危",
    medium: "中危",
    low: "低危",
  },
  source: {
    builtin: "内置规则",
    custom: "用户规则",
  },
  phase: {
    idle: "空闲",
    scanning: "扫描中",
    done: "已完成",
  },
  scanSteps: {
    read: "读取本地 SKILL.md",
  },
  rulesNotice:
    "内置规则库 v{version}，随 {appName} 应用更新；当前没有远端规则库更新通道，因此不会发起网络请求或显示伪造的更新成功状态。",
  dropzone: {
    title: "拖入 SKILL.md 或 Skill 文件夹以开始扫描",
    hint: "仅支持 SKILL.md / 含 SKILL.md 的目录 · 单文件最大 100MB · 本地解析，不上传源码",
    tccHint:
      "选择文稿/下载/桌面中的文件时，首次需系统授权；应用不请求其他目录权限",
    selectFile: "选择 SKILL.md",
    selectFolder: "选择文件夹",
    remaining: "今日剩余 {remaining} / {limit} 次",
  },
  scanning: {
    title: "本地扫描中 · {progress}%",
  },
  history: {
    title: "检测历史（近 30 天）",
    clear: "清除历史",
    loading: "正在加载检测历史…",
    empty: "尚未执行扫描。",
    searchPlaceholder: "搜索检测名称…",
    showing: "展示 {shown} / {total} 条",
  },
  report: {
    title: "安全报告 · {name}",
    viewSource: "查看源码",
    verdictLabel: "综合判定：{verdict}",
    riskScore: "/ 100 风险评分",
    riskHits: "{count} 项命中 · {duration}",
    pass: "通过",
    hits: "{count} 项命中",
    noRisks: "11 个维度均未命中静态风险规则。",
    riskDetails: "非通过项详情",
    reviewTitle: "综合审查意见",
    sourceTitle: "本地源：{name}",
    sourceTruncated: "… 已省略其余本地内容（未上传）",
  },
  privacy: {
    statement: "结论仅来自本地静态规则；未上传 SKILL.md、代码片段或命中详情。",
  },
  review: {
    safe: "当前静态规则未发现风险；静态扫描不能替代对 Skill 行为和来源的人工审阅。",
    suspicious:
      "发现需人工确认的静态风险信号；建议在安装前审阅上述命中行及其上下文。",
    dangerous:
      "发现高危静态风险信号；建议不要安装或执行此 Skill，完成独立人工审查后再决定。",
  },
  confirm: {
    deleteReport: "删除当前报告并重置扫描器？历史记录将保留。",
    clearHistory: "清除近 30 天的全部检测历史？此操作不可恢复。",
  },
  toast: {
    scanDone: "本地扫描完成：{verdict}",
    historyCleared: "已清除检测历史",
    noSource: "此历史报告未保存源码；请重新选择本地文件查看。",
  },
} as const;
