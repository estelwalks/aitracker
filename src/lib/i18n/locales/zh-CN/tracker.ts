export const tracker = {
  title: "燃烧榜",
  desc: "行为诊断式浪费榜单：从真实 Token 数据中识别低效消耗并给出优化建议。",
  metric: {
    tokens: "总消耗",
    events: "事件数",
    entries: "上榜条目",
  },
  board: {
    skill: "Skill 消耗榜",
    project: "项目消耗榜",
    session: "会话消耗榜",
  },
  row: {
    tokens: "{count} tokens",
    events: "{count} 事件",
    calls: "{count} 次调用",
    waste: "浪费指数",
    cacheRate: "缓存命中 {rate}",
    outputRatio: "输出占比 {ratio}",
    suggest: "建议优化",
    trendUp: "环比上升",
    trendDown: "环比下降",
    trendFlat: "环比持平",
    trendNa: "无环比",
  },
  suggest: {
    cache: "缓存命中率偏低，建议复用上下文以提升缓存命中。",
    output: "输出 Token 占比偏高，建议精简输出或启用压缩。",
    volume: "消耗量较大，建议检查相关任务规模与重复扫描。",
    none: "暂无明显优化点。",
  },
  detail: {
    wasteDetail: "浪费拆解",
    close: "关闭",
  },
  empty: "暂无可用数据",
  emptyDesc: "扫描到真实用量后，这里会展示按浪费指数排序的榜单。",
} as const;
